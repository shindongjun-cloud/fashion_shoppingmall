// 결제창에서 결제를 마치면 토스가 이 주소로 보내줍니다. (successUrl)
// 예: /api/payments/confirm?paymentKey=...&orderId=...&amount=...
// 재고 확인 → 토스 결제 승인 → 주문 완료·재고 확정 순서로 처리합니다 (lib/checkout.ts).
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentCustomer } from "@/lib/current-customer";
import { confirmOrderPayment } from "@/lib/checkout";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const paymentKey = params.get("paymentKey");
  const paymentOrderId = params.get("orderId");
  const amount = Number(params.get("amount"));

  const goTo = (path: string) => NextResponse.redirect(new URL(path, request.url));
  const fail = (message: string) => goTo(`/checkout/fail?message=${encodeURIComponent(message)}`);

  const customer = await getCurrentCustomer();
  if (!paymentKey || !paymentOrderId || !customer) {
    return fail("결제 정보가 올바르지 않아요.");
  }

  const result = await confirmOrderPayment({ customerId: customer.id, paymentOrderId, paymentKey, amount });
  return result.ok ? goTo(`/checkout/complete?orderId=${result.orderId}`) : fail(result.message);
}
