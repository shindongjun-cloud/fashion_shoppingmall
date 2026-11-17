"use client";
/* eslint-disable @next/next/no-img-element -- 임시 SVG 이미지라 next/image 최적화가 필요 없음 */

import Link from "next/link";
import { useCart } from "@/context/CartContext";
import type { CartSku } from "@/lib/catalog";
import { findQtyLimitViolation } from "@/lib/cart-rules";
import { formatPrice } from "@/lib/format";

// 장바구니 화면. SKU 정보(skus)는 서버(app/cart/page.tsx)에서 받아옵니다.
export default function CartView({ skus }: { skus: CartSku[] }) {
  const { items, updateQuantity, removeItem, clearCart } = useCart();

  // 장바구니에는 skuId와 수량만 저장되어 있으므로, SKU 정보를 찾아서 합칩니다.
  // (DB에서 없어진 SKU는 건너뜁니다)
  const lines = items.flatMap((item) => {
    const sku = skus.find((s) => s.id === item.skuId);
    return sku ? [{ ...item, sku }] : [];
  });

  // 주문할 수 없는 줄(판매중지·재고 부족)이 있으면 주문 버튼을 막습니다.
  const problem = (sku: CartSku, quantity: number) =>
    !sku.sellable ? "판매가 중지된 상품이에요" :
    sku.stock === 0 ? "품절됐어요" :
    quantity > sku.stock ? `재고가 ${sku.stock}개 남았어요` : null;
  // 같은 스타일 합계가 1회 주문 한도를 넘는지 (예: 스니커즈 최대 2켤레)
  const overLimit = findQtyLimitViolation(lines);
  const styleTotal = (styleCode: string) =>
    lines.filter((l) => l.sku.styleCode === styleCode).reduce((n, l) => n + l.quantity, 0);
  const hasProblem =
    overLimit !== null || lines.some(({ sku, quantity }) => problem(sku, quantity));

  const totalPrice = lines.reduce(
    (sum, line) => sum + line.sku.price * line.quantity,
    0,
  );

  if (lines.length === 0) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-20 text-center">
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
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">장바구니</h1>
        <button
          onClick={clearCart}
          className="text-sm text-gray-500 hover:underline"
        >
          전체 비우기
        </button>
      </div>

      <ul className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
        {lines.map(({ sku, quantity }) => {
          const message = problem(sku, quantity);
          return (
            <li key={sku.id} className="flex items-center gap-4 p-4">
              <div className="h-24 w-20 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                {sku.imageUrl && (
                  <img src={sku.imageUrl} alt={sku.styleName} className="h-full w-full object-cover" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <Link
                  href={`/products/${sku.styleCode}`}
                  className="font-medium text-gray-900 hover:underline"
                >
                  {sku.styleName}
                </Link>
                {/* 옵션: 컬러 / 사이즈 */}
                <p className="mt-0.5 flex items-center gap-1.5 text-sm text-gray-500">
                  <span
                    className="h-3 w-3 rounded-full border border-gray-300"
                    style={{ backgroundColor: sku.colorHex }}
                  />
                  {sku.colorName} / {sku.sizeName}
                </p>
                <p className="text-sm text-gray-500">{formatPrice(sku.price)}</p>
                {message && <p className="mt-1 text-sm text-red-600">{message}</p>}
                {sku.maxQtyPerOrder !== null && (
                  <p className={`mt-1 text-xs ${overLimit?.styleCode === sku.styleCode ? "text-red-600" : "text-gray-400"}`}>
                    1회 주문 시 최대 {sku.maxQtyPerOrder}개 (같은 상품 모든 컬러·사이즈 합계)
                  </p>
                )}

                {/* 수량 조절 */}
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => updateQuantity(sku.id, quantity - 1)}
                    disabled={quantity <= 1}
                    className="h-8 w-8 rounded border border-gray-300 text-gray-700 disabled:opacity-40"
                    aria-label="수량 줄이기"
                  >
                    −
                  </button>
                  <span className="w-8 text-center text-gray-900">{quantity}</span>
                  <button
                    onClick={() => updateQuantity(sku.id, quantity + 1)}
                    disabled={
                      quantity >= sku.stock ||
                      (sku.maxQtyPerOrder !== null && styleTotal(sku.styleCode) >= sku.maxQtyPerOrder)
                    }
                    className="h-8 w-8 rounded border border-gray-300 text-gray-700 disabled:opacity-40"
                    aria-label="수량 늘리기"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="flex flex-col items-end gap-2">
                <p className="font-bold text-gray-900">
                  {formatPrice(sku.price * quantity)}
                </p>
                <button
                  onClick={() => removeItem(sku.id)}
                  className="text-sm text-gray-500 hover:text-red-500"
                >
                  삭제
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex items-center justify-between text-lg">
          <span className="text-gray-700">총 결제 금액</span>
          <span className="text-2xl font-bold text-gray-900">
            {formatPrice(totalPrice)}
          </span>
        </div>
        {hasProblem ? (
          <p className="mt-4 rounded-lg bg-red-50 py-3 text-center text-sm text-red-600">
            주문할 수 없는 상품이 있어요. 수량을 줄이거나 삭제해 주세요.
          </p>
        ) : (
          // 로그인 안 했으면 /checkout에서 로그인 페이지로 보내줍니다
          <Link
            href="/checkout"
            className="mt-4 block w-full rounded-lg bg-gray-900 py-3 text-center font-medium text-white hover:bg-gray-700"
          >
            주문하기
          </Link>
        )}
      </div>
    </main>
  );
}
