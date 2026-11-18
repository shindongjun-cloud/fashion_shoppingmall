import { formatPrice } from "@/lib/format";

// 주문 금액 구성 (주문 당시 저장된 값 그대로 표시)
//   상품 금액 − 상품 할인 − 쿠폰 + 배송비 − 배송비 할인 − 포인트 = 결제 금액
type Amounts = {
  itemsListTotal: number;
  itemsDiscountTotal: number;
  couponDiscountTotal: number;
  shippingBaseFee: number;
  shippingExtraFee: number;
  shippingDiscount: number;
  pointUsed: number;
  totalPrice: number;
};

export default function OrderAmounts({ order, totalLabel = "결제 금액" }: { order: Amounts; totalLabel?: string }) {
  const row = (label: string, value: string, className = "") => (
    <div className={`flex justify-between ${className}`}>
      <dt>{label}</dt>
      <dd className="whitespace-nowrap">{value}</dd>
    </div>
  );
  return (
    <dl className="space-y-1 text-sm text-gray-700">
      {row("상품 금액", formatPrice(order.itemsListTotal))}
      {order.itemsDiscountTotal > 0 && row("상품 할인", `−${formatPrice(order.itemsDiscountTotal)}`, "text-red-600")}
      {order.couponDiscountTotal > 0 && row("쿠폰 할인", `−${formatPrice(order.couponDiscountTotal)}`, "text-red-600")}
      {row("배송비", order.shippingBaseFee === 0 ? "무료" : formatPrice(order.shippingBaseFee))}
      {order.shippingExtraFee > 0 && row("제주·도서산간 추가 배송비", formatPrice(order.shippingExtraFee))}
      {order.shippingDiscount > 0 && row("배송비 할인", `−${formatPrice(order.shippingDiscount)}`, "text-red-600")}
      {order.pointUsed > 0 && row("포인트 사용", `−${formatPrice(order.pointUsed)}`, "text-red-600")}
      {row(totalLabel, formatPrice(order.totalPrice), "mt-2 border-t border-gray-200 pt-2 text-base font-bold text-gray-900")}
    </dl>
  );
}
