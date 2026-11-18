"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ANONYMOUS,
  loadTossPayments,
  type TossPaymentsWidgets,
} from "@tosspayments/tosspayments-sdk";
import { useCart } from "@/context/CartContext";
import { cancelPendingOrder, createGuestOrder, createOrder } from "@/app/checkout/actions";
import { redeemCodeAtCheckout } from "@/app/coupons/actions";
import { applyCoupon, couponBenefitText, couponChoices, COUPON_KIND_LABEL, type CouponOption } from "@/lib/coupon-rules";
import { formatDate } from "@/lib/format";
import type { CartSku } from "@/lib/catalog";
import { formatPrice } from "@/lib/format";
import { isKnownFailCode, paymentFailMessage } from "@/lib/payment-labels";

// NEXT_PUBLIC_ 으로 시작하는 환경변수만 브라우저 코드에서 읽을 수 있어요. (클라이언트 키는 공개돼도 괜찮음)
const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? "";

export type CheckoutAddress = {
  id: number;
  label: string;
  isDefault: boolean;
  recipient: string;
  phoneMasked: string;
  line: string;
  deliveryMemo: string | null;
  /** 제주·도서산간 추가 배송비 (일반 지역 0) */
  extraFee: number;
  regionLabel: string | null;
};

type Props = {
  skus: CartSku[];
  customerKey: string;
  customerName?: string;
  customerEmail?: string;
  /** 내 주소록 (없으면 결제 버튼을 막음) */
  addresses: CheckoutAddress[];
  /** 지금 적용 중인 배송비 규칙 (화면 표시용. 실제 금액은 서버가 다시 계산) */
  shippingRule: { baseFee: number; freeShippingThreshold: number | null };
  /** 비회원 주문: 배송지를 직접 입력하므로 우편번호 → 추가 배송비 계산용 지역 범위 */
  guest?: { zones: { zipFrom: string; zipTo: string; extraFee: number; label: string }[] };
  /** 회원: 쓸 수 있는 쿠폰 (대상 SKU는 서버가 계산). 할인 계산은 서버와 같은 lib/coupon-rules.ts */
  coupons?: CouponOption[];
  /** 서버 기준 지금 시각 (쿠폰 "N일 남음" 계산용. 화면 그리는 중에 Date.now()를 부르면 서버·브라우저 결과가 달라질 수 있음) */
  nowMs?: number;
};

/** 비회원 주문서 입력값 */
const EMPTY_GUEST = { name: "", phone: "", email: "", recipient: "", recipientPhone: "", zipCode: "", address1: "", address2: "", memo: "", password: "", passwordConfirm: "", sameAsOrderer: true, consent: false };

