// 쿠폰 할인 계산 (순수 함수, 브라우저·서버 공용)
//
// 결제 화면(CheckoutView)과 주문 생성(lib/checkout.ts)이 이 파일 하나로 계산해서 "보이는 할인 = 결제 할인"을 보장합니다.
// 어떤 상품이 쿠폰 대상인지(eligibleSkuIds)는 서버가 DB로 판단해서 넘겨 줍니다 (lib/coupon.ts).
//
// 규칙 요약
//  - ★ 한 주문에 쿠폰은 1장만 (상품·장바구니·배송비 쿠폰 중 하나, 중복 사용 없음). DB 트리거도 같은 규칙으로 막음
//  - ★ 쿠폰은 고객이 직접 고름 (자동 선택 없음). 결제 화면은 할인 금액이 큰 순서로 보여 주고 만료일을 함께 표시
//  - 상품 쿠폰: 대상 상품 줄 1개에 적용 (줄 = 같은 SKU 여러 개). 대상 줄이 여러 개면 할인이 가장 큰 줄에 적용
//  - 장바구니 쿠폰: 대상 줄의 판매가 합계 기준 → 줄마다 금액 비율로 나눠 저장 (반품 환불 기준)
//  - 배송비 쿠폰: 기본 배송비만 (제주·도서산간 추가 배송비는 할인 안 함)
//  - 정률: 10원 미만 버림, 최대 할인 한도. 정액: 기준 금액보다 작아야 적용 (0원 결제 방지)
//  - 무료배송 기준은 쿠폰 적용 "전" 판매가 합계로 판단 (주문 테이블의 freeShippingThreshold 규칙과 같음)

export type CouponKindValue = "PRODUCT" | "ORDER" | "SHIPPING";
export type CouponDiscountTypeValue = "RATE" | "AMOUNT" | "FREE_SHIPPING";

/** 계산에 필요한 쿠폰 1장의 정보 */
export type CouponOption = {
  id: number; // 고객 쿠폰(CustomerCoupon) id
  couponNo: string;
  name: string;
  kind: CouponKindValue;
  discountType: CouponDiscountTypeValue;
  discountValue: number;
  maxDiscountAmount: number | null;
  minOrderAmount: number;
  eligibleSkuIds: number[]; // 상품·장바구니 쿠폰의 대상 SKU (배송비 쿠폰은 빈 배열)
  saleExcludedSkuIds: number[]; // 대상이지만 "할인 행사 상품 제외" 쿠폰이라 빠진 SKU (안내 문구용)
  validTo: string; // ISO (이 시각 직전까지 사용 가능)
};

export type CalcLine = { skuId: number; lineTotal: number };

/** 적용 결과. 쿠폰 1장이므로 product·order·shipping 중 하나만 채워짐 */
export type CouponApplied = {
  /** 줄 순서대로 쿠폰 할인 (= OrderItem.couponAllocated) */
  lineCouponAllocated: number[];
  product: { couponId: number; lineIndex: number; amount: number }[];
  order: { couponId: number; amount: number; allocations: { lineIndex: number; amount: number }[] } | null;
  shipping: { couponId: number; amount: number } | null;
  couponDiscountTotal: number; // 상품·장바구니 쿠폰 (Order.couponDiscountTotal)
  shippingDiscount: number; // 배송비 쿠폰 (Order.shippingDiscount)
};

/** 정률 할인 (10원 미만 버림) + 최대 한도. ⚠️ 정수 계산 */
export function rateDiscount(base: number, rate: number, max: number | null) {
  const d = Math.floor((base * rate) / 1000) * 10;
  return max === null ? d : Math.min(d, max);
}

/** 상품·장바구니 쿠폰의 할인액 (적용 불가면 0) */
export function itemsCouponDiscount(c: Pick<CouponOption, "discountType" | "discountValue" | "maxDiscountAmount" | "minOrderAmount">, base: number) {
  if (base <= 0 || base < c.minOrderAmount) return 0;
  if (c.discountType === "RATE") return rateDiscount(base, c.discountValue, c.maxDiscountAmount);
  if (c.discountType === "AMOUNT") return c.discountValue < base ? c.discountValue : 0; // 기준 금액 이상 할인 = 0원 판매 → 미적용
  return 0;
}

/** 배송비 쿠폰 할인액 (기본 배송비만) */
export function shippingCouponDiscount(c: Pick<CouponOption, "discountType" | "discountValue" | "minOrderAmount">, shippingBaseFee: number, itemsTotal: number) {
  if (shippingBaseFee <= 0 || itemsTotal < c.minOrderAmount) return 0;
  if (c.discountType === "FREE_SHIPPING") return shippingBaseFee;
  if (c.discountType === "AMOUNT") return Math.min(c.discountValue, shippingBaseFee);
  return 0;
}

