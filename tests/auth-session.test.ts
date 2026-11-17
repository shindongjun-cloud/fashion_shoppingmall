// 로그인 유지 정책 테스트 (임시 DB 복사본)
// "로그인 상태 유지" 체크 → 30일·사용 시 연장 / 체크 안 함 → 브라우저 종료 시 로그아웃 + 최대 12시간
import { removeTempDb } from "./helpers/temp-db"; // ⚠️ 반드시 첫 줄
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "../src/lib/prisma";
import { BROWSER_COOKIE, hashBrowserKey, REMEMBER_COOKIE, SHORT_SESSION_MS, withLoginPolicy } from "../src/lib/auth-session";
import { loginPath, safeReturnPath } from "../src/lib/safe-redirect";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const THIRTY_DAYS = 30 * DAY;

after(async () => {
  await prisma.$disconnect();
  removeTempDb();
});

/** 쿠키와 시계를 바꿔 끼울 수 있는 어댑터 */
function setup(cookies: Record<string, string | undefined>, now = new Date()) {
  const state = { cookies: { ...cookies }, now };
  const adapter = withLoginPolicy(PrismaAdapter(prisma), {
    readCookie: async (name) => state.cookies[name],
    now: () => state.now,
  });
  return { adapter, state };
}
async function newLogin(cookies: Record<string, string | undefined>, now = new Date()) {
  const user = await prisma.user.create({ data: { name: "로그인테스트" } });
  const { adapter, state } = setup(cookies, now);
  const token = `tok_${Math.random().toString(36).slice(2)}`;
  // Auth.js가 넘기는 값: 만료 = 지금 + 30일
  const created = await adapter.createSession!({ sessionToken: token, userId: user.id, expires: new Date(now.getTime() + THIRTY_DAYS) });
  return { adapter, state, token, created, user };
}
const row = (token: string) => prisma.session.findUnique({ where: { sessionToken: token } });

describe("로그인 상태 유지 체크함", () => {
  test("30일 유지, 12시간 상한·브라우저 쿠키 없음, 브라우저를 닫아도(쿠키 없어도) 로그인 유지", async () => {
    const now = new Date();
    const { adapter, state, token, created } = await newLogin({ [REMEMBER_COOKIE]: "1" }, now);
    assert.equal(created.expires.getTime(), now.getTime() + THIRTY_DAYS);
    const r = await row(token);
    assert.deepEqual([r!.absoluteExpiresAt, r!.browserKeyHash], [null, null]);
    state.cookies = {}; // 브라우저를 닫았다 다시 엶
    state.now = new Date(now.getTime() + 13 * HOUR);
    assert.ok(await adapter.getSessionAndUser!(token), "12시간이 지나도 유지");
  });

  test("사용하면 30일로 연장 (Auth.js 기본 동작 그대로)", async () => {
    const now = new Date();
    const { adapter, token } = await newLogin({ [REMEMBER_COOKIE]: "1" }, now);
    const later = new Date(now.getTime() + 20 * DAY + THIRTY_DAYS);
    await adapter.updateSession!({ sessionToken: token, expires: later });
    assert.equal((await row(token))!.expires.getTime(), later.getTime());
  });
});

