"use server";

// 서버 액션: 브라우저에서 호출하지만 서버에서 실행되는 함수입니다.
// 여기서 주문을 "결제 대기(PENDING)" 상태로 만들고, 결제할 금액을 정합니다.

import { randomUUID } from "crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getCartSkus } from "@/lib/catalog";
import { findQtyLimitViolation } from "@/lib/cart-rules";
import type { CartItem } from "@/context/CartContext";

type CreateOrderResult =
  | { paymentOrderId: string; orderName: string; amount: number }
  | { error: string };

export async function createOrder(items: CartItem[]): Promise<CreateOrderResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return { error: "로그인이 필요해요." };
  }

  // ⚠️ 브라우저에서 온 값은 사용자가 마음대로 바꿀 수 있으니 전부 검사합니다.
  const valid =
    Array.isArray(items) &&
    items.length > 0 &&
    items.length <= 50 &&
    items.every(
      (item) =>
        Number.isInteger(item.skuId) &&
        Number.isInteger(item.quantity) &&
        item.quantity >= 1 &&
        item.quantity <= 99,
    );
  const skuIds = valid ? items.map((item) => item.skuId) : [];
  if (!valid || new Set(skuIds).size !== skuIds.length) {
    return { error: "장바구니 정보가 올바르지 않아요." };
  }

  const skus = await getCartSkus(skuIds);
  if (skus.length !== skuIds.length) {
    return { error: "판매하지 않는 상품이 장바구니에 있어요." };
  }

  const orderItems = items.map((item) => ({
    sku: skus.find((s) => s.id === item.skuId)!,
    quantity: item.quantity,
  }));

  // 판매 상태와 재고 확인
  // (재고를 실제로 줄이고 동시 주문을 막는 일은 3번 재고 단계에서 "재고 예약"으로 만듭니다)
  for (const { sku, quantity } of orderItems) {
    if (!sku.sellable) {
      return { error: `${sku.styleName} (${sku.colorName}/${sku.sizeName})은 판매가 중지됐어요.` };
    }
    if (sku.stock < quantity) {
      return { error: `${sku.styleName} (${sku.colorName}/${sku.sizeName}) 재고가 부족해요.` };
    }
  }

  // 1회 주문 수량 제한 (한정 상품)
  const overLimit = findQtyLimitViolation(orderItems);
  if (overLimit) {
    return { error: `${overLimit.styleName}은 1회 주문 시 ${overLimit.maxQtyPerOrder}개까지 살 수 있어요.` };
  }

  // ⚠️ 금액은 반드시 서버에서, DB에 있는 가격으로 계산합니다.
  //    sku.price는 getCartSkus()가 "지금 이 순간" 기준으로 정가와 할인 행사를 다시 계산한 값입니다.
  //    (장바구니에 담은 뒤 행사가 끝났다면 끝난 가격으로 결제됩니다)
  //    (브라우저가 보낸 금액을 믿으면 100원짜리로 바꿔서 결제하는 조작이 가능해요)
  const amount = orderItems.reduce(
    (sum, { sku, quantity }) => sum + sku.price * quantity,
    0,
  );

  const firstName = orderItems[0].sku.styleName;
  const orderName =
    orderItems.length > 1
      ? `${firstName} 외 ${orderItems.length - 1}건`
      : firstName;

  // 토스에 보낼 주문번호: 겹치지 않는 무작위 값 (영문, 숫자, -, _ 로 6~64자)
  const paymentOrderId = `order_${randomUUID()}`;

  await prisma.order.create({
    data: {
      paymentOrderId,
      orderName,
      totalPrice: amount,
      userId,
      items: {
        // 주문 당시의 이름·컬러·사이즈·가격을 복사해 둡니다 (스냅샷)
        create: orderItems.map(({ sku, quantity }) => ({
          skuId: sku.id,
          quantity,
          listPrice: sku.listPrice,
          discountAmount: sku.discountAmount,
          price: sku.price,
          promotionId: sku.promotionId,
          promotionName: sku.promotionName,
          styleCode: sku.styleCode,
          skuCode: sku.skuCode,
          styleName: sku.styleName,
          colorName: sku.colorName,
          sizeName: sku.sizeName,
          imageUrl: sku.imageUrl,
        })),
      },
    },
  });

  return { paymentOrderId, orderName, amount };
}
