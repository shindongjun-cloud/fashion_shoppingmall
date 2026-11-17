import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentCustomer } from "@/lib/current-customer";
import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/format";
import { mainPayment, paymentInclude, toPaymentView } from "@/lib/payment-view";
import ClearCart from "@/components/ClearCart";
import PaymentSummary from "@/components/PaymentSummary";

export const dynamic = "force-dynamic";

// 결제 완료 / 입금 대기(가상계좌) 페이지. 예: /checkout/complete?orderId=3
export default async function CompletePage({ searchParams }: PageProps<"/checkout/complete">) {
  const { orderId } = await searchParams;
  const customer = await getCurrentCustomer();
  const id = Number(orderId);
  if (!customer || !Number.isInteger(id)) {
    notFound();
  }

  // 내 주문이고, 결제 완료 또는 입금 대기인 주문만 보여줍니다.
  const order = await prisma.order.findFirst({
    where: { id, customerId: customer.id, status: { in: ["PAID", "WAITING_DEPOSIT"] } },
    include: { items: true, payments: { include: paymentInclude } }, // 상품 정보는 주문 항목의 스냅샷 컬럼
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
      <p className="mt-2 text-gray-600">주문번호 {order.id}</p>

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
                <span className="ml-2 text-xs text-red-600">
                  {item.promotionName} −{formatPrice(item.discountAmount * item.quantity)}
                </span>
              )}
            </span>
            <span>{formatPrice(item.price * item.quantity)}</span>
          </li>
        ))}
        <li className="mt-2 flex justify-between border-t border-gray-200 pt-2 font-bold text-gray-900">
          <span>{waiting ? "입금할 금액" : "총 결제 금액"}</span>
          <span>{formatPrice(order.totalPrice)}</span>
        </li>
      </ul>

      <div className="mt-8 flex justify-center gap-3">
        <Link href="/orders" className="rounded-lg border border-gray-300 px-6 py-3 font-medium text-gray-800 hover:bg-gray-100">
          주문 내역 보기
        </Link>
        <Link href="/" className="rounded-lg bg-gray-900 px-6 py-3 font-medium text-white hover:bg-gray-700">
          계속 쇼핑하기
        </Link>
      </div>
    </main>
  );
}
