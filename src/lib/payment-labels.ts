// 결제 화면 표시용 이름·문구 (브라우저에서도 써도 되는 파일: 비밀 값·DB 없음)
// 코드표는 토스페이먼츠 문서의 은행·카드사 코드 기준입니다. 표에 없는 코드는 "코드 XX"로 보여 줍니다.

export const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING: "결제 대기",
  WAITING_DEPOSIT: "입금 대기",
  PAID: "결제 완료",
  CANCELED: "주문 취소",
  EXPIRED: "입금 기한 만료",
  CANCEL_FAILED: "환불 확인 중",
};

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CARD: "카드",
  VIRTUAL_ACCOUNT: "가상계좌(무통장입금)",
  EASY_PAY: "간편결제",
  TRANSFER: "계좌이체",
  MOBILE_PHONE: "휴대폰",
  GIFT_CERTIFICATE: "상품권",
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  IN_PROGRESS: "승인 중",
  UNKNOWN: "결과 확인 중",
  WAITING_FOR_DEPOSIT: "입금 대기",
  DONE: "결제 완료",
  PARTIAL_CANCELED: "부분 취소",
  CANCELED: "전액 취소",
  ABORTED: "실패",
  EXPIRED: "만료",
};

const BANKS: Record<string, string> = {
  "39": "경남은행", "34": "광주은행", "12": "단위농협", "32": "부산은행", "45": "새마을금고", "64": "산림조합",
  "88": "신한은행", "48": "신협", "27": "씨티은행", "20": "우리은행", "71": "우체국", "50": "저축은행",
  "37": "전북은행", "35": "제주은행", "90": "카카오뱅크", "89": "케이뱅크", "92": "토스뱅크", "81": "하나은행",
  "54": "HSBC은행", "03": "IBK기업은행", "06": "KB국민은행", "31": "DGB대구은행", "02": "KDB산업은행",
  "11": "NH농협은행", "23": "SC제일은행", "07": "Sh수협은행",
};
const CARD_COMPANIES: Record<string, string> = {
  "3K": "기업비씨", "46": "광주", "71": "롯데", "30": "산업", "31": "BC", "51": "삼성", "38": "새마을",
  "41": "신한", "62": "신협", "36": "씨티", "33": "우리", "W1": "우리", "37": "우체국", "39": "저축",
  "35": "전북", "42": "제주", "15": "카카오뱅크", "3A": "케이뱅크", "24": "토스뱅크", "21": "하나",
  "61": "현대", "11": "국민", "91": "NH농협", "34": "수협",
};
/** 환불 계좌 은행 선택지 (이름 순) */
export const BANK_OPTIONS = Object.entries(BANKS).map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name, "ko"));
export const bankName = (code: string) => BANKS[code] ?? `은행 코드 ${code}`;
export const cardCompanyName = (code: string) => (CARD_COMPANIES[code] ? `${CARD_COMPANIES[code]}카드` : `카드사 코드 ${code}`);

/** 결제 실패 안내 문구. 주소창의 message를 그대로 보여 주지 않고, 코드로 우리 문구를 고릅니다 (임의 문구 표시 방지) */
const FAIL_MESSAGES: Record<string, string> = {
  PAY_PROCESS_CANCELED: "결제를 취소했어요.",
  PAY_PROCESS_ABORTED: "결제가 진행되지 않았어요. 다시 시도해 주세요.",
  USER_CANCEL: "결제를 취소했어요.",
  REJECT_CARD_COMPANY: "카드사에서 결제를 거절했어요. 한도·잔액을 확인하거나 다른 카드로 시도해 주세요.",
  INVALID_REJECT_CARD: "카드사에서 결제를 거절했어요. 카드사에 문의하거나 다른 카드로 시도해 주세요.",
  REJECT_CARD_PAYMENT: "카드 한도를 초과했거나 잔액이 부족해요.",
  REJECT_ACCOUNT_PAYMENT: "계좌 잔액이 부족해요.",
  EXCEED_MAX_CARD_INSTALLMENT_PLAN: "선택한 할부 개월 수를 쓸 수 없어요. 할부 개월을 줄여 다시 시도해 주세요.",
  BELOW_MINIMUM_AMOUNT: "선택한 결제수단의 최소 결제 금액보다 적어요. 다른 결제수단을 선택해 주세요.",
  NOT_FOUND_PAYMENT_SESSION: "결제 시간(10분)이 지났어요. 다시 결제해 주세요. 결제된 금액은 없어요.",
  PROVIDER_ERROR: "결제사에 일시적인 문제가 있어요. 잠시 후 다시 시도해 주세요.",
  OUT_OF_STOCK: "결제를 기다리는 동안 재고가 소진되었어요. 결제는 진행되지 않았어요.",
  AMOUNT_MISMATCH: "결제 금액이 주문 금액과 달라 결제를 중단했어요. 결제된 금액은 없어요.",
  ORDER_NOT_FOUND: "주문을 찾을 수 없어요.",
  GUEST_SESSION_EXPIRED: "비회원 주문 확인 시간(1시간)이 지났거나 주문한 브라우저가 아니어서 결제를 마치지 않았어요. 돈은 빠져나가지 않았어요. 다시 주문해 주세요.",
  ORDER_CLOSED: "이미 취소되었거나 처리가 끝난 주문이에요. 다시 주문해 주세요.",
  INVALID_REQUEST: "결제 정보가 올바르지 않아요. 다시 시도해 주세요.",
  ORDER_ERROR_REFUNDED: "주문을 완료하지 못해 결제를 자동으로 취소했어요. 다시 시도해 주세요.",
  ORDER_ERROR_REFUND_PENDING: "주문 처리 중 문제가 생겼어요. 결제 취소를 확인한 뒤 환불해 드릴게요. 주문 내역에서 상태를 확인할 수 있어요.",
  PAYMENT_CONFIG: "결제 설정에 문제가 있어 결제할 수 없어요. 잠시 후 다시 시도해 주세요.",
  LOGIN_REQUIRED: "로그인이 필요해요.",
};
export const DEFAULT_FAIL_MESSAGE = "결제 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.";
export function paymentFailMessage(code: string | null | undefined): string {
  return (code && FAIL_MESSAGES[code]) || DEFAULT_FAIL_MESSAGE;
}
/** 우리가 문구를 알고 있는 코드인지 (주소에 들어갈 코드 값 검증용) */
export const isKnownFailCode = (code: string) => code in FAIL_MESSAGES;

/** 입금 전 주문 취소 결과 안내 */
export const DEPOSIT_CANCEL_NOTICE: Record<string, string> = {
  DONE: "입금 전 주문을 취소했어요.",
  NOT_FOUND: "주문을 찾을 수 없어요.",
  NOT_WAITING: "입금 대기 중인 주문만 여기서 취소할 수 있어요.",
  RESULT_PENDING: "취소 요청 결과를 확인하고 있어요. 잠시 후 다시 확인해 주세요.",
  ALREADY_DEPOSITED: "이미 입금이 확인되어 결제가 완료됐어요. 결제 취소는 고객센터로 문의해 주세요.",
  FAILED: "취소하지 못했어요. 잠시 후 다시 시도해 주세요.",
};
