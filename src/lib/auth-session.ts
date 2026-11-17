// 로그인 유지 정책 (서버 전용)
//
//  "로그인 상태 유지" 체크함   → 30일 유지, 사이트를 쓰는 날마다 30일로 연장 (Auth.js 기본 동작)
//  "로그인 상태 유지" 체크 안 함 → ① 브라우저를 닫으면 로그아웃  ② 쓰는 중이어도 로그인 후 12시간이 지나면 로그아웃
//
// 어떻게:
//  - 로그인 버튼(서버 액션)에서 쿠키 2개를 심음 (app/login/actions.ts)
//      shop-login-remember  : "1"(유지) / "0"(유지 안 함) — 15분짜리, 로그인 처리 때 읽음
//      shop-browser-session : 무작위 값, 만료 시각이 없는 쿠키 → 브라우저를 닫으면 브라우저가 지움
//  - Auth.js가 세션을 만들 때(createSession) 체크 여부를 보고, 유지 안 함이면
//      Session.absoluteExpiresAt = 지금 + 12시간, Session.browserKeyHash = 브라우저 쿠키 값의 해시
//  - 로그인 확인 때마다(getSessionAndUser) 12시간이 지났거나 브라우저 쿠키가 없으면/다르면 세션을 지우고 로그아웃 처리
//  - 세션 연장(updateSession)은 12시간을 넘지 못하게 자름
// ⚠️ 탭만 닫는 것은 로그아웃되지 않음 (브라우저 전체를 닫아야 함). 크롬 "중단한 부분부터 계속" 설정이면 쿠키가 살아날 수 있어 12시간 상한을 둠
import { createHash } from "node:crypto";
import type { Adapter, AdapterSession } from "next-auth/adapters";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export const REMEMBER_COOKIE = "shop-login-remember";
export const BROWSER_COOKIE = "shop-browser-session";
export const SHORT_SESSION_MS = 12 * 60 * 60 * 1000;

export const hashBrowserKey = (value: string) => createHash("sha256").update(value).digest("hex");

export type LoginPolicyDeps = {
  /** 요청 쿠키 읽기 (테스트에서 바꿔 끼움) */
  readCookie: (name: string) => Promise<string | undefined>;
  now: () => Date;
};

const defaultDeps: LoginPolicyDeps = {
  readCookie: async (name) => {
    try {
      return (await cookies()).get(name)?.value;
    } catch {
      return undefined; // 요청 밖(스크립트 등)에서 불린 경우
    }
  },
  now: () => new Date(),
};

type SessionRow = AdapterSession & { absoluteExpiresAt?: Date | null; browserKeyHash?: string | null };

export function withLoginPolicy(adapter: Adapter, deps: LoginPolicyDeps = defaultDeps): Adapter {
  const { createSession, getSessionAndUser, updateSession, deleteSession } = adapter;
  if (!createSession || !getSessionAndUser || !updateSession || !deleteSession) throw new Error("세션 함수가 없는 어댑터입니다");

  return {
    ...adapter,

    async createSession(data) {
      // 체크했을 때만 30일. 쿠키가 없으면(로그인 화면을 거치지 않음) 안전한 쪽 = 유지 안 함
      if ((await deps.readCookie(REMEMBER_COOKIE)) === "1") return createSession(data);
      const now = deps.now();
      const absolute = new Date(now.getTime() + SHORT_SESSION_MS);
      const browserKey = await deps.readCookie(BROWSER_COOKIE);
      const row = await prisma.session.create({
        data: {
          sessionToken: data.sessionToken,
          userId: data.userId,
          expires: data.expires < absolute ? data.expires : absolute,
          absoluteExpiresAt: absolute,
          browserKeyHash: browserKey ? hashBrowserKey(browserKey) : null,
        },
      });
      return { sessionToken: row.sessionToken, userId: row.userId, expires: row.expires };
    },

    async getSessionAndUser(sessionToken) {
      const found = await getSessionAndUser(sessionToken);
      if (!found) return found;
      const session = found.session as SessionRow;
      if (!session.absoluteExpiresAt) return found; // 로그인 상태 유지

      const now = deps.now();
      const browserKey = await deps.readCookie(BROWSER_COOKIE);
      const timeUp = now.getTime() >= session.absoluteExpiresAt.getTime();
      const browserClosed = session.browserKeyHash != null && (!browserKey || hashBrowserKey(browserKey) !== session.browserKeyHash);
      if (timeUp || browserClosed) {
        try {
          await deleteSession(sessionToken);
        } catch {
          // 이미 지워졌으면 무시 (동시에 두 요청이 지우는 경우)
        }
        return null; // Auth.js가 로그인 쿠키도 지움
      }
      // 쿠키 만료 시각도 12시간 상한에 맞춤
      const expires = session.expires < session.absoluteExpiresAt ? session.expires : session.absoluteExpiresAt;
      return { ...found, session: { ...found.session, expires } };
    },

    async updateSession(data) {
      if (data.expires) {
        const row = await prisma.session.findUnique({ where: { sessionToken: data.sessionToken }, select: { absoluteExpiresAt: true } });
        if (row?.absoluteExpiresAt && data.expires > row.absoluteExpiresAt) {
          return updateSession({ ...data, expires: row.absoluteExpiresAt }); // 12시간을 넘겨 연장하지 않음
        }
      }
      return updateSession(data);
    },
  };
}
