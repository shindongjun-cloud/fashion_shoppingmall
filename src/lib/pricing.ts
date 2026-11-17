// 판매가 계산 (서버 전용)
//
//   판매가 = 정가(StylePrice 중 지금 유효한 행)
//          − 지금 적용 가능한 할인 행사 중 "할인액이 가장 큰 1개" (같으면 priority 높은 순)
//
// 판매가를 DB에 저장하지 않고 매번 계산하기 때문에, 행사 시작·종료 시각이 되면
// 아무도 손대지 않아도 가격이 바뀌고 돌아옵니다.
// 화면(목록·상세·장바구니)과 주문 생성이 모두 이 파일 하나를 써서 "보이는 가격 = 결제 가격"을 보장합니다.
import type { Gender, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

// 계산 결과 (1개 기준)
export type PriceInfo = {
  listPrice: number; // 정가
  salePrice: number; // 판매가
  discountAmount: number; // 할인액 = 정가 − 판매가
  discountRate: number; // 표시용 할인율(%) — 소수점 버림
  promotion: {
    id: number;
    displayName: string;
    badgeText: string | null;
    endAt: Date;
    showEndDate: boolean;
  } | null;
};

// 할인 대상 판단에 필요한 스타일 정보
export type StyleForPricing = {
  id: number;
  gender: Gender;
  seasonId: number | null;
  categoryId: number;
  category: { path: string };
};

export const activePromotionInclude = {
  targets: true,
} satisfies Prisma.PricePromotionInclude;
export type ActivePromotion = Prisma.PricePromotionGetPayload<{ include: typeof activePromotionInclude }>;
type Target = ActivePromotion["targets"][number];

// ---------------------------------------------------------------
// 1) 대상 판단
// ---------------------------------------------------------------
function targetMatches(target: Target, style: StyleForPricing) {
  switch (target.targetType) {
    case "ALL":
      return true;
    case "CATEGORY":
      // 경로 열거(path) 덕분에 "아우터(/1/) 아래 전부"를 문자열 포함 여부로 판단합니다.
      return target.categoryId !== null && style.category.path.includes(`/${target.categoryId}/`);
    case "SEASON":
      return target.seasonId !== null && target.seasonId === style.seasonId;
    case "GENDER":
      return target.gender === style.gender;
    case "STYLE":
      return target.styleId === style.id;
  }
}

// 여러 포함 대상이 겹치면 "더 구체적인 대상"의 할인값 덮어쓰기를 씁니다.
// 스타일 지정 > 카테고리(깊을수록) > 시즌 > 성별 > 전체
function specificity(target: Target, style: StyleForPricing) {
  switch (target.targetType) {
    case "STYLE": return 100;
    case "CATEGORY": {
      // 카테고리 깊이 = 경로에서 해당 id가 몇 번째인지
      const depth = style.category.path.split("/").filter(Boolean).indexOf(String(target.categoryId)) + 1;
      return 50 + depth;
    }
    case "SEASON": return 30;
    case "GENDER": return 20;
    case "ALL": return 10;
  }
}

// 이 행사가 이 스타일에 적용되는지, 적용된다면 할인값은 얼마인지
function applicableDiscountValue(promotion: ActivePromotion, style: StyleForPricing) {
  const matched = promotion.targets.filter((t) => targetMatches(t, style));
  // 제외 대상에 걸리면 무조건 미적용 (포함보다 제외가 우선)
  if (matched.some((t) => t.mode === "EXCLUDE")) return null;
  const includes = matched.filter((t) => t.mode === "INCLUDE");
  if (includes.length === 0) return null;
  const best = includes.sort((a, b) => specificity(b, style) - specificity(a, style))[0];
  return best.discountValueOverride ?? promotion.discountValue;
}

// ---------------------------------------------------------------
// 2) 할인 금액 계산
// ---------------------------------------------------------------
function roundPrice(price: number, unit: number, mode: ActivePromotion["roundingMode"]) {
  if (unit <= 1) return price;
  const f = mode === "CEIL" ? Math.ceil : mode === "ROUND" ? Math.round : Math.floor;
  return f(price / unit) * unit;
}

function discountFor(promotion: ActivePromotion, value: number, listPrice: number) {
  if (promotion.minListPrice !== null && listPrice < promotion.minListPrice) return 0;

  let sale: number;
  if (promotion.discountType === "RATE") {
    // ⚠️ 금액은 정수로 계산합니다. 89000 * 0.7 = 62299.999...(소수 오차) → 내림하면 62,200원이 되는 버그
    //    89000 * 70 / 100 = 62300 처럼 곱하기를 먼저 하면 정확합니다.
    sale = (listPrice * (100 - value)) / 100;
  } else if (promotion.discountType === "AMOUNT") {
    sale = listPrice - value;
  } else {
    sale = value; // FIXED_PRICE: 균일가
  }
  sale = roundPrice(sale, promotion.roundingUnit, promotion.roundingMode);

  let discount = listPrice - sale;
  if (promotion.maxDiscountAmount !== null) {
    discount = Math.min(discount, promotion.maxDiscountAmount); // 최대 할인 한도
  }
  // 할인이 음수(균일가가 정가보다 비쌈)면 이 행사는 적용하지 않습니다.
  if (discount <= 0) return 0;
  // ⚠️ 판매가가 0원 이하가 되는 행사는 적용하지 않습니다. (정액 2만원 할인 × 정가 1만5천원 상품 = 0원 판매 사고)
  //    할인을 정가까지 깎아 "0원"으로 파는 대신, 이 상품에는 행사가 안 걸린 것으로 봅니다.
  if (listPrice - discount < 1) return 0;
  return discount;
}

export function computePrice(style: StyleForPricing, listPrice: number, promotions: ActivePromotion[]): PriceInfo {
  let best: { promotion: ActivePromotion; discount: number } | null = null;
  for (const promotion of promotions) {
    const value = applicableDiscountValue(promotion, style);
    if (value === null) continue;
    const discount = discountFor(promotion, value, listPrice);
    if (discount <= 0) continue;
    // 할인액이 가장 큰 1개. 같으면 priority가 높은 것, 그것도 같으면 먼저 만든 것
    if (
      !best ||
      discount > best.discount ||
      (discount === best.discount && promotion.priority > best.promotion.priority)
    ) {
      best = { promotion, discount };
    }
  }

  const discountAmount = best?.discount ?? 0;
  return {
    listPrice,
    salePrice: listPrice - discountAmount,
    discountAmount,
    discountRate: listPrice > 0 ? Math.floor((discountAmount / listPrice) * 100) : 0,
    promotion: best
      ? {
          id: best.promotion.id,
          displayName: best.promotion.displayName,
          badgeText: best.promotion.badgeText,
          endAt: best.promotion.endAt,
          showEndDate: best.promotion.showEndDate,
        }
      : null,
  };
}

// ---------------------------------------------------------------
// 3) DB에서 읽어 계산 (여러 스타일을 한 번에: 쿼리 3번으로 끝)
// ---------------------------------------------------------------
export async function getPrices(styleIds: number[], now = new Date()): Promise<Map<number, PriceInfo>> {
  const ids = [...new Set(styleIds)];
  if (ids.length === 0) return new Map();

  const [styles, prices, promotions] = await Promise.all([
    prisma.style.findMany({
      where: { id: { in: ids } },
      select: { id: true, gender: true, seasonId: true, categoryId: true, category: { select: { path: true } } },
    }),
    // 지금 유효한 정가: validFrom <= 지금 < validTo (validTo 없음 = 현재 가격)
    prisma.stylePrice.findMany({
      where: {
        styleId: { in: ids },
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gt: now } }],
      },
      orderBy: { validFrom: "desc" },
    }),
    // 지금 진행 중인 행사: 확정(APPROVED) + 기간 안
    prisma.pricePromotion.findMany({
      where: { status: "APPROVED", startAt: { lte: now }, endAt: { gt: now } },
      include: activePromotionInclude,
      orderBy: { id: "asc" },
    }),
  ]);

  const result = new Map<number, PriceInfo>();
  for (const style of styles) {
    // 기간이 실수로 겹쳐 있으면 가장 최근에 시작한 행을 씁니다.
    const current = prices.find((p) => p.styleId === style.id);
    if (!current) continue; // 정가가 없는 상품은 팔 수 없음 → 결과에서 빠짐
    result.set(style.id, computePrice(style, current.listPrice, promotions));
  }
  return result;
}
