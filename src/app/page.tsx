import ProductCard from "@/components/ProductCard";
import { prisma } from "@/lib/prisma";
import { sellableColorWhere, sellableStyleWhere } from "@/lib/catalog";
import { getPrices } from "@/lib/pricing";
import { getAvailability } from "@/lib/inventory";

// 요청할 때마다 데이터베이스에서 새로 읽습니다. (없으면 빌드할 때 한 번만 읽고 고정됨)
export const dynamic = "force-dynamic";

// 첫 화면: 상품 목록
// B안이라 카드 1장 = 스타일 1개. 컬러는 카드 아래 컬러칩으로 보여줍니다.
export default async function Home() {
  const styles = await prisma.style.findMany({
    where: sellableStyleWhere(),
    orderBy: [{ releasedAt: "desc" }, { id: "desc" }], // 최신 출시 순
    include: {
      category: true,
      colors: {
        where: sellableColorWhere,
        orderBy: { sortOrder: "asc" }, // 0번 = 대표 컬러
        include: {
          color: true,
          // 카드에는 대표(MAIN)·착용(MODEL) 컷만 필요
          images: {
            where: { type: { in: ["MAIN", "MODEL"] } },
            orderBy: { sortOrder: "asc" },
          },
          // 품절 판단용: 팔 수 있는 SKU (재고는 아래에서 잔고 테이블로 계산)
          skus: { where: { status: "ON_SALE" }, select: { id: true } },
        },
      },
    },
  });

  // 판매가는 저장하지 않고 정가 + 할인 행사로 계산합니다 (lib/pricing.ts)
  const skuIds = styles.flatMap((s) => s.colors.flatMap((c) => c.skus.map((k) => k.id)));
  const [prices, availability] = await Promise.all([getPrices(styles.map((s) => s.id)), getAvailability(skuIds)]);
  // 판매 가능 수량이 1개 이상인 SKU가 있는 컬러 = 품절 아님
  const inStockColorIds = styles.flatMap((s) =>
    s.colors.filter((c) => c.skus.some((k) => (availability.get(k.id) ?? 0) > 0)).map((c) => c.id),
  );

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">전체 상품</h1>
      <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3">
        {styles.map((style) => {
          const price = prices.get(style.id);
          // 정가가 등록되지 않은 상품은 팔 수 없으므로 목록에서 뺍니다.
          return price ? <ProductCard key={style.id} style={style} price={price} inStockColorIds={inStockColorIds} /> : null;
        })}
      </div>
    </main>
  );
}
