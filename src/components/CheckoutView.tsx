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

// NEXT_PUBLIC_ 으로 시작하는 환경변수만 브라우저 코드에서 읽을 수 있어요. (클라이언트 키는 공개돼도 괜찮음)
const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? "";

type Props = {
  skus: CartSku[];
  customerKey: string;
  customerName?: string;
  customerEmail?: string;
};

export default function CheckoutView({
  skus,
  customerKey,
  customerName,
  customerEmail,
}: Props) {
  const { items } = useCart();
  const [widgets, setWidgets] = useState<TossPaymentsWidgets | null>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const lines = items.flatMap((item) => {
    const sku = skus.find((s) => s.id === item.skuId);
    return sku ? [{ ...item, sku }] : [];
  });
  // 화면 표시용 금액. 실제 결제 금액은 서버(createOrder)가 다시 계산합니다.
  const total = lines.reduce(
    (sum, line) => sum + line.sku.price * line.quantity,
    0,
  );

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

  // 2) 결제 버튼
  async function handlePay() {
    if (!widgets) return;
    setPaying(true);
    setError(null);

    // 서버에 주문을 만들고, 서버가 계산한 금액을 받아옵니다.
    const order = await createOrder(items);
    if ("error" in order) {
      setError(order.error);
      setPaying(false);
      return;
    }

    // 화면을 연 뒤 할인 행사가 끝나거나 시작되면, 화면 금액과 서버가 계산한 결제 금액이 달라집니다.
    // 고객이 본 금액과 다른 금액으로 결제창을 띄우면 안 되므로 멈추고 알려 줍니다.
    // 이 주문이 잡아 둔 재고 예약은 바로 풉니다 (안 풀면 20분 동안 다른 고객이 못 삼)
    if (order.amount !== total) {
      await cancelPendingOrder(order.paymentOrderId, "PRICE_CHANGED");
      setError(
        `그 사이 가격이 바뀌었어요 (${formatPrice(total)} → ${formatPrice(order.amount)}). 새로고침해서 바뀐 금액을 확인해 주세요.`,
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
      // 결제창을 닫았거나 약관 미동의 등 → 재고 예약을 바로 풂
      await cancelPendingOrder(order.paymentOrderId, "PAYMENT_FAILED");
      setError(e instanceof Error ? e.message : "결제를 진행하지 못했어요.");
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
            <span className="font-medium text-gray-900">
              {formatPrice(sku.price * quantity)}
            </span>
          </li>
        ))}
        <li className="flex justify-between p-4 text-lg font-bold text-gray-900">
          <span>총 결제 금액</span>
          <span>{formatPrice(total)}</span>
        </li>
      </ul>

      {/* 토스 결제 위젯이 그려지는 자리 */}
      <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div id="payment-method" />
        <div id="agreement" />
      </div>

      {error && <p className="mt-4 text-center text-sm text-red-600">{error}</p>}

      <button
        onClick={handlePay}
        disabled={!widgets || paying}
        className="mt-6 w-full rounded-lg bg-blue-600 py-4 text-lg font-bold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {paying ? "결제 진행 중..." : `${formatPrice(total)} 결제하기`}
      </button>
    </main>
  );
}