/**
 * 금액을 기준 금액 비율로 나눔 (원 단위 나머지는 소수점이 큰 줄부터 1원씩, 같으면 금액이 큰 줄·앞줄)
 * 합계는 항상 total과 같고, 어떤 줄도 자기 기준 금액을 넘지 않음
 */
export function allocate(total: number, bases: number[]): number[] {
  const sum = bases.reduce((n, b) => n + b, 0);
  // 나눌 금액이 기준 금액 합계보다 크면 어떤 줄은 자기 금액보다 많이 받게 됨 → 계산 실수이므로 멈춤
  if (!Number.isInteger(total) || total < 0 || total > Math.max(sum, 0)) throw new Error(`allocate: 나눌 금액(${total})이 기준 금액 합계(${sum})보다 큽니다`);
  if (sum <= 0) return bases.map(() => 0);
  const raw = bases.map((b) => (total * b) / sum);
  const out = raw.map((r) => Math.floor(r));
  let rest = total - out.reduce((n, x) => n + x, 0);
  const order = bases
    .map((b, i) => ({ i, frac: raw[i] - out[i], b }))
    .sort((a, b) => b.frac - a.frac || b.b - a.b || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    if (out[i] < bases[i]) {
      out[i] += 1;
      rest -= 1;
    }
  }
  return out;
}

/** 쿠폰 1장의 이 장바구니 기준 할인 (쓸 수 없으면 amount 0 + 이유) */
export function couponQuote(lines: CalcLine[], shippingBaseFee: number, c: CouponOption): { amount: number; lineIndex: number | null; reason: string | null } {
  const itemsTotal = lines.reduce((n, l) => n + l.lineTotal, 0);
  if (c.kind === "SHIPPING") {
    if (shippingBaseFee <= 0) return { amount: 0, lineIndex: null, reason: "배송비가 무료라 쓸 필요가 없어요" };
    const amount = shippingCouponDiscount(c, shippingBaseFee, itemsTotal);
    return amount > 0 ? { amount, lineIndex: null, reason: null } : { amount: 0, lineIndex: null, reason: minText(c) };
  }
  const eligible = lines.map((l, i) => (c.eligibleSkuIds.includes(l.skuId) ? i : -1)).filter((i) => i >= 0);
  if (eligible.length === 0) {
    const saleOnly = lines.some((l) => c.saleExcludedSkuIds.includes(l.skuId));
    return { amount: 0, lineIndex: null, reason: saleOnly ? "할인 행사 중인 상품에는 쓸 수 없는 쿠폰이에요" : "주문 상품 중 쿠폰 대상이 없어요" };
  }
  if (c.kind === "PRODUCT") {
    // 대상 줄 중 할인이 가장 큰 줄 (같으면 앞줄)
    let best: { amount: number; lineIndex: number } = { amount: 0, lineIndex: -1 };
    for (const i of eligible) {
      const amount = itemsCouponDiscount(c, lines[i].lineTotal);
      if (amount > best.amount) best = { amount, lineIndex: i };
    }
    return best.amount > 0 ? { ...best, reason: null } : { amount: 0, lineIndex: null, reason: minText(c, "상품 1개") };
  }
  const base = eligible.reduce((n, i) => n + lines[i].lineTotal, 0);
  const amount = itemsCouponDiscount(c, base);
  return amount > 0 ? { amount, lineIndex: null, reason: null } : { amount: 0, lineIndex: null, reason: minText(c, "대상 상품") };
}
const minText = (c: CouponOption, what = "상품") =>
  c.minOrderAmount > 0 ? `${what} ${c.minOrderAmount.toLocaleString("ko-KR")}원 이상일 때 쓸 수 있어요` : "사용 조건에 맞지 않아요";

/** 고른 쿠폰 1장을 적용 (null = 쿠폰 안 씀). 쓸 수 없으면 { error } */
export function applyCoupon(lines: CalcLine[], shippingBaseFee: number, options: CouponOption[], couponId: number | null): CouponApplied | { error: string } {
  const none: CouponApplied = { lineCouponAllocated: lines.map(() => 0), product: [], order: null, shipping: null, couponDiscountTotal: 0, shippingDiscount: 0 };
  if (couponId === null) return none;
  const c = options.find((o) => o.id === couponId);
  if (!c) return { error: "선택한 쿠폰을 쓸 수 없어요. 다시 선택해 주세요." };
  const q = couponQuote(lines, shippingBaseFee, c);
  if (q.amount <= 0) return { error: `${c.name}: ${q.reason ?? "사용 조건에 맞지 않아요"}` };

  if (c.kind === "SHIPPING") return { ...none, shipping: { couponId: c.id, amount: q.amount }, shippingDiscount: q.amount };
  if (c.kind === "PRODUCT") {
    const lineCouponAllocated = none.lineCouponAllocated.map((_, i) => (i === q.lineIndex ? q.amount : 0));
    return { ...none, lineCouponAllocated, product: [{ couponId: c.id, lineIndex: q.lineIndex!, amount: q.amount }], couponDiscountTotal: q.amount };
  }
  const eligible = lines.map((l, i) => (c.eligibleSkuIds.includes(l.skuId) ? i : -1)).filter((i) => i >= 0);
  const parts = allocate(q.amount, eligible.map((i) => lines[i].lineTotal));
  const lineCouponAllocated = none.lineCouponAllocated.slice();
  eligible.forEach((lineIndex, k) => (lineCouponAllocated[lineIndex] = parts[k]));
  // 대상 줄 전부 기록 (배분 0원인 줄도: DB가 최소 금액·정률 한도를 대상 줄 기준으로 다시 검사)
  return { ...none, lineCouponAllocated, order: { couponId: c.id, amount: q.amount, allocations: eligible.map((lineIndex, k) => ({ lineIndex, amount: parts[k] })) }, couponDiscountTotal: q.amount };
}

