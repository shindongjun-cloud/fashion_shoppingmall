import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCustomer } from "@/lib/current-customer";
import { getGuestOrderId } from "@/lib/current-owner";
import { prisma } from "@/lib/prisma";
import { GUEST_LOCK_MINUTES, GUEST_MAX_FAILS } from "@/lib/guest";
import { loginPath } from "@/lib/safe-redirect";
import { claimGuestOrderAction } from "./actions";

export const dynamic = "force-dynamic";

// 회원: 비회원으로 주문했던 주문을 내 계정으로 가져오기
//  - 주문번호 + 주문 비밀번호로 본인 확인 (휴대폰·이메일 자동 연결은 하지 않음: 우리 회원가입은 휴대폰·이메일 인증이 없어 남의 주문을 가져갈 수 있음)
//  - 이 브라우저에서 방금 비회원 주문을 조회·결제했다면 비밀번호 없이 바로
const RESULT: Record<string, string> = {
  WRONG: `주문번호 또는 주문 비밀번호가 맞지 않아요. ${GUEST_MAX_FAILS}번 틀리면 ${GUEST_LOCK_MINUTES}분 동안 시도할 수 없어요.`,
  RATE_LIMITED: "시도가 너무 많아요. 잠시 후 다시 시도해 주세요.",
  CLAIMED: "이미 회원 계정으로 옮겨진 주문이에요.",
  NOT_CLAIMABLE: "결제가 끝나지 않은 주문은 가져올 수 없어요.",
  NOT_ACTIVE: "지금 회원 상태(탈퇴 신청·휴면·정지)에서는 주문을 가져올 수 없어요.",
};

export default async function ClaimGuestOrderPage({ searchParams }: PageProps<"/orders/claim">) {
  const { r, orderNo } = await searchParams;
  const prefill = typeof orderNo === "string" && /^\d{8}-\d{8}$/.test(orderNo) ? orderNo : "";
  const customer = await getCurrentCustomer();
  if (!customer) redirect(loginPath(`/orders/claim${prefill ? `?orderNo=${prefill}` : ""}`));
  // 이 브라우저의 비회원 출입증이 이 주문번호의 것이면 비밀번호 없이 가져오기
  const guestOrderId = await getGuestOrderId();
  const sessionOrder = guestOrderId !== null ? await prisma.order.findUnique({ where: { id: guestOrderId }, select: { orderNo: true, status: true } }) : null;
  const viaSession = sessionOrder && sessionOrder.status !== "PENDING" && (!prefill || sessionOrder.orderNo === prefill) ? sessionOrder.orderNo : null;
  const message = typeof r === "string" ? RESULT[r] : undefined;
  const input = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2";

  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <Link href="/orders" className="text-sm text-gray-500 underline">
        ← 주문 내역
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-gray-900">비회원 주문 가져오기</h1>
      <p className="mt-2 text-sm text-gray-500">비회원으로 주문했던 주문을 내 계정의 주문 내역으로 옮겨요. 옮긴 뒤에는 비회원 조회로 볼 수 없어요.</p>
      <p className="mt-1 text-xs text-gray-500">비회원으로 산 주문이라 쿠폰·포인트 혜택은 소급되지 않아요. (등급 실적에는 포함)</p>
      {message && <p className="mt-6 rounded-lg bg-red-50 p-3 text-sm text-red-700">{message}</p>}

      {viaSession && !message && (
        <form action={claimGuestOrderAction} className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
          <input type="hidden" name="orderNo" value={viaSession} />
          <input type="hidden" name="useSession" value="1" />
          <p className="text-sm text-gray-700">
            이 브라우저에서 확인한 비회원 주문 <span className="font-medium">{viaSession}</span>
          </p>
          <button className="mt-3 w-full rounded-lg bg-gray-900 py-3 font-medium text-white hover:bg-gray-700">이 주문을 내 계정으로 가져오기</button>
        </form>
      )}

      <form action={claimGuestOrderAction} className="mt-6 space-y-4">
        <label className="block text-sm text-gray-700">
          주문번호
          <input name="orderNo" required defaultValue={prefill} placeholder="20261118-12345678" pattern="\d{8}-\d{8}" inputMode="numeric" className={input} />
        </label>
        <label className="block text-sm text-gray-700">
          주문 비밀번호
          <input name="password" type="password" required minLength={6} maxLength={20} className={input} />
        </label>
        <button className="w-full rounded-lg border border-gray-900 py-3 font-medium text-gray-900 hover:bg-gray-50">주문번호·비밀번호로 가져오기</button>
      </form>
    </main>
  );
}
