"use client";

import Link from "next/link";
import { useCart } from "@/context/CartContext";

// 헤더의 장바구니 링크. 담긴 개수를 배지로 보여줍니다.
export default function CartLink() {
  const { totalQuantity } = useCart();

  return (
    <Link href="/cart" className="relative text-gray-700 hover:text-gray-900">
      장바구니
      {totalQuantity > 0 && (
        <span className="absolute -top-2 -right-5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white">
          {totalQuantity}
        </span>
      )}
    </Link>
  );
}
