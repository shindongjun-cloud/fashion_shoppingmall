// 재고 처리 (서버 전용)
//
// 숫자(잔고)는 직접 고치지 않습니다. 이 파일은 "원장 행 추가"와 "예약 행 추가·상태 변경"만 하고,
// 잔고(onHand·reserved)는 DB 트리거가 맞춥니다(prisma/db-constraints.ts).
//
//   판매 가능 수량 = 실재고 − 예약 − 안전재고   (온라인 판매 위치 합계)
//
// 흐름:  주문 생성 → reserveOrder (RESERVED, 20분)
//        결제 승인 직전 → ensureOrderReserved (만료됐거나 곧 만료되면 다시 잡기)
//        결제 승인 후 → confirmOrder (CONFIRMED → 트리거가 판매 원장 SALE 생성 → 실재고 감소)
//        결제 실패·이탈 → releaseOrder (RELEASED)
//        시간 초과 → releaseExpired (EXPIRED)
import type { LedgerRefType, LedgerType, Prisma, ReleaseReason } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

export const RESERVATION_TTL_MINUTES = 20;
/** 결제 승인 직전에 예약 남은 시간이 이보다 짧으면 새로 잡습니다 (승인 도중 만료되는 것 방지) */
export const RENEW_IF_LESS_THAN_MS = 2 * 60 * 1000;

/** 재고 부족 (사용자에게 보여 줄 수 있는 오류) */
export class InsufficientStockError extends Error {
  constructor(
    public skuId: number,
    public requested: number,
    public available: number,
  ) {
    super(`재고 부족: SKU ${skuId} 요청 ${requested}개, 판매 가능 ${available}개`);
  }
}

/** DB 트리거·제약이 낸 오류인지 (메시지에 제약 이름이 들어 있음) */
export function isConstraintError(error: unknown, name: string) {
  const parts: string[] = [];
  let e: unknown = error;
  while (e instanceof Error) {
    parts.push(e.message, JSON.stringify((e as Error & { meta?: unknown }).meta ?? {}));
    e = (e as Error & { cause?: unknown }).cause;
  }
  return parts.join(" ").includes(name);
}

/**
 * DB 잠금 충돌(SQLite "database is locked", Prisma P1008)인지
 * 두 연결이 동시에 쓰려고 하면 한쪽이 약 5초 기다린 뒤 이 오류로 실패합니다.
 */
export function isBusyError(error: unknown) {
  const parts: string[] = [];
  let e: unknown = error;
  while (e instanceof Error) {
    const x = e as Error & { code?: string; meta?: unknown; cause?: unknown };
    parts.push(x.code ?? "", x.message, JSON.stringify(x.meta ?? {}));
    e = x.cause;
  }
  const text = parts.join(" ");
  return text.includes("SQLITE_BUSY") || text.includes("database is locked") || text.includes("P1008");
}

/**
 * 잠금 충돌이면 잠깐 쉬고 다시 시도합니다 (최대 attempts번).
 * 다시 시도하면 먼저 끝난 쪽의 결과(예: 다른 고객의 예약)를 보고 정상 처리되거나 "재고 부족"으로 끝납니다.
 * ⚠️ fn은 처음부터 다시 실행해도 안전해야 합니다 (트랜잭션 전체를 다시 실행하므로 OK).
 */
export async function withBusyRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!isBusyError(e) || i >= attempts) throw e;
      await new Promise((resolve) => setTimeout(resolve, 50 * i + Math.random() * 50));
    }
  }
}

const sellableLocationWhere ={ isOnlineSellable: true, isActive: true } satisfies Prisma.InventoryLocationWhereInput;

// ---------------------------------------------------------------
// 조회
// ---------------------------------------------------------------

/**
 * SKU별 판매 가능 수량 (화면 표시·사전 검사용, 읽기만 함)
 * 만료 시각이 지났지만 아직 정리되지 않은 예약은 빼고 계산합니다.
 * (실제 예약 때는 releaseExpired로 먼저 정리한 뒤 DB 트리거가 다시 검사하므로, 여기 값은 "안내용"입니다)
 */
