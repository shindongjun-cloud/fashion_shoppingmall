import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCustomer } from "@/lib/current-customer";
import { downloadableGeneralCoupons, listMyCoupons } from "@/lib/coupon";
import { COUPON_KIND_LABEL, COUPON_NOTICE, isCouponNoticeCode } from "@/lib/coupon-rules";
import { formatDate } from "@/lib/format";
import { loginPath } from "@/lib/safe-redirect";
import { downloadCouponAction, redeemCodeAction } from "@/app/coupons/actions";

export const dynamic = "force-dynamic";

// 쿠폰함 (회원): 사용 가능 / 지난 쿠폰, 받을 수 있는 쿠폰, 코드 등록
const STATUS_LABEL: Record<string, string> = { AVAILABLE: "사용 가능", IN_USE: "결제 대기 주문에 사용 중", USED: "사용 완료", EXPIRED: "기간 만료", REVOKED: "회수됨" };

export default async function MyCouponsPage({ searchParams }: PageProps<"/my/coupons">) {
  const customer = await getCurrentCustomer();
  if (!customer) redirect(loginPath("/my/coupons"));
  const { coupon } = await searchParams;
  const notice = isCouponNoticeCode(coupon) ? COUPON_NOTICE[coupon] : null;
  const ok = coupon === "OK" || coupon === "CODE_OK";
  const [mine, downloadable] = await Promise.all([listMyCoupons(customer.id), customer.status === "ACTIVE" ? downloadableGeneralCoupons(customer.id) : []]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-gray-900">쿠폰함</h1>
        <Link href="/my" className="text-sm text-gray-500 underline">
          내 정보
        </Link>
      </div>
      {notice && <p className={`mt-4 rounded-lg p-3 text-sm ${ok ? "bg-gray-100 text-gray-800" : "bg-red-50 text-red-700"}`}>{notice}</p>}

      {/* 코드 등록 */}
      <form action={redeemCodeAction} className="mt-6 flex gap-2">
        <input type="hidden" name="back" value="/my/coupons" />
        <input name="code" required maxLength={30} placeholder="쿠폰 코드 입력" autoComplete="off" className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 uppercase" />
        <button className="shrink-0 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">등록</button>
      </form>

      {downloadable.length > 0 && (
        <section className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <h2 className="font-bold text-gray-900">받을 수 있는 쿠폰</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {downloadable.map((d) => (
              <li key={d.policyId} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-gray-800">
                  <span className="mr-1 text-xs text-blue-700">{COUPON_KIND_LABEL[d.kind]}</span>
                  {d.name} <span className="text-gray-500">· {d.benefit}</span>
                </span>
                <form action={downloadCouponAction}>
                  <input type="hidden" name="policyId" value={d.policyId} />
                  <input type="hidden" name="back" value="/my/coupons" />
                  <button className="rounded-lg border border-blue-600 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100">쿠폰 받기</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="font-bold text-gray-900">사용 가능한 쿠폰 {mine.usable.length}장</h2>
        {mine.usable.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">사용할 수 있는 쿠폰이 없어요.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {mine.usable.map((c) => (
              <li key={c.id} className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-bold text-gray-900">
                    <span className="mr-1 text-xs font-normal text-blue-700">{COUPON_KIND_LABEL[c.kind]}</span>
                    {c.name}
                  </span>
                  <span className={c.daysLeft <= 7 ? "text-xs text-red-600" : "text-xs text-gray-500"}>
                    {formatDate(new Date(c.validTo.getTime() - 1))}까지{c.daysLeft <= 7 ? ` (${c.daysLeft}일 남음)` : ""}
                  </span>
                </div>
                <p className="mt-1 text-gray-700">{c.benefit}</p>
                {c.description && <p className="mt-1 text-xs text-gray-500">{c.description}</p>}
                {c.status === "IN_USE" && (
                  <p className="mt-1 text-xs text-amber-700">
                    결제 대기 중인 주문({c.orderNo})에 사용 중이에요. 결제하지 않으면 바로 돌아와요.
                  </p>
                )}
                {c.paused && <p className="mt-1 text-xs text-red-600">지금은 사용이 일시 중지된 쿠폰이에요.</p>}
                <p className="mt-1 text-xs text-gray-400">{c.couponNo}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {mine.past.length > 0 && (
        <section className="mt-8">
          <h2 className="font-bold text-gray-900">지난 쿠폰</h2>
          <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white text-sm">
            {mine.past.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-gray-500">
                <span>
                  {c.name} <span className="text-xs">· {c.benefit}</span>
                </span>
                <span className="text-xs">
                  {STATUS_LABEL[c.status]}
                  {c.orderNo && c.status === "USED" && (
                    <Link href={`/orders/${c.orderNo}`} className="ml-1 underline">
                      주문 보기
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="mt-8 text-xs leading-relaxed text-gray-500">
        · 결제 전에 주문을 취소하거나 결제창을 닫으면 쿠폰은 바로 돌아와요.
        <br />· 결제 후 주문 전체를 취소하면 사용 기간이 남은 쿠폰은 돌아오고, 기간이 지났으면 소멸돼요.
        <br />· 일부 상품만 반품하면 쿠폰은 돌아오지 않고, 그 상품에 나눠진 쿠폰 할인만큼 덜 환불돼요.
        <br />· 배송비 쿠폰은 기본 배송비만 할인돼요. (제주·도서산간 추가 배송비 제외)
      </p>
    </main>
  );
}
