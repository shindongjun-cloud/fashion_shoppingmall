"use server";

// 서버 액션: 브라우저에서 호출하지만 서버에서 실행되는 함수입니다.
// 로그인만 확인하고, 실제 처리는 lib/checkout.ts · lib/payment.ts가 합니다 (테스트에서도 같은 함수를 씀).

import { getCurrentCustomer } from "@/lib/current-customer";
import type { CartItem } from "@/context/CartContext";
import { abandonOrder, placeOrder, type PlaceOrderResult } from "@/lib/checkout";
import { headers } from "next/headers";

// 주문 생성 + 배송지 스냅샷 + 재고 예약
// addressId: 주문서에서 고른 배송지 (내 주소록인지는 placeOrder가 확인. 없으면 기본 배송지)
export async function createOrder(items: CartItem[], addressId?: number): Promise<PlaceOrderResult> {
  const customer = await getCurrentCustomer();
  if (!customer) {
    return { error: "로그인이 필요해요." };
  }
  // 모바일 웹인지 (주문 경로 통계용. 정확할 필요는 없음)
  const ua = (await headers()).get("user-agent") ?? "";
  const channel = /Mobi|Android|iPhone|iPad/i.test(ua) ? "MOBILE_WEB" : "WEB";
  return placeOrder(customer.id, items, new Date(), { addressId: typeof addressId === "number" ? addressId : undefined, channel });
}

// 결제를 진행하지 않기로 한 주문의 재고 예약을 바로 풀고 주문을 취소합니다. (안 풀면 20분 동안 재고가 묶임)
// code: 결제창에서 받은 오류 코드 (USER_CANCEL 등). 있으면 결제 시도 기록(실패)도 남깁니다.
export async function cancelPendingOrder(paymentOrderId: string, reason: "PRICE_CHANGED" | "PAYMENT_FAILED", code?: string) {
  const customer = await getCurrentCustomer();
  if (!customer || typeof paymentOrderId !== "string") return;
  if (reason !== "PRICE_CHANGED" && reason !== "PAYMENT_FAILED") return;
  await abandonOrder(customer.id, paymentOrderId, reason, new Date(), typeof code === "string" ? code : undefined);
}
