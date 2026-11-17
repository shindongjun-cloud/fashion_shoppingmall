import ProductCard from "@/components/ProductCard";
import { prisma } from "@/lib/prisma";

// 요청할 때마다 데이터베이스에서 새로 읽습니다. (없으면 빌드할 때 한 번만 읽고 고정됨)
export const dynamic = "force-dynamic";

// 첫 화면: 상품 목록
// async 함수라서 서버에서 데이터베이스를 직접 읽을 수 있습니다. (서버 컴포넌트)
export default async function Home() {
  const products = await prisma.product.findMany({
    orderBy: { id: "asc" },
  });

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">전체 상품</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {/* products 배열의 상품마다 카드를 하나씩 만듭니다 */}
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </main>
  );
}