describe("로그인 상태 유지 체크 안 함", () => {
  test("세션은 12시간짜리, 브라우저 쿠키는 해시로만 저장", async () => {
    const now = new Date();
    const { created, token } = await newLogin({ [REMEMBER_COOKIE]: "0", [BROWSER_COOKIE]: "browser-key-1" }, now);
    assert.equal(created.expires.getTime(), now.getTime() + SHORT_SESSION_MS, "로그인 쿠키 만료도 12시간");
    const r = await row(token);
    assert.equal(r!.absoluteExpiresAt!.getTime(), now.getTime() + SHORT_SESSION_MS);
    assert.equal(r!.browserKeyHash, hashBrowserKey("browser-key-1"));
    assert.notEqual(r!.browserKeyHash, "browser-key-1", "원래 값은 저장하지 않음");
  });

  test("같은 브라우저(쿠키 있음)에서는 로그인 유지", async () => {
    const { adapter, token, user } = await newLogin({ [REMEMBER_COOKIE]: "0", [BROWSER_COOKIE]: "k2" });
    const found = await adapter.getSessionAndUser!(token);
    assert.equal(found?.user.id, user.id);
  });

  test("브라우저를 닫았다 열면(쿠키 사라짐) 로그아웃 + 세션 삭제", async () => {
    const { adapter, state, token } = await newLogin({ [REMEMBER_COOKIE]: "0", [BROWSER_COOKIE]: "k3" });
    state.cookies = {}; // 만료 시각 없는 쿠키는 브라우저가 닫힐 때 지워짐
    assert.equal(await adapter.getSessionAndUser!(token), null);
    assert.equal(await row(token), null, "세션도 지워짐 (다시 쓸 수 없음)");
  });

  test("쿠키 값이 다르면(다른 브라우저로 로그인 쿠키만 복사) 로그아웃", async () => {
    const { adapter, state, token } = await newLogin({ [REMEMBER_COOKIE]: "0", [BROWSER_COOKIE]: "k4" });
    state.cookies = { [BROWSER_COOKIE]: "other" };
    assert.equal(await adapter.getSessionAndUser!(token), null);
  });

  test("사용 중이어도 로그인 후 12시간이 지나면 로그아웃", async () => {
    const now = new Date();
    const { adapter, state, token } = await newLogin({ [REMEMBER_COOKIE]: "0", [BROWSER_COOKIE]: "k5" }, now);
    state.now = new Date(now.getTime() + SHORT_SESSION_MS - 1000);
    assert.ok(await adapter.getSessionAndUser!(token), "11시간 59분 59초: 유지");
    state.now = new Date(now.getTime() + SHORT_SESSION_MS);
    assert.equal(await adapter.getSessionAndUser!(token), null, "12시간: 로그아웃");
    assert.equal(await row(token), null);
  });

  test("사용할 때마다 연장해도 12시간을 넘지 않음", async () => {
    const now = new Date();
    const { adapter, token } = await newLogin({ [REMEMBER_COOKIE]: "0", [BROWSER_COOKIE]: "k6" }, now);
    await adapter.updateSession!({ sessionToken: token, expires: new Date(now.getTime() + THIRTY_DAYS) });
    assert.equal((await row(token))!.expires.getTime(), now.getTime() + SHORT_SESSION_MS);
  });

  test("로그인 화면을 거치지 않아 선택 쿠키가 없으면 안전한 쪽(유지 안 함, 12시간)", async () => {
    const now = new Date();
    const { token } = await newLogin({}, now);
    const r = await row(token);
    assert.equal(r!.absoluteExpiresAt!.getTime(), now.getTime() + SHORT_SESSION_MS);
    assert.equal(r!.browserKeyHash, null, "브라우저 쿠키가 없으면 12시간 상한만 적용");
  });
});

describe("로그인 후 돌아갈 주소 검사", () => {
  test("우리 사이트 경로만 허용, 외부·로그인 관련 주소는 홈으로", () => {
    assert.equal(safeReturnPath("/checkout"), "/checkout");
    assert.equal(safeReturnPath("/api/payments/confirm?paymentKey=a&orderId=b&amount=1"), "/api/payments/confirm?paymentKey=a&orderId=b&amount=1");
    assert.equal(safeReturnPath("https://evil.example/steal"), "/steal", "다른 사이트 주소는 경로만 남김");
    assert.equal(safeReturnPath("//evil.example"), "/");
    assert.equal(safeReturnPath("/\\evil.example"), "/");
    assert.equal(safeReturnPath("/login?callbackUrl=/x"), "/", "로그인 화면으로 돌아가는 반복 방지");
    assert.equal(safeReturnPath("/api/auth/signout"), "/");
    assert.equal(safeReturnPath(undefined), "/");
    assert.equal(safeReturnPath(["/a"]), "/");
    assert.equal(loginPath("/checkout"), "/login?callbackUrl=%2Fcheckout");
  });
});
