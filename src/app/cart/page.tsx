import CartView from "@/components/CartView";
import { prisma } from "@/lib/prisma";

// 요청할 때마다 데이터베이스에서 새로 읽습니다.
export const dynamic = "force-dynamic";

// 서버에서 상품 정보를 읽고, 장바구니 화면(브라우저에서 동작)에 넘겨줍니다.
// 장바구니 내용은 브라우저 localStorage에 있어서 서버는 알 수 없기 때문입니다.
export default async function CartPage() {
  const products = await prisma.product.findMany();
  return <CartView products={products} />;
}
