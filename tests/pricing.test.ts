// 판매가 계산 단위 테스트 (DB 없이 계산 함수만 검사)
// 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { computePrice, type ActivePromotion, type StyleForPricing } from "../src/lib/pricing";

type Target = ActivePromotion["targets"][number];
const T0 = new Date("2026-11-01T00:00:00Z");
const T1 = new Date("2026-12-01T00:00:00Z");

let seq = 0;
// 테스트용 스타일: 남성 / 시즌 10 / 카테고리 경로 /1/5/ (아우터 > 자켓)
const style = (over: Partial<StyleForPricing> = {}): StyleForPricing => ({
  id: 1, gender: "MEN", seasonId: 10, categoryId: 5, category: { path: "/1/5/" }, ...over,
});
const target = (t: Partial<Target>): Target => ({
  id: ++seq, promotionId: 0, targetType: "ALL", mode: "INCLUDE",
  categoryId: null, seasonId: null, gender: null, styleId: null,
  discountValueOverride: null, createdAt: T0, ...t,
});
const promo = (p: Partial<Omit<ActivePromotion, "targets">> & { targets?: Partial<Target>[] }): ActivePromotion => {
  const id = ++seq;
  return {
    id, code: `P${id}`, name: `행사${id}`, displayName: `행사${id}`, description: null,
    discountType: "RATE", discountValue: 10, maxDiscountAmount: null, minListPrice: null,
    roundingUnit: 100, roundingMode: "FLOOR", startAt: T0, endAt: T1, status: "APPROVED", priority: 0,
    badgeText: null, showEndDate: false, createdBy: null, approvedBy: null, approvedAt: T0,
    createdAt: T0, updatedAt: T0,
    ...p,
    targets: (p.targets ?? [{}]).map((t) => target({ ...t, promotionId: id })),
  };
};

test("행사가 없으면 판매가 = 정가", () => {
  const p = computePrice(style(), 259000, []);
  assert.equal(p.salePrice, 259000);
  assert.equal(p.discountAmount, 0);
  assert.equal(p.promotion, null);
});

test("소수 오차 회귀: 89,000원 30% → 62,300원 (62,200원이 되면 안 됨)", () => {
  const p = computePrice(style(), 89000, [promo({ discountValue: 30 })]);
  assert.equal(p.salePrice, 62300);
});

test("정률 할인은 모든 정가·할인율에서 정수 계산과 같은 결과", () => {
  for (let list = 1000; list <= 500000; list += 700) {
    for (const rate of [1, 7, 10, 15, 20, 29, 30, 33, 40, 50, 70, 99]) {
      const expected = Math.floor((list * (100 - rate)) / 100 / 100) * 100;
      const p = computePrice(style(), list, [promo({ discountValue: rate })]);
      const want = list - expected > 0 && expected >= 1 ? expected : list; // 0원 이하면 미적용
      assert.equal(p.salePrice, want, `정가 ${list}, ${rate}%`);
    }
  }
});

test("최대 할인 한도: 79,000원 40% (31,600) → 한도 30,000 → 49,000원", () => {
  const p = computePrice(style(), 79000, [promo({ discountValue: 40, maxDiscountAmount: 30000 })]);
  assert.equal(p.salePrice, 49000);
  assert.equal(p.discountAmount, 30000);
});

test("제외(EXCLUDE)가 포함(INCLUDE)보다 우선", () => {
  const p = computePrice(style({ id: 7 }), 100000, [
    promo({ discountValue: 30, targets: [{ targetType: "ALL" }, { targetType: "STYLE", mode: "EXCLUDE", styleId: 7 }] }),
  ]);
  assert.equal(p.salePrice, 100000);
  assert.equal(p.promotion, null);
});

test("더 구체적인 대상의 할인값 덮어쓰기: 전체 30% + 아우터(/1/) 35% → 35%", () => {
  const p = computePrice(style(), 100000, [
    promo({ discountValue: 30, targets: [{ targetType: "ALL" }, { targetType: "CATEGORY", categoryId: 1, discountValueOverride: 35 }] }),
  ]);
  assert.equal(p.salePrice, 65000);
});

test("더 깊은 카테고리가 이김: 아우터(/1/) 20% vs 자켓(/1/5/) 25% → 25%", () => {
  const p = computePrice(style(), 100000, [
    promo({ discountValue: 10, targets: [
      { targetType: "CATEGORY", categoryId: 1, discountValueOverride: 20 },
      { targetType: "CATEGORY", categoryId: 5, discountValueOverride: 25 },
    ] }),
  ]);
  assert.equal(p.salePrice, 75000);
});

