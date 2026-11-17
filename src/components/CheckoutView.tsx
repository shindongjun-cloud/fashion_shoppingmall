"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  loadTossPayments,
  type TossPaymentsWidgets,
} from "@tosspayments/tosspayments-sdk";
import { useCart } from "@/context/CartContext";
import { createOrder } from "@/app/checkout/actions";
import type { Product } from "@/generated/prisma/client";
import { formatPrice } from "@/lib/format";

// NEXT_PUBLIC_ 으로 시작하는 환경변수만 브라우저 코드에서 읽을 수 있어요. (클라이언트 키는 공개돼도 괜찮음)
const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? "";

type Props = {
  products: Product[];
  customerKey: string;
  customerName?: string;
  customerEmail?: string;
};

export default function CheckoutView({
  products,
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
    const product = products.find((p) => p.id === item.productId);
    return product ? [{ ...item, product }] : [];
  });
  // 화면 표시용 금액. 실제 결제 금액은 서버(createOrder)가 다시 계산합니다.
  const total = lines.reduce(
    (sum, line) => sum + line.product.price * line.quantity,
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

    try {
      await widgets.setAmount({ currency: "KRW", value: order.amount });
      // 결제창이 뜨고, 결제가 끝나면 successUrl 또는 failUrl로 이동합니다.
      await widgets.requestPayment({
        orderId: order.paymentOrderId,
        orderName: order.orderName,
        customerName,
        customerEmail,
        successUrl: `${window.location.origin}/api/payments/confirm`,
        failUrl: `${window.location.origin}/checkout/fail`,
      });
    } catch (e) {
      // 결제창을 닫았거나 약관 미동의 등
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
        {lines.map(({ product, quantity }) => (
          <li key={product.id} className="flex items-center gap-3 p-4">
            <span className="text-2xl">{product.emoji}</span>
            <span className="flex-1 text-gray-900">
              {product.name} × {quantity}
            </span>
            <span className="font-medium text-gray-900">
              {formatPrice(product.price * quantity)}
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
