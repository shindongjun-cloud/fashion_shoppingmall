"use server";

// 서버 액션: 브라우저에서 호출하지만 서버에서 실행되는 함수입니다.
// 여기서 주문을 "결제 대기(PENDING)" 상태로 만들고, 결제할 금액을 정합니다.

import { randomUUID } from "crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
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
        Number.isInteger(item.productId) &&
        Number.isInteger(item.quantity) &&
        item.quantity >= 1 &&
        item.quantity <= 99,
    );
  const productIds = valid ? items.map((item) => item.productId) : [];
  if (!valid || new Set(productIds).size !== productIds.length) {
    return { error: "장바구니 정보가 올바르지 않아요." };
  }

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
  });
  if (products.length !== productIds.length) {
    return { error: "판매하지 않는 상품이 장바구니에 있어요." };
  }

  // ⚠️ 금액은 반드시 서버에서, DB에 있는 가격으로 계산합니다.
  //    (브라우저가 보낸 금액을 믿으면 100원짜리로 바꿔서 결제하는 조작이 가능해요)
  const orderItems = items.map((item) => {
    const product = products.find((p) => p.id === item.productId)!;
    return { product, quantity: item.quantity };
  });
  const amount = orderItems.reduce(
    (sum, { product, quantity }) => sum + product.price * quantity,
    0,
  );

  const firstName = orderItems[0].product.name;
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
        create: orderItems.map(({ product, quantity }) => ({
          productId: product.id,
          quantity,
          price: product.price, // 주문 당시 가격을 기록
        })),
      },
    },
  });

  return { paymentOrderId, orderName, amount };
}
