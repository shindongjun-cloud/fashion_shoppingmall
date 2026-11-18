// 주문 생성 (서버 전용). 결제 승인 이후는 lib/payment.ts, 결제 후 주문 처리(취소·배송·구매확정)는 lib/order.ts
// 서버 액션(app/checkout/actions.ts)이 이 파일을 씁니다.
//   회원:   placeOrder(customerId, ...)      — 로그인 확인은 호출하는 쪽, 배송지는 주소록에서
//   비회원: placeGuestOrder(input, ...)      — 주문자·배송지 직접 입력 + 주문 비밀번호 + 개인정보 동의, 쿠폰·포인트 없음
import { randomUUID } from "crypto";
import type { OrderChannel, Prisma, ShippingRegion } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCartSkus, type CartSku } from "@/lib/catalog";
import { findQtyLimitViolation } from "@/lib/cart-rules";
import { blindIndex, decrypt, encrypt, encryptOrNull, normalizeEmail, normalizePhone } from "@/lib/crypto";
import { InsufficientStockError, isBusyError, isConstraintError, releaseOrder, reserveOrder, withBusyRetry } from "@/lib/inventory";
import { computeShipping, currentShippingPolicy, findZone, generateOrderNo, OrderError, orderStatusData, type ShippingQuote } from "@/lib/order-rules";
import { createGuestSession, GUEST_PRIVACY_VERSION, guestPasswordProblem, hashGuestPassword } from "@/lib/guest";
import { couponOptionsFor, reserveOrderCoupons } from "@/lib/coupon";
import { applyCoupon, type CouponApplied, type CouponOption } from "@/lib/coupon-rules";

export type PlaceOrderResult =
  | { paymentOrderId: string; orderNo: string; orderName: string; amount: number }
  | { error: string };
export type PlaceGuestOrderResult = (Extract<PlaceOrderResult, { orderNo: string }> & { guestToken: string; guestTokenMaxAge: number }) | { error: string };

type CartLine = { skuId: number; quantity: number };

/** 받는 분 연락처(암호문) → 조회용 해시 (형식이 이상하면 null) */
export function recipientPhoneHash(phoneEnc: string) {
  const normalized = normalizePhone(decrypt(phoneEnc));
  return normalized ? blindIndex("phone", normalized) : null;
}

export type PlaceOrderOptions = {
  /** 배송지(주소록 id). 없으면 기본 배송지 */
  addressId?: number;
  channel?: OrderChannel;
  /** 결제 화면에서 고른 쿠폰 1장 (CustomerCoupon id, 없으면 쿠폰 없이). 금액은 서버가 다시 계산 */
  couponId?: number | null;
};

// ---------------------------------------------------------------
// 공통: 장바구니 검사 → 서버 가격 → 배송비
// ---------------------------------------------------------------
type Prepared = {
  skus: CartSku[];
  lines: { sku: CartSku; quantity: number }[];
  lineAmounts: { lineListTotal: number; lineDiscountTotal: number; lineTotal: number }[];
  itemsListTotal: number;
  itemsDiscountTotal: number;
  itemsTotal: number;
  shipping: ShippingQuote;
  amount: number;
  orderName: string;
  /** 쿠폰 (회원만) */
  coupons: { applied: CouponApplied; options: CouponOption[] } | null;
};

