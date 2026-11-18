import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { safeReturnPath } from "@/lib/safe-redirect";
import { loginWithGitHub } from "./actions";

// 로그인 화면. 예: /login?callbackUrl=/checkout (로그인 후 돌아갈 곳)
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { callbackUrl } = await searchParams;
  const returnTo = safeReturnPath(callbackUrl);
  // 이미 로그인했으면 바로 돌려보냄
  if ((await auth())?.user) redirect(returnTo);

  return (
    <main className="mx-auto w-full max-w-sm px-4 py-20">
      <h1 className="text-center text-2xl font-bold text-gray-900">로그인</h1>
      <p className="mt-2 text-center text-sm text-gray-500">처음이면 로그인과 함께 회원가입이 돼요.</p>
      <form action={loginWithGitHub} className="mt-8 space-y-4">
        <input type="hidden" name="callbackUrl" value={returnTo} />
        <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" name="remember" className="mt-0.5 h-4 w-4 accent-gray-900" />
          <span>
            로그인 상태 유지
            <span className="mt-0.5 block text-xs text-gray-500">
              체크하면 30일 동안 로그인이 유지돼요. 체크하지 않으면 브라우저를 닫거나 12시간이 지나면 로그아웃돼요.
              <br />
              PC방·회사 등 여러 사람이 쓰는 컴퓨터에서는 체크하지 마세요.
            </span>
          </span>
        </label>
        {/* 체크박스를 먼저 보고 누르도록 버튼은 아래에 */}
        <button className="w-full rounded-lg bg-gray-900 py-3 font-medium text-white hover:bg-gray-700">GitHub로 로그인</button>
      </form>
      {/* 주문하러 온 경우: 로그인 없이 비회원으로 주문 (쿠폰·포인트 없음) */}
      {returnTo.startsWith("/checkout") && (
        <div className="mt-6 border-t border-gray-200 pt-6 text-center">
          <Link href="/checkout?guest=1" className="block w-full rounded-lg border border-gray-300 py-3 font-medium text-gray-800 hover:bg-gray-50">
            비회원으로 주문하기
          </Link>
          <p className="mt-2 text-xs text-gray-500">비회원은 쿠폰·포인트를 쓸 수 없어요. 주문번호와 주문 비밀번호로 조회해요.</p>
        </div>
      )}
      <p className="mt-6 text-center text-sm">
        <Link href="/guest/orders" className="text-gray-500 underline">
          비회원 주문 조회
        </Link>
      </p>
    </main>
  );
}
