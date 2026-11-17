import Link from "next/link";

// 로그인이 거부되었을 때 이유를 보여 주는 페이지 (auth.ts의 signIn 콜백, Auth.js 오류)
export default async function LoginBlockedPage({ searchParams }: PageProps<"/login-blocked">) {
  // reason: 우리가 막은 경우(auth.ts signIn 콜백) / error: Auth.js 자체 오류 코드 (Configuration 등)
  const { reason, error } = await searchParams;
  const message =
    reason === "suspended"
      ? "이용이 정지된 계정이에요. 고객센터로 문의해 주세요."
      : reason === "rejoin"
        ? "탈퇴한 계정은 30일 동안 다시 가입할 수 없어요."
        : error === "Configuration"
          ? "로그인 설정에 문제가 있어요. (GitHub 앱 키 등 서버 설정 오류 — 서버 로그를 확인하세요)"
          : "로그인하지 못했어요. 잠시 후 다시 시도해 주세요.";
  // 정지·재가입 제한이 아닌 경우, 원인을 찾을 수 있게 오류 코드를 같이 보여 줍니다
  const errorCode = !reason && typeof error === "string" ? error : null;

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-20 text-center">
      <h1 className="text-2xl font-bold text-gray-900">로그인할 수 없어요</h1>
      <p className="mt-3 text-gray-600">{message}</p>
      {errorCode && <p className="mt-2 text-sm text-gray-400">오류 코드: {errorCode}</p>}
      <Link href="/" className="mt-8 inline-block rounded-lg bg-gray-900 px-6 py-3 font-medium text-white hover:bg-gray-700">
        홈으로
      </Link>
    </main>
  );
}
