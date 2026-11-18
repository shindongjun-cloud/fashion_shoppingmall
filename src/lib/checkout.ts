// 주문 생성 (서버 전용). 결제 승인 이후는 lib/payment.ts, 결제 후 주문 처리(취소·배송·구매확정)는 lib/order.ts
// 서버 액션(app/checkout/actions.ts)이 이 파일을 씁니다.
// 로그인 확인(auth)은 호출하는 쪽에서 하고, 여기서는 customerId(쇼핑몰 고객)를 받습니다. → 테스트에서 직접 호출할 수 있음
import { randomUUID } from "crypto";
import type { OrderChannel } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCartSkus } from "@/lib/catalog";
import { findQtyLimitViolation } from "@/lib/cart-rules";
import { blindIndex, decrypt, encryptOrNull, normalizePhone } from "@/lib/crypto";
import { InsufficientStockError, isBusyError, isConstraintError, releaseOrder, reserveOrder, withBusyRetry } from "@/lib/inventory";
import { computeShipping, currentShippingPolicy, findZone, generateOrderNo, OrderError, orderStatusData } from "@/lib/order-rules";

export type PlaceOrderResult =
  | { paymentOrderId: string; orderNo: string; orderName: string; amount: number }
  | { error: string };

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
};

// ---------------------------------------------------------------
// 1) 주문 생성 + 배송지 스냅샷 + 재고 예약 (한 트랜잭션)
// ---------------------------------------------------------------
export async function placeOrder(customerId: number, items: CartLine[], now = new Date(), options: PlaceOrderOptions = {}): Promise<PlaceOrderResult> {
  // ⚠️ 브라우저에서 온 값은 사용자가 마음대로 바꿀 수 있으니 전부 검사합니다.
  const valid =
    Array.isArray(items) &&
    items.length > 0 &&
    items.length <= 50 &&
    items.every(
      (item) => Number.isInteger(item.skuId) && Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 99,
    );
  const skuIds = valid ? items.map((item) => item.skuId) : [];
  if (!valid || new Set(skuIds).size !== skuIds.length) {
    return { error: "장바구니 정보가 올바르지 않아요." };
  }
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

  const skus = await getCartSkus(skuIds);
  if (skus.length !== skuIds.length) {
    return { error: "판매하지 않는 상품이 장바구니에 있어요." };
  }
  const lines = items.map((item) => ({ sku: skus.find((s) => s.id === item.skuId)!, quantity: item.quantity }));

  // 판매 상태·재고 사전 확인 (안내용. 실제로 재고를 지키는 것은 아래 예약 + DB 트리거)
  for (const { sku, quantity } of lines) {
    const label = `${sku.styleName} (${sku.colorName}/${sku.sizeName})`;
    if (!sku.sellable) return { error: `${label}은 판매가 중지됐어요.` };
    if (sku.stock < quantity) return { error: `${label} 재고가 부족해요. (남은 수량 ${sku.stock}개)` };
  }
  const overLimit = findQtyLimitViolation(lines);
  if (overLimit) {
    return { error: `${overLimit.styleName}은 1회 주문 시 ${overLimit.maxQtyPerOrder}개까지 살 수 있어요.` };
  }

  // ⚠️ 금액은 반드시 서버에서, DB에 있는 가격으로 계산합니다. (sku.price = 지금 시각 기준 판매가)
  // 상품 줄 금액 (쿠폰·포인트 몫은 ⑬⑭ 단계 전까지 0 → 실결제액 = 판매가 × 수량)
  const lineAmounts = lines.map(({ sku, quantity }) => ({
    lineListTotal: sku.listPrice * quantity,
    lineDiscountTotal: sku.discountAmount * quantity,
    lineTotal: sku.price * quantity,
  }));
  const sum = (key: keyof (typeof lineAmounts)[number]) => lineAmounts.reduce((n, l) => n + l[key], 0);
  const itemsListTotal = sum("lineListTotal");
  const itemsDiscountTotal = sum("lineDiscountTotal");
  const itemsTotal = sum("lineTotal");

  let shipping;
  try {
    const policy = await currentShippingPolicy(prisma, now);
    shipping = computeShipping(policy, await findZone(prisma, policy.id, address.zipCode), itemsTotal);
  } catch (e) {
    if (e instanceof OrderError) return { error: e.message };
    throw e;
  }
  const amount = itemsTotal + shipping.fee; // 쿠폰·포인트(⑬⑭) 전
  const firstName = lines[0].sku.styleName;
  const orderName = lines.length > 1 ? `${firstName} 외 ${lines.length - 1}건` : firstName;
  const paymentOrderId = `order_${randomUUID()}`;

  // 주문자 정보 스냅샷: 프로필의 암호문을 그대로 복사 (같은 키). 프로필에 없으면 로그인 계정(GitHub) 이름·이메일을 암호화
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId }, include: { profile: true, user: { select: { name: true, email: true } } } });
  const orderer = {
    ordererNameEnc: customer.profile?.nameEnc ?? encryptOrNull(customer.user?.name?.trim()),
    ordererPhoneEnc: customer.profile?.phoneEnc ?? null,
    ordererPhoneHash: customer.profile?.phoneHash ?? null,
    ordererEmailEnc: customer.profile?.contactEmailEnc ?? encryptOrNull(customer.user?.email?.trim()),
  };

  let orderNo = "";
  try {
    // 동시에 들어온 다른 주문과 DB 잠금이 충돌하면 다시 시도 (다시 하면 상대 예약을 보고 정상 처리 or 재고 부족)
    // 주문번호가 우연히 겹치면(1억분의 1) 새 번호로 다시 시도
    for (let attempt = 1; ; attempt++) {
      orderNo = generateOrderNo(now);
      try {
        await withBusyRetry(() =>
          prisma.$transaction(async (tx) => {
            // 같은 고객의 이전 "결제 대기" 주문은 재고를 풀고 취소합니다.
            // (결제하기를 여러 번 누르거나 결제창을 닫고 다시 시도하면 주문이 여러 개 생겨 재고를 계속 묶기 때문)
            // ⚠️ 다른 탭에서 결제 승인이 진행 중이거나 결과 확인 중인 주문은 건드리지 않음 (승인되면 재고가 필요)
            const previous = await tx.order.findMany({
              where: { customerId, status: "PENDING", payments: { none: { status: { in: ["IN_PROGRESS", "UNKNOWN"] } } } },
              select: { id: true },
            });
            for (const p of previous) {
              await releaseOrder(tx, p.id, "SUPERSEDED", now);
              await tx.order.update({ where: { id: p.id }, data: { ...orderStatusData("CANCELED", now, "SYSTEM", "새 주문으로 대체"), canceledAt: now } });
            }

            const order = await tx.order.create({
              data: {
                orderNo,
                paymentOrderId,
                orderName,
                customerId,
                channel: options.channel ?? "WEB",
                ...orderStatusData("PENDING", now, "CUSTOMER"),
                itemsListTotal,
                itemsDiscountTotal,
                itemsTotal,
                shippingBaseFee: shipping.baseFee,
                shippingExtraFee: shipping.extraFee,
                shippingFee: shipping.fee,
                totalPrice: amount,
                shippingPolicyId: shipping.policyId,
                freeShippingThreshold: shipping.threshold,
                ...orderer,
                createdAt: now,
                items: {
                  create: lines.map(({ sku, quantity }, i) => ({
                    lineNo: i + 1,
                    skuId: sku.id,
                    quantity,
                    listPrice: sku.listPrice,
                    discountAmount: sku.discountAmount,
                    price: sku.price,
                    promotionId: sku.promotionId,
                    promotionName: sku.promotionName,
                    ...lineAmounts[i],
                    payAmount: lineAmounts[i].lineTotal,
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
              include: { items: { select: { id: true, skuId: true, quantity: true } } },
            });
            // 배송지 스냅샷 (주소록의 암호문을 그대로 복사)
            await tx.orderShippingAddress.create({
              data: {
                orderId: order.id,
                sourceAddressId: address.id,
                recipientEnc: address.recipientEnc,
                phoneEnc: address.phoneEnc,
                phoneHash: recipientPhoneHash(address.phoneEnc), // 고객센터: 받는 분 전화번호로 주문 찾기
                zipCode: address.zipCode,
                address1Enc: address.address1Enc,
                address2Enc: address.address2Enc,
                deliveryMemoEnc: address.deliveryMemoEnc,
                region: shipping.region,
                createdAt: now,
              },
            });
            await tx.customerAddress.update({ where: { id: address.id }, data: { lastUsedAt: now } });
            // 재고 예약: 하나라도 부족하면 예외 → 트랜잭션 전체 취소 (주문도 안 만들어짐)
            await reserveOrder(tx, order.id, order.items.map((i) => ({ orderItemId: i.id, skuId: i.skuId, qty: i.quantity })), now);
          }),
        );
        break;
      } catch (e) {
        if (attempt < 3 && isConstraintError(e, "orderNo")) continue; // 주문번호 중복 (UNIQUE)
        throw e;
      }
    }
  } catch (e) {
    if (isConstraintError(e, "Order_customer_active")) {
      return { error: "주문할 수 없는 회원 상태예요. (탈퇴 신청·정지·휴면 회원)" };
    }
    if (isConstraintError(e, "Order_shipping_rule")) {
      return { error: "배송비 규칙이 바뀌었어요. 새로고침해서 금액을 다시 확인해 주세요." };
    }
    if (isBusyError(e)) {
      return { error: "주문이 몰려 처리하지 못했어요. 잠시 후 다시 시도해 주세요." };
    }
    if (e instanceof InsufficientStockError) {
      const sku = skus.find((s) => s.id === e.skuId)!;
      return { error: `${sku.styleName} (${sku.colorName}/${sku.sizeName}) 재고가 부족해요. 방금 다른 고객이 구매했어요.` };
    }
    throw e;
  }

  return { paymentOrderId, orderNo, orderName, amount };
}

// 결제 승인·실패·취소는 lib/payment.ts (주문 생성 이후의 돈 흐름)
export { abandonOrder, confirmOrderPayment, defaultPaymentDeps, type ConfirmOutcome, type PaymentDeps } from "@/lib/payment";
