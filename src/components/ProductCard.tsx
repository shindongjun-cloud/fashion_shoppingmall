/* eslint-disable @next/next/no-img-element -- 임시 SVG 이미지라 next/image 최적화가 필요 없음 */
import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { formatPrice } from "@/lib/format";
import { GENDER_LABEL } from "@/lib/product-labels";
import type { PriceInfo } from "@/lib/pricing";

// 목록 페이지(app/page.tsx)에서 include로 읽어온 모양 그대로 받습니다.
type CardStyle = Prisma.StyleGetPayload<{
  include: {
    category: true;
    colors: {
      include: {
        color: true;
        images: true;
        skus: { select: { stock: true } };
      };
    };
  };
}>;

// 상품 카드: 대표 컬러 사진 + (마우스를 올리면) 착용 사진 + 컬러칩
export default function ProductCard({ style, price }: { style: CardStyle; price: PriceInfo }) {
  const mainColor = style.colors[0];
  const mainImage = mainColor?.images.find((img) => img.type === "MAIN");
  const hoverImage = mainColor?.images.find((img) => img.type === "MODEL");

  // 품절은 상태값이 아니라 재고로 계산합니다.
  const hasStock = (c: CardStyle["colors"][number]) => c.skus.some((s) => s.stock > 0);
  const soldOut = !style.colors.some(hasStock);
  const rate = price.discountRate;

  return (
    <Link href={`/products/${style.styleCode}`} className="group block">
      <div className="relative aspect-[4/5] overflow-hidden rounded-lg bg-gray-100">
        {mainImage && (
          <img
            src={mainImage.url}
            alt={mainImage.alt}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {hoverImage && (
          <img
            src={hoverImage.url}
            alt={hoverImage.alt}
            className="absolute inset-0 h-full w-full object-cover opacity-0 transition group-hover:opacity-100"
          />
        )}
        {/* 할인 행사 뱃지 (예: SEASON OFF) */}
        {price.promotion?.badgeText && !soldOut && (
          <span className="absolute left-2 top-2 rounded bg-red-600 px-2 py-0.5 text-xs font-bold tracking-wide text-white">
            {price.promotion.badgeText}
          </span>
        )}
        {soldOut && (
          <span className="absolute left-2 top-2 rounded bg-gray-900/80 px-2 py-0.5 text-xs font-medium text-white">
            SOLD OUT
          </span>
        )}
      </div>

      <div className="mt-3">
        {/* 컬러칩: 품절 컬러는 흐리게 */}
        <div className="flex gap-1.5">
          {style.colors.map((c) => (
            <span
              key={c.id}
              title={c.colorLabel ?? c.color.name}
              className={`h-3.5 w-3.5 rounded-full border border-gray-300 ${hasStock(c) ? "" : "opacity-30"}`}
              style={{ backgroundColor: c.color.hex }}
            />
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          {GENDER_LABEL[style.gender]} · {style.category.name}
        </p>
        <h2 className="mt-0.5 text-sm font-medium text-gray-900 group-hover:underline">
          {style.name}
        </h2>
        <p className="mt-1 text-sm">
          {rate > 0 && <span className="mr-1.5 font-bold text-red-600">{rate}%</span>}
          <span className="font-bold text-gray-900">{formatPrice(price.salePrice)}</span>
          {rate > 0 && (
            <span className="ml-1.5 text-xs text-gray-400 line-through">
              {formatPrice(price.listPrice)}
            </span>
          )}
        </p>
      </div>
    </Link>
  );
}
