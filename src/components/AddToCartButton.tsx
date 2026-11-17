"use client";

import { useState } from "react";
import Link from "next/link";
import { useCart } from "@/context/CartContext";

// 상품 상세 페이지의 "장바구니 담기" 버튼
export default function AddToCartButton({ productId }: { productId: number }) {
  const { addItem } = useCart();
  const [added, setAdded] = useState(false);

  function handleClick() {
    addItem(productId);
    setAdded(true);
  }

  return (
    <div className="mt-8">
      <button
        onClick={handleClick}
        className="w-full rounded-lg bg-gray-900 py-3 font-medium text-white transition hover:bg-gray-700"
      >
        장바구니 담기
      </button>
      {added && (
        <p className="mt-3 text-center text-sm text-gray-600">
          장바구니에 담았어요.{" "}
          <Link href="/cart" className="font-medium text-gray-900 underline">
            장바구니 보기
          </Link>
        </p>
      )}
    </div>
  );
}
