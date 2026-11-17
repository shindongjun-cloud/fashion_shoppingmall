// 로그인 후 돌아갈 주소 검사: 우리 사이트 안의 경로만 허용 (다른 사이트로 보내는 데 악용되는 것 방지)
// 로그인·오류 관련 경로는 무한 반복을 막기 위해 홈으로 바꿈
export function safeReturnPath(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return "/";
  try {
    if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
    const url = new URL(raw, "http://local.invalid");
    // 절대 주소면 우리 사이트(같은 호스트로 들어온 요청)인지 알 수 없으므로 경로만 사용
    const path = url.pathname + url.search;
    if (!path.startsWith("/") || path.startsWith("//")) return "/";
    if (path.startsWith("/login") || path.startsWith("/api/auth")) return "/";
    return path;
  } catch {
    return "/";
  }
}

/** 로그인 화면 주소 (로그인 후 돌아올 곳 포함) */
export const loginPath = (returnTo: string) => `/login?callbackUrl=${encodeURIComponent(safeReturnPath(returnTo))}`;
