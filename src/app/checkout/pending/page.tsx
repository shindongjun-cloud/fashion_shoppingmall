import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentCustomer } from "@/lib/current-customer";
import { prisma } from "@/lib/prisma";
import AutoRefresh from "@/components/AutoRefresh";
import { loginPath } from "@/lib/safe-redirect";

export const dynamic = "force-dynamic";

// 결제 결과 확인 중 (토스 응답을 못 받았거나 다른 탭에서 처리 중일 때)
// 3초마다 /api/payments/status가 토스에 물어보고, 결과가 나오면 완료·실패 화면으로 보냅니다.
// 오래 걸리면(약 1분) 자동 확인을 멈추고 안내합니다. 결과는 정기 작업이 계속 확인하므로 주문 내역에서 볼 수 있어요.
const MAX_TRIES = 20;

export default async function PendingPage({ searchParams }: PageProps<"/checkout/pending">) {
  const { orderNo, try: tryParam } = await searchParams;
  const customer = await getCurrentCustomer();
  if (!customer) redirect(loginPath("/orders"));
  if (typeof orderNo !== "string") notFound();
  const order = await prisma.order.findFirst({ where: { orderNo, customerId: customer.id } });
  if (!order) notFound();
  const tries = Math.max(0, Number(tryParam) || 0);
  const keepChecking = tries < MAX_TRIES;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-20 text-center">
      {keepChecking && <AutoRefresh href={`/api/payments/status?orderNo=${order.orderNo}&try=${tries}`} seconds={3} />}
      <p className="text-5xl">⏳</p>
      <h1 className="mt-4 text-2xl font-bold text-gray-900">결제 결과를 확인하고 있어요</h1>
      <p className="mt-2 text-gray-600">
        {keepChecking
          ? "잠시만 기다려 주세요. 이 화면을 닫거나 다시 결제하지 마세요."
          : "확인이 늦어지고 있어요. 결제가 승인되면 주문 내역에 표시되고, 승인되지 않았다면 결제된 금액은 자동으로 취소돼요."}
      </p>
      <p className="mt-1 text-sm text-gray-500">주문번호 {order.orderNo}</p>
      <div className="mt-8 flex justify-center gap-3">
        {!keepChecking && (
          <Link href={`/api/payments/status?orderNo=${order.orderNo}&try=0`} className="rounded-lg bg-gray-900 px-6 py-3 font-medium text-white hover:bg-gray-700">
            다시 확인
          </Link>
        )}
        <Link href="/orders" className="rounded-lg border border-gray-300 px-6 py-3 font-medium text-gray-700 hover:bg-gray-50">
          주문 내역
        </Link>
      </div>
    </main>
  );
}
