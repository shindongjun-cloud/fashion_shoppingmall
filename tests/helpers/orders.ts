// 테스트 도우미: 주소가 있는 고객, 규칙에 맞는 "날것" 주문 (placeOrder를 거치지 않고 재고·DB 제약만 시험할 때)
// ⚠️ temp-db를 먼저 import한 테스트 파일에서만 사용
import { prisma } from "../../src/lib/prisma";
import { ensureCustomerForUser, addAddress } from "../../src/lib/customer";
import { computeShipping, currentShippingPolicy, findZone, generateOrderNo } from "../../src/lib/order-rules";

/** 기본 배송지를 가진 새 고객 (zipCode: 06236 서울 / 63100 제주 / 40200 울릉 등) */
export async function newShopper(name: string, zipCode = "06236") {
  const user = await prisma.user.create({ data: { name } });
  const customerId = (await ensureCustomerForUser(user.id)).id;
  await giveAddress(customerId, { zipCode, makeDefault: true });
  return customerId;
}

let addrSeq = 0;
export function giveAddress(customerId: number, opts: { zipCode?: string; label?: string; makeDefault?: boolean; memo?: string } = {}) {
  return addAddress(customerId, {
    label: opts.label ?? `주소${++addrSeq}`,
    recipient: "김테스트",
    phone: "010-1234-5678",
    zipCode: opts.zipCode ?? "06236",
    address1: "서울 강남구 테헤란로 1",
    address2: "101동 1001호",
    deliveryMemo: opts.memo,
    makeDefault: opts.makeDefault,
  });
}

let orderSeq = 0;
/**
 * 결제 대기 주문 (주문 상품 포함, 예약·배송지는 따로). 금액은 배송비 규칙대로 맞춰서 만듦
 * items: SKU id + 수량 (단가 1,000원)
 */
export async function makeRawOrder(customerId: number, items: { skuId: number; qty: number; price?: number }[], now = new Date()) {
  const lines = items.map((i) => ({ ...i, price: i.price ?? 1000 }));
  const itemsTotal = lines.reduce((n, l) => n + l.price * l.qty, 0);
  const policy = await currentShippingPolicy(prisma, now);
  const ship = computeShipping(policy, await findZone(prisma, policy.id, "06236"), itemsTotal);
  return prisma.order.create({
    data: {
      orderNo: generateOrderNo(now),
      paymentOrderId: `order_test_${++orderSeq}_${Date.now()}`,
      orderName: "테스트",
      customerId,
      status: "PENDING",
      statusChangedAt: now,
      itemsListTotal: itemsTotal,
      itemsDiscountTotal: 0,
      itemsTotal,
      shippingBaseFee: ship.baseFee,
      shippingExtraFee: 0,
      shippingFee: ship.fee,
      totalPrice: itemsTotal + ship.fee,
      shippingPolicyId: policy.id,
      freeShippingThreshold: policy.freeShippingThreshold,
      createdAt: now,
      items: {
        create: lines.map((l, i) => ({
          lineNo: i + 1,
          skuId: l.skuId,
          quantity: l.qty,
          listPrice: l.price,
          discountAmount: 0,
          price: l.price,
          lineListTotal: l.price * l.qty,
          lineDiscountTotal: 0,
          lineTotal: l.price * l.qty,
          payAmount: l.price * l.qty,
          styleCode: "T",
          skuCode: `T-${l.skuId}`,
          styleName: "T",
          colorName: "T",
          sizeName: "T",
          statusChangedAt: now,
          createdAt: now,
        })),
      },
    },
    include: { items: true },
  });
}

/**
 * 결제할 수 있는 주문 (금액을 마음대로 정할 때): 날것 주문 + 배송지 스냅샷 + 재고 예약
 * 재고가 넉넉한 SKU를 골라 씀
 */
export async function makePayableOrder(customerId: number, opts: { price: number; qty?: number; now?: Date }) {
  const now = opts.now ?? new Date();
  const qty = opts.qty ?? 1;
  const bal = await prisma.inventoryBalance.findFirst({ where: { location: { isOnlineSellable: true }, onHand: { gte: 20 } }, orderBy: { onHand: "desc" } });
  if (!bal) throw new Error("재고가 넉넉한 SKU가 없음 (seed 확인)");
  const order = await makeRawOrder(customerId, [{ skuId: bal.skuId, qty, price: opts.price }], now);
  const book = await giveAddress(customerId, {});
  await prisma.orderShippingAddress.create({
    data: { orderId: order.id, sourceAddressId: book.id, recipientEnc: book.recipientEnc, phoneEnc: book.phoneEnc, zipCode: book.zipCode, address1Enc: book.address1Enc, address2Enc: book.address2Enc, region: "NORMAL", createdAt: now },
  });
  const { reserveOrder } = await import("../../src/lib/inventory");
  await prisma.$transaction((tx) => reserveOrder(tx, order.id, linesOf(order), now));
  return order;
}

/** reserveOrder에 넘길 상품 줄 목록 */
export const linesOf = (order: { items: { id: number; skuId: number; quantity: number }[] }) =>
  order.items.map((i) => ({ orderItemId: i.id, skuId: i.skuId, qty: i.quantity }));
