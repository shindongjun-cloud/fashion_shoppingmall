// 주문 공통 규칙 (서버 전용): 주문번호, 상태 변경 값, 배송비 계산
// checkout.ts(주문 생성) · payment.ts(결제) · order.ts(주문 처리)가 함께 씁니다. (서로 import하면 순환이 생겨 따로 둠)
import { randomInt } from "node:crypto";
import type { OrderActor, OrderItemStatus, OrderStatus, Prisma, ShippingRegion } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

/** 배송 완료 후 자동 구매확정까지 (DB 트리거 Shipment_cascade와 같은 값 — 테스트가 비교) */
export const AUTO_CONFIRM_DAYS = 7;
/** 주문자·배송지 개인정보 보관 기간 (전자상거래법: 계약·대금결제 기록 5년) */
export const PII_RETENTION_DAYS = 365 * 5;
const DAY = 24 * 60 * 60 * 1000;

/** 사용자에게 보여 줄 수 있는 주문 처리 오류 */
export class OrderError extends Error {}

// ---------------------------------------------------------------
// 주문번호: "20261118-48213907" (한국 날짜 + 무작위 8자리)
// 순서대로 매기면(000123) 하루 주문 수가 드러나고 다른 번호를 짐작하기 쉬워서 무작위로 붙입니다.
// ---------------------------------------------------------------
export function kstDateCode(now: Date) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10).replaceAll("-", "");
}
export function generateOrderNo(now: Date) {
  return `${kstDateCode(now)}-${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
}
export const ORDER_NO_PATTERN = /^\d{8}-\d{8}$/;

// ---------------------------------------------------------------
// 상태 변경 값: 상태를 바꿀 때는 반드시 이 함수로 (트리거가 이 값들로 이력을 남김)
// ---------------------------------------------------------------
export function orderStatusData(status: OrderStatus, now: Date, by: OrderActor = "SYSTEM", memo: string | null = null) {
  return { status, statusChangedAt: now, statusChangedBy: by, statusMemo: memo ? memo.slice(0, 200) : null, updatedAt: now };
}
export function itemStatusData(status: OrderItemStatus, now: Date, by: OrderActor, memo: string | null = null) {
  return { status, statusChangedAt: now, statusChangedBy: by, statusMemo: memo ? memo.slice(0, 200) : null };
}

// ---------------------------------------------------------------
// 배송비
//   기본 배송비: 쿠폰 적용 전 판매가 합계가 무료 기준 이상이면 0
//   추가 배송비(제주·도서산간): 무료배송이어도 붙음
// ---------------------------------------------------------------
export type ShippingPolicyRule = { id: number; baseFee: number; freeShippingThreshold: number | null };
export type ShippingZone = { region: ShippingRegion; extraFee: number; name: string } | null;
export type ShippingQuote = {
  policyId: number;
  baseFee: number;
  extraFee: number;
  fee: number;
  threshold: number | null;
  region: ShippingRegion;
  zoneName: string | null;
  /** 무료배송까지 남은 금액 (이미 무료거나 무료 기준이 없으면 0) */
  remainingForFree: number;
};

/** 순수 계산 (DB 없이 테스트 가능) */
export function computeShipping(policy: ShippingPolicyRule, zone: ShippingZone, itemsTotal: number): ShippingQuote {
  const free = policy.freeShippingThreshold !== null && itemsTotal >= policy.freeShippingThreshold;
  const baseFee = free ? 0 : policy.baseFee;
  const extraFee = zone?.extraFee ?? 0;
  return {
    policyId: policy.id,
    baseFee,
    extraFee,
    fee: baseFee + extraFee,
    threshold: policy.freeShippingThreshold,
    region: zone?.region ?? "NORMAL",
    zoneName: zone?.name ?? null,
    remainingForFree: policy.freeShippingThreshold !== null && !free ? policy.freeShippingThreshold - itemsTotal : 0,
  };
}

/** 지금 적용 중인 배송비 규칙 (없으면 주문 불가 — 설정 오류) */
export async function currentShippingPolicy(db: Db, now: Date) {
  const policy = await db.shippingPolicy.findFirst({
    where: { validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] },
    orderBy: { validFrom: "desc" },
  });
  if (!policy) throw new OrderError("배송비 규칙이 설정되지 않아 지금은 주문할 수 없어요.");
  return policy;
}

/** 규칙에서 우편번호의 추가 배송 지역 찾기 */
export async function findZone(db: Db, policyId: number, zipCode: string): Promise<ShippingZone> {
  const z = await db.shippingSurchargeZone.findFirst({ where: { policyId, zipFrom: { lte: zipCode }, zipTo: { gte: zipCode } } });
  return z ? { region: z.region, extraFee: z.extraFee, name: z.name } : null;
}

export async function quoteShipping(db: Db, itemsTotal: number, zipCode: string, now: Date): Promise<ShippingQuote> {
  const policy = await currentShippingPolicy(db, now);
  return computeShipping(policy, await findZone(db, policy.id, zipCode), itemsTotal);
}

export const autoConfirmAt = (deliveredAt: Date) => new Date(deliveredAt.getTime() + AUTO_CONFIRM_DAYS * DAY);
export const piiPurgeCutoff = (now: Date) => new Date(now.getTime() - PII_RETENTION_DAYS * DAY);
