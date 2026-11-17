import ProductCard from "@/components/ProductCard";
import { prisma } from "@/lib/prisma";
import { sellableColorWhere, sellableStyleWhere } from "@/lib/catalog";

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
          // 품절 판단용: 팔 수 있는 SKU의 재고만
          skus: { where: { status: "ON_SALE" }, select: { stock: true } },
        },
      },
    },
  });

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">전체 상품</h1>
      <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3">
        {styles.map((style) => (
          <ProductCard key={style.id} style={style} />
        ))}
      </div>
    </main>
  );
}
