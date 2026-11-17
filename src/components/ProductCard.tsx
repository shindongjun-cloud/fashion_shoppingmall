import Link from "next/link";
import type { Product } from "@/generated/prisma/client";
import { formatPrice } from "@/lib/format";

// 부모에게서 product 하나를 props로 받아 카드 모양으로 보여줍니다.
export default function ProductCard({ product }: { product: Product }) {
  return (
    <Link
      href={`/products/${product.id}`}
      className="group block overflow-hidden rounded-xl border border-gray-200 bg-white transition hover:shadow-lg"
    >
      <div
        className={`flex aspect-square items-center justify-center text-7xl ${product.color}`}
      >
        {product.emoji}
      </div>
      <div className="p-4">
        <p className="text-xs text-gray-500">{product.category}</p>
        <h2 className="mt-1 font-medium text-gray-900 group-hover:underline">
          {product.name}
        </h2>
        <p className="mt-2 font-bold text-gray-900">
          {formatPrice(product.price)}
        </p>
      </div>
    </Link>
  );
}
