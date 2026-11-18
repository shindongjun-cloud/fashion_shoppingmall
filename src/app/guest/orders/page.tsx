import Link from "next/link";
import { GUEST_LOCK_MINUTES, GUEST_MAX_FAILS } from "@/lib/guest";
import { lookupGuestOrderAction } from "./actions";

export const dynamic = "force-dynamic";

// 비회원 주문 조회: 주문번호 + 주문할 때 정한 비밀번호
const RESULT: Record<string, string> = {
  WRONG: `주문번호 또는 주문 비밀번호가 맞지 않아요. ${GUEST_MAX_FAILS}번 틀리면 ${GUEST_LOCK_MINUTES}분 동안 조회할 수 없어요.`,
  RATE_LIMITED: "조회 시도가 너무 많아요. 잠시 후 다시 시도해 주세요.",
  CLAIMED: "회원 계정으로 옮겨진 주문이에요. 로그인해서 주문 내역에서 확인해 주세요.",
};

export default async function GuestOrderLookupPage({ searchParams }: PageProps<"/guest/orders">) {
  const { r, orderNo, expired } = await searchParams;
  const message = typeof r === "string" ? RESULT[r] : expired ? "조회 시간이 지났어요. 다시 조회해 주세요." : undefined;
  const prefill = typeof orderNo === "string" && /^\d{8}-\d{8}$/.test(orderNo) ? orderNo : "";
  const input = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2";
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="text-center text-2xl font-bold text-gray-900">비회원 주문 조회</h1>
      <p className="mt-2 text-center text-sm text-gray-500">주문 완료 화면의 주문번호와 주문할 때 정한 비밀번호를 입력해 주세요.</p>
      {message && <p className={`mt-6 rounded-lg p-3 text-sm ${r === "CLAIMED" ? "bg-gray-100 text-gray-800" : "bg-red-50 text-red-700"}`}>{message}</p>}
      <form action={lookupGuestOrderAction} className="mt-6 space-y-4">
        <label className="block text-sm text-gray-700">
          주문번호
          <input name="orderNo" required defaultValue={prefill} placeholder="20261118-12345678" pattern="\d{8}-\d{8}" inputMode="numeric" className={input} />
        </label>
        <label className="block text-sm text-gray-700">
          주문 비밀번호
          <input name="password" type="password" required minLength={6} maxLength={20} autoComplete="current-password" className={input} />
        </label>
        <button className="w-full rounded-lg bg-gray-900 py-3 font-medium text-white hover:bg-gray-700">조회하기</button>
      </form>
      <p className="mt-6 text-center text-xs text-gray-500">
        주문 비밀번호를 잊으셨다면 고객센터로 문의해 주세요.
        <br />
        회원이신가요?{" "}
        <Link href="/login?callbackUrl=%2Forders" className="underline">
          로그인
        </Link>
      </p>
    </main>
  );
}
