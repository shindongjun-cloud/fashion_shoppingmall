import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getCartSkus } from "@/lib/catalog";
import { getCurrentCustomer } from "@/lib/current-customer";
import { listAddresses } from "@/lib/customer";
import CheckoutView from "@/components/CheckoutView";
import { getTossConfigProblem } from "@/lib/toss";
import { loginPath } from "@/lib/safe-redirect";
import { prisma } from "@/lib/prisma";
import { currentShippingPolicy, findZone } from "@/lib/order-rules";
import { REGION_LABEL } from "@/lib/order-labels";

export const dynamic = "force-dynamic";

// 주문서(결제) 페이지. 회원은 로그인, 비회원은 로그인 화면에서 "비회원으로 주문하기"(?guest=1)를 고른 경우
export default async function CheckoutPage({ searchParams }: PageProps<"/checkout">) {
  const session = await auth();
  const customer = await getCurrentCustomer();
  const { guest } = await searchParams;
  if (!session?.user || !customer) {
    if (guest === "1") return <GuestCheckout />;
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

  const now = new Date();
  const [skus, addresses, policy] = await Promise.all([getCartSkus(), listAddresses(customer.id), currentShippingPolicy(prisma, now).catch(() => null)]);
  if (!policy) {
    console.error("[주문 설정 오류] 지금 적용 중인 배송비 규칙(ShippingPolicy)이 없습니다");
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-20 text-center">
        <p className="text-gray-700">지금은 주문할 수 없어요. 배송비 설정을 확인하고 있어요.</p>
      </main>
    );
  }
  // 배송지마다 제주·도서산간 추가 배송비를 미리 계산 (화면 표시용. 실제 금액은 주문할 때 서버가 다시 계산)
  const addressOptions = await Promise.all(
    addresses.map(async (a) => {
      const zone = await findZone(prisma, policy.id, a.zipCode);
      return {
        id: a.id,
        label: a.label,
        isDefault: a.isDefault,
        recipient: a.recipient,
        phoneMasked: a.phoneMasked,
        line: `(${a.zipCode}) ${a.address1} ${a.address2 ?? ""}`.trim(),
        deliveryMemo: a.deliveryMemo,
        extraFee: zone?.extraFee ?? 0,
        regionLabel: zone ? `${REGION_LABEL[zone.region]} · ${zone.name}` : null,
      };
    }),
  );

  return (
    <CheckoutView
      skus={skus}
      customerKey={customer.customerNo} // 토스가 구매자를 구분하는 값 (로그인 계정이 아닌 고객번호: 탈퇴 후에도 바뀌지 않음)
      customerName={session.user.name ?? undefined}
      customerEmail={session.user.email ?? undefined}
      addresses={addressOptions}
      shippingRule={{ baseFee: policy.baseFee, freeShippingThreshold: policy.freeShippingThreshold }}
    />
  );
}

/** 비회원 주문서: 배송지는 직접 입력 → 우편번호로 추가 배송비를 화면에서 바로 계산하도록 지역 범위를 넘김 */
async function GuestCheckout() {
  const configProblem = getTossConfigProblem();
  const policy = await currentShippingPolicy(prisma, new Date()).catch(() => null);
  if (configProblem || !policy) {
    console.error(`[결제 설정 오류] ${configProblem ?? "지금 적용 중인 배송비 규칙이 없습니다"}`);
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-20 text-center">
        <p className="text-gray-700">지금은 주문할 수 없어요. 설정을 확인하고 있어요.</p>
      </main>
    );
  }
  const [skus, zones] = await Promise.all([getCartSkus(), prisma.shippingSurchargeZone.findMany({ where: { policyId: policy.id }, orderBy: { zipFrom: "asc" } })]);
  return (
    <CheckoutView
      skus={skus}
      customerKey="ANONYMOUS"
      addresses={[]}
      shippingRule={{ baseFee: policy.baseFee, freeShippingThreshold: policy.freeShippingThreshold }}
      guest={{ zones: zones.map((z) => ({ zipFrom: z.zipFrom, zipTo: z.zipTo, extraFee: z.extraFee, label: `${REGION_LABEL[z.region]} · ${z.name}` })) }}
    />
  );
}
