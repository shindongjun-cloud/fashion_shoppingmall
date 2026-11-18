// 지금 요청의 주문 주인 찾기 (서버 전용): 회원(로그인) / 비회원(출입증 쿠키)
import { cookies, headers } from "next/headers";
import { getCurrentCustomer } from "@/lib/current-customer";
import { findGuestOrderId, GUEST_COOKIE } from "@/lib/guest";
import type { OrderOwner } from "@/lib/order-rules";

/** 비회원 출입증 쿠키 → 그 주문 id (만료·무효·회원으로 옮긴 주문이면 null) */
export async function getGuestOrderId(): Promise<number | null> {
  return findGuestOrderId((await cookies()).get(GUEST_COOKIE)?.value);
}

/** 이 주문에 접근할 수 있는 주인들 (회원 로그인과 비회원 출입증이 둘 다 있을 수 있음) */
export async function getOwners(): Promise<OrderOwner[]> {
  const [customer, guestOrderId] = await Promise.all([getCurrentCustomer(), getGuestOrderId()]);
  return [...(customer ? [{ customerId: customer.id }] : []), ...(guestOrderId !== null ? [{ guestOrderId }] : [])];
}

/** 요청한 사람의 IP (프록시 뒤면 x-forwarded-for의 첫 값). 무작위 대입 차단·기록용 */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

/** 비회원 출입증 쿠키 설정값 (모든 경로에서 필요: 주문서·결제 승인·완료·조회) */
export const guestCookieOptions = (maxAgeSeconds: number) => ({ path: "/", maxAge: maxAgeSeconds, httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production" });
