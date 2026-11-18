// 비회원 주문 (서버 전용): 주문 비밀번호, 임시 출입증, 조회, 회원 계정으로 가져오기
//
//   주문할 때    : 비밀번호 해시 + 개인정보 동의 저장(GuestOrderAccess) + CHECKOUT 출입증(쿠키) → 결제창 → 완료 화면
//   나중에 조회  : 주문번호 + 비밀번호 → LOOKUP 출입증(30분) → 비회원 주문 상세
//   회원이 되면  : 로그인 후 주문번호 + 비밀번호(또는 같은 브라우저의 출입증)로 "내 계정으로 가져오기"
//
// 보안:
//  - 비밀번호는 scrypt 해시만 저장. 주문마다 연속 5번 틀리면 30분 잠금, 같은 IP는 1시간에 실패 20번이면 차단
//  - "주문번호가 없음 / 비밀번호가 틀림 / 잠김"은 같은 문구로 안내 (어떤 주문번호가 있는지 알아낼 수 없게)
//  - 출입증 쿠키에는 무작위 값, DB에는 그 해시만. 출입증은 그 주문 하나에만 통함
//  - 회원 계정으로 가져가면 그 주문의 비회원 출입증은 모두 무효
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import type { GuestAttemptPurpose, GuestAttemptResult, GuestSessionPurpose, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { blindIndex, maskIp } from "@/lib/crypto";
import { isConstraintError, withBusyRetry } from "@/lib/inventory";
import { ORDER_NO_PATTERN } from "@/lib/order-rules";

type Db = Prisma.TransactionClient | typeof prisma;

export const GUEST_COOKIE = "shop-guest-order"; // 비회원 출입증 쿠키 (httpOnly)
export const GUEST_PRIVACY_VERSION = "guest-order-2611"; // 비회원 개인정보 수집·이용 동의 문구 버전
export const GUEST_PASSWORD_MIN = 6;
export const GUEST_PASSWORD_MAX = 20;
export const GUEST_MAX_FAILS = 5; // 주문당 연속 실패 → 잠금
export const GUEST_LOCK_MINUTES = 30;
export const GUEST_IP_FAILS_PER_HOUR = 20; // 같은 IP 실패 한도
export const CHECKOUT_SESSION_MINUTES = 60; // 주문서 → 결제 → 완료(입금 대기 확인)까지
export const LOOKUP_SESSION_MINUTES = 30; // 조회 성공 후
export const GUEST_ATTEMPT_RETENTION_DAYS = 90;
const MIN = 60 * 1000;

/** 사용자에게 보여 줄 수 있는 비회원 주문 오류 */
export class GuestError extends Error {}

// ---------------------------------------------------------------
// 비밀번호
// ---------------------------------------------------------------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize("NFKC"), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}
/** 규칙: 6~20자, 공백 없이 (숫자만도 허용). 문제가 있으면 안내 문구 */
export function guestPasswordProblem(password: unknown, confirm?: unknown): string | null {
  if (typeof password !== "string" || password.length < GUEST_PASSWORD_MIN || password.length > GUEST_PASSWORD_MAX) {
    return `주문 비밀번호는 ${GUEST_PASSWORD_MIN}~${GUEST_PASSWORD_MAX}자로 입력해 주세요.`;
  }
  if (/\s/.test(password)) return "주문 비밀번호에 공백은 쓸 수 없어요.";
  if (/^(.)\1+$/.test(password)) return "같은 글자만 반복한 비밀번호는 쓸 수 없어요.";
  if ("01234567890123456789".includes(password) || "98765432109876543210".includes(password)) return "연속된 숫자(123456 등)는 쓸 수 없어요.";
  if (confirm !== undefined && password !== confirm) return "주문 비밀번호 확인이 일치하지 않아요.";
  return null;
}
export async function hashGuestPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `s1:${salt.toString("base64")}:${(await scrypt(password, salt)).toString("base64")}`;
}
export async function verifyGuestPassword(password: string, stored: string | null): Promise<boolean> {
  // 저장값이 없어도 같은 시간을 쓰도록 계산은 함 (응답 시간으로 주문 존재 여부를 알아내지 못하게)
  const [, saltB64, hashB64] = (stored ?? "s1:AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=").split(":");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"));
  const expected = Buffer.from(hashB64, "base64");
  return stored !== null && expected.length === actual.length && timingSafeEqual(actual, expected);
}

// ---------------------------------------------------------------
// 출입증 (쿠키 값 = 무작위 토큰, DB = 해시)
// ---------------------------------------------------------------
export const hashGuestToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createGuestSession(db: Db, orderId: number, purpose: GuestSessionPurpose, now: Date, ip?: string | null) {
  const token = randomBytes(32).toString("base64url");
  const minutes = purpose === "CHECKOUT" ? CHECKOUT_SESSION_MINUTES : LOOKUP_SESSION_MINUTES;
  await db.guestOrderSession.create({
    data: { orderId, tokenHash: hashGuestToken(token), purpose, expiresAt: new Date(now.getTime() + minutes * MIN), ipMasked: maskIp(ip), createdAt: now },
  });
  return { token, maxAgeSeconds: minutes * 60 };
}

