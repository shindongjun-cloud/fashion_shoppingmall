// "결제 확인 중" 화면이 몇 초마다 부르는 주소: 토스에 한 번 물어보고 결과에 맞는 화면으로 보냅니다.
// 예: /api/payments/status?orderId=12&try=3
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentCustomer } from "@/lib/current-customer";
import { refreshOrderPayment } from "@/lib/payment";

export async function GET(request: NextRequest) {
  const goTo = (path: string) => NextResponse.redirect(new URL(path, request.url));
  const orderId = Number(request.nextUrl.searchParams.get("orderId"));
  const tries = Math.min(100, Math.max(0, Number(request.nextUrl.searchParams.get("try")) || 0));
  const customer = await getCurrentCustomer();
  if (!customer) return goTo(`/api/auth/signin?callbackUrl=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`);
  if (!Number.isInteger(orderId) || orderId < 1) return goTo("/checkout/fail?code=ORDER_NOT_FOUND");

  const result = await refreshOrderPayment(customer.id, orderId);
  switch (result.kind) {
    case "PAID":
    case "WAITING_DEPOSIT":
      return goTo(`/checkout/complete?orderId=${orderId}`);
    case "PROCESSING":
      return goTo(`/checkout/pending?orderId=${orderId}&try=${tries + 1}`);
    case "FAILED":
      return goTo(`/checkout/fail?code=${encodeURIComponent(result.code)}`);
  }
}
