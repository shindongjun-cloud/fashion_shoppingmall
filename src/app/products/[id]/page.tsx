import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/format";
import AddToCartButton from "@/components/AddToCartButton";

export const dynamic = "force-dynamic";

// 폴더 이름의 [id]가 주소의 일부가 됩니다. 예: /products/3 → id는 "3"
export default async function ProductPage({
  params,
}: PageProps<"/products/[id]">) {
  const { id } = await params;

  // 주소의 id는 글자("3")라서 숫자(3)로 바꿉니다. 숫자가 아니면 404
  const productId = Number(id);
  if (!Number.isInteger(productId)) {
    notFound();
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
  });

  // 없는 상품이면 404 페이지를 보여줍니다.
  if (!product) {
    notFound();
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <Link href="/" className="text-sm text-gray-500 hover:underline">
        ← 목록으로
      </Link>

      <div className="mt-6 grid gap-8 md:grid-cols-2">
        <div
          className={`flex aspect-square items-center justify-center rounded-xl text-9xl ${product.color}`}
        >
          {product.emoji}
        </div>

        <div className="flex flex-col">
          <p className="text-sm text-gray-500">{product.category}</p>
          <h1 className="mt-1 text-3xl font-bold text-gray-900">
            {product.name}
          </h1>
          <p className="mt-4 text-2xl font-bold text-gray-900">
            {formatPrice(product.price)}
          </p>
          <p className="mt-6 leading-relaxed text-gray-700">
            {product.description}
          </p>
          <AddToCartButton productId={product.id} />
        </div>
      </div>
    </main>
  );
}