/** 쿠키의 출입증 → 그 주문 id (만료·무효·회원 계정으로 옮긴 주문이면 null) */
export async function findGuestOrderId(token: string | undefined | null, now = new Date()): Promise<number | null> {
  if (!token || token.length > 100) return null;
  const s = await prisma.guestOrderSession.findUnique({ where: { tokenHash: hashGuestToken(token) }, include: { order: { select: { customerId: true, ordererType: true } } } });
  if (!s || s.revokedAt || s.expiresAt <= now || s.order.ordererType !== "GUEST" || s.order.customerId !== null) return null;
  return s.orderId;
}

export async function revokeGuestSessions(db: Db, orderId: number, now: Date) {
  await db.guestOrderSession.updateMany({ where: { orderId, revokedAt: null, expiresAt: { gt: now } }, data: { revokedAt: now } });
}

// ---------------------------------------------------------------
// 조회 (주문번호 + 비밀번호)
// ---------------------------------------------------------------
export type GuestCheckResult =
  | { ok: true; orderId: number }
  | { ok: false; reason: "WRONG" | "RATE_LIMITED" | "CLAIMED" };

async function recordAttempt(
  purpose: GuestAttemptPurpose,
  result: GuestAttemptResult,
  orderNoInput: string,
  ip: string | null | undefined,
  now: Date,
  extra: { orderId?: number; customerId?: number } = {},
) {
  await withBusyRetry(() =>
    prisma.guestLookupAttempt.create({
      data: {
        purpose,
        result,
        orderNoInput: ORDER_NO_PATTERN.test(orderNoInput) ? orderNoInput : "INVALID",
        orderId: extra.orderId ?? null,
        customerId: extra.customerId ?? null,
        ipHash: blindIndex("ip", ip?.trim() || "unknown"),
        ipMasked: maskIp(ip),
        attemptedAt: now,
      },
    }),
  );
}

/**
 * 주문번호 + 비밀번호 확인 (조회·가져오기 공통). 틀리면 실패 횟수를 올리고, 5번째에 30분 잠금
 * "주문 없음·비밀번호 틀림·잠김"은 모두 WRONG (같은 안내)
 */
export async function checkGuestPassword(input: {
  purpose: GuestAttemptPurpose;
  orderNo: unknown;
  password: unknown;
  ip?: string | null;
  customerId?: number;
  now?: Date;
}): Promise<GuestCheckResult> {
  const now = input.now ?? new Date();
  const orderNo = typeof input.orderNo === "string" ? input.orderNo.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const ipHash = blindIndex("ip", input.ip?.trim() || "unknown");
  const who = { customerId: input.customerId };

  // 같은 IP의 최근 1시간 실패가 많으면 비밀번호를 확인하지 않고 거절 (무작위 대입 차단)
  const recentFails = await prisma.guestLookupAttempt.count({ where: { ipHash, result: { not: "SUCCESS" }, attemptedAt: { gt: new Date(now.getTime() - 60 * MIN) } } });
  if (recentFails >= GUEST_IP_FAILS_PER_HOUR) {
    await recordAttempt(input.purpose, "RATE_LIMITED", orderNo, input.ip, now, who);
    return { ok: false, reason: "RATE_LIMITED" };
  }

  const order = ORDER_NO_PATTERN.test(orderNo) ? await prisma.order.findUnique({ where: { orderNo }, include: { guestAccess: true } }) : null;
  const access = order?.ordererType === "GUEST" ? order.guestAccess : null;
  const matched = await verifyGuestPassword(password, access?.passwordHash ?? null); // 주문이 없어도 같은 시간 소요
  if (!order || !access) {
    await recordAttempt(input.purpose, "WRONG", orderNo, input.ip, now, who);
    return { ok: false, reason: "WRONG" };
  }
  if (access.lockedUntil && access.lockedUntil > now) {
    await recordAttempt(input.purpose, "LOCKED", orderNo, input.ip, now, { ...who, orderId: order.id });
    return { ok: false, reason: "WRONG" };
  }
  if (!matched) {
    // 실패 횟수 +1 (동시에 틀려도 정확히 세도록 DB에서 더함). 5번째면 잠그고 0부터 다시
    await withBusyRetry(() =>
      prisma.$transaction(async (tx) => {
        const a = await tx.guestOrderAccess.update({ where: { orderId: order.id }, data: { failedCount: { increment: 1 }, lastFailedAt: now } });
        if (a.failedCount >= GUEST_MAX_FAILS) {
          await tx.guestOrderAccess.update({ where: { orderId: order.id }, data: { failedCount: 0, lockedUntil: new Date(now.getTime() + GUEST_LOCK_MINUTES * MIN) } });
        }
      }),
    );
    await recordAttempt(input.purpose, "WRONG", orderNo, input.ip, now, { ...who, orderId: order.id });
    return { ok: false, reason: "WRONG" };
  }
  // 비밀번호가 맞음
  await withBusyRetry(() => prisma.guestOrderAccess.update({ where: { orderId: order.id }, data: { failedCount: 0, lockedUntil: null, lastAccessAt: now } }));
  if (access.claimedAt) {
    await recordAttempt(input.purpose, "CLAIMED_ALREADY", orderNo, input.ip, now, { ...who, orderId: order.id });
    return { ok: false, reason: "CLAIMED" };
  }
  await recordAttempt(input.purpose, "SUCCESS", orderNo, input.ip, now, { ...who, orderId: order.id });
  return { ok: true, orderId: order.id };
}

