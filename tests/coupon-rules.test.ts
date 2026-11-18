// 쿠폰 할인 계산 단위 테스트 (DB 없음): lib/coupon-rules.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { allocate, applyCoupon, couponChoices, couponValidTo, itemsCouponDiscount, rateDiscount, shippingCouponDiscount, type CouponOption } from "../src/lib/coupon-rules";

let seq = 0;
const coupon = (o: Partial<CouponOption> & Pick<CouponOption, "kind" | "discountType" | "discountValue">): CouponOption => ({
  id: ++seq,
  couponNo: `CP${String(seq).padStart(10, "0")}`,
  name: `쿠폰${seq}`,
  maxDiscountAmount: null,
  minOrderAmount: 0,
  eligibleSkuIds: [1, 2, 3],
  saleExcludedSkuIds: [],
  validTo: "2026-12-31T00:00:00.000Z",
  ...o,
});
const ok = <T,>(r: T | { error: string }): T => {
  assert.ok(!(typeof r === "object" && r !== null && "error" in r), JSON.stringify(r));
  return r as T;
};

describe("금액 계산", () => {
  test("정률은 10원 미만 버림, 최대 한도", () => {
    assert.equal(rateDiscount(103200, 10, null), 10320);
    assert.equal(rateDiscount(49990, 15, null), 7490); // 7498.5 → 7490
    assert.equal(rateDiscount(300000, 10, 10000), 10000);
    assert.equal(rateDiscount(99, 10, null), 0);
  });
  test("최소 금액 경계: 같으면 적용, 1원 모자라면 미적용", () => {
    const c = { discountType: "AMOUNT" as const, discountValue: 5000, maxDiscountAmount: null, minOrderAmount: 50000 };
    assert.equal(itemsCouponDiscount(c, 50000), 5000);
    assert.equal(itemsCouponDiscount(c, 49999), 0);
  });
  test("정액이 기준 금액 이상이면 미적용 (0원 판매 방지)", () => {
    const c = { discountType: "AMOUNT" as const, discountValue: 5000, maxDiscountAmount: null, minOrderAmount: 0 };
    assert.equal(itemsCouponDiscount(c, 5000), 0);
    assert.equal(itemsCouponDiscount(c, 5001), 5000);
  });
  test("배송비 쿠폰: 기본 배송비만, 무료배송이면 0, 정액은 배송비까지만", () => {
    assert.equal(shippingCouponDiscount({ discountType: "FREE_SHIPPING", discountValue: 0, minOrderAmount: 0 }, 3000, 20000), 3000);
    assert.equal(shippingCouponDiscount({ discountType: "FREE_SHIPPING", discountValue: 0, minOrderAmount: 0 }, 0, 60000), 0);
    assert.equal(shippingCouponDiscount({ discountType: "AMOUNT", discountValue: 5000, minOrderAmount: 0 }, 3000, 20000), 3000);
    assert.equal(shippingCouponDiscount({ discountType: "AMOUNT", discountValue: 1000, minOrderAmount: 30000 }, 3000, 20000), 0);
  });
  test("배분: 합계 일치, 원 단위 나머지는 소수점 큰 줄부터, 줄 금액 초과 없음", () => {
    assert.deepEqual(allocate(10000, [49000, 103200]), [3219, 6781]); // 3219.45 / 6780.55 → 남는 1원은 소수점이 큰 쪽
    assert.throws(() => allocate(100, [1, 1, 1]), /기준 금액 합계/, "합계보다 많이 나누면 어떤 줄은 자기 금액을 넘음 → 거부");
    assert.deepEqual(allocate(3, [1, 1, 1]), [1, 1, 1]);
    const parts = allocate(9999, [33333, 33333, 33334]);
    assert.equal(parts.reduce((n, x) => n + x, 0), 9999);
    assert.deepEqual(allocate(1, [100000, 10]), [1, 0], "아주 작은 줄은 0원일 수 있음");
    assert.deepEqual(allocate(0, [10, 20]), [0, 0]);
  });
  test("발급일 포함 N일: 한국 날짜 기준 마지막 날 23:59:59까지", () => {
    // 11/18 15:00 KST 발급, 30일 → 12/18 00:00 KST(=12/17 15:00Z) 직전까지
    assert.equal(couponValidTo(new Date("2026-11-18T06:00:00Z"), 30).toISOString(), "2026-12-17T15:00:00.000Z");
    // 11/18 23:30 KST (= 14:30Z) 발급도 같은 날로 셈
    assert.equal(couponValidTo(new Date("2026-11-18T14:30:00Z"), 1).toISOString(), "2026-11-18T15:00:00.000Z");
    // 11/19 00:30 KST (= 11/18 15:30Z)는 다음 날
    assert.equal(couponValidTo(new Date("2026-11-18T15:30:00Z"), 1).toISOString(), "2026-11-19T15:00:00.000Z");
  });
});