export async function getAvailability(skuIds: number[], db: Db = prisma, now = new Date()): Promise<Map<number, number>> {
  const ids = [...new Set(skuIds)];
  const result = new Map<number, number>(ids.map((id) => [id, 0]));
  if (ids.length === 0) return result;

  const [balances, staleReservations] = await Promise.all([
    db.inventoryBalance.findMany({
      where: { skuId: { in: ids }, location: sellableLocationWhere },
      select: { skuId: true, locationId: true, onHand: true, reserved: true, safetyStock: true },
    }),
    db.inventoryReservation.groupBy({
      by: ["skuId", "locationId"],
      where: { skuId: { in: ids }, status: "RESERVED", expiresAt: { lte: now } },
      _sum: { qty: true },
    }),
  ]);
  for (const b of balances) {
    const stale = staleReservations.find((r) => r.skuId === b.skuId && r.locationId === b.locationId)?._sum.qty ?? 0;
    const available = Math.max(0, b.onHand - (b.reserved - stale) - b.safetyStock);
    result.set(b.skuId, (result.get(b.skuId) ?? 0) + available);
  }
  return result;
}

// ---------------------------------------------------------------
// 예약
// ---------------------------------------------------------------

/** 만료 시각이 지난 예약을 EXPIRED로 바꿔 재고를 풀어 줍니다. 바꾼 개수를 돌려줍니다. */
export async function releaseExpired(db: Db = prisma, now = new Date(), skuIds?: number[]) {
  const result = await db.inventoryReservation.updateMany({
    where: { status: "RESERVED", expiresAt: { lte: now }, ...(skuIds ? { skuId: { in: skuIds } } : {}) },
    data: { status: "EXPIRED", releasedAt: now },
  });
  return result.count;
}

/**
 * 주문의 SKU들을 예약합니다. 하나라도 부족하면 InsufficientStockError (트랜잭션 안에서 쓰면 전부 취소됨).
 * 한 SKU는 한 위치에서만 잡습니다 (위치 우선순위 순). 여러 위치에 나눠 잡는 것은 매장 단계에서 추가.
 */
export async function reserveOrder(
  tx: Prisma.TransactionClient,
  orderId: number,
  items: { skuId: number; qty: number }[],
  now = new Date(),
  /** 만료 시각 (기본: 지금 + 20분). 가상계좌는 입금 기한까지 잡아 둡니다 */
  expiresAt: Date = new Date(now.getTime() + RESERVATION_TTL_MINUTES * 60 * 1000),
) {
  const skuIds = items.map((i) => i.skuId);
  await releaseExpired(tx, now, skuIds); // 만료된 예약부터 정리해야 그 수량이 다시 팔 수 있게 됨

  const balances = await tx.inventoryBalance.findMany({
    where: { skuId: { in: skuIds }, location: sellableLocationWhere },
    include: { location: { select: { priority: true } } },
    orderBy: [{ location: { priority: "asc" } }, { locationId: "asc" }],
  });
  for (const item of items) {
    const candidates = balances.filter((b) => b.skuId === item.skuId);
    const totalAvailable = candidates.reduce((n, b) => n + Math.max(0, b.onHand - b.reserved - b.safetyStock), 0);
    const location = candidates.find((b) => b.onHand - b.reserved - b.safetyStock >= item.qty);
    if (!location) throw new InsufficientStockError(item.skuId, item.qty, totalAvailable);
    try {
      await tx.inventoryReservation.create({
        data: { orderId, skuId: item.skuId, locationId: location.locationId, qty: item.qty, expiresAt, createdAt: now },
      });
    } catch (e) {
      // 위에서 읽은 뒤 다른 주문이 먼저 잡은 경우: DB 트리거가 최종적으로 막아 줌
      if (isConstraintError(e, "InventoryReservation_insufficient")) {
        throw new InsufficientStockError(item.skuId, item.qty, 0);
      }
      throw e;
    }
  }
}

/** 주문의 RESERVED 예약을 해제합니다. */
export async function releaseOrder(db: Db, orderId: number, reason: ReleaseReason, now = new Date()) {
  const result = await db.inventoryReservation.updateMany({
    where: { orderId, status: "RESERVED" },
    data: { status: "RELEASED", releasedAt: now, releaseReason: reason },
  });
  return result.count;
}

/**
 * 결제 승인 "직전" 확인: 주문 수량만큼 유효한 예약이 있는지.
 * 만료됐거나 곧 만료되는 예약은 풀고 다시 잡습니다. 재고가 없으면 승인하면 안 됨 → { ok: false }
 */
