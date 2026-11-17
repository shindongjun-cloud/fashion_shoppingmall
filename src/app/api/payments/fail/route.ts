// 결제창에서 실패·취소하면 토스가 이 주소로 보내줍니다. (failUrl)
// 예: /api/payments/fail?code=PAY_PROCESS_CANCELED&message=...&orderId=order_...
// 그 주문이 잡고 있던 재고 예약을 바로 풀고(안 풀면 20분 동안 묶임) 실패 화면으로 보냅니다.
// (화면 렌더링 중에 DB를 바꾸지 않도록 페이지가 아닌 라우트에서 처리)
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentCustomer } from "@/lib/current-customer";
import { abandonOrder } from "@/lib/checkout";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const paymentOrderId = params.get("orderId");
  const message = params.get("message") ?? "결제가 취소되었어요.";

  const customer = await getCurrentCustomer();
  if (customer && paymentOrderId) {
    await abandonOrder(customer.id, paymentOrderId, "PAYMENT_FAILED");
  }
  return NextResponse.redirect(new URL(`/checkout/fail?message=${encodeURIComponent(message)}`, request.url));
}
