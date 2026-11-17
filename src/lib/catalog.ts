// 상품(스타일/컬러/SKU)을 읽을 때 여러 페이지가 같이 쓰는 조건과 함수 모음 (서버 전용)
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------
// "고객에게 팔 수 있는 상품" 조건
// 판매 상태(status)와 전시 여부(isDisplayed)를 따로 관리하기 때문에 둘 다 확인합니다.
// ---------------------------------------------------------------
export function sellableStyleWhere(now = new Date()): Prisma.StyleWhereInput {
  return {
    status: "ON_SALE",
    isDisplayed: true,
    deletedAt: null, // 소프트 삭제된 상품 제외
    AND: [
      { OR: [{ saleStartAt: null }, { saleStartAt: { lte: now } }] },
      { OR: [{ saleEndAt: null }, { saleEndAt: { gt: now } }] },
    ],
  };
}

export const sellableColorWhere = {
  status: "ON_SALE",
  isDisplayed: true,
} satisfies Prisma.StyleColorWhereInput;

type StyleForCheck = {
  status: string;
  isDisplayed: boolean;
  deletedAt: Date | null;
  saleStartAt: Date | null;
  saleEndAt: Date | null;
};

// 위 조건과 같은 판단을 이미 읽어온 데이터에 대해 합니다 (장바구니·주문 검사용)
export function isStyleSellable(style: StyleForCheck, now = new Date()) {
  return (
    style.status === "ON_SALE" &&
    style.isDisplayed &&
    style.deletedAt === null &&
    (style.saleStartAt === null || style.saleStartAt <= now) &&
    (style.saleEndAt === null || style.saleEndAt > now)
  );
}

// ---------------------------------------------------------------
// 장바구니·주문서에서 쓰는 "SKU 한 줄" 정보
// 3단 구조(스타일→컬러→SKU)를 화면에서 쓰기 쉽게 한 줄로 펼친 모양입니다.
// ---------------------------------------------------------------
export type CartSku = {
  id: number;
  skuCode: string;
  styleCode: string;
  styleName: string;
  colorName: string;
  colorHex: string;
  sizeName: string;
  price: number; // 판매가
  maxQtyPerOrder: number | null; // 스타일 단위 1회 주문 최대 수량 (없으면 제한 없음)
  stock: number;
  imageUrl: string | null;
  sellable: boolean; // 지금 주문 가능한지 (판매중지·숨김이면 false)
};

const cartSkuInclude = {
  size: true,
  styleColor: {
    include: {
      color: true,
      style: true,
      images: { where: { type: "MAIN" }, orderBy: { sortOrder: "asc" }, take: 1 },
    },
  },
} satisfies Prisma.SkuInclude;

type SkuWithRelations = Prisma.SkuGetPayload<{ include: typeof cartSkuInclude }>;

function toCartSku(sku: SkuWithRelations, now: Date): CartSku {
  const { styleColor } = sku;
  const { style, color } = styleColor;
  return {
    id: sku.id,
    skuCode: sku.skuCode,
    styleCode: style.styleCode,
    styleName: style.name,
    colorName: styleColor.colorLabel ?? color.name,
    colorHex: color.hex,
    sizeName: sku.size.label,
    price: style.salePrice,
    maxQtyPerOrder: style.maxQtyPerOrder,
    stock: sku.stock,
    imageUrl: styleColor.images[0]?.url ?? null,
    sellable:
      sku.status === "ON_SALE" &&
      styleColor.status === "ON_SALE" &&
      styleColor.isDisplayed &&
      isStyleSellable(style, now),
  };
}

// ids를 주면 그 SKU만, 안 주면 전체를 읽습니다.
// (장바구니 내용은 브라우저에만 있어서 지금은 전체를 넘깁니다. 상품이 많아지면 id로 좁혀 읽도록 바꿉니다)
export async function getCartSkus(ids?: number[]): Promise<CartSku[]> {
  const now = new Date();
  const skus = await prisma.sku.findMany({
    where: ids ? { id: { in: ids } } : undefined,
    include: cartSkuInclude,
  });
  return skus.map((sku) => toCartSku(sku, now));
}
