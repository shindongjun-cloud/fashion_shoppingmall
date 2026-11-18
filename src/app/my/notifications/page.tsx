import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCustomer } from "@/lib/current-customer";
import { prisma } from "@/lib/prisma";
import { listNotifications } from "@/lib/notification";
import { restockDates } from "@/lib/restock";
import { formatDate, formatDateTime } from "@/lib/format";
import { loginPath } from "@/lib/safe-redirect";
import { cancelRestockAction } from "@/app/products/actions";
import { markAllReadAction } from "./actions";

export const dynamic = "force-dynamic";

// 알림함 (회원): 재입고·반품 진행 알림 + 내 재입고 알림 신청 목록
// (이메일·카카오 알림톡 발송은 배포 때 연결. 지금은 사이트 알림함으로 받음)
const RESTOCK_STATUS: Record<string, string> = { WAITING: "재입고 일정 기다리는 중", SCHEDULED: "재입고 예정일 안내받음" };

export default async function NotificationsPage() {
  const customer = await getCurrentCustomer();
  if (!customer) redirect(loginPath("/my/notifications"));
  const [items, subs] = await Promise.all([
    listNotifications(customer.id),
    prisma.restockSubscription.findMany({
      where: { customerId: customer.id, status: { in: ["WAITING", "SCHEDULED"] } },
      include: { sku: { include: { size: true, styleColor: { include: { color: true, style: true } } } } },
      orderBy: { id: "desc" },
    }),
  ]);
  const dates = await restockDates(subs.map((s) => s.skuId));
  const unread = items.filter((n) => !n.readAt).length;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-gray-900">알림함</h1>
        {unread > 0 && (
          <form action={markAllReadAction}>
            <button className="text-sm text-gray-600 underline">모두 읽음 표시 ({unread})</button>
          </form>
        )}
      </div>

      {subs.length > 0 && (
        <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="font-bold text-gray-900">재입고 알림 신청</h2>
          <ul className="mt-2 divide-y divide-gray-100 text-sm">
            {subs.map((s) => {
              const st = s.sku.styleColor;
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={`/products/${st.style.styleCode}?color=${st.color.code}`} className="text-gray-800 hover:underline">
                    {st.style.name} ({st.color.name}/{s.sku.size.label})
                    <span className="ml-2 text-xs text-gray-500">
                      {dates.get(s.skuId) ? `${formatDate(dates.get(s.skuId)!)} 재입고 예정` : RESTOCK_STATUS[s.status]} · {formatDate(s.expiresAt)}까지
                    </span>
                  </Link>
                  <form action={cancelRestockAction}>
                    <input type="hidden" name="subscriptionId" value={s.id} />
                    <button className="text-xs text-gray-500 underline">신청 취소</button>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {items.length === 0 ? (
        <p className="mt-10 text-center text-gray-500">받은 알림이 없어요.</p>
      ) : (
        <ul className="mt-6 space-y-2">
          {items.map((n) => (
            <li key={n.id} className={`rounded-xl border p-4 ${n.readAt ? "border-gray-200 bg-white" : "border-blue-200 bg-blue-50"}`}>
              <div className="flex flex-wrap justify-between gap-2">
                <p className="font-medium text-gray-900">
                  {!n.readAt && <span className="mr-1 text-xs text-blue-700">새 알림</span>}
                  {n.title}
                </p>
                <span className="text-xs text-gray-500">{formatDateTime(n.createdAt)}</span>
              </div>
              <p className="mt-1 text-sm text-gray-700">{n.body}</p>
              {n.linkUrl && (
                <Link href={n.linkUrl} className="mt-1 inline-block text-sm text-gray-600 underline">
                  바로 가기
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