/** 비회원 조회: 비밀번호가 맞으면 LOOKUP 출입증 발급 */
export async function lookupGuestOrder(input: { orderNo: unknown; password: unknown; ip?: string | null; now?: Date }) {
  const now = input.now ?? new Date();
  const r = await checkGuestPassword({ ...input, purpose: "LOOKUP", now });
  if (!r.ok) return r;
  const session = await createGuestSession(prisma, r.orderId, "LOOKUP", now, input.ip);
  return { ...r, ...session };
}

// ---------------------------------------------------------------
// 회원 계정으로 가져오기
// ---------------------------------------------------------------
export type ClaimCode = "DONE" | "WRONG" | "RATE_LIMITED" | "CLAIMED" | "NOT_CLAIMABLE" | "NOT_ACTIVE";

/**
 * 비회원 주문 → 회원 주문. 본인 확인은 둘 중 하나:
 *  ① 주문번호 + 주문 비밀번호   ② 같은 브라우저의 유효한 비회원 출입증(이미 비밀번호를 확인했거나 그 브라우저에서 주문함)
 * 주문 당시 사실(비회원으로 주문, 주문자 정보, 쿠폰·포인트 0)은 그대로 두고, 주인만 회원으로 바꿈
 */
export async function claimGuestOrder(input: {
  customerId: number;
  orderNo?: unknown;
  password?: unknown;
  sessionToken?: string | null;
  ip?: string | null;
  now?: Date;
}): Promise<{ code: ClaimCode; orderNo?: string }> {
  const now = input.now ?? new Date();
  let orderId: number | null = null;
  if (input.sessionToken) {
    orderId = await findGuestOrderId(input.sessionToken, now);
    // 출입증의 주문과 입력한 주문번호가 다르면 출입증으로는 인정하지 않음
    if (orderId !== null && typeof input.orderNo === "string" && input.orderNo) {
      const o = await prisma.order.findUnique({ where: { id: orderId }, select: { orderNo: true } });
      if (o?.orderNo !== input.orderNo.trim()) orderId = null;
    }
  }
  if (orderId === null) {
    const r = await checkGuestPassword({ purpose: "CLAIM", orderNo: input.orderNo, password: input.password, ip: input.ip, customerId: input.customerId, now });
    if (!r.ok) return { code: r.reason };
    orderId = r.orderId;
  } else {
    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { orderNo: true } });
    await recordAttempt("CLAIM", "SUCCESS", o.orderNo, input.ip, now, { orderId, customerId: input.customerId });
  }
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.status === "PENDING") return { code: "NOT_CLAIMABLE", orderNo: order.orderNo }; // 결제 전 주문
  try {
    await withBusyRetry(() =>
      prisma.$transaction(async (tx) => {
        // 가져오기 기록 → 주문의 주인 (트리거가 두 값이 같은지 확인) → 비회원 출입증 무효
        await tx.guestOrderAccess.update({ where: { orderId: order.id }, data: { claimedAt: now, claimedByCustomerId: input.customerId } });
        await tx.order.update({ where: { id: order.id }, data: { customerId: input.customerId, linkedAt: now, updatedAt: now } });
        await revokeGuestSessions(tx, order.id, now);
      }),
    );
  } catch (e) {
    if (isConstraintError(e, "GuestOrderAccess_claim_once") || isConstraintError(e, "이미 회원 주문")) return { code: "CLAIMED", orderNo: order.orderNo };
    if (isConstraintError(e, "정상(ACTIVE) 회원만")) return { code: "NOT_ACTIVE", orderNo: order.orderNo };
    throw e;
  }
  return { code: "DONE", orderNo: order.orderNo };
}

// ---------------------------------------------------------------
// 정기 작업
// ---------------------------------------------------------------
/** 만료·무효 출입증 삭제 + 90일 지난 시도 기록 삭제 */
export async function cleanupGuestRecords(now = new Date()) {
  const sessions = await prisma.guestOrderSession.deleteMany({ where: { OR: [{ expiresAt: { lte: now } }, { revokedAt: { not: null } }] } });
  const attempts = await prisma.guestLookupAttempt.deleteMany({ where: { attemptedAt: { lt: new Date(now.getTime() - (GUEST_ATTEMPT_RETENTION_DAYS * 24 * 60 + 1) * MIN) } } });
  return { sessions: sessions.count, attempts: attempts.count };
}
