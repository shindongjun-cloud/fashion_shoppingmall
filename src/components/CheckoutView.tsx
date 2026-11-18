"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  loadTossPayments,
  type TossPaymentsWidgets,
} from "@tosspayments/tosspayments-sdk";
import { useCart } from "@/context/CartContext";
import { cancelPendingOrder, createOrder } from "@/app/checkout/actions";
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
};

export default function CheckoutView({
  skus,
  customerKey,
  customerName,
  customerEmail,
  addresses,
  shippingRule,
}: Props) {
  const { items } = useCart();
  const [widgets, setWidgets] = useState<TossPaymentsWidgets | null>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addressId, setAddressId] = useState<number | null>(
    (addresses.find((a) => a.isDefault) ?? addresses[0])?.id ?? null,
  );
  const startedRef = useRef(false);

  const lines = items.flatMap((item) => {
    const sku = skus.find((s) => s.id === item.skuId);
    return sku ? [{ ...item, sku }] : [];
  });
  const address = addresses.find((a) => a.id === addressId) ?? null;

  // 화면 표시용 금액. 실제 결제 금액은 서버(createOrder)가 DB 가격·배송비 규칙으로 다시 계산합니다.
  const listTotal = lines.reduce((sum, l) => sum + l.sku.listPrice * l.quantity, 0);
  const itemsTotal = lines.reduce((sum, l) => sum + l.sku.price * l.quantity, 0);
  const discount = listTotal - itemsTotal;
  const threshold = shippingRule.freeShippingThreshold;
  const freeShipping = threshold !== null && itemsTotal >= threshold;
  const baseFee = freeShipping ? 0 : shippingRule.baseFee;
  const extraFee = address?.extraFee ?? 0;
  const total = itemsTotal + baseFee + extraFee;

  // 1) 토스 결제 위젯(결제수단 선택 + 약관)을 화면에 한 번만 그립니다.
  useEffect(() => {
    if (total === 0 || startedRef.current) return;
    startedRef.current = true; // 개발 모드에서 두 번 실행되는 것 방지

    (async () => {
      const tossPayments = await loadTossPayments(clientKey);
      const newWidgets = tossPayments.widgets({ customerKey });
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
    if (!widgets || !address) return;
    setPaying(true);
    setError(null);

    // 서버에 주문을 만들고(배송지 스냅샷 + 재고 예약), 서버가 계산한 금액을 받아옵니다.
    const order = await createOrder(items, address.id);
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
        customerName,
        customerEmail,
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

      {/* 배송지: 주소록에서 선택. 주문에는 이 값을 복사해 저장 (나중에 주소록을 바꿔도 주문 배송지는 그대로) */}
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

      {/* 금액 구성: 상품 금액 − 상품 할인 + 배송비 = 결제 금액 (쿠폰·포인트는 다음 단계) */}
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
        <div className="flex justify-between">
          <dt>배송비</dt>
          <dd className="whitespace-nowrap">{baseFee === 0 ? "무료" : formatPrice(baseFee)}</dd>
        </div>
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
        disabled={!widgets || paying || !address}
        className="mt-6 w-full rounded-lg bg-blue-600 py-4 text-lg font-bold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {!address ? "배송지를 먼저 등록해 주세요" : paying ? "결제 진행 중..." : `${formatPrice(total)} 결제하기`}
      </button>
    </main>
  );
}
