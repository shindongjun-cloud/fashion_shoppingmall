import Link from "next/link";

// 결제 실패 페이지. 토스(failUrl) 또는 우리 서버(승인 실패)가 이리로 보냅니다.
// 예: /checkout/fail?code=PAY_PROCESS_CANCELED&message=사용자에 의해 결제가 취소되었습니다.
export default async function FailPage({
  searchParams,
}: PageProps<"/checkout/fail">) {
  const { message } = await searchParams;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-20 text-center">
      <p className="text-5xl">😢</p>
      <h1 className="mt-4 text-2xl font-bold text-gray-900">
        결제에 실패했어요
      </h1>
      <p className="mt-2 text-gray-600">
        {typeof message === "string" ? message : "알 수 없는 오류가 발생했어요."}
      </p>
      <Link
        href="/cart"
        className="mt-8 inline-block rounded-lg bg-gray-900 px-6 py-3 font-medium text-white hover:bg-gray-700"
      >
        장바구니로 돌아가기
      </Link>
    </main>
  );
}
