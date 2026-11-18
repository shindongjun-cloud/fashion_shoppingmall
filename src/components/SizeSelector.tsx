"use client";

import { useState } from "react";
import Link from "next/link";
import { useCart } from "@/context/CartContext";
import { subscribeRestockAction } from "@/app/products/actions";
import { LOW_STOCK_DISPLAY } from "@/lib/cart-rules";

type SizeOption = {
  id: number; // SKU id (장바구니에 담기는 값)
  sizeLabel: string;
  stock: number; // 판매 가능 수량 (실재고 − 결제 대기·출고 대기 − 안전재고)
  onSale: boolean;
  /** 품절일 때 재입고 예정일 (확정된 발주가 있으면 "2026. 11. 25." 형태) */
  restockDate: string | null;
  /** 내가 이미 재입고 알림을 신청함 */
  subscribed: boolean;
};

// 상품 상세의 사이즈 선택 + 장바구니 담기
// 컬러는 이미 골라진 상태로 들어오므로, 사이즈를 고르면 SKU 하나가 정해집니다.
// 품절 사이즈도 고를 수 있음 → 재입고 예정일 안내 + 재입고 알림 신청 (판매 중지 사이즈는 고를 수 없음)
export default function SizeSelector({ skus, back, loggedIn, restockNotice }: { skus: SizeOption[]; back: string; loggedIn: boolean; restockNotice?: string }) {
  const { addItem } = useCart();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [added, setAdded] = useState(false);

  const allSoldOut = skus.every((sku) => !sku.onSale || sku.stock === 0);
  const selected = skus.find((sku) => sku.id === selectedId);
  const selectedSoldOut = selected !== undefined && selected.stock === 0;

  function handleAdd() {
    if (!selected || selectedSoldOut) return;
    addItem(selected.id);
    setAdded(true);
  }

  return (
    <div className="mt-6">
      <p className="text-sm text-gray-700">사이즈</p>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {skus.map((sku) => {
          const soldOut = sku.onSale && sku.stock === 0;
          const isSelected = sku.id === selectedId;
          return (
            <button
              key={sku.id}
              type="button"
              disabled={!sku.onSale}
              onClick={() => {
                setSelectedId(sku.id);
                setAdded(false);
              }}
              className={`rounded border py-2 text-sm transition ${
                isSelected ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 text-gray-900 hover:border-gray-900"
              } ${soldOut ? (isSelected ? "line-through" : "text-gray-400 line-through") : ""} disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-300 disabled:line-through`}
            >
              {sku.sizeLabel}
            </button>
          );
        })}
      </div>

      {restockNotice && <p className="mt-3 rounded-lg bg-gray-100 p-3 text-sm text-gray-800">{restockNotice}</p>}

      {/* 재고가 적으면 알려줍니다 */}
      {selected && !selectedSoldOut && selected.stock <= LOW_STOCK_DISPLAY && (
        <p className="mt-2 text-sm text-red-600">품절 임박! {selected.stock}개 남았어요.</p>
      )}

      {/* 품절 사이즈: 재입고 예정일 + 알림 신청 */}
      {selected && selectedSoldOut && (
        <div className="mt-3 rounded-lg border border-gray-200 p-3 text-sm">
          <p className="font-medium text-gray-900">
            {selected.sizeLabel} 품절 ·{" "}
            {selected.restockDate ? <span className="text-blue-700">{selected.restockDate} 재입고 예정</span> : <span className="text-gray-500">재입고 일정 미정</span>}
          </p>
          {selected.subscribed ? (
            <p className="mt-2 text-gray-600">
              재입고 알림을 신청했어요. 일정이 정해지거나 입고되면{" "}
              <Link href="/my/notifications" className="underline">
                알림함
              </Link>
              으로 알려 드려요.
            </p>
          ) : loggedIn ? (
            <form action={subscribeRestockAction} className="mt-2">
              <input type="hidden" name="skuId" value={selected.id} />
              <input type="hidden" name="back" value={back} />
              <button className="w-full rounded-lg border border-gray-900 py-2 font-medium text-gray-900 hover:bg-gray-50">재입고 알림 신청</button>
            </form>
          ) : (
            <Link href={`/login?callbackUrl=${encodeURIComponent(back)}`} className="mt-2 block w-full rounded-lg border border-gray-900 py-2 text-center font-medium text-gray-900 hover:bg-gray-50">
              로그인하고 재입고 알림 신청
            </Link>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={handleAdd}
        disabled={!selected || selectedSoldOut}
        className="mt-4 w-full rounded-lg bg-gray-900 py-3 font-medium text-white transition hover:bg-gray-700 disabled:bg-gray-300"
      >
        {allSoldOut || selectedSoldOut ? "품절" : selected ? "장바구니 담기" : "사이즈를 선택하세요"}
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
