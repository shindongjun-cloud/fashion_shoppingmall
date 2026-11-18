// 결제창에서 실패·취소하면 토스가 이 주소로 보내줍니다. (failUrl)
// 예: /api/payments/fail?code=PAY_PROCESS_CANCELED&message=...  (결제창 취소일 때는 orderId가 오지 않음!)
// 시도를 기록하고, 그 주문이 잡고 있던 재고를 바로 풀고(안 풀면 20분 동안 묶임) 실패 화면으로 보냅니다.
// (화면 렌더링 중에 DB를 바꾸지 않도록 페이지가 아닌 라우트에서 처리)
// ⚠️ message는 주소창 값이라 누구나 바꿀 수 있으므로 화면에는 보여 주지 않고, 코드로 우리 문구를 고릅니다.
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentCustomer } from "@/lib/current-customer";
import { recordCheckoutFailure } from "@/lib/payment";
import { getGuestOrderId } from "@/lib/current-owner";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const rawCode = params.get("code") ?? "";
  let code = /^[A-Z0-9_]{1,64}$/.test(rawCode) ? rawCode : "PAY_PROCESS_ABORTED";

  // 회원이면 로그인으로, 비회원이면 출입증의 주문으로 (둘 다 없으면 기록 없이 안내만 — 재고는 20분 뒤 자동 해제)
  const customer = await getCurrentCustomer();
  const guestOrderId = customer ? null : await getGuestOrderId();
  if (customer || guestOrderId !== null) {
    const owner = customer ? { customerId: customer.id } : { guestOrderId: guestOrderId! };
    const r = await recordCheckoutFailure(owner, { paymentOrderId: params.get("orderId"), code, message: params.get("message") });
    code = r.code;
  }
  return NextResponse.redirect(new URL(`/checkout/fail?code=${encodeURIComponent(code)}`, request.url));
}