async function prepare(items: CartLine[], zipCode: string, now: Date): Promise<Prepared | { error: string }> {
  // ⚠️ 브라우저에서 온 값은 사용자가 마음대로 바꿀 수 있으니 전부 검사합니다.
  const valid =
    Array.isArray(items) &&
    items.length > 0 &&
    items.length <= 50 &&
    items.every((item) => Number.isInteger(item.skuId) && Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 99);
  const skuIds = valid ? items.map((item) => item.skuId) : [];
  if (!valid || new Set(skuIds).size !== skuIds.length) return { error: "장바구니 정보가 올바르지 않아요." };

  const skus = await getCartSkus(skuIds);
  if (skus.length !== skuIds.length) return { error: "판매하지 않는 상품이 장바구니에 있어요." };
  const lines = items.map((item) => ({ sku: skus.find((s) => s.id === item.skuId)!, quantity: item.quantity }));

  // 판매 상태·재고 사전 확인 (안내용. 실제로 재고를 지키는 것은 아래 예약 + DB 트리거)
  for (const { sku, quantity } of lines) {
    const label = `${sku.styleName} (${sku.colorName}/${sku.sizeName})`;
    if (!sku.sellable) return { error: `${label}은 판매가 중지됐어요.` };
    if (sku.stock < quantity) return { error: `${label} 재고가 부족해요. (남은 수량 ${sku.stock}개)` };
  }
  const overLimit = findQtyLimitViolation(lines);
  if (overLimit) return { error: `${overLimit.styleName}은 1회 주문 시 ${overLimit.maxQtyPerOrder}개까지 살 수 있어요.` };

  // ⚠️ 금액은 반드시 서버에서, DB에 있는 가격으로 계산합니다. (쿠폰·포인트 몫은 ⑬⑭ 전까지 0)
  const lineAmounts = lines.map(({ sku, quantity }) => ({
    lineListTotal: sku.listPrice * quantity,
    lineDiscountTotal: sku.discountAmount * quantity,
    lineTotal: sku.price * quantity,
  }));
  const sum = (key: keyof (typeof lineAmounts)[number]) => lineAmounts.reduce((n, l) => n + l[key], 0);
  const itemsTotal = sum("lineTotal");
  let shipping: ShippingQuote;
  try {
    const policy = await currentShippingPolicy(prisma, now);
    shipping = computeShipping(policy, await findZone(prisma, policy.id, zipCode), itemsTotal);
  } catch (e) {
    if (e instanceof OrderError) return { error: e.message };
    throw e;
  }
  const firstName = lines[0].sku.styleName;
  return {
    skus,
    lines,
    lineAmounts,
    itemsListTotal: sum("lineListTotal"),
    itemsDiscountTotal: sum("lineDiscountTotal"),
    itemsTotal,
    shipping,
    amount: itemsTotal + shipping.fee,
    orderName: lines.length > 1 ? `${firstName} 외 ${lines.length - 1}건` : firstName,
    coupons: null,
  };
}

/** 고른 쿠폰을 서버에서 다시 계산해 금액에 반영 (내 쿠폰인지·대상인지·조건은 DB에서 다시 읽어 판단) */
async function withCoupons(p: Prepared, customerId: number, couponId: number | null | undefined, now: Date): Promise<Prepared | { error: string }> {
  if (couponId === undefined || couponId === null) return p;
  // 쿠폰은 주문당 1장 (브라우저에서 온 값이므로 형식부터 검사)
  if (!Number.isInteger(couponId) || couponId < 1) return { error: "쿠폰 선택 정보가 올바르지 않아요. 새로고침해 주세요." };
  const options = await couponOptionsFor(customerId, p.skus.map((s) => ({ id: s.id, discountAmount: s.discountAmount })), now);
  // 내 "지금 쓸 수 있는 쿠폰"에 없음 = 만료·사용됨·다른 결제에서 사용 중·남의 쿠폰 (조건 미달과 구분해서 안내)
  if (!options.some((o) => o.id === couponId)) return { error: "선택한 쿠폰을 지금 쓸 수 없어요. 만료됐거나 다른 주문에서 쓰였을 수 있어요. 새로고침해 주세요." };
  const applied = applyCoupon(
    p.lines.map(({ sku }, i) => ({ skuId: sku.id, lineTotal: p.lineAmounts[i].lineTotal })),
    p.shipping.baseFee,
    options,
    couponId,
  );
  if ("error" in applied) return { error: `${applied.error} 다른 쿠폰을 고르거나 쿠폰 없이 결제해 주세요.` };
  const amount = p.itemsTotal - applied.couponDiscountTotal + p.shipping.fee - applied.shippingDiscount;
  if (amount < 1) return { error: "쿠폰 할인 후 결제 금액이 0원이 되어 주문할 수 없어요." };
  return { ...p, amount, coupons: { applied, options } };
}

