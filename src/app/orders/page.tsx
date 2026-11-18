import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getCurrentCustomer } from "@/lib/current-customer";
import { prisma } from "@/lib/prisma";
import { formatDate, formatPrice } from "@/lib/format";
import { FULFILLMENT_LABEL, ITEM_STATUS_LABEL } from "@/lib/order-labels";
import { ORDER_STATUS_LABEL } from "@/lib/payment-labels";
import { loginPath } from "@/lib/safe-redirect";

export const dynamic = "force-dynamic";

// 내 주문 내역 (로그인한 사람만 볼 수 있는 페이지). 자세한 내용·취소·배송조회는 주문 상세(/orders/주문번호)에서
// 결제창까지 가지 않았거나 결제에 실패한 "시도"는 주문으로 보여 주지 않습니다 (실제 쇼핑몰과 같이).
//   보여 주는 것: 입금 대기, 결제 완료(배송 진행), 입금 기한 만료, 환불 확인 중, 결제 후 취소된 주문, 결제 결과 확인 중인 주문
export default async function OrdersPage() {
  const session = await auth();

  // 로그인 안 했으면 로그인 페이지로 보내고, 로그인 후 이 페이지로 돌아옵니다.
  const customer = await getCurrentCustomer();
  if (!customer) {
    redirect(loginPath("/orders"));
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
    include: { items: { orderBy: { lineNo: "asc" } } }, // 상품 정보는 주문 항목의 스냅샷 컬럼
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-bold text-gray-900">내 주문 내역</h1>
      <p className="mt-1 text-sm text-gray-500">{session?.user?.name}님, 안녕하세요.</p>

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
            const statusText =
              order.status === "PAID" ? FULFILLMENT_LABEL[order.fulfillmentStatus] : order.status === "PENDING" ? "결제 확인 중" : (ORDER_STATUS_LABEL[order.status] ?? order.status);
            const mixed = new Set(order.items.map((i) => i.status)).size > 1; // 상품마다 상태가 다르면 줄마다 표시
            return (
              <li key={order.id} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap justify-between gap-2 text-sm text-gray-500">
                  <span>
                    {formatDate(order.createdAt)} · 주문번호 {order.orderNo}
                  </span>
                  <span className={order.status === "CANCEL_FAILED" ? "font-bold text-red-600" : "font-medium text-gray-800"}>{statusText}</span>
                </div>
                <ul className="mt-2 text-gray-800">
                  {order.items.map((item) => (
                    <li key={item.id}>
                      {item.styleName} ({item.colorName} / {item.sizeName}) × {item.quantity}
                      {mixed && <span className="ml-2 text-xs text-blue-700">{ITEM_STATUS_LABEL[item.status]}</span>}
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex items-center justify-between">
                  <Link href={`/orders/${order.orderNo}`} className="text-sm text-gray-600 underline">
                    주문 상세 · 배송조회
                  </Link>
                  <p className="font-bold text-gray-900">{formatPrice(order.totalPrice)}</p>
                </div>
                {order.status === "PENDING" && (
                  <Link href={`/api/payments/status?orderNo=${order.orderNo}&try=0`} className="mt-2 inline-block text-sm text-gray-600 underline">
                    결제 결과 다시 확인
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
