// 결제창에서 결제를 마치면 토스가 이 주소로 보내줍니다. (successUrl)
// 예: /api/payments/confirm?paymentKey=...&orderId=...&amount=...
// 여기서 금액을 검증하고, 토스에 "결제 승인"을 요청해야 결제가 최종 완료돼요.
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { confirmPayment } from "@/lib/toss";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const paymentKey = params.get("paymentKey");
  const orderId = params.get("orderId");
  const amount = Number(params.get("amount"));

  const goTo = (path: string) =>
    NextResponse.redirect(new URL(path, request.url));
  const fail = (message: string) =>
    goTo(`/checkout/fail?message=${encodeURIComponent(message)}`);

  const session = await auth();
  const userId = session?.user?.id;
  if (!paymentKey || !orderId || !userId) {
    return fail("결제 정보가 올바르지 않아요.");
  }

  // 1) 우리 DB에 있는, 이 사람의 주문인지 확인
  const order = await prisma.order.findUnique({
    where: { paymentOrderId: orderId },
  });
  if (!order || order.userId !== userId) {
    return fail("주문을 찾을 수 없어요.");
  }

  // 새로고침 등으로 다시 들어온 경우: 이미 완료된 주문이면 완료 페이지로
  if (order.status === "PAID") {
    return goTo(`/checkout/complete?orderId=${order.id}`);
  }

  // 2) ⚠️ 결제된 금액이 서버가 계산한 주문 금액과 같은지 확인 (조작 방지)
  if (amount !== order.totalPrice) {
    return fail("결제 금액이 주문 금액과 달라요.");
  }

  // 3) 토스에 결제 승인 요청
  const result = await confirmPayment({
    paymentKey,
    orderId,
    amount: order.totalPrice,
  });
  if (!result.ok) {
    return fail(result.message);
  }

  // 4) 주문을 "결제 완료"로 변경
  await prisma.order.update({
    where: { id: order.id },
    data: { status: "PAID", paymentKey },
  });

  return goTo(`/checkout/complete?orderId=${order.id}`);
}