type AddressSnapshot = {
  sourceAddressId: number | null;
  recipientEnc: string;
  phoneEnc: string;
  phoneHash: string | null;
  zipCode: string;
  address1Enc: string;
  address2Enc: string | null;
  deliveryMemoEnc: string | null;
};
type OrdererSnapshot = { ordererNameEnc: string | null; ordererPhoneEnc: string | null; ordererPhoneHash: string | null; ordererEmailEnc: string | null };

/** 주문 + 상품 줄 + 배송지 스냅샷 + 재고 예약 (트랜잭션 안) */
async function insertOrder(
  tx: Prisma.TransactionClient,
  p: Prepared,
  o: { orderNo: string; paymentOrderId: string; customerId: number | null; channel: OrderChannel; orderer: OrdererSnapshot; address: AddressSnapshot; region: ShippingRegion; now: Date },
) {
  const { now } = o;
  const order = await tx.order.create({
    data: {
      orderNo: o.orderNo,
      paymentOrderId: o.paymentOrderId,
      orderName: p.orderName,
      customerId: o.customerId,
      ordererType: o.customerId === null ? "GUEST" : "MEMBER",
      channel: o.channel,
      ...orderStatusData("PENDING", now, "CUSTOMER"),
      itemsListTotal: p.itemsListTotal,
      itemsDiscountTotal: p.itemsDiscountTotal,
      itemsTotal: p.itemsTotal,
      couponDiscountTotal: p.coupons?.applied.couponDiscountTotal ?? 0,
      shippingDiscount: p.coupons?.applied.shippingDiscount ?? 0,
      shippingBaseFee: p.shipping.baseFee,
      shippingExtraFee: p.shipping.extraFee,
      shippingFee: p.shipping.fee,
      totalPrice: p.amount,
      shippingPolicyId: p.shipping.policyId,
      freeShippingThreshold: p.shipping.threshold,
      ...o.orderer,
      createdAt: now,
      items: {
        create: p.lines.map(({ sku, quantity }, i) => ({
          lineNo: i + 1,
          skuId: sku.id,
          quantity,
          listPrice: sku.listPrice,
          discountAmount: sku.discountAmount,
          price: sku.price,
          promotionId: sku.promotionId,
          promotionName: sku.promotionName,
          ...p.lineAmounts[i],
          couponAllocated: p.coupons?.applied.lineCouponAllocated[i] ?? 0,
          payAmount: p.lineAmounts[i].lineTotal - (p.coupons?.applied.lineCouponAllocated[i] ?? 0),
          styleCode: sku.styleCode,
          skuCode: sku.skuCode,
          styleName: sku.styleName,
          colorName: sku.colorName,
          sizeName: sku.sizeName,
          imageUrl: sku.imageUrl,
          statusChangedAt: now,
          statusChangedBy: "CUSTOMER",
          createdAt: now,
        })),
      },
    },
    include: { items: { select: { id: true, skuId: true, quantity: true }, orderBy: { lineNo: "asc" } } },
  });
  // 쿠폰 예약 (주문 쿠폰 + 줄별 배분). 같은 쿠폰이 다른 주문에서 쓰이는 중이면 DB가 거부 → 트랜잭션 전체 취소
  if (p.coupons) await reserveOrderCoupons(tx, order.id, order.items, p.coupons.applied, p.coupons.options, now);
  await tx.orderShippingAddress.create({ data: { orderId: order.id, ...o.address, region: o.region, createdAt: now } });
  // 재고 예약: 하나라도 부족하면 예외 → 트랜잭션 전체 취소 (주문도 안 만들어짐)
  await reserveOrder(tx, order.id, order.items.map((i) => ({ orderItemId: i.id, skuId: i.skuId, qty: i.quantity })), now);
  return order;
}

