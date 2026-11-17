"use client";

import Link from "next/link";
import { useCart } from "@/context/CartContext";
import type { Product } from "@/generated/prisma/client";
import { formatPrice } from "@/lib/format";

// 장바구니 화면. 상품 정보(products)는 서버(app/cart/page.tsx)에서 받아옵니다.
export default function CartView({ products }: { products: Product[] }) {
  const { items, updateQuantity, removeItem, clearCart } = useCart();

  // 장바구니에는 id와 수량만 저장되어 있으므로, 상품 정보를 찾아서 합칩니다.
  // (삭제된 상품은 건너뜁니다)
  const lines = items.flatMap((item) => {
    const product = products.find((p) => p.id === item.productId);
    return product ? [{ ...item, product }] : [];
  });

  const totalPrice = lines.reduce(
    (sum, line) => sum + line.product.price * line.quantity,
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
        {lines.map(({ product, quantity }) => (
          <li key={product.id} className="flex items-center gap-4 p-4">
            <div
              className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-lg text-4xl ${product.color}`}
            >
              {product.emoji}
            </div>

            <div className="min-w-0 flex-1">
              <Link
                href={`/products/${product.id}`}
                className="font-medium text-gray-900 hover:underline"
              >
                {product.name}
              </Link>
              <p className="text-sm text-gray-500">
                {formatPrice(product.price)}
              </p>

              {/* 수량 조절 */}
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => updateQuantity(product.id, quantity - 1)}
                  disabled={quantity <= 1}
                  className="h-8 w-8 rounded border border-gray-300 text-gray-700 disabled:opacity-40"
                  aria-label="수량 줄이기"
                >
                  −
                </button>
                <span className="w-8 text-center text-gray-900">{quantity}</span>
                <button
                  onClick={() => updateQuantity(product.id, quantity + 1)}
                  className="h-8 w-8 rounded border border-gray-300 text-gray-700"
                  aria-label="수량 늘리기"
                >
                  +
                </button>
              </div>
            </div>

            <div className="flex flex-col items-end gap-2">
              <p className="font-bold text-gray-900">
                {formatPrice(product.price * quantity)}
              </p>
              <button
                onClick={() => removeItem(product.id)}
                className="text-sm text-gray-500 hover:text-red-500"
              >
                삭제
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex items-center justify-between text-lg">
          <span className="text-gray-700">총 결제 금액</span>
          <span className="text-2xl font-bold text-gray-900">
            {formatPrice(totalPrice)}
          </span>
        </div>
        {/* 로그인 안 했으면 /checkout에서 로그인 페이지로 보내줍니다 */}
        <Link
          href="/checkout"
          className="mt-4 block w-full rounded-lg bg-gray-900 py-3 text-center font-medium text-white hover:bg-gray-700"
        >
          주문하기
        </Link>
      </div>
    </main>
  );
}