test("카테고리 경로 매칭: id 1 행사가 경로 /11/12/ 상품에 걸리면 안 됨", () => {
  const p = computePrice(style({ category: { path: "/11/12/" }, categoryId: 12 }), 100000, [
    promo({ discountValue: 30, targets: [{ targetType: "CATEGORY", categoryId: 1 }] }),
  ]);
  assert.equal(p.promotion, null);
});

test("시즌·성별 대상", () => {
  const season = computePrice(style(), 100000, [promo({ discountValue: 20, targets: [{ targetType: "SEASON", seasonId: 10 }] })]);
  assert.equal(season.salePrice, 80000);
  const otherSeason = computePrice(style(), 100000, [promo({ discountValue: 20, targets: [{ targetType: "SEASON", seasonId: 99 }] })]);
  assert.equal(otherSeason.salePrice, 100000);
  const women = computePrice(style(), 100000, [promo({ discountValue: 20, targets: [{ targetType: "GENDER", gender: "WOMEN" }] })]);
  assert.equal(women.salePrice, 100000);
});

test("균일가: 169,000원 → 139,000원, 정가보다 비싼 균일가는 미적용", () => {
  const p = computePrice(style(), 169000, [promo({ discountType: "FIXED_PRICE", discountValue: 139000, roundingUnit: 1000 })]);
  assert.equal(p.salePrice, 139000);
  const expensive = computePrice(style(), 30000, [promo({ discountType: "FIXED_PRICE", discountValue: 39000 })]);
  assert.equal(expensive.salePrice, 30000);
  assert.equal(expensive.promotion, null);
});

test("0원 판매 방지: 정가보다 큰 정액 할인은 적용하지 않음", () => {
  const p = computePrice(style(), 15000, [promo({ discountType: "AMOUNT", discountValue: 20000 })]);
  assert.equal(p.salePrice, 15000);
  assert.equal(p.promotion, null);
  const exact = computePrice(style(), 20000, [promo({ discountType: "AMOUNT", discountValue: 20000 })]);
  assert.equal(exact.salePrice, 20000, "정가와 같은 할인(→0원)도 미적용");
});

test("여러 행사 중 할인이 가장 큰 1개, 같으면 priority 높은 것", () => {
  const a = promo({ discountValue: 10, priority: 0 });
  const b = promo({ discountValue: 40, priority: 0 });
  assert.equal(computePrice(style(), 100000, [a, b]).promotion?.id, b.id);
  const c = promo({ discountValue: 20, priority: 1 });
  const d = promo({ discountValue: 20, priority: 5 });
  assert.equal(computePrice(style(), 100000, [c, d]).promotion?.id, d.id);
  const e = promo({ discountValue: 20, priority: 3 });
  const f = promo({ discountValue: 20, priority: 3 });
  assert.equal(computePrice(style(), 100000, [e, f]).promotion?.id, e.id, "완전히 같으면 먼저 만든 행사");
});

test("최소 정가 조건", () => {
  const p = computePrice(style(), 50000, [promo({ discountValue: 30, minListPrice: 100000 })]);
  assert.equal(p.salePrice, 50000);
});

test("끝자리 처리: 내림 / 반올림 / 올림 (올림이어도 정가를 넘지 않음)", () => {
  // 129,000 × 67% = 86,430
  assert.equal(computePrice(style(), 129000, [promo({ discountValue: 33, roundingMode: "FLOOR" })]).salePrice, 86400);
  assert.equal(computePrice(style(), 129000, [promo({ discountValue: 33, roundingMode: "ROUND" })]).salePrice, 86400);
  assert.equal(computePrice(style(), 129000, [promo({ discountValue: 33, roundingMode: "CEIL" })]).salePrice, 86500);
  // 45,050원 1% 할인 = 44,599.5 → 올림 44,600 (정가 이하)
  const ceil = computePrice(style(), 45050, [promo({ discountValue: 1, roundingMode: "CEIL" })]);
  assert.ok(ceil.salePrice <= 45050);
});

test("표시 할인율은 소수점 버림: 30,000 / 79,000 = 37.9% → 37%", () => {
  const p = computePrice(style(), 79000, [promo({ discountValue: 40, maxDiscountAmount: 30000 })]);
  assert.equal(p.discountRate, 37);
});
