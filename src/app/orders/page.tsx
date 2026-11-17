import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, formatPrice } from "@/lib/format";

// 내 주문 내역 (로그인한 사람만 볼 수 있는 페이지)
export default async function OrdersPage() {
  const session = await auth();

  // 로그인 안 했으면 로그인 페이지로 보내고, 로그인 후 이 페이지로 돌아옵니다.
  // (id까지 확인: Prisma에서 userId가 undefined면 "조건 없음"이 되어 모든 주문이 나올 수 있어요)
  const userId = session?.user?.id;
  if (!userId) {
    redirect("/api/auth/signin?callbackUrl=/orders");
  }

  // "내" 주문만 가져옵니다. (where: userId)
  const orders = await prisma.order.findMany({
    where: { userId },
    include: { items: true }, // 상품 정보는 주문 항목의 스냅샷 컬럼에 있어서 상품 테이블을 조인하지 않습니다
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-bold text-gray-900">내 주문 내역</h1>
      <p className="mt-1 text-sm text-gray-500">
        {session?.user?.name}님, 안녕하세요.
      </p>

      {orders.length === 0 ? (
        <div className="mt-10 text-center">
          {/* 주문은 5단계(결제)에서 만들 수 있게 됩니다 */}
          <p className="text-gray-600">아직 주문한 상품이 없어요.</p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-lg bg-gray-900 px-6 py-3 font-medium text-white hover:bg-gray-700"
          >
            쇼핑하러 가기
          </Link>
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {orders.map((order) => (
            <li
              key={order.id}
              className="rounded-xl border border-gray-200 bg-white p-4"
            >
              <div className="flex justify-between text-sm text-gray-500">
                <span>
                  주문번호 {order.id} ·{" "}
                  {formatDate(order.createdAt)}
                </span>
                <span>{order.status === "PAID" ? "결제 완료" : "결제 대기"}</span>
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
              <p className="mt-2 text-right font-bold text-gray-900">
                {formatPrice(order.totalPrice)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
