import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/format";
import ClearCart from "@/components/ClearCart";

export const dynamic = "force-dynamic";

// 결제 완료 페이지. 예: /checkout/complete?orderId=3
export default async function CompletePage({
  searchParams,
}: PageProps<"/checkout/complete">) {
  const { orderId } = await searchParams;
  const session = await auth();
  const userId = session?.user?.id;
  const id = Number(orderId);
  if (!userId || !Number.isInteger(id)) {
    notFound();
  }

  // 내 주문이고, 결제 완료된 주문만 보여줍니다.
  const order = await prisma.order.findFirst({
    where: { id, userId, status: "PAID" },
    include: { items: true }, // 상품 정보는 주문 항목의 스냅샷 컬럼에 있어서 상품 테이블을 조인하지 않습니다
  });
  if (!order) {
    notFound();
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-16 text-center">
      <ClearCart />
      <p className="text-5xl">🎉</p>
      <h1 className="mt-4 text-2xl font-bold text-gray-900">
        결제가 완료되었어요
      </h1>
      <p className="mt-2 text-gray-600">주문번호 {order.id}</p>

      <ul className="mx-auto mt-8 max-w-md rounded-xl border border-gray-200 bg-white p-4 text-left">
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
          <span>총 결제 금액</span>
          <span>{formatPrice(order.totalPrice)}</span>
        </li>
      </ul>

      <div className="mt-8 flex justify-center gap-3">
        <Link
          href="/orders"
          className="rounded-lg border border-gray-300 px-6 py-3 font-medium text-gray-800 hover:bg-gray-100"
        >
          주문 내역 보기
        </Link>
        <Link
          href="/"
          className="rounded-lg bg-gray-900 px-6 py-3 font-medium text-white hover:bg-gray-700"
        >
          계속 쇼핑하기
        </Link>
      </div>
    </main>
  );
}
