// 주문 화면용 문구 (브라우저·서버 공용: DB·서버 코드를 import하지 않음)
import type { FulfillmentStatus, OrderItemStatus, ShippingRegion } from "@/generated/prisma/enums";

export const ITEM_STATUS_LABEL: Record<OrderItemStatus, string> = {
  AWAITING_PAYMENT: "결제 대기",
  PAID: "결제 완료",
  PREPARING: "상품 준비중",
  SHIPPED: "배송중",
  DELIVERED: "배송 완료",
  CONFIRMED: "구매 확정",
  CANCELED: "취소",
};

export const FULFILLMENT_LABEL: Record<FulfillmentStatus, string> = {
  UNPAID: "결제 전",
  PAID: "결제 완료",
  PREPARING: "상품 준비중",
  PARTIALLY_SHIPPED: "일부 배송중",
  SHIPPED: "배송중",
  DELIVERED: "배송 완료",
  CONFIRMED: "구매 확정",
  CANCELED: "취소",
};

export const REGION_LABEL: Record<ShippingRegion, string> = { NORMAL: "일반", JEJU: "제주", REMOTE: "도서산간" };

/** 고객 취소 결과 → 안내 문구 (주소의 ?notice= 코드로 고름. 문구를 주소에 그대로 싣지 않음) */
export const CUSTOMER_CANCEL_NOTICE: Record<string, string> = {
  DONE: "주문을 취소했어요. 결제한 수단으로 환불돼요. (계좌이체·간편결제는 보통 바로, 카드는 카드사에 따라 3~7영업일)",
  NOT_FOUND: "주문을 찾을 수 없어요.",
  NOT_CANCELABLE: "취소할 수 있는 상태의 주문이 아니에요.",
  PREPARING: "상품 준비가 시작되어 직접 취소할 수 없어요. 고객센터로 문의해 주세요.",
  NEED_REFUND_ACCOUNT: "가상계좌로 결제한 주문은 환불받을 계좌를 입력해야 해요.",
  RESULT_PENDING: "취소 결과를 확인하고 있어요. 잠시 후 주문 상세에서 확인해 주세요.",
  FAILED: "취소하지 못했어요. 잠시 후 다시 시도하거나 고객센터로 문의해 주세요.",
  ADDRESS_CHANGED: "배송지를 바꿨어요.",
  CONFIRMED: "구매를 확정했어요. 감사합니다!",
};

/** 택배사 배송조회 주소 ({no} 자리에 송장번호) */
export const trackingUrl = (template: string, trackingNo: string) => template.replace("{no}", encodeURIComponent(trackingNo));

/** 송장번호 보기 좋게: 6012-3456-7890 */
export const formatTrackingNo = (no: string) => no.replace(/(\d{4})(?=\d)/g, "$1-");
