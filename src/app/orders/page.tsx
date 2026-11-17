import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getCurrentCustomer } from "@/lib/current-customer";
import { prisma } from "@/lib/prisma";
import { formatDate, formatPrice } from "@/lib/format";
import { DEPOSIT_CANCEL_NOTICE, ORDER_STATUS_LABEL } from "@/lib/payment-labels";
import { mainPayment, paymentInclude, toPaymentView } from "@/lib/payment-view";
import PaymentSummary from "@/components/PaymentSummary";
import { cancelDepositOrder } from "./actions";

export const dynamic = "force-dynamic";

// 내 주문 내역 (로그인한 사람만 볼 수 있는 페이지)
// 결제창까지 가지 않았거나 결제에 실패한 "시도"는 주문으로 보여 주지 않습니다 (실제 쇼핑몰과 같이).
//   보여 주는 것: 입금 대기, 결제 완료, 입금 기한 만료, 환불 확인 중, 결제 후 취소된 주문, 결제 결과 확인 중인 주문
export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const session = await auth();
  const { notice } = await searchParams;

  // 로그인 안 했으면 로그인 페이지로 보내고, 로그인 후 이 페이지로 돌아옵니다.
  const customer = await getCurrentCustomer();
  if (!customer) {
    redirect("/api/auth/signin?callbackUrl=/orders");
  }

  const orders = await prisma.order.findMany({
    where: {
      customerId: customer.id, // "내" 주문만
      OR: [
        { status: { in: ["WAITING_DEPOSIT", "PAID", "EXPIRED", "CANCEL_FAILED"] } },
        { status: "CANCELED", payments: { some: { OR: [{ approvedAt: { not: null } }, { method: "VIRTUAL_ACCOUNT", paymentKey: { not: null } }] } } },
        { status: "PENDING", payments: { some: { status: { in: ["IN_PROGRESS", "UNKNOWN"] } } } },
      ],
    },
    include: { items: true, payments: { include: paymentInclude } }, // 상품 정보는 주문 항목의 스냅샷 컬럼
    orderBy: { createdAt: "desc" },
  });
  const noticeText = typeof notice === "string" ? DEPOSIT_CANCEL_NOTICE[notice] : undefined;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-bold text-gray-900">내 주문 내역</h1>
      <p className="mt-1 text-sm text-gray-500">{session?.user?.name}님, 안녕하세요.</p>
      {noticeText && <p className="mt-4 rounded-lg bg-gray-100 p-3 text-sm text-gray-800">{noticeText}</p>}

      {orders.length === 0 ? (
        <div className="mt-10 text-center">
          <p className="text-gray-600">아직 주문한 상품이 없어요.</p>
          <Link href="/" className="mt-6 inline-block rounded-lg bg-gray-900 px-6 py-3 font-medium text-white hover:bg-gray-700">
            쇼핑하러 가기
          </Link>
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {orders.map((order) => {
            const payment = mainPayment(order.payments);
            const processing = order.status === "PENDING";
            return (
              <li key={order.id} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex justify-between text-sm text-gray-500">
                  <span>
                    주문번호 {order.id} · {formatDate(order.createdAt)}
                  </span>
                  <span className={order.status === "CANCEL_FAILED" ? "font-bold text-red-600" : ""}>
                    {processing ? "결제 확인 중" : (ORDER_STATUS_LABEL[order.status] ?? order.status)}
                  </span>
                </div>
                <ul className="mt-2 text-gray-800">
                  {order.items.map((item) => (
                    <li key={item.id}>
                      {item.styleName} ({item.colorName} / {item.sizeName}) × {item.quantity}
                      {item.discountAmount > 0 && (
                        <span className="ml-2 text-xs text-red-600">
                          {item.promotionName} −{formatPrice(item.discountAmount * item.quantity)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-right font-bold text-gray-900">{formatPrice(order.totalPrice)}</p>
                {payment && (
                  <div className="mt-3 border-t border-gray-100 pt-3">
                    <PaymentSummary view={toPaymentView(payment)} orderStatus={order.status} />
                  </div>
                )}
                {order.status === "CANCEL_FAILED" && (
                  <p className="mt-2 text-sm text-red-600">주문 처리 중 문제가 생겨 환불을 확인하고 있어요. 확인 후 환불해 드릴게요.</p>
                )}
                {processing && (
                  <Link href={`/api/payments/status?orderId=${order.id}&try=0`} className="mt-2 inline-block text-sm text-gray-600 underline">
                    결제 결과 다시 확인
                  </Link>
                )}
                {order.status === "WAITING_DEPOSIT" && (
                  <form action={cancelDepositOrder} className="mt-3 text-right">
                    <input type="hidden" name="orderId" value={order.id} />
                    <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">입금 전 주문 취소</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
