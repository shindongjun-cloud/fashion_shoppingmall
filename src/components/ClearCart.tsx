"use client";

import { useEffect } from "react";
import { useCart } from "@/context/CartContext";

// 화면에 나타나면 장바구니를 비웁니다. (결제 완료 페이지에서 사용)
export default function ClearCart() {
  const { clearCart } = useCart();

  useEffect(() => {
    clearCart();
  }, [clearCart]);

  return null;
}
