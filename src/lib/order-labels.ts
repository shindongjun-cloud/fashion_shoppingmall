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
  RETURN_REQUESTED: "반품 요청",
  RETURN_COLLECTING: "반품 회수중",
  RETURNED: "반품 완료",
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
  RETURNED: "반품 완료",
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
  CLAIMED: "비회원 주문을 내 계정으로 가져왔어요. 이제 주문 내역에서 볼 수 있어요.",
  RETURN_REQUESTED: "반품을 신청했어요. 확인 후 회수 일정을 알려 드릴게요.",
  RETURN_CANCELED: "반품 신청을 철회했어요.",
};

/** 택배사 배송조회 주소 ({no} 자리에 송장번호) */
export const trackingUrl = (template: string, trackingNo: string) => template.replace("{no}", encodeURIComponent(trackingNo));

/** 송장번호 보기 좋게: 6012-3456-7890 */
export const formatTrackingNo = (no: string) => no.replace(/(\d{4})(?=\d)/g, "$1-");

export const RETURN_STATUS_LABEL: Record<string, string> = {
  REQUESTED: "반품 신청",
  APPROVED: "반품 승인 (회수 준비)",
  COLLECTING: "회수중",
  RECEIVED: "반품센터 도착 (검수 중)",
  INSPECTED: "검수 완료 (환불 진행 중)",
  COMPLETED: "반품 완료",
  REJECTED: "반품 불가",
  CANCELED: "반품 철회",
};
export const RETURN_REASON_LABEL: Record<string, string> = {
  CHANGE_OF_MIND: "단순 변심",
  SIZE: "사이즈·핏이 맞지 않음",
  DEFECT: "상품 불량",
  WRONG_ITEM: "다른 상품이 옴 (오배송)",
  DAMAGED: "배송 중 파손",
};
export const RETURN_INSPECTION_LABEL: Record<string, string> = { RESELLABLE: "정상", DEFECTIVE: "불량", NOT_RETURNABLE: "반품 불가" };
/** 고객 사유(반품 배송비 부담) 여부 */
export const isCustomerFault = (reason: string) => reason === "CHANGE_OF_MIND" || reason === "SIZE";
/** 반품 신청 기간 (배송 완료일 기준): 고객 사유 7일, 판매자 사유 30일 — DB 트리거와 같은 값 */
export const RETURN_WINDOW_DAYS = { CUSTOMER: 7, SELLER: 30 } as const;
