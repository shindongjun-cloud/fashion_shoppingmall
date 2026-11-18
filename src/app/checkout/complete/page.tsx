import Link from "next/link";
import { notFound } from "next/navigation";
import { getOwners } from "@/lib/current-owner";
import { ownsOrder } from "@/lib/order-rules";
import { loginPath } from "@/lib/safe-redirect";
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
  const owners = await getOwners(); // 회원 로그인 / 비회원 출입증
  if (owners.length === 0 || typeof orderNo !== "string") {
    notFound();
  }

  // 내 주문이고, 결제 완료 또는 입금 대기인 주문만 보여줍니다. (남의 주문번호는 "없음"과 똑같이)
  const found = await prisma.order.findFirst({
    where: { orderNo, status: { in: ["PAID", "WAITING_DEPOSIT"] } },
    include: { items: { orderBy: { lineNo: "asc" } }, payments: { include: paymentInclude } }, // 상품 정보는 주문 항목의 스냅샷 컬럼
  });
  if (!found || !owners.some((o) => ownsOrder(o, found))) {
    notFound();
  }
  const order = found;
  const guest = order.customerId === null;
  const payment = mainPayment(order.payments);
  const waiting = order.status === "WAITING_DEPOSIT";

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-16 text-center">
      {/* 주문이 만들어졌으므로 장바구니를 비움 (입금 대기도 주문은 확정) */}
      <ClearCart />
      <p className="text-5xl">{waiting ? "🏦" : "🎉"}</p>
      <h1 className="mt-4 text-2xl font-bold text-gray-900">{waiting ? "주문이 접수되었어요. 입금해 주세요" : "결제가 완료되었어요"}</h1>
      <p className="mt-2 text-gray-600">주문번호 {order.orderNo}</p>
      {guest && (
        <div className="mx-auto mt-4 max-w-md rounded-xl border border-amber-300 bg-amber-50 p-4 text-left text-sm text-amber-900">
          <p className="font-bold">비회원 주문이에요. 주문번호를 꼭 적어 두세요.</p>
          <p className="mt-1">
            주문 조회·취소는 <span className="font-mono font-bold">{order.orderNo}</span> 와 주문할 때 정한 비밀번호로 해요. (상단 &quot;비회원 주문조회&quot;)
          </p>
          <p className="mt-1">
            회원이시면{" "}
            <Link href={loginPath(`/orders/claim?orderNo=${order.orderNo}`)} className="underline">
              로그인하고 이 주문을 내 계정으로 가져올 수 있어요
            </Link>
            .
          </p>
        </div>
      )}

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
        <Link href={guest ? `/guest/orders/${order.orderNo}` : `/orders/${order.orderNo}`} className="rounded-lg border border-gray-300 px-6 py-3 font-medium text-gray-800 hover:bg-gray-100">
          주문 상세 보기
        </Link>
        <Link href="/" className="rounded-lg bg-gray-900 px-6 py-3 font-medium text-white hover:bg-gray-700">
          계속 쇼핑하기
        </Link>
      </div>
    </main>
  );
}
