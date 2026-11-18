// 재입고 예정일·재입고 알림 (서버 전용)
//
//   재입고 예정일 = 확정(또는 일부 입고)된 발주 줄 중 아직 다 안 들어온 줄의 가장 빠른 예정일 (저장하지 않고 계산 → 어긋날 일이 없음)
//   알림 신청(회원, 품절일 때만) → syncRestock(SKU)가 상황에 맞춰 알림:
//     판매 가능 수량 > 0           → "재입고됐어요" (끝)
//     품절 + 예정일 있음           → "n월 n일 재입고 예정" (예정일이 바뀌면 "예정일 변경")
//     품절 + 예정일 없어짐(발주 취소) → "재입고 일정 취소" (다시 대기)
//   syncRestock은 발주 확정·날짜 변경·취소·입고·반품 복귀 때 바로, 그리고 정기 작업으로 한 번 더 (주문 취소로 재고가 풀린 경우 등)
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getAvailability, withBusyRetry } from "@/lib/inventory";
import { notify } from "@/lib/notification";
import { formatDate } from "@/lib/format";

type Db = Prisma.TransactionClient | typeof prisma;
const DAY = 24 * 60 * 60 * 1000;
export const RESTOCK_SUBSCRIPTION_DAYS = 90;
/** 재입고 안내 뒤 이 기간 안에 사면 "구매함"으로 기록 (알림 효과 확인용) */
export const RESTOCK_PURCHASE_WINDOW_DAYS = 30;

export class RestockError extends Error {}

/** SKU별 재입고 예정일 (확정된 발주가 없으면 없음) */
export async function restockDates(skuIds: number[], db: Db = prisma): Promise<Map<number, Date>> {
  const lines = await db.purchaseOrderLine.findMany({
    where: { skuId: { in: [...new Set(skuIds)] }, expectedAt: { not: null }, purchaseOrder: { status: { in: ["CONFIRMED", "PARTIALLY_RECEIVED"] } } },
    select: { skuId: true, expectedAt: true, qtyOrdered: true, qtyReceived: true },
  });
  const result = new Map<number, Date>();
  for (const l of lines) {
    if (l.qtyReceived >= l.qtyOrdered || !l.expectedAt) continue; // 다 들어온 줄은 제외
    const cur = result.get(l.skuId);
    if (!cur || l.expectedAt < cur) result.set(l.skuId, l.expectedAt);
  }
  return result;
}

async function skuLabel(db: Db, skuId: number) {
  const k = await db.sku.findUniqueOrThrow({ where: { id: skuId }, include: { size: true, styleColor: { include: { color: true, style: true } } } });
  return { text: `${k.styleColor.style.name} (${k.styleColor.color.name}/${k.size.label})`, link: `/products/${k.styleColor.style.styleCode}?color=${k.styleColor.color.code}` };
}

/** 재입고 알림 신청 (회원, 품절일 때만) */
export async function subscribeRestock(customerId: number, skuId: number, now = new Date()) {
  const sku = await prisma.sku.findUnique({ where: { id: skuId } });
  if (!sku) throw new RestockError("상품을 찾을 수 없어요.");
  const available = (await getAvailability([skuId])).get(skuId) ?? 0;
  if (available > 0) throw new RestockError("지금 구매할 수 있는 상품이에요.");
  const open = await prisma.restockSubscription.findFirst({ where: { customerId, skuId, status: { in: ["WAITING", "SCHEDULED"] } } });
  if (open) return open; // 이미 신청함 (두 번 눌러도 같은 결과)
  const sub = await withBusyRetry(() =>
    prisma.restockSubscription.create({ data: { customerId, skuId, expiresAt: new Date(now.getTime() + RESTOCK_SUBSCRIPTION_DAYS * DAY), createdAt: now } }),
  );
  await syncRestock(skuId, now); // 이미 예정일이 있으면 바로 안내
  return sub;
}

export async function cancelRestock(customerId: number, subscriptionId: number, now = new Date()) {
  const r = await withBusyRetry(() =>
    prisma.restockSubscription.updateMany({ where: { id: subscriptionId, customerId, status: { in: ["WAITING", "SCHEDULED"] } }, data: { status: "CANCELED", closedAt: now } }),
  );
  return r.count > 0;
}

