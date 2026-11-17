import Link from "next/link";
import { cookies } from "next/headers";
import { loginPath, safeReturnPath } from "@/lib/safe-redirect";

// 로그인이 안 됐을 때 보여 주는 페이지
//  - reason: 우리가 막은 경우 (auth.ts signIn 콜백) → 다시 시도해도 소용없으므로 "다시 로그인" 버튼 없음
//  - error : Auth.js 자체 오류 (Configuration, AccessDenied 등) → 일시적일 수 있으니 "다시 로그인" 버튼 제공
//
// 다시 로그인하면 원래 가려던 페이지(예: /checkout)로 돌아가도록, Auth.js가 남긴 쿠키에서 주소를 읽습니다.
// 다른 사이트로 보내는 데 악용되지 않게 우리 사이트 안의 경로만 허용합니다 (lib/safe-redirect.ts).
export default async function LoginBlockedPage({ searchParams }: PageProps<"/login-blocked">) {
  const { reason, error } = await searchParams;
  const blocked = reason === "suspended" || reason === "rejoin";
  const message =
    reason === "suspended"
      ? "이용이 정지된 계정이에요. 고객센터로 문의해 주세요."
      : reason === "rejoin"
        ? "탈퇴한 계정은 30일 동안 다시 가입할 수 없어요."
        : error === "AccessDenied"
          ? "GitHub에서 로그인을 허용하지 않았어요. 다시 시도해 주세요."
          : error === "Configuration"
            ? "로그인 설정에 문제가 있어요. (GitHub 앱 키 등 서버 설정 오류 — 서버 로그를 확인하세요)"
            : "로그인하지 못했어요. 다시 시도해 주세요.";
  // 정지·재가입 제한이 아닌 경우, 원인을 찾을 수 있게 오류 코드를 같이 보여 줍니다
  const errorCode = !reason && typeof error === "string" ? error : null;

  const cookieStore = await cookies();
  const returnTo = safeReturnPath(
    cookieStore.get("__Secure-authjs.callback-url")?.value ?? cookieStore.get("authjs.callback-url")?.value,
  );

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-20 text-center">
      <h1 className="text-2xl font-bold text-gray-900">로그인할 수 없어요</h1>
      <p className="mt-3 text-gray-600">{message}</p>
      {errorCode && <p className="mt-2 text-sm text-gray-400">오류 코드: {errorCode}</p>}
      <div className="mt-8 flex justify-center gap-3">
        {!blocked && (
          <Link href={loginPath(returnTo)} className="rounded-lg bg-gray-900 px-6 py-3 font-medium text-white hover:bg-gray-700">
            다시 로그인
          </Link>
        )}
        <Link
          href="/"
          className={
            blocked
              ? "rounded-lg bg-gray-900 px-6 py-3 font-medium text-white hover:bg-gray-700"
              : "rounded-lg border border-gray-300 px-6 py-3 font-medium text-gray-700 hover:bg-gray-50"
          }
        >
          홈으로
        </Link>
      </div>
    </main>
  );
}
