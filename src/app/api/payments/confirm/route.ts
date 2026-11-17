// 결제창에서 결제를 마치면 토스가 이 주소로 보내줍니다. (successUrl)
// 예: /api/payments/confirm?paymentKey=...&orderId=...&amount=...&paymentType=NORMAL
// 실제 처리는 lib/payment.ts의 confirmOrderPayment (재고 확인 → 토스 승인 → 결제 저장 → 주문 완료)
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentCustomer } from "@/lib/current-customer";
import { confirmOrderPayment } from "@/lib/payment";
import { getTossConfigProblem } from "@/lib/toss";
import { loginPath } from "@/lib/safe-redirect";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const goTo = (path: string) => NextResponse.redirect(new URL(path, request.url));
  const fail = (code: string) => goTo(`/checkout/fail?code=${encodeURIComponent(code)}`);

  const configProblem = getTossConfigProblem();
  if (configProblem) {
    console.error(`[결제 설정 오류] ${configProblem}`);
    return fail("PAYMENT_CONFIG");
  }

  const customer = await getCurrentCustomer();
  if (!customer) {
    // 결제 도중 로그인이 만료됨 → 로그인한 뒤 이 주소로 돌아와서 승인을 이어서 진행 (토스 승인은 결제 후 10분 안에만 가능)
    const back = request.nextUrl.pathname + request.nextUrl.search;
    return goTo(loginPath(back));
  }

  const result = await confirmOrderPayment({
    customerId: customer.id,
    paymentOrderId: params.get("orderId"),
    paymentKey: params.get("paymentKey"),
    amount: params.get("amount"),
  });
  switch (result.kind) {
    case "PAID":
    case "WAITING_DEPOSIT":
      return goTo(`/checkout/complete?orderId=${result.orderId}`);
    case "PROCESSING":
      return goTo(`/checkout/pending?orderId=${result.orderId}`);
    case "FAILED":
      return fail(result.code);
  }
}
