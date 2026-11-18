"use server";

// 서버 액션: 브라우저에서 호출하지만 서버에서 실행되는 함수입니다.
// 주인 확인만 하고, 실제 처리는 lib/checkout.ts · lib/payment.ts가 합니다 (테스트에서도 같은 함수를 씀).

import { cookies, headers } from "next/headers";
import { getCurrentCustomer } from "@/lib/current-customer";
import { clientIp, getGuestOrderId, guestCookieOptions } from "@/lib/current-owner";
import type { CartItem } from "@/context/CartContext";
import { abandonOrder, placeGuestOrder, placeOrder, type GuestCheckoutInput, type PlaceOrderResult } from "@/lib/checkout";
import { GUEST_COOKIE } from "@/lib/guest";

async function channel() {
  // 모바일 웹인지 (주문 경로 통계용. 정확할 필요는 없음)
  const ua = (await headers()).get("user-agent") ?? "";
  return /Mobi|Android|iPhone|iPad/i.test(ua) ? ("MOBILE_WEB" as const) : ("WEB" as const);
}

// 회원 주문 생성 + 배송지 스냅샷 + 재고 예약
// addressId: 주문서에서 고른 배송지 (내 주소록인지는 placeOrder가 확인. 없으면 기본 배송지)
export async function createOrder(items: CartItem[], addressId?: number): Promise<PlaceOrderResult> {
  const customer = await getCurrentCustomer();
  if (!customer) {
    return { error: "로그인이 필요해요." };
  }
  return placeOrder(customer.id, items, new Date(), { addressId: typeof addressId === "number" ? addressId : undefined, channel: await channel() });
}

// 비회원 주문 생성: 주문자·배송지 직접 입력 + 주문 비밀번호 + 개인정보 동의 → 출입증 쿠키(결제창에서 돌아올 때 주인 확인)
export async function createGuestOrder(items: CartItem[], input: GuestCheckoutInput): Promise<PlaceOrderResult> {
  if (await getCurrentCustomer()) return { error: "로그인한 상태에서는 회원으로 주문해 주세요. (새로고침)" };
  const r = await placeGuestOrder(input, items, new Date(), { channel: await channel(), ip: await clientIp(), previousOrderId: await getGuestOrderId() });
  if ("error" in r) return r;
  (await cookies()).set(GUEST_COOKIE, r.guestToken, guestCookieOptions(r.guestTokenMaxAge));
  return { paymentOrderId: r.paymentOrderId, orderNo: r.orderNo, orderName: r.orderName, amount: r.amount }; // 출입증 값은 브라우저 스크립트에 넘기지 않음
}

// 결제를 진행하지 않기로 한 주문의 재고 예약을 바로 풀고 주문을 취소합니다. (안 풀면 20분 동안 재고가 묶임)
// code: 결제창에서 받은 오류 코드 (USER_CANCEL 등). 있으면 결제 시도 기록(실패)도 남깁니다.
export async function cancelPendingOrder(paymentOrderId: string, reason: "PRICE_CHANGED" | "PAYMENT_FAILED", code?: string) {
  if (typeof paymentOrderId !== "string") return;
  if (reason !== "PRICE_CHANGED" && reason !== "PAYMENT_FAILED") return;
  const customer = await getCurrentCustomer();
  const guestOrderId = customer ? null : await getGuestOrderId();
  if (!customer && guestOrderId === null) return;
  const owner = customer ? { customerId: customer.id } : { guestOrderId: guestOrderId! };
  await abandonOrder(owner, paymentOrderId, reason, new Date(), typeof code === "string" ? code : undefined);
}