describe("쿠폰 적용", () => {
  const lines = [
    { skuId: 1, lineTotal: 49000 },
    { skuId: 2, lineTotal: 103200 },
  ];
  test("상품 쿠폰: 대상 줄 중 할인이 가장 큰 줄 하나에만, 줄 배분 = 할인액", () => {
    const knit = coupon({ kind: "PRODUCT", discountType: "RATE", discountValue: 15, maxDiscountAmount: 20000, eligibleSkuIds: [1, 2] });
    const r = ok(applyCoupon(lines, 3000, [knit], knit.id));
    assert.deepEqual(r.product, [{ couponId: knit.id, lineIndex: 1, amount: 15480 }], "103,200원 줄에 (49,000원 줄보다 할인이 큼)");
    assert.deepEqual(r.lineCouponAllocated, [0, 15480]);
    assert.deepEqual([r.order, r.shipping, r.couponDiscountTotal, r.shippingDiscount], [null, null, 15480, 0]);
  });
  test("장바구니 쿠폰: 대상 줄 판매가 합계 기준, 줄마다 비율로 나눔", () => {
    const cart = coupon({ kind: "ORDER", discountType: "RATE", discountValue: 10, maxDiscountAmount: 10000 });
    const r = ok(applyCoupon(lines, 3000, [cart], cart.id));
    assert.equal(r.order!.amount, 10000); // 152,200 × 10% = 15,220 → 한도 10,000
    assert.deepEqual(r.lineCouponAllocated, [3219, 6781]);
    assert.equal(r.product.length, 0);
  });
  test("배송비 쿠폰: 배송비 할인만, 상품 할인 0", () => {
    const ship = coupon({ kind: "SHIPPING", discountType: "FREE_SHIPPING", discountValue: 0, eligibleSkuIds: [] });
    const r = ok(applyCoupon(lines, 3000, [ship], ship.id));
    assert.deepEqual([r.couponDiscountTotal, r.shippingDiscount, r.lineCouponAllocated], [0, 3000, [0, 0]]);
  });
  test("쿠폰 안 씀(null) → 할인 0", () => {
    const r = ok(applyCoupon(lines, 3000, [], null));
    assert.deepEqual([r.couponDiscountTotal, r.shippingDiscount], [0, 0]);
  });
  test("대상 아님·내 쿠폰 목록에 없음·배송비 무료인데 배송비 쿠폰·최소 금액 미달 → 오류", () => {
    const p = coupon({ kind: "PRODUCT", discountType: "RATE", discountValue: 10, eligibleSkuIds: [99] });
    assert.ok("error" in applyCoupon(lines, 0, [p], p.id));
    assert.ok("error" in applyCoupon(lines, 0, [p], 123456));
    const s = coupon({ kind: "SHIPPING", discountType: "FREE_SHIPPING", discountValue: 0, eligibleSkuIds: [] });
    assert.ok("error" in applyCoupon(lines, 0, [s], s.id));
    const c = coupon({ kind: "ORDER", discountType: "AMOUNT", discountValue: 5000, minOrderAmount: 50000, eligibleSkuIds: [1] });
    assert.ok("error" in applyCoupon(lines, 0, [c], c.id), "행사 상품 제외 쿠폰: 대상 줄(49,000원)이 5만원 미만");
  });
});

describe("결제 화면 쿠폰 목록 (자동 선택 없음, 고객이 고름)", () => {
  test("쓸 수 있는 쿠폰은 할인 금액이 큰 순서, 같으면 만료가 빠른 순서, 쓸 수 없는 쿠폰은 아래에 이유와 함께", () => {
    const lines = [{ skuId: 1, lineTotal: 80000 }];
    const a = coupon({ kind: "ORDER", discountType: "AMOUNT", discountValue: 5000, validTo: "2026-12-31T00:00:00.000Z" });
    const b = coupon({ kind: "ORDER", discountType: "AMOUNT", discountValue: 5000, validTo: "2026-12-01T00:00:00.000Z" });
    const c = coupon({ kind: "ORDER", discountType: "RATE", discountValue: 10 }); // 8,000원
    const ship = coupon({ kind: "SHIPPING", discountType: "FREE_SHIPPING", discountValue: 0, eligibleSkuIds: [] }); // 배송비 무료라 못 씀
    const big = coupon({ kind: "ORDER", discountType: "AMOUNT", discountValue: 20000, minOrderAmount: 100000 }); // 최소 금액 미달
    const list = couponChoices(lines, 0, [a, ship, big, b, c]);
    assert.deepEqual(list.slice(0, 3).map((x) => x.coupon.id), [c.id, b.id, a.id], "8,000 > 5,000(12/1 만료) > 5,000(12/31 만료)");
    assert.deepEqual(new Set(list.slice(3).map((x) => x.coupon.id)), new Set([big.id, ship.id]), "쓸 수 없는 쿠폰은 맨 아래");
    assert.deepEqual(list.slice(0, 3).map((x) => x.amount), [8000, 5000, 5000]);
    assert.deepEqual(list.slice(3).map((x) => x.amount), [0, 0]);
    assert.match(list.find((x) => x.coupon.id === ship.id)!.reason!, /배송비가 무료/);
    assert.match(list.find((x) => x.coupon.id === big.id)!.reason!, /100,000원 이상/);
  });
  test("행사 상품 제외 쿠폰은 이유를 정확히 안내", () => {
    const c = coupon({ kind: "ORDER", discountType: "AMOUNT", discountValue: 5000, minOrderAmount: 50000, eligibleSkuIds: [], saleExcludedSkuIds: [1] });
    const [q] = couponChoices([{ skuId: 1, lineTotal: 103200 }], 0, [c]);
    assert.equal(q.amount, 0);
    assert.match(q.reason!, /할인 행사 중인 상품에는/);
  });
  test("상품 쿠폰 목록에는 적용될 상품 줄과 금액이 함께", () => {
    const lines = [{ skuId: 1, lineTotal: 30000 }, { skuId: 2, lineTotal: 100000 }];
    const p = coupon({ kind: "PRODUCT", discountType: "RATE", discountValue: 20 });
    const [q] = couponChoices(lines, 0, [p]);
    assert.deepEqual([q.amount, q.lineIndex], [20000, 1]);
  });
});
