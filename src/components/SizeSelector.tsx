"use client";

import { useState } from "react";
import Link from "next/link";
import { useCart } from "@/context/CartContext";

type SizeOption = {
  id: number; // SKU id (장바구니에 담기는 값)
  sizeLabel: string;
  stock: number; // 판매 가능 수량 (실재고 − 결제 대기 예약 − 안전재고)
  onSale: boolean;
};

// 상품 상세의 사이즈 선택 + 장바구니 담기
// 컬러는 이미 골라진 상태로 들어오므로, 사이즈를 고르면 SKU 하나가 정해집니다.
export default function SizeSelector({ skus }: { skus: SizeOption[] }) {
  const { addItem } = useCart();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [added, setAdded] = useState(false);

  const allSoldOut = skus.every((sku) => !sku.onSale || sku.stock === 0);
  const selected = skus.find((sku) => sku.id === selectedId);

  function handleAdd() {
    if (!selected) return;
    addItem(selected.id);
    setAdded(true);
  }

  return (
    <div className="mt-6">
      <p className="text-sm text-gray-700">사이즈</p>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {skus.map((sku) => {
          const available = sku.onSale && sku.stock > 0;
          const isSelected = sku.id === selectedId;
          return (
            <button
              key={sku.id}
              type="button"
              disabled={!available}
              onClick={() => {
                setSelectedId(sku.id);
                setAdded(false);
              }}
              className={`rounded border py-2 text-sm transition ${
                isSelected
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-300 text-gray-900 hover:border-gray-900"
              } disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-300 disabled:line-through`}
            >
              {sku.sizeLabel}
            </button>
          );
        })}
      </div>

      {/* 재고가 적으면 알려줍니다 */}
      {selected && selected.stock <= 3 && (
        <p className="mt-2 text-sm text-red-600">품절 임박! {selected.stock}개 남았어요.</p>
      )}

      <button
        type="button"
        onClick={handleAdd}
        disabled={!selected}
        className="mt-4 w-full rounded-lg bg-gray-900 py-3 font-medium text-white transition hover:bg-gray-700 disabled:bg-gray-300"
      >
        {allSoldOut ? "품절" : selected ? "장바구니 담기" : "사이즈를 선택하세요"}
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
