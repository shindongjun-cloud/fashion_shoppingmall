import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentCustomer } from "@/lib/current-customer";
import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/format";
import { mainPayment, paymentInclude, toPaymentView } from "@/lib/payment-view";
import ClearCart from "@/components/ClearCart";
import OrderAmounts from "@/components/OrderAmounts";
import PaymentSummary from "@/components/PaymentSummary";

export const dynamic = "force-dynamic";

// 결제 완료 / 입금 대기(가상계좌) 페이지. 예: /checkout/complete?orderNo=20261118-48213907
export default async function CompletePage({ searchParams }: PageProps<"/checkout/complete">) {
  const { orderNo } = await searchParams;
  const customer = await getCurrentCustomer();
  if (!customer || typeof orderNo !== "string") {
    notFound();
  }

  // 내 주문이고, 결제 완료 또는 입금 대기인 주문만 보여줍니다. (남의 주문번호는 "없음"과 똑같이)
  const order = await prisma.order.findFirst({
    where: { orderNo, customerId: customer.id, status: { in: ["PAID", "WAITING_DEPOSIT"] } },
    include: { items: { orderBy: { lineNo: "asc" } }, payments: { include: paymentInclude } }, // 상품 정보는 주문 항목의 스냅샷 컬럼
  });
  if (!order) {
    notFound();
  }
  const payment = mainPayment(order.payments);
  const waiting = order.status === "WAITING_DEPOSIT";

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-16 text-center">
      {/* 주문이 만들어졌으므로 장바구니를 비움 (입금 대기도 주문은 확정) */}
      <ClearCart />
      <p className="text-5xl">{waiting ? "🏦" : "🎉"}</p>
      <h1 className="mt-4 text-2xl font-bold text-gray-900">{waiting ? "주문이 접수되었어요. 입금해 주세요" : "결제가 완료되었어요"}</h1>
      <p className="mt-2 text-gray-600">주문번호 {order.orderNo}</p>

      {payment && (
        <div className="mx-auto mt-6 max-w-md rounded-xl border border-gray-200 bg-white p-4">
          <PaymentSummary view={toPaymentView(payment)} orderStatus={order.status} />
        </div>
      )}

      <ul className="mx-auto mt-4 max-w-md rounded-xl border border-gray-200 bg-white p-4 text-left">
        {order.items.map((item) => (
          <li key={item.id} className="flex justify-between py-1 text-gray-800">
            <span>
              {item.styleName} ({item.colorName} / {item.sizeName}) × {item.quantity}
              {item.discountAmount > 0 && (
                <span className="ml-2 whitespace-nowrap text-xs text-red-600">
                  {item.promotionName} −{formatPrice(item.lineDiscountTotal)}
                </span>
              )}
            </span>
            <span className="shrink-0 whitespace-nowrap pl-3">{formatPrice(item.lineTotal)}</span>
          </li>
        ))}
        <li className="mt-2 border-t border-gray-200 pt-2">
          <OrderAmounts order={order} totalLabel={waiting ? "입금할 금액" : "총 결제 금액"} />
        </li>
      </ul>

      <div className="mt-8 flex justify-center gap-3">
        <Link href={`/orders/${order.orderNo}`} className="rounded-lg border border-gray-300 px-6 py-3 font-medium text-gray-800 hover:bg-gray-100">
          주문 상세 보기
        </Link>
        <Link href="/" className="rounded-lg bg-gray-900 px-6 py-3 font-medium text-white hover:bg-gray-700">
          계속 쇼핑하기
        </Link>
      </div>
    </main>
  );
}
