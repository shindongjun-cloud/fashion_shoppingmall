// "결제 확인 중" 화면이 몇 초마다 부르는 주소: 토스에 한 번 물어보고 결과에 맞는 화면으로 보냅니다.
// 예: /api/payments/status?orderNo=20261118-48213907&try=3  (주소에는 내부 번호 대신 고객용 주문번호)
import { NextResponse, type NextRequest } from "next/server";
import { refreshOrderPayment } from "@/lib/payment";
import { loginPath } from "@/lib/safe-redirect";
import { prisma } from "@/lib/prisma";
import { ORDER_NO_PATTERN, ownsOrder } from "@/lib/order-rules";
import { getOwners } from "@/lib/current-owner";

export async function GET(request: NextRequest) {
  const goTo = (path: string) => NextResponse.redirect(new URL(path, request.url));
  const orderNo = request.nextUrl.searchParams.get("orderNo") ?? "";
  const tries = Math.min(100, Math.max(0, Number(request.nextUrl.searchParams.get("try")) || 0));

  const owners = await getOwners(); // 회원 로그인 / 비회원 출입증
  if (owners.length === 0) return goTo(loginPath(request.nextUrl.pathname + request.nextUrl.search));
  const order = ORDER_NO_PATTERN.test(orderNo) ? await prisma.order.findUnique({ where: { orderNo }, select: { id: true, customerId: true } }) : null;
  const owner = order ? owners.find((o) => ownsOrder(o, order)) : undefined;
  if (!order || !owner) return goTo("/checkout/fail?code=ORDER_NOT_FOUND"); // 남의 주문도 "없음"과 똑같이

  const result = await refreshOrderPayment(owner, order.id);
  switch (result.kind) {
    case "PAID":
    case "WAITING_DEPOSIT":
      return goTo(`/checkout/complete?orderNo=${orderNo}`);
    case "PROCESSING":
      return goTo(`/checkout/pending?orderNo=${orderNo}&try=${tries + 1}`);
    case "FAILED":
      return goTo(`/checkout/fail?code=${encodeURIComponent(result.code)}`);
  }
}