/** 주문번호가 우연히 겹치면(1억분의 1) 새 번호로 다시, 잠금 충돌이면 다시 */
async function withNewOrderNo<T>(now: Date, fn: (orderNo: string) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const orderNo = generateOrderNo(now);
    try {
      return await withBusyRetry(() => fn(orderNo));
    } catch (e) {
      if (attempt < 3 && isConstraintError(e, "orderNo")) continue;
      throw e;
    }
  }
}

function friendlyOrderError(e: unknown, skus: CartSku[]): { error: string } {
  if (isConstraintError(e, "Order_customer_active")) return { error: "주문할 수 없는 회원 상태예요. (탈퇴 신청·정지·휴면 회원)" };
  if (isConstraintError(e, "Order_shipping_rule")) return { error: "배송비 규칙이 바뀌었어요. 새로고침해서 금액을 다시 확인해 주세요." };
  if (isConstraintError(e, "OrderCoupon_coupon_unavailable")) return { error: "선택한 쿠폰을 지금 쓸 수 없어요. 다른 결제(탭)에서 사용 중이거나 이미 사용·만료됐어요. 새로고침해 주세요." };
  if (isConstraintError(e, "OrderCoupon_") || isConstraintError(e, "OrderItemCoupon_")) return { error: "쿠폰 사용 조건이 바뀌었어요. 새로고침해서 쿠폰을 다시 골라 주세요." };
  if (isBusyError(e)) return { error: "주문이 몰려 처리하지 못했어요. 잠시 후 다시 시도해 주세요." };
  if (e instanceof InsufficientStockError) {
    const sku = skus.find((s) => s.id === e.skuId)!;
    return { error: `${sku.styleName} (${sku.colorName}/${sku.sizeName}) 재고가 부족해요. 방금 다른 고객이 구매했어요.` };
  }
  throw e;
}