export default function CheckoutView({
  skus,
  customerKey,
  customerName,
  customerEmail,
  addresses,
  shippingRule,
  guest,
  coupons = [],
  nowMs = 0,
}: Props) {
  const router = useRouter();
  // 고객이 고른 쿠폰 1장 (null = 쿠폰 안 씀. 자동으로 고르지 않음: 만료일을 보고 고객이 선택)
  const [couponId, setCouponId] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [codeMsg, setCodeMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [g, setG] = useState(EMPTY_GUEST);
  const setField = (key: keyof typeof EMPTY_GUEST) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setG((prev) => ({ ...prev, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const { items } = useCart();
  const [widgets, setWidgets] = useState<TossPaymentsWidgets | null>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addressId, setAddressId] = useState<number | null>(
    (addresses.find((a) => a.isDefault) ?? addresses[0])?.id ?? null,
  );
  const startedRef = useRef(false);
  const field = "min-w-0 rounded-lg border border-gray-300 px-3 py-2";

  const lines = items.flatMap((item) => {
    const sku = skus.find((s) => s.id === item.skuId);
    return sku ? [{ ...item, sku }] : [];
  });
  const address = addresses.find((a) => a.id === addressId) ?? null;
  // 비회원: 우편번호 5자리를 다 입력하면 제주·도서산간 추가 배송비를 바로 보여 줌
  const guestZone = guest && /^\d{5}$/.test(g.zipCode) ? (guest.zones.find((z) => z.zipFrom <= g.zipCode && g.zipCode <= z.zipTo) ?? null) : null;
  const guestReady = Boolean(guest && g.name && g.phone && g.email && g.zipCode.length === 5 && g.address1 && g.password && g.passwordConfirm && g.consent && (g.sameAsOrderer || (g.recipient && g.recipientPhone)));

  // 화면 표시용 금액. 실제 결제 금액은 서버(createOrder)가 DB 가격·배송비 규칙으로 다시 계산합니다.
  const listTotal = lines.reduce((sum, l) => sum + l.sku.listPrice * l.quantity, 0);
  const itemsTotal = lines.reduce((sum, l) => sum + l.sku.price * l.quantity, 0);
  const discount = listTotal - itemsTotal;
  const threshold = shippingRule.freeShippingThreshold;
  const freeShipping = threshold !== null && itemsTotal >= threshold;
  const baseFee = freeShipping ? 0 : shippingRule.baseFee;
  const extraFee = guest ? (guestZone?.extraFee ?? 0) : (address?.extraFee ?? 0);

  // 쿠폰 (주문당 1장): 화면 계산 = 서버 계산 (같은 함수)
  // 목록은 할인 금액이 큰 순서 (같으면 만료가 빠른 순), 쓸 수 없는 쿠폰은 아래에 이유와 함께
  const calcLines = lines.map((l) => ({ skuId: l.sku.id, lineTotal: l.sku.price * l.quantity }));
  const choices = guest ? [] : couponChoices(calcLines, baseFee, coupons);
  const appliedResult = guest ? null : applyCoupon(calcLines, baseFee, coupons, couponId);
  // 고른 쿠폰을 장바구니·배송지 변경으로 더 쓸 수 없게 되면 할인 없이 계산하고 안내 (결제 금액이 화면과 달라지지 않게)
  const applied = appliedResult && !("error" in appliedResult) ? appliedResult : null;
  const couponProblem = appliedResult && "error" in appliedResult ? appliedResult.error : null;
  const couponDiscount = applied?.couponDiscountTotal ?? 0;
  const shippingDiscount = applied?.shippingDiscount ?? 0;
  const total = itemsTotal - couponDiscount + baseFee + extraFee - shippingDiscount;
  const daysLeft = (iso: string) => Math.ceil((new Date(iso).getTime() - nowMs) / 86400_000);

  async function registerCode() {
    if (!code.trim()) return;
    const r = await redeemCodeAtCheckout(code);
    setCodeMsg({ ok: r.ok, text: r.message });
    if (r.ok) {
      setCode("");
      router.refresh(); // 서버에서 쿠폰 목록을 다시 받음 (고르는 것은 고객이)
    }
  }

  // 1) 토스 결제 위젯(결제수단 선택 + 약관)을 화면에 한 번만 그립니다.
  useEffect(() => {
    if (total === 0 || startedRef.current) return;
    startedRef.current = true; // 개발 모드에서 두 번 실행되는 것 방지

    (async () => {
      const tossPayments = await loadTossPayments(clientKey);
      // 비회원은 토스 규칙대로 ANONYMOUS (회원은 고객번호)
      const newWidgets = tossPayments.widgets({ customerKey: customerKey === "ANONYMOUS" ? ANONYMOUS : customerKey });
      await newWidgets.setAmount({ currency: "KRW", value: total });
      await Promise.all([
        newWidgets.renderPaymentMethods({ selector: "#payment-method" }),
        newWidgets.renderAgreement({ selector: "#agreement" }),
      ]);
      setWidgets(newWidgets);
    })().catch(() => {
      setError("결제 화면을 불러오지 못했어요. 새로고침해 주세요.");
    });
  }, [total, customerKey]);

  // 배송지를 바꿔 배송비(제주·도서산간)가 달라지면 위젯 금액도 맞춤 (할인 가능한 결제수단 표시가 금액에 따라 달라짐)
  useEffect(() => {
    if (widgets && total > 0) void widgets.setAmount({ currency: "KRW", value: total });
  }, [widgets, total]);

  // 2) 결제 버튼
  async function handlePay() {
    if (!widgets || (!guest && !address)) return;
    setPaying(true);
    setError(null);

    // 서버에 주문을 만들고(배송지 스냅샷 + 재고 예약), 서버가 계산한 금액을 받아옵니다.
    // (비회원: 입력값 검사·비밀번호 해시·동의 기록·출입증 쿠키도 서버가)
    const order = guest
      ? await createGuestOrder(items, {
          orderer: { name: g.name, phone: g.phone, email: g.email },
          address: {
            recipient: g.sameAsOrderer ? g.name : g.recipient,
            phone: g.sameAsOrderer ? g.phone : g.recipientPhone,
            zipCode: g.zipCode,
            address1: g.address1,
            address2: g.address2,
            deliveryMemo: g.memo,
          },
          password: g.password,
          passwordConfirm: g.passwordConfirm,
          privacyConsent: g.consent,
        })
      : await createOrder(items, address!.id, couponProblem ? null : couponId);
    if ("error" in order) {
      setError(order.error);
      setPaying(false);
      return;
    }

    // 화면을 연 뒤 할인 행사·배송비 규칙이 바뀌면, 화면 금액과 서버가 계산한 결제 금액이 달라집니다.
    // 고객이 본 금액과 다른 금액으로 결제창을 띄우면 안 되므로 멈추고 알려 줍니다.
    // 이 주문이 잡아 둔 재고 예약은 바로 풉니다 (안 풀면 20분 동안 다른 고객이 못 삼)
    if (order.amount !== total) {
      await cancelPendingOrder(order.paymentOrderId, "PRICE_CHANGED");
      setError(
        `그 사이 금액이 바뀌었어요 (${formatPrice(total)} → ${formatPrice(order.amount)}). 새로고침해서 바뀐 금액을 확인해 주세요.`,
      );
      setPaying(false);
      return;
    }

    try {
      await widgets.setAmount({ currency: "KRW", value: order.amount });
      // 결제창이 뜨고, 결제가 끝나면 successUrl 또는 failUrl로 이동합니다.
      await widgets.requestPayment({
        orderId: order.paymentOrderId,
        orderName: order.orderName,
        customerName: guest ? g.name : customerName,
        customerEmail: guest ? g.email : customerEmail,
        successUrl: `${window.location.origin}/api/payments/confirm`,
        // 실패·취소 시 재고 예약을 풀고 실패 화면으로 보내는 라우트
        failUrl: `${window.location.origin}/api/payments/fail`,
      });
    } catch (e) {
      // 결제창을 닫았거나 약관 미동의 등 → 시도 기록 + 재고 예약을 바로 풂
      // SDK 오류 코드가 있으면 우리 문구로, 없으면 SDK 메시지 (예: 약관에 동의해 주세요)
      const code = (e as { code?: string }).code;
      await cancelPendingOrder(order.paymentOrderId, "PAYMENT_FAILED", code);
      setError(
        code === "USER_CANCEL"
          ? "결제를 취소했어요. 다시 결제하려면 버튼을 눌러 주세요."
          : code && isKnownFailCode(code)
            ? paymentFailMessage(code)
            : e instanceof Error && e.message
              ? e.message // SDK 안내 (예: 필수 약관에 동의해 주세요)
              : paymentFailMessage(code),
      );
      setPaying(false);
    }
  }

  if (lines.length === 0) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-20 text-center">
        <p className="text-gray-600">장바구니가 비어 있어요.</p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg bg-gray-900 px-6 py-3 font-medium text-white hover:bg-gray-700"
        >
          쇼핑하러 가기
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold text-gray-900">주문서</h1>
      <p className="mt-1 text-sm text-amber-700">
        테스트 모드예요. 실제로 돈이 나가지 않아요.
      </p>

      {guest && (
        <section className="mt-6 space-y-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900">비회원 주문</h2>
            <Link href="/login?callbackUrl=%2Fcheckout" className="text-gray-500 underline">
              회원 로그인
            </Link>
          </div>
          <p className="text-xs text-gray-500">비회원은 쿠폰·포인트를 쓸 수 없어요. 주문 내역은 주문번호와 아래 주문 비밀번호로 조회해요.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <input value={g.name} onChange={setField("name")} maxLength={30} placeholder="주문자 이름" autoComplete="name" className={field} disabled={paying} />
            <input value={g.phone} onChange={setField("phone")} inputMode="tel" placeholder="휴대폰 010-0000-0000" autoComplete="tel" className={field} disabled={paying} />
            <input value={g.email} onChange={setField("email")} type="email" placeholder="이메일" autoComplete="email" className={field} disabled={paying} />
          </div>
          <h3 className="pt-2 font-bold text-gray-900">배송지</h3>
          <label className="flex items-center gap-2 text-gray-700">
            <input type="checkbox" checked={g.sameAsOrderer} onChange={setField("sameAsOrderer")} className="accent-gray-900" disabled={paying} /> 받는 분이 주문자와 같아요
          </label>
          {!g.sameAsOrderer && (
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={g.recipient} onChange={setField("recipient")} maxLength={30} placeholder="받는 분" className={field} disabled={paying} />
              <input value={g.recipientPhone} onChange={setField("recipientPhone")} inputMode="tel" placeholder="받는 분 휴대폰" className={field} disabled={paying} />
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            <input value={g.zipCode} onChange={setField("zipCode")} inputMode="numeric" maxLength={5} placeholder="우편번호 5자리" autoComplete="postal-code" className={field} disabled={paying} />
            <input value={g.address1} onChange={setField("address1")} maxLength={100} placeholder="주소" autoComplete="address-line1" className={`${field} sm:col-span-2`} disabled={paying} />
            <input value={g.address2} onChange={setField("address2")} maxLength={100} placeholder="상세 주소" autoComplete="address-line2" className={`${field} sm:col-span-2`} disabled={paying} />
            <input value={g.memo} onChange={setField("memo")} maxLength={100} placeholder="배송 메모 (선택)" className={field} disabled={paying} />
          </div>
          {guestZone && <p className="text-xs text-amber-700">{guestZone.label} 추가 배송비 {formatPrice(guestZone.extraFee)}</p>}
          <h3 className="pt-2 font-bold text-gray-900">주문 비밀번호</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={g.password} onChange={setField("password")} type="password" minLength={6} maxLength={20} placeholder="6~20자" autoComplete="new-password" className={field} disabled={paying} />
            <input value={g.passwordConfirm} onChange={setField("passwordConfirm")} type="password" minLength={6} maxLength={20} placeholder="한 번 더" autoComplete="new-password" className={field} disabled={paying} />
          </div>
          <p className="text-xs text-gray-500">주문 조회·취소에 써요. 잊으면 고객센터로 문의해야 하니 꼭 기억해 주세요.</p>
          <label className="flex items-start gap-2 rounded-lg bg-gray-50 p-3 text-gray-700">
            <input type="checkbox" checked={g.consent} onChange={setField("consent")} className="mt-0.5 accent-gray-900" disabled={paying} />
            <span>
              (필수) 비회원 주문 개인정보 수집·이용 동의
              <span className="mt-1 block text-xs text-gray-500">
                수집 항목: 주문자 이름·휴대폰·이메일, 받는 분 이름·휴대폰·주소 / 목적: 주문·배송·결제·고객 상담 / 보관: 주문일로부터 5년 (전자상거래법) 후 파기
              </span>
            </span>
          </label>
        </section>
      )}

      {/* 배송지: 주소록에서 선택. 주문에는 이 값을 복사해 저장 (나중에 주소록을 바꿔도 주문 배송지는 그대로) */}
      {!guest && (
      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4 text-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-900">배송지</h2>
          <Link href="/my#addresses" className="text-gray-500 underline">
            배송지 관리
          </Link>
        </div>
        {addresses.length === 0 ? (
          <p className="mt-2 text-red-600">등록된 배송지가 없어요. 내 정보에서 배송지를 추가해 주세요.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {addresses.map((a) => (
              <label
                key={a.id}
                className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${a.id === addressId ? "border-gray-900" : "border-gray-200"}`}
              >
                <input
                  type="radio"
                  name="address"
                  checked={a.id === addressId}
                  onChange={() => setAddressId(a.id)}
                  disabled={paying}
                  className="mt-1 accent-gray-900"
                />
                <span className="text-gray-700">
                  <span className="font-medium text-gray-900">[{a.label}]</span>
                  {a.isDefault && <span className="ml-1 text-xs text-blue-600">기본</span>} {a.recipient} · {a.phoneMasked}
                  <br />
                  {a.line}
                  {a.deliveryMemo && <span className="block text-xs text-gray-500">메모: {a.deliveryMemo}</span>}
                  {a.regionLabel && (
                    <span className="block text-xs text-amber-700">
                      {a.regionLabel} 추가 배송비 {formatPrice(a.extraFee)}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        )}
      </section>
      )}

      {/* 주문 상품 요약 */}
      <ul className="mt-6 divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
        {lines.map(({ sku, quantity }) => (
          <li key={sku.id} className="flex items-center gap-3 p-4">
            <span
              className="h-4 w-4 shrink-0 rounded-full border border-gray-300"
              style={{ backgroundColor: sku.colorHex }}
            />
            <span className="flex-1 text-gray-900">
              {sku.styleName}
              <span className="text-sm text-gray-500"> ({sku.colorName} / {sku.sizeName})</span> × {quantity}
            </span>
            <span className="shrink-0 whitespace-nowrap font-medium text-gray-900">
              {formatPrice(sku.price * quantity)}
            </span>
          </li>
        ))}
      </ul>

      {/* 쿠폰 (회원): 주문당 1장, 고객이 직접 선택. 할인 금액이 큰 순서 + 만료일 표시 */}
      {!guest && (
        <section className="mt-4 space-y-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-bold text-gray-900">쿠폰</h2>
            <span className="text-xs text-gray-500">주문당 1장 · 할인 금액이 큰 순서</span>
          </div>
          {choices.length === 0 ? (
            <p className="text-gray-500">사용할 수 있는 쿠폰이 없어요.</p>
          ) : (
            <ul className="space-y-2">
              <li>
                <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${couponId === null ? "border-gray-900" : "border-gray-200"}`}>
                  <input type="radio" name="coupon" checked={couponId === null} onChange={() => setCouponId(null)} disabled={paying} className="accent-gray-900" />
                  <span className="text-gray-700">쿠폰 사용 안 함</span>
                </label>
              </li>
              {choices.map(({ coupon: c, amount, lineIndex, reason }) => {
                const usable = amount > 0;
                const left = daysLeft(c.validTo);
                return (
                  <li key={c.id}>
                    <label
                      className={`flex items-start gap-3 rounded-lg border p-3 ${usable ? "cursor-pointer" : "cursor-not-allowed bg-gray-50 opacity-60"} ${couponId === c.id ? "border-gray-900" : "border-gray-200"}`}
                    >
                      <input type="radio" name="coupon" checked={couponId === c.id} onChange={() => setCouponId(c.id)} disabled={paying || !usable} className="mt-1 accent-gray-900" />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                          <span className="font-medium text-gray-900">
                            <span className="mr-1 text-xs font-normal text-blue-700">{COUPON_KIND_LABEL[c.kind]}</span>
                            {c.name}
                          </span>
                          {usable && <span className="whitespace-nowrap font-bold text-red-600">−{formatPrice(amount)}</span>}
                        </span>
                        <span className="block text-xs text-gray-500">
                          {couponBenefitText(c)} · {formatDate(new Date(new Date(c.validTo).getTime() - 1))}까지
                          {left <= 7 && <span className="text-red-600"> ({left}일 남음)</span>}
                        </span>
                        {usable && c.kind === "PRODUCT" && lineIndex !== null && (
                          <span className="block text-xs text-gray-500">적용 상품: {lines[lineIndex].sku.styleName}</span>
                        )}
                        {!usable && reason && <span className="block text-xs text-gray-500">{reason}</span>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {couponProblem && <p className="text-xs text-amber-700">{couponProblem} — 다른 쿠폰을 고르거나 쿠폰 없이 결제해 주세요.</p>}
          <div className="flex gap-2 pt-1">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={30}
              placeholder="쿠폰 코드"
              autoComplete="off"
              disabled={paying}
              className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 uppercase"
            />
            <button type="button" onClick={registerCode} disabled={paying || !code.trim()} className="shrink-0 rounded-lg border border-gray-900 px-3 py-1.5 text-xs font-medium disabled:opacity-50">
              등록
            </button>
          </div>
          {codeMsg && <p className={`text-xs ${codeMsg.ok ? "text-blue-700" : "text-red-600"}`}>{codeMsg.text}</p>}
        </section>
      )}

      {/* 금액 구성: 상품 금액 − 상품 할인 − 쿠폰 + 배송비 − 배송비 쿠폰 = 결제 금액 (포인트는 다음 단계) */}
      <dl className="mt-4 space-y-1 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
        <div className="flex justify-between">
          <dt>상품 금액</dt>
          <dd className="whitespace-nowrap">{formatPrice(listTotal)}</dd>
        </div>
        {discount > 0 && (
          <div className="flex justify-between text-red-600">
            <dt>상품 할인</dt>
            <dd className="whitespace-nowrap">−{formatPrice(discount)}</dd>
          </div>
        )}
        {couponDiscount > 0 && (
          <div className="flex justify-between text-red-600">
            <dt>쿠폰 할인</dt>
            <dd className="whitespace-nowrap">−{formatPrice(couponDiscount)}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt>배송비</dt>
          <dd className="whitespace-nowrap">{baseFee === 0 ? "무료" : formatPrice(baseFee)}</dd>
        </div>
        {shippingDiscount > 0 && (
          <div className="flex justify-between text-red-600">
            <dt>배송비 쿠폰 할인</dt>
            <dd className="whitespace-nowrap">−{formatPrice(shippingDiscount)}</dd>
          </div>
        )}
        {extraFee > 0 && (
          <div className="flex justify-between">
            <dt>제주·도서산간 추가 배송비</dt>
            <dd className="whitespace-nowrap">{formatPrice(extraFee)}</dd>
          </div>
        )}
        {threshold !== null && !freeShipping && (
          <p className="text-xs text-blue-600">{formatPrice(threshold - itemsTotal)} 더 담으면 기본 배송비 무료</p>
        )}
        <div className="mt-2 flex justify-between border-t border-gray-200 pt-2 text-lg font-bold text-gray-900">
          <dt>총 결제 금액</dt>
          <dd className="whitespace-nowrap">{formatPrice(total)}</dd>
        </div>
      </dl>

      {/* 토스 결제 위젯이 그려지는 자리 */}
      <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div id="payment-method" />
        <div id="agreement" />
      </div>

      {error && <p className="mt-4 text-center text-sm text-red-600">{error}</p>}

      <button
        onClick={handlePay}
        disabled={!widgets || paying || (guest ? !guestReady : !address)}
        className="mt-6 w-full rounded-lg bg-blue-600 py-4 text-lg font-bold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {guest && !guestReady
          ? "주문 정보를 모두 입력하고 동의해 주세요"
          : !guest && !address
            ? "배송지를 먼저 등록해 주세요"
            : paying
              ? "결제 진행 중..."
              : `${formatPrice(total)} 결제하기`}
      </button>
    </main>
  );
}