/**
 * (트랜잭션 안에서) 주문 수량만큼 유효한 예약이 있게 맞춥니다. 재고가 없으면 InsufficientStockError.
 *  - minRemainingMs: 남은 시간이 이보다 짧으면 새로 잡음 (토스 승인처럼 시간이 걸리는 작업 전)
 *  - expiresAt: 새로 잡을 때의 만료 시각. 지정하면 기존 예약의 만료 시각이 이와 다를 때도 새로 잡음 (가상계좌 연장)
 */
export async function ensureReservedTx(
  tx: Prisma.TransactionClient,
  orderId: number,
  now = new Date(),
  options: { minRemainingMs?: number; expiresAt?: Date } = {},
) {
  const minRemaining = options.minRemainingMs ?? 0;
  const items = await tx.orderItem.findMany({ where: { orderId }, select: { skuId: true, quantity: true } });
  await releaseExpired(tx, now, items.map((i) => i.skuId));
  const active = await tx.inventoryReservation.findMany({ where: { orderId, status: "RESERVED" } });

  const ok = items.every((item) => {
    const r = active.find((a) => a.skuId === item.skuId);
    return (
      r &&
      r.qty === item.quantity &&
      r.expiresAt.getTime() - now.getTime() > minRemaining &&
      (!options.expiresAt || r.expiresAt.getTime() === options.expiresAt.getTime())
    );
  });
  if (ok && active.length === items.length) return;

  // 하나라도 문제가 있으면 남은 예약을 모두 풀고 처음부터 다시 잡습니다 (부분 갱신보다 단순하고 안전)
  await releaseOrder(tx, orderId, "RENEWED", now);
  await reserveOrder(tx, orderId, items.map((i) => ({ skuId: i.skuId, qty: i.quantity })), now, options.expiresAt);
}

export async function ensureOrderReserved(orderId: number, now = new Date()): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await withBusyRetry(() => prisma.$transaction((tx) => ensureReservedTx(tx, orderId, now, { minRemainingMs: RENEW_IF_LESS_THAN_MS - 1 })));
    return { ok: true };
  } catch (e) {
    if (e instanceof InsufficientStockError) {
      await releaseOrder(prisma, orderId, "PAYMENT_FAILED", now);
      return { ok: false, message: "결제를 기다리는 동안 재고가 소진되었어요. 결제는 진행되지 않았어요." };
    }
    throw e;
  }
}

/** 결제 승인 후: 주문의 예약을 모두 확정 (트리거가 판매 원장을 만들고 실재고를 줄임) */
export async function confirmOrder(tx: Prisma.TransactionClient, orderId: number, now = new Date()) {
  const items = await tx.orderItem.findMany({ where: { orderId }, select: { skuId: true, quantity: true } });
  const result = await tx.inventoryReservation.updateMany({
    where: { orderId, status: "RESERVED" },
    data: { status: "CONFIRMED", confirmedAt: now },
  });
  if (result.count !== items.length) {
    throw new Error(`예약 확정 개수(${result.count})가 주문 항목 수(${items.length})와 다릅니다`);
  }
}

// ---------------------------------------------------------------
// 입고·조정 (관리자 단계에서 화면을 붙일 함수)
// ---------------------------------------------------------------

/** 잔고 행이 없으면 0으로 만듭니다 (행은 0으로만 만들 수 있음) */
export async function ensureBalance(db: Db, skuId: number, locationId: number) {
  const existing = await db.inventoryBalance.findUnique({ where: { skuId_locationId: { skuId, locationId } } });
  return existing ?? db.inventoryBalance.create({ data: { skuId, locationId } });
}

/** 원장에 한 줄 추가 (입고 +, 조정 ± 등). balanceAfter는 직전 실재고 + qty로 계산하고 DB가 다시 검사합니다. */
export async function recordMovement(
  tx: Prisma.TransactionClient,
  input: {
    skuId: number;
    locationId: number;
    type: Exclude<LedgerType, "SALE">; // 판매는 예약 확정으로만
    qty: number;
    refType: LedgerRefType;
    refId?: string;
    reason?: string;
    memo?: string;
    createdBy?: string;
    occurredAt?: Date;
  },
) {
  const balance = await ensureBalance(tx, input.skuId, input.locationId);
  return tx.inventoryLedger.create({
    data: {
      skuId: input.skuId,
      locationId: input.locationId,
      type: input.type,
      qty: input.qty,
      balanceAfter: balance.onHand + input.qty,
      refType: input.refType,
      refId: input.refId,
      reason: input.reason,
      memo: input.memo,
      createdBy: input.createdBy ?? "SYSTEM",
      occurredAt: input.occurredAt ?? new Date(),
    },
  });
}
