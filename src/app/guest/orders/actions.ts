"use server";

// 비회원 주문 조회: 주문번호 + 주문 비밀번호 → 출입증 쿠키 → 비회원 주문 상세
// 결과 안내는 코드(?r=)로만 (문구를 주소에 싣지 않음). "주문 없음·틀림·잠김"은 같은 코드(WRONG)
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { clientIp, guestCookieOptions } from "@/lib/current-owner";
import { GUEST_COOKIE, lookupGuestOrder } from "@/lib/guest";

export async function lookupGuestOrderAction(form: FormData) {
  const orderNo = typeof form.get("orderNo") === "string" ? String(form.get("orderNo")).trim() : "";
  const r = await lookupGuestOrder({ orderNo, password: form.get("password"), ip: await clientIp() });
  if (!r.ok) {
    const keep = /^\d{8}-\d{8}$/.test(orderNo) ? `&orderNo=${orderNo}` : "";
    redirect(`/guest/orders?r=${r.reason}${keep}`);
  }
  (await cookies()).set(GUEST_COOKIE, r.token, guestCookieOptions(r.maxAgeSeconds));
  redirect(`/guest/orders/${orderNo}`);
}
