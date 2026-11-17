import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getCartSkus } from "@/lib/catalog";
import { getCurrentCustomer } from "@/lib/current-customer";
import { listAddresses } from "@/lib/customer";
import CheckoutView from "@/components/CheckoutView";
import { getTossConfigProblem } from "@/lib/toss";
import { loginPath } from "@/lib/safe-redirect";

export const dynamic = "force-dynamic";

// 주문서(결제) 페이지. 로그인한 사람만 들어올 수 있어요.
export default async function CheckoutPage() {
  const session = await auth();
  const customer = await getCurrentCustomer();
  if (!session?.user || !customer) {
    redirect(loginPath("/checkout"));
  }

  // 정상(ACTIVE) 고객만 주문 가능 (DB 트리거 Order_customer_active도 막음)
  if (customer.status !== "ACTIVE") {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-20 text-center">
        <p className="text-gray-700">
          {customer.status === "WITHDRAW_PENDING" ? "탈퇴 신청 중에는 주문할 수 없어요. 탈퇴를 철회하면 다시 주문할 수 있어요." : "지금은 주문할 수 없는 회원 상태예요."}
        </p>
        <Link href="/my" className="mt-6 inline-block rounded-lg bg-gray-900 px-6 py-3 font-medium text-white hover:bg-gray-700">
          내 정보로 가기
        </Link>
      </main>
    );
  }

  // 결제 키가 비어 있거나 짝이 안 맞으면 결제창을 띄우지 않고 바로 알림 (결제 직전에야 알게 되는 일 방지)
  const configProblem = getTossConfigProblem();
  if (configProblem) {
    console.error(`[결제 설정 오류] ${configProblem}`);
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-20 text-center">
        <p className="text-gray-700">지금은 결제할 수 없어요. 결제 설정을 확인하고 있어요.</p>
        {process.env.NODE_ENV !== "production" && <p className="mt-2 text-sm text-red-600">개발자 안내: {configProblem} (.env 확인)</p>}
        <Link href="/cart" className="mt-6 inline-block rounded-lg bg-gray-900 px-6 py-3 font-medium text-white hover:bg-gray-700">
          장바구니로
        </Link>
      </main>
    );
  }

  const [skus, addresses] = await Promise.all([getCartSkus(), listAddresses(customer.id)]);
  const shipTo = addresses.find((a) => a.isDefault);

  return (
    <>
      {/* 기본 배송지 (주문서에 배송지 스냅샷을 저장하는 것은 ⑦ 주문 단계) */}
      <section className="mx-auto mt-10 w-full max-w-3xl px-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900">배송지</h2>
            <Link href="/my#addresses" className="text-gray-500 underline">변경</Link>
          </div>
          {shipTo ? (
            <p className="mt-2 text-gray-700">
              [{shipTo.label}] {shipTo.recipient} · {shipTo.phoneMasked}
              <br />({shipTo.zipCode}) {shipTo.address1} {shipTo.address2}
            </p>
          ) : (
            <p className="mt-2 text-red-600">등록된 배송지가 없어요. 내 정보에서 배송지를 추가해 주세요.</p>
          )}
        </div>
      </section>
      <CheckoutView
        skus={skus}
        customerKey={customer.customerNo} // 토스가 구매자를 구분하는 값 (로그인 계정이 아닌 고객번호: 탈퇴 후에도 바뀌지 않음)
        customerName={session.user.name ?? undefined}
        customerEmail={session.user.email ?? undefined}
        hasAddress={Boolean(shipTo)}
      />
    </>
  );
}