// ---------------------------------------------------------------
// 1) 회원 주문
// ---------------------------------------------------------------
export async function placeOrder(customerId: number, items: CartLine[], now = new Date(), options: PlaceOrderOptions = {}): Promise<PlaceOrderResult> {
  if (options.addressId !== undefined && (!Number.isInteger(options.addressId) || options.addressId < 1)) {
    return { error: "배송지를 다시 선택해 주세요." };
  }
  // 배송지: 고른 주소록(내 것만) 또는 기본 배송지. 주문에는 이 값을 "복사"해 둠 → 나중에 주소록을 바꿔도 주문 배송지는 그대로
  const address = await prisma.customerAddress.findFirst({
    where: { customerId, ...(options.addressId !== undefined ? { id: options.addressId } : { isDefault: true }) },
  });
  if (!address) {
    return { error: options.addressId !== undefined ? "선택한 배송지를 찾을 수 없어요. 다시 선택해 주세요." : "배송지를 먼저 등록해 주세요. (내 정보 > 배송지)" };
  }
  const prepared = await prepare(items, address.zipCode, now);
  if ("error" in prepared) return prepared;
  const p = await withCoupons(prepared, customerId, options.couponId, now);
  if ("error" in p) return p;
  const paymentOrderId = `order_${randomUUID()}`;

  // 주문자 정보 스냅샷: 프로필의 암호문을 그대로 복사 (같은 키). 프로필에 없으면 로그인 계정(GitHub) 이름·이메일을 암호화
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId }, include: { profile: true, user: { select: { name: true, email: true } } } });
  const orderer: OrdererSnapshot = {
    ordererNameEnc: customer.profile?.nameEnc ?? encryptOrNull(customer.user?.name?.trim()),
    ordererPhoneEnc: customer.profile?.phoneEnc ?? null,
    ordererPhoneHash: customer.profile?.phoneHash ?? null,
    ordererEmailEnc: customer.profile?.contactEmailEnc ?? encryptOrNull(customer.user?.email?.trim()),
  };

  try {
    const orderNo = await withNewOrderNo(now, (orderNo) =>
      prisma.$transaction(async (tx) => {
        // 같은 고객의 이전 "결제 대기" 주문은 재고를 풀고 취소합니다.
        // (결제하기를 여러 번 누르거나 결제창을 닫고 다시 시도하면 주문이 여러 개 생겨 재고를 계속 묶기 때문)
        // ⚠️ 다른 탭에서 결제 승인이 진행 중이거나 결과 확인 중인 주문은 건드리지 않음 (승인되면 재고가 필요)
        const previous = await tx.order.findMany({
          where: { customerId, status: "PENDING", payments: { none: { status: { in: ["IN_PROGRESS", "UNKNOWN"] } } } },
          select: { id: true },
        });
        for (const prev of previous) {
          await releaseOrder(tx, prev.id, "SUPERSEDED", now);
          await tx.order.update({ where: { id: prev.id }, data: { ...orderStatusData("CANCELED", now, "SYSTEM", "새 주문으로 대체"), canceledAt: now } });
        }
        await insertOrder(tx, p, {
          orderNo,
          paymentOrderId,
          customerId,
          channel: options.channel ?? "WEB",
          orderer,
          now,
          region: p.shipping.region,
          address: {
            sourceAddressId: address.id,
            recipientEnc: address.recipientEnc,
            phoneEnc: address.phoneEnc,
            phoneHash: recipientPhoneHash(address.phoneEnc), // 고객센터: 받는 분 전화번호로 주문 찾기
            zipCode: address.zipCode,
            address1Enc: address.address1Enc,
            address2Enc: address.address2Enc,
            deliveryMemoEnc: address.deliveryMemoEnc,
          },
        });
        await tx.customerAddress.update({ where: { id: address.id }, data: { lastUsedAt: now } });
        return orderNo;
      }),
    );
    return { paymentOrderId, orderNo, orderName: p.orderName, amount: p.amount };
  } catch (e) {
    return friendlyOrderError(e, p.skus);
  }
}

// ---------------------------------------------------------------
// 2) 비회원 주문
// ---------------------------------------------------------------
export type GuestAddressInput = { recipient: string; phone: string; zipCode: string; address1: string; address2?: string; deliveryMemo?: string };
export type GuestCheckoutInput = {
  orderer: { name: string; phone: string; email: string };
  address: GuestAddressInput;
  password: string;
  passwordConfirm: string;
  /** 비회원 주문 개인정보 수집·이용 동의 (필수) */
  privacyConsent: boolean;
};

/** 비회원 배송지 입력 검사 → 암호문 스냅샷 (배송지 변경에도 씀) */
export function guestAddressSnapshot(a: GuestAddressInput): AddressSnapshot | { error: string } {
  const recipient = (a.recipient ?? "").trim();
  const phone = normalizePhone(a.phone ?? "");
  const zip = (a.zipCode ?? "").trim();
  const address1 = (a.address1 ?? "").trim();
  const address2 = (a.address2 ?? "").trim();
  const memo = (a.deliveryMemo ?? "").trim();
  if (!recipient || recipient.length > 30) return { error: "받는 분 이름을 입력해 주세요. (30자 이내)" };
  if (!phone) return { error: "받는 분 휴대폰 번호 형식이 올바르지 않아요." };
  if (!/^\d{5}$/.test(zip)) return { error: "우편번호는 숫자 5자리예요." };
  if (!address1 || address1.length > 100) return { error: "주소를 입력해 주세요." };
  if (address2.length > 100) return { error: "상세 주소는 100자 이내로 입력해 주세요." };
  if (memo.length > 100) return { error: "배송 메모는 100자 이내로 입력해 주세요." };
  return {
    sourceAddressId: null,
    recipientEnc: encrypt(recipient),
    phoneEnc: encrypt(phone),
    phoneHash: blindIndex("phone", phone),
    zipCode: zip,
    address1Enc: encrypt(address1),
    address2Enc: encryptOrNull(address2 || null),
    deliveryMemoEnc: encryptOrNull(memo || null),
  };
}

