import Link from "next/link";
import { paymentFailMessage } from "@/lib/payment-labels";

// 결제 실패 페이지. 예: /checkout/fail?code=REJECT_CARD_COMPANY
// ⚠️ 주소창의 문구(message)는 누구나 바꿀 수 있어 보여 주지 않습니다. 코드로 우리 문구를 고릅니다.
// 장바구니는 그대로 남아 있으므로 바로 다시 결제할 수 있습니다.
export default async function FailPage({ searchParams }: PageProps<"/checkout/fail">) {
  const { code } = await searchParams;
  const safeCode = typeof code === "string" && /^[A-Z0-9_]{1,64}$/.test(code) ? code : null;
  const canceledByUser = safeCode === "PAY_PROCESS_CANCELED" || safeCode === "USER_CANCEL";

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-20 text-center">
      <p className="text-5xl">{canceledByUser ? "🛒" : "😢"}</p>
      <h1 className="mt-4 text-2xl font-bold text-gray-900">{canceledByUser ? "결제를 취소했어요" : "결제하지 못했어요"}</h1>
      <p className="mt-2 text-gray-600">{paymentFailMessage(safeCode)}</p>
      {safeCode && !canceledByUser && <p className="mt-1 text-xs text-gray-400">오류 코드: {safeCode}</p>}
      <p className="mt-4 text-sm text-gray-500">장바구니에 담은 상품은 그대로 있어요.</p>
      <div className="mt-8 flex justify-center gap-3">
        <Link href="/checkout" className="rounded-lg bg-gray-900 px-6 py-3 font-medium text-white hover:bg-gray-700">
          다시 결제하기
        </Link>
        <Link href="/cart" className="rounded-lg border border-gray-300 px-6 py-3 font-medium text-gray-700 hover:bg-gray-50">
          장바구니
        </Link>
        <Link href="/orders" className="rounded-lg border border-gray-300 px-6 py-3 font-medium text-gray-700 hover:bg-gray-50">
          주문 내역
        </Link>
      </div>
    </main>
  );
}