/** 이 SKU를 신청한 사람들에게 지금 상황(재입고·예정일·변경·취소)을 알림. 보낸 알림 수 */
export async function syncRestock(skuId: number, now = new Date()): Promise<number> {
  const subs = await prisma.restockSubscription.findMany({ where: { skuId, status: { in: ["WAITING", "SCHEDULED"] }, expiresAt: { gt: now } }, orderBy: { id: "asc" } });
  if (subs.length === 0) return 0;
  const available = (await getAvailability([skuId])).get(skuId) ?? 0;
  const expected = (await restockDates([skuId])).get(skuId) ?? null;
  const { text, link } = await skuLabel(prisma, skuId);
  let sent = 0;
  for (const sub of subs) {
    await withBusyRetry(() =>
      prisma.$transaction(async (tx) => {
        if (available > 0) {
          // 신청 순서대로 모두 알림 (수량이 적을 수 있다고 안내 — 실무에서도 선착순)
          if (await notify(tx, { customerId: sub.customerId, type: "RESTOCK_ARRIVED", title: "재입고됐어요", body: `${text} 상품이 다시 들어왔어요. 수량이 많지 않으니 서둘러 주세요.`, linkUrl: link, dedupKey: `restock-arrived:${sub.id}` }, now)) sent++;
          await tx.restockSubscription.update({ where: { id: sub.id }, data: { status: "ARRIVED", arrivedAt: now, closedAt: now } });
        } else if (expected && (sub.status === "WAITING" || sub.notifiedExpectedAt?.getTime() !== expected.getTime())) {
          const changed = sub.status === "SCHEDULED";
          const sentNow = await notify(
            tx,
            {
              customerId: sub.customerId,
              type: changed ? "RESTOCK_RESCHEDULED" : "RESTOCK_SCHEDULED",
              title: changed ? "재입고 예정일이 바뀌었어요" : "재입고 예정일이 정해졌어요",
              body: `${text} 상품이 ${formatDate(expected)}에 재입고될 예정이에요.${changed && sub.notifiedExpectedAt ? ` (이전 안내: ${formatDate(sub.notifiedExpectedAt)})` : ""} 입고되면 다시 알려 드릴게요.`,
              linkUrl: link,
              dedupKey: `restock-scheduled:${sub.id}:${expected.toISOString().slice(0, 10)}`,
            },
            now,
          );
          if (sentNow) sent++;
          await tx.restockSubscription.update({ where: { id: sub.id }, data: { status: "SCHEDULED", notifiedExpectedAt: expected, scheduledAt: sub.scheduledAt ?? now } });
        } else if (!expected && sub.status === "SCHEDULED") {
          // 안내했던 일정이 없어짐 (발주 취소 등) → 다시 대기
          if (await notify(tx, { customerId: sub.customerId, type: "RESTOCK_CANCELED", title: "재입고 일정이 취소되었어요", body: `${text} 상품의 재입고 일정이 취소되었어요. 새 일정이 정해지면 다시 알려 드릴게요.`, linkUrl: link, dedupKey: `restock-canceled:${sub.id}:${sub.notifiedExpectedAt?.toISOString().slice(0, 10)}` }, now)) sent++;
          await tx.restockSubscription.update({ where: { id: sub.id }, data: { status: "WAITING", notifiedExpectedAt: null } });
        }
      }),
    );
  }
  return sent;
}

/** 재입고 안내를 받은 고객이 그 상품을 결제하면 "구매함"으로 (결제 완료 처리 안에서) */
export async function markRestockPurchased(tx: Prisma.TransactionClient, customerId: number, skuIds: number[], now: Date) {
  await tx.restockSubscription.updateMany({
    where: { customerId, skuId: { in: skuIds }, status: "ARRIVED", arrivedAt: { gte: new Date(now.getTime() - RESTOCK_PURCHASE_WINDOW_DAYS * DAY) } },
    data: { status: "PURCHASED" },
  });
}

/** 정기 작업: 90일 지난 신청 만료 + 진행 중인 신청이 있는 SKU 전부 다시 확인 (주문 취소로 재고가 풀린 경우 등) */
export async function restockJob(now = new Date()) {
  const expired = await prisma.restockSubscription.updateMany({ where: { status: { in: ["WAITING", "SCHEDULED"] }, expiresAt: { lte: now } }, data: { status: "EXPIRED", closedAt: now } });
  const skus = await prisma.restockSubscription.findMany({ where: { status: { in: ["WAITING", "SCHEDULED"] } }, select: { skuId: true }, distinct: ["skuId"] });
  let sent = 0;
  for (const { skuId } of skus) sent += await syncRestock(skuId, now);
  return { expired: expired.count, sent };
}
