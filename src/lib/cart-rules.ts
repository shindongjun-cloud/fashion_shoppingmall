// 장바구니·주문 규칙 (DB를 쓰지 않아서 브라우저와 서버 양쪽에서 같이 씁니다)
// 같은 규칙을 화면(장바구니 경고)과 서버(주문 생성 검사)에서 똑같이 적용하기 위해 한 곳에 둡니다.
import type { CartSku } from "@/lib/catalog";

// 1회 주문 수량 제한 검사: 같은 스타일의 SKU(컬러·사이즈 상관없이)를 합쳐서 셉니다.
// 예: 스니커즈 최대 2켤레 → 화이트 260 1개 + 블랙 270 1개 = 2개까지 OK
export function findQtyLimitViolation(lines: { sku: CartSku; quantity: number }[]) {
  const totals = new Map<string, { sku: CartSku; total: number }>();
  for (const { sku, quantity } of lines) {
    const cur = totals.get(sku.styleCode);
    totals.set(sku.styleCode, { sku, total: (cur?.total ?? 0) + quantity });
  }
  for (const { sku, total } of totals.values()) {
    if (sku.maxQtyPerOrder !== null && total > sku.maxQtyPerOrder) return sku;
  }
  return null;
}
