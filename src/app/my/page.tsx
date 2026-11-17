import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentCustomer } from "@/lib/current-customer";
import { getPaidAmountLast12Months, getProfileView, listAddresses } from "@/lib/customer";
import { formatDate, formatPrice } from "@/lib/format";
import { FIT_SCALE } from "@/lib/product-labels";
import { addAddressAction, deleteAddressAction, saveBodyAction, saveProfileAction, setDefaultAddressAction } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "정상",
  DORMANT: "휴면",
  SUSPENDED: "이용 정지",
  WITHDRAW_PENDING: "탈퇴 신청 중",
  WITHDRAWN: "탈퇴",
};
const GENDER_OPTIONS = [
  { value: "UNDISCLOSED", label: "선택 안 함" },
  { value: "FEMALE", label: "여성" },
  { value: "MALE", label: "남성" },
  { value: "OTHER", label: "기타" },
];
const input = "mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm";
const button = "rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700";

// 내 정보: 프로필(마스킹 표시) · 체형 · 배송지 · 등급 · 탈퇴
export default async function MyPage({ searchParams }: PageProps<"/my">) {
  const customer = await getCurrentCustomer();
  if (!customer) redirect("/api/auth/signin?callbackUrl=/my");
  const { ok, error } = await searchParams;

  const [profile, addresses, body, grade, nextGrade, yearAmount] = await Promise.all([
    getProfileView(customer.id),
    listAddresses(customer.id),
    prisma.customerBodyProfile.findUnique({ where: { customerId: customer.id } }),
    prisma.customerGrade.findUniqueOrThrow({ where: { id: customer.gradeId } }),
    prisma.customerGrade.findFirst({ where: { isActive: true, minAmount: { gt: 0 } , id: { not: customer.gradeId } }, orderBy: { minAmount: "asc" } }),
    getPaidAmountLast12Months(customer.id),
  ]);
  const amount = yearAmount;

  return (
    <main className="mx-auto w-full max-w-3xl space-y-10 px-4 py-10">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">내 정보</h1>
        <p className="mt-1 text-sm text-gray-500">
          고객번호 {customer.customerNo} · 가입 {formatDate(customer.joinedAt)} · 상태 {STATUS_LABEL[customer.status]}
        </p>
        {typeof ok === "string" && <p className="mt-3 rounded bg-green-50 p-3 text-sm text-green-700">{ok}</p>}
        {typeof error === "string" && <p className="mt-3 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {customer.status === "WITHDRAW_PENDING" && (
          <p className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-800">
            탈퇴 신청 중이에요. <Link href="/my/withdraw" className="underline">철회하기</Link>
          </p>
        )}
      </div>

      {/* 등급 */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="font-bold text-gray-900">회원 등급</h2>
        <p className="mt-2 text-lg font-bold text-gray-900">{grade.name}</p>
        <p className="text-sm text-gray-600">
          포인트 적립 {grade.pointRateBp / 100}% · 최근 12개월 결제 {formatPrice(amount)}
          {nextGrade && nextGrade.minAmount > amount && ` · ${nextGrade.name}까지 ${formatPrice(nextGrade.minAmount - amount)}`}
        </p>
        <p className="mt-1 text-xs text-gray-400">등급은 매월 1일 최근 12개월 결제 금액으로 다시 정해져요.</p>
      </section>

      {/* 프로필: 저장된 값은 가려서 보여 주고, 바꿀 때만 새로 입력 */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="font-bold text-gray-900">프로필</h2>
        <dl className="mt-3 grid grid-cols-[6rem_1fr] gap-y-1 text-sm">
          <dt className="text-gray-500">이름</dt><dd>{profile.masked.name ?? "-"}</dd>
          <dt className="text-gray-500">휴대폰</dt><dd>{profile.masked.phone ?? "-"}</dd>
          <dt className="text-gray-500">생년월일</dt><dd>{profile.masked.birthDate ?? "-"}</dd>
          <dt className="text-gray-500">이메일</dt><dd>{profile.masked.email ?? "-"}</dd>
        </dl>
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-gray-700 underline">수정하기</summary>
          <form action={saveProfileAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">이름<input name="name" className={input} maxLength={30} placeholder="비우면 삭제" /></label>
            <label className="text-sm">휴대폰<input name="phone" className={input} placeholder="010-1234-5678" /></label>
            <label className="text-sm">생년월일<input name="birthDate" type="date" className={input} /></label>
            <label className="text-sm">성별
              <select name="gender" defaultValue={profile.gender} className={input}>
                {GENDER_OPTIONS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </label>
            <label className="text-sm sm:col-span-2">연락용 이메일<input name="contactEmail" type="email" className={input} /></label>
            <p className="text-xs text-gray-500 sm:col-span-2">
              입력한 항목은 모두 새 값으로 바뀌고, 비운 항목은 삭제돼요. 개인정보는 암호화되어 저장돼요. 만 14세 미만은 가입할 수 없어요.
            </p>
            <div className="sm:col-span-2"><button className={button}>저장</button></div>
          </form>
        </details>
      </section>

      {/* 체형 정보 */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="font-bold text-gray-900">체형 정보 <span className="text-sm font-normal text-gray-500">(선택 · 사이즈 추천에 사용)</span></h2>
        <form action={saveBodyAction} className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-sm">키(cm)<input name="heightCm" type="number" defaultValue={body?.heightCm ?? ""} className={input} /></label>
          <label className="text-sm">몸무게(kg)<input name="weightKg" type="number" defaultValue={body?.weightKg ?? ""} className={input} /></label>
          <label className="text-sm">신발(mm)<input name="shoeSizeMm" type="number" defaultValue={body?.shoeSizeMm ?? ""} className={input} /></label>
          <label className="text-sm">평소 상의<input name="topSize" defaultValue={body?.topSize ?? ""} className={input} placeholder="100, L" /></label>
          <label className="text-sm">평소 하의<input name="bottomSize" defaultValue={body?.bottomSize ?? ""} className={input} placeholder="30" /></label>
          <label className="text-sm">선호 핏
            <select name="preferredFit" defaultValue={body?.preferredFit ?? ""} className={input}>
              <option value="">선택 안 함</option>
              {FIT_SCALE.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-3">
            <input name="showInReviews" type="checkbox" defaultChecked={body?.showInReviews ?? false} />
            리뷰에 키·사이즈 공개 (몸무게는 공개하지 않아요)
          </label>
          <div className="sm:col-span-3"><button className={button}>저장</button></div>
        </form>
      </section>

      {/* 배송지 */}
      <section id="addresses" className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="font-bold text-gray-900">배송지 <span className="text-sm font-normal text-gray-500">({addresses.length}/20)</span></h2>
        <ul className="mt-3 divide-y divide-gray-100">
          {addresses.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-4 py-3 text-sm">
              <div>
                <p className="font-medium text-gray-900">
                  {a.label} {a.isDefault && <span className="ml-1 rounded bg-gray-900 px-1.5 py-0.5 text-xs text-white">기본</span>}
                </p>
                <p className="text-gray-600">{a.recipient} · {a.phoneMasked}</p>
                <p className="text-gray-600">({a.zipCode}) {a.address1} {a.address2}</p>
                {a.deliveryMemo && <p className="text-gray-400">{a.deliveryMemo}</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                {!a.isDefault && (
                  <form action={setDefaultAddressAction}>
                    <input type="hidden" name="addressId" value={a.id} />
                    <button className="text-gray-600 underline">기본으로</button>
                  </form>
                )}
                <form action={deleteAddressAction}>
                  <input type="hidden" name="addressId" value={a.id} />
                  <button className="text-red-600 underline">삭제</button>
                </form>
              </div>
            </li>
          ))}
          {addresses.length === 0 && <li className="py-3 text-sm text-gray-500">등록된 배송지가 없어요.</li>}
        </ul>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-gray-700 underline">배송지 추가</summary>
          <form action={addAddressAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">배송지 이름<input name="label" required maxLength={20} className={input} placeholder="집" /></label>
            <label className="text-sm">받는 분<input name="recipient" required maxLength={30} className={input} /></label>
            <label className="text-sm">휴대폰<input name="phone" required className={input} placeholder="010-1234-5678" /></label>
            <label className="text-sm">우편번호<input name="zipCode" required pattern="\d{5}" className={input} placeholder="04780" /></label>
            <label className="text-sm sm:col-span-2">주소<input name="address1" required className={input} /></label>
            <label className="text-sm sm:col-span-2">상세 주소<input name="address2" className={input} /></label>
            <label className="text-sm sm:col-span-2">배송 메모<input name="deliveryMemo" maxLength={100} className={input} placeholder="문 앞에 놓아 주세요" /></label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input name="makeDefault" type="checkbox" />기본 배송지로 지정</label>
            <div className="sm:col-span-2"><button className={button}>추가</button></div>
          </form>
        </details>
      </section>

      <div className="text-right">
        <Link href="/my/withdraw" className="text-sm text-gray-400 underline">회원 탈퇴</Link>
      </div>
    </main>
  );
}
