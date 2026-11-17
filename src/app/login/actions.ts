"use server";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { signIn } from "@/auth";
import { BROWSER_COOKIE, REMEMBER_COOKIE } from "@/lib/auth-session";
import { safeReturnPath } from "@/lib/safe-redirect";

// "GitHub로 로그인" 버튼: 로그인 상태 유지 여부를 쿠키에 적어 두고 GitHub 로그인으로 보냄
// (GitHub에서 돌아와 세션을 만들 때 lib/auth-session.ts가 이 쿠키를 읽음)
export async function loginWithGitHub(formData: FormData) {
  const remember = formData.get("remember") === "on";
  const returnTo = safeReturnPath(formData.get("callbackUrl"));
  const store = await cookies();
  const secure = process.env.NODE_ENV === "production";
  store.set(REMEMBER_COOKIE, remember ? "1" : "0", { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 15 * 60 });
  if (remember) {
    store.delete(BROWSER_COOKIE);
  } else {
    // 만료 시각(maxAge·expires)을 주지 않음 → 브라우저를 닫으면 브라우저가 지우는 쿠키
    store.set(BROWSER_COOKIE, randomBytes(32).toString("base64url"), { httpOnly: true, sameSite: "lax", secure, path: "/" });
  }
  await signIn("github", { redirectTo: returnTo }); // 여기서 GitHub로 이동 (이후 코드는 실행되지 않음)
}