/**
 * 결제 화면 쿠폰 목록: 쓸 수 있는 쿠폰을 할인 금액이 큰 순서로 (같으면 만료가 빠른 순), 쓸 수 없는 쿠폰은 아래에 이유와 함께
 * ⚠️ 정렬만 해 줄 뿐 자동으로 고르지 않음 — 만료일을 보고 고객이 직접 고름
 */
export function couponChoices(lines: CalcLine[], shippingBaseFee: number, options: CouponOption[]) {
  return options
    .map((coupon) => ({ coupon, ...couponQuote(lines, shippingBaseFee, coupon) }))
    .sort((a, b) => Number(b.amount > 0) - Number(a.amount > 0) || b.amount - a.amount || a.coupon.validTo.localeCompare(b.coupon.validTo) || a.coupon.id - b.coupon.id);
}

/**
 * 발급일 포함 N일 쿠폰의 사용 종료 시각: 발급일(한국 날짜) + N일의 0시(한국 시각) 직전까지
 * 예) 11/18 오후 3시 발급, 30일 → 12/17 23:59:59 KST까지 = validTo 12/18 00:00 KST
 * ⚠️ DB 트리거(CustomerCoupon_issue_guard)가 같은 계산으로 검사합니다.
 */
export function couponValidTo(issuedAt: Date, validDays: number): Date {
  const kst = new Date(issuedAt.getTime() + 9 * 3600_000);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + validDays) - 9 * 3600_000);
}

/** 화면 표시용 쿠폰 혜택 문구 */
export function couponBenefitText(c: Pick<CouponOption, "kind" | "discountType" | "discountValue" | "maxDiscountAmount" | "minOrderAmount">) {
  const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
  const benefit =
    c.discountType === "FREE_SHIPPING" ? "배송비 무료" : c.discountType === "RATE" ? `${c.discountValue}% 할인${c.maxDiscountAmount ? ` (최대 ${won(c.maxDiscountAmount)})` : ""}` : `${won(c.discountValue)} 할인`;
  const min = c.minOrderAmount > 0 ? ` · ${won(c.minOrderAmount)} 이상` : "";
  return benefit + min;
}

export const COUPON_KIND_LABEL: Record<CouponKindValue, string> = { PRODUCT: "상품 쿠폰", ORDER: "장바구니 쿠폰", SHIPPING: "배송비 쿠폰" };

/** 쿠폰 받기·코드 입력 결과 안내 (화면은 URL의 code로 문구를 고름) */
export const COUPON_NOTICE = {
  OK: "쿠폰을 받았어요. 쿠폰함에서 확인할 수 있어요.",
  CODE_OK: "쿠폰 코드를 등록했어요. 쿠폰함에 들어왔어요.",
  SOLD_OUT: "선착순 수량이 모두 소진됐어요.",
  ALREADY: "이미 받은 쿠폰이에요.",
  GRADE: "회원 등급 조건에 맞지 않아 받을 수 없어요.",
  PERIOD: "발급 기간이 아니에요.",
  INACTIVE: "지금은 받을 수 없는 쿠폰이에요.",
  CUSTOMER: "지금 회원 상태로는 쿠폰을 받을 수 없어요.",
  NOT_DOWNLOADABLE: "받을 수 없는 쿠폰이에요.",
  LOCKED: "코드를 여러 번 잘못 입력했어요. 1시간 뒤에 다시 시도해 주세요.",
  BAD_CODE: "사용할 수 없는 쿠폰 코드예요. (코드가 없거나 기간이 끝났어요)",
  BUSY: "요청이 몰려 처리하지 못했어요. 잠시 후 다시 시도해 주세요.",
  NOT_REVOCABLE: "회수할 수 없는 쿠폰이에요.",
} as const;
export type CouponNoticeCode = keyof typeof COUPON_NOTICE;
export const isCouponNoticeCode = (v: unknown): v is CouponNoticeCode => typeof v === "string" && Object.hasOwn(COUPON_NOTICE, v);