export async function placeGuestOrder(
  input: GuestCheckoutInput,
  items: CartLine[],
  now = new Date(),
  options: { channel?: OrderChannel; ip?: string | null; /** 같은 브라우저의 이전 비회원 결제 대기 주문 (출입증으로 확인) */ previousOrderId?: number | null } = {},
): Promise<PlaceGuestOrderResult> {
  if (!input || typeof input !== "object") return { error: "주문 정보가 올바르지 않아요." };
  if (input.privacyConsent !== true) return { error: "비회원 주문 개인정보 수집·이용에 동의해 주세요." };
  const name = (input.orderer?.name ?? "").trim();
  const phone = normalizePhone(input.orderer?.phone ?? "");
  const email = normalizeEmail(input.orderer?.email ?? "");
  if (!name || name.length > 30) return { error: "주문자 이름을 입력해 주세요. (30자 이내)" };
  if (!phone) return { error: "주문자 휴대폰 번호 형식이 올바르지 않아요." };
  if (!email) return { error: "주문자 이메일 형식이 올바르지 않아요." };
  const pwProblem = guestPasswordProblem(input.password, input.passwordConfirm);
  if (pwProblem) return { error: pwProblem };
  const address = guestAddressSnapshot(input.address ?? ({} as GuestAddressInput));
  if ("error" in address) return address;

  const p = await prepare(items, address.zipCode, now);
  if ("error" in p) return p;
  const passwordHash = await hashGuestPassword(input.password);
  const paymentOrderId = `order_${randomUUID()}`;
  const orderer: OrdererSnapshot = { ordererNameEnc: encrypt(name), ordererPhoneEnc: encrypt(phone), ordererPhoneHash: blindIndex("phone", phone), ordererEmailEnc: encrypt(email) };

  try {
    const r = await withNewOrderNo(now, (orderNo) =>
      prisma.$transaction(async (tx) => {
        // 같은 브라우저에서 다시 주문하면 이전 결제 대기 주문은 풀고 취소 (회원의 "새 주문으로 대체"와 같은 이유)
        if (options.previousOrderId) {
          const prev = await tx.order.findFirst({
            where: { id: options.previousOrderId, ordererType: "GUEST", customerId: null, status: "PENDING", payments: { none: { status: { in: ["IN_PROGRESS", "UNKNOWN"] } } } },
          });
          if (prev) {
            await releaseOrder(tx, prev.id, "SUPERSEDED", now);
            await tx.order.update({ where: { id: prev.id }, data: { ...orderStatusData("CANCELED", now, "SYSTEM", "새 주문으로 대체"), canceledAt: now } });
          }
        }
        const order = await insertOrder(tx, p, { orderNo, paymentOrderId, customerId: null, channel: options.channel ?? "WEB", orderer, address, region: p.shipping.region, now });
        await tx.guestOrderAccess.create({
          data: { orderId: order.id, passwordHash, privacyConsentAt: now, privacyConsentVersion: GUEST_PRIVACY_VERSION, createdAt: now },
        });
        const session = await createGuestSession(tx, order.id, "CHECKOUT", now, options.ip);
        return { orderNo, session };
      }),
    );
    return { paymentOrderId, orderNo: r.orderNo, orderName: p.orderName, amount: p.amount, guestToken: r.session.token, guestTokenMaxAge: r.session.maxAgeSeconds };
  } catch (e) {
    return friendlyOrderError(e, p.skus);
  }
}

// 결제 승인·실패·취소는 lib/payment.ts (주문 생성 이후의 돈 흐름)
export { abandonOrder, confirmOrderPayment, defaultPaymentDeps, type ConfirmOutcome, type PaymentDeps } from "@/lib/payment";
