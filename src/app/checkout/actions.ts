"use server";

// 서버 액션: 브라우저에서 호출하지만 서버에서 실행되는 함수입니다.
// 로그인만 확인하고, 실제 처리는 lib/checkout.ts가 합니다 (테스트에서도 같은 함수를 씀).

import { getCurrentCustomer } from "@/lib/current-customer";
import type { CartItem } from "@/context/CartContext";
import { abandonOrder, placeOrder, type PlaceOrderResult } from "@/lib/checkout";

// 주문 생성 + 재고 예약
export async function createOrder(items: CartItem[]): Promise<PlaceOrderResult> {
  const customer = await getCurrentCustomer();
  if (!customer) {
    return { error: "로그인이 필요해요." };
  }
  return placeOrder(customer.id, items);
}

// 결제를 진행하지 않기로 한 주문의 재고 예약을 바로 풉니다. (안 풀면 20분 동안 재고가 묶임)
export async function cancelPendingOrder(paymentOrderId: string, reason: "PRICE_CHANGED" | "PAYMENT_FAILED") {
  const customer = await getCurrentCustomer();
  if (!customer || typeof paymentOrderId !== "string") return;
  if (reason !== "PRICE_CHANGED" && reason !== "PAYMENT_FAILED") return;
  await abandonOrder(customer.id, paymentOrderId, reason);
}
