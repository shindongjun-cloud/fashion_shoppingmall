import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentCustomer } from "@/lib/current-customer";
import { formatDate } from "@/lib/format";
import { cancelWithdrawalAction, requestWithdrawalAction } from "../actions";
import { loginPath } from "@/lib/safe-redirect";

export const dynamic = "force-dynamic";

const REASONS = [
  { value: "LOW_USAGE", label: "자주 이용하지 않아요" },
  { value: "PRIVACY", label: "개인정보가 걱정돼요" },
  { value: "PRODUCT", label: "상품이 마음에 들지 않아요" },
  { value: "DELIVERY", label: "배송이 불만족스러워요" },
  { value: "SERVICE", label: "서비스·응대가 불만족스러워요" },
  { value: "REJOIN", label: "다시 가입하려고 해요" },
  { value: "OTHER", label: "기타" },
];

// 회원 탈퇴: 신청 → 7일 유예(철회 가능) → 개인정보 파기
export default async function WithdrawPage({ searchParams }: PageProps<"/my/withdraw">) {
  const customer = await getCurrentCustomer();
  if (!customer) redirect(loginPath("/my/withdraw"));
  const { ok, error } = await searchParams;
  const open = await prisma.customerWithdrawal.findFirst({ where: { customerId: customer.id, completedAt: null, canceledAt: null } });

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Link href="/my" className="text-sm text-gray-500 hover:underline">← 내 정보</Link>
      <h1 className="mt-4 text-2xl font-bold text-gray-900">회원 탈퇴</h1>
      {typeof ok === "string" && <p className="mt-3 rounded bg-green-50 p-3 text-sm text-green-700">{ok}</p>}
      {typeof error === "string" && <p className="mt-3 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {open ? (
        <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <p className="font-bold">탈퇴 신청 중이에요</p>
          <p className="mt-1">
            {formatDate(open.scheduledAt)}에 탈퇴가 처리돼요. 그 전에는 언제든 철회할 수 있어요.
            신청 중에는 주문할 수 없어요.
          </p>
          <form action={cancelWithdrawalAction} className="mt-4">
            <button className="rounded-lg bg-gray-900 px-4 py-2 font-medium text-white hover:bg-gray-700">탈퇴 철회하기</button>
          </form>
        </section>
      ) : (
        <>
          <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-700">
            <h2 className="font-bold text-gray-900">탈퇴하기 전에 확인해 주세요</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>신청 후 7일 동안은 철회할 수 있고, 7일이 지나면 탈퇴가 처리돼요.</li>
              <li>탈퇴하면 이름·연락처·배송지·체형 정보가 바로 파기되고 복구할 수 없어요.</li>
              <li>주문·결제 기록은 전자상거래법에 따라 5년 동안 보관돼요 (개인을 알아볼 수 없게 처리).</li>
              <li>같은 GitHub 계정으로는 30일 동안 다시 가입할 수 없어요.</li>
              <li>결제 대기 중인 주문이 있으면 탈퇴할 수 없어요.</li>
            </ul>
          </section>
          <form action={requestWithdrawalAction} className="mt-6 space-y-4">
            <label className="block text-sm">탈퇴 사유
              <select name="reasonCode" className="mt-1 w-full rounded border border-gray-300 px-3 py-2">
                {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </label>
            <label className="block text-sm">하고 싶은 말 (선택)
              <textarea name="reasonText" maxLength={500} rows={3} className="mt-1 w-full rounded border border-gray-300 px-3 py-2" />
            </label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" />위 안내를 확인했어요</label>
            <button className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">탈퇴 신청</button>
          </form>
        </>
      )}
    </main>
  );
}
