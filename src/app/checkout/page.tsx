import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import CheckoutView from "@/components/CheckoutView";

export const dynamic = "force-dynamic";

// 주문서(결제) 페이지. 로그인한 사람만 들어올 수 있어요.
export default async function CheckoutPage() {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) {
    redirect("/api/auth/signin?callbackUrl=/checkout");
  }

  const products = await prisma.product.findMany();

  return (
    <CheckoutView
      products={products}
      customerKey={user.id} // 토스가 구매자를 구분하는 값
      customerName={user.name ?? undefined}
      customerEmail={user.email ?? undefined}
    />
  );
}
