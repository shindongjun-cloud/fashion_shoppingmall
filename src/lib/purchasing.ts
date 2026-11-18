// 발주·입고·재주문 알림 (서버 전용, 관리자 화면 대신 scripts/inventory-ops.ts 명령어로)
//
//   발주 작성(DRAFT) → 발주(ORDERED) → 거래처 날짜 확정(CONFIRMED, 줄마다 예정일) → 입고(일부·전부) → 완료 / 취소(입고 전)
//   입고: 정상 수량 = 물류센터(판매 가능), 불량 수량 = 불량 창고 (원장이 줄마다)
//   예정일이 생기거나 바뀌거나 없어지면, 입고되면 → 재입고 알림 (lib/restock.ts)
//   재주문점: 판매 가능 수량 ≤ 재주문점이고 진행 중인 발주가 없으면 "재주문 필요" (관리자 알림)
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureBalance, getAvailability, isConstraintError, recordMovement, withBusyRetry } from "@/lib/inventory";
import { kstDateCode } from "@/lib/order-rules";
import { notify } from "@/lib/notification";
import { syncRestock } from "@/lib/restock";

type Tx = Prisma.TransactionClient;
export class PurchasingError extends Error {}

/** "2026-11-25" → 한국 날짜 0시 */
export function parseKstDate(text: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new PurchasingError(`날짜 형식이 아니에요: ${text} (예: 2026-11-25)`);
  const d = new Date(`${text}T00:00:00+09:00`);
  if (Number.isNaN(d.getTime())) throw new PurchasingError(`없는 날짜예요: ${text}`);
  return d;
}

async function nextNo(prefix: "PO" | "IN", now: Date, count: (start: string) => Promise<number>) {
  const day = kstDateCode(now);
  return `${prefix}-${day}-${String((await count(`${prefix}-${day}-`)) + 1).padStart(3, "0")}`;
}
async function skuIdOf(db: Tx | typeof prisma, skuCode: string) {
  const sku = await db.sku.findUnique({ where: { skuCode } });
  if (!sku) throw new PurchasingError(`SKU를 찾을 수 없어요: ${skuCode}`);
  return sku.id;
}
async function findPo(poNo: string) {
  const po = await prisma.purchaseOrder.findUnique({ where: { poNo }, include: { lines: { include: { sku: true } } } });
  if (!po) throw new PurchasingError(`발주를 찾을 수 없어요: ${poNo}`);
  return po;
}
const dcLocation = async (db: Tx | typeof prisma) => {
  const loc = await db.inventoryLocation.findFirst({ where: { isOnlineSellable: true, isActive: true, type: "WAREHOUSE" }, orderBy: { priority: "asc" } });
  if (!loc) throw new PurchasingError("물류센터 위치가 없어요.");
  return loc;
};
const defectLocation = async (db: Tx | typeof prisma) => {
  const loc = await db.inventoryLocation.findFirst({ where: { type: "DEFECT", isActive: true } });
  if (!loc) throw new PurchasingError("불량 창고 위치가 없어요.");
  return loc;
};

// ---------------------------------------------------------------
// 발주
// ---------------------------------------------------------------
export async function createPurchaseOrder(input: { supplierCode: string; lines: { skuCode: string; qty: number; unitCost?: number }[]; by: string; memo?: string }, now = new Date()) {
  const supplier = await prisma.manufacturer.findUnique({ where: { code: input.supplierCode } });
  if (!supplier || !supplier.isActive) throw new PurchasingError(`거래처를 찾을 수 없어요: ${input.supplierCode}`);
  if (input.lines.length === 0) throw new PurchasingError("발주할 상품이 없어요.");
  for (const l of input.lines) if (!Number.isInteger(l.qty) || l.qty < 1) throw new PurchasingError(`수량이 올바르지 않아요: ${l.skuCode}`);
  for (let attempt = 1; ; attempt++) {
    const poNo = await nextNo("PO", now, (start) => prisma.purchaseOrder.count({ where: { poNo: { startsWith: start } } }));
    try {
      return await withBusyRetry(() =>
        prisma.$transaction(async (tx) => {
          const po = await tx.purchaseOrder.create({ data: { poNo, supplierId: supplier.id, statusChangedAt: now, createdBy: input.by, memo: input.memo ?? null, createdAt: now } });
          let lineNo = 0;
          for (const l of input.lines) {
            await tx.purchaseOrderLine.create({ data: { purchaseOrderId: po.id, lineNo: ++lineNo, skuId: await skuIdOf(tx, l.skuCode), qtyOrdered: l.qty, unitCost: l.unitCost ?? null, createdAt: now } });
          }
          await tx.purchaseOrderEvent.create({ data: { purchaseOrderId: po.id, type: "CREATED", createdBy: input.by, createdAt: now } });
          return po;
        }),
      );
    } catch (e) {
      if (attempt < 3 && isConstraintError(e, "poNo")) continue; // 동시에 같은 번호
      if (isConstraintError(e, "purchaseOrderId_skuId")) throw new PurchasingError("같은 SKU를 두 줄로 발주할 수 없어요.");
      throw e;
    }
  }
}

/** 거래처에 발주 (날짜 미정) → 이 SKU들의 재주문 알림은 "발주 진행"으로 해소 */
export async function orderPurchaseOrder(poNo: string, by: string, now = new Date()) {
  const po = await findPo(poNo);
  if (po.status !== "DRAFT") throw new PurchasingError(`작성 중인 발주만 보낼 수 있어요 (현재: ${po.status})`);
  await withBusyRetry(() =>
    prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "ORDERED", orderedAt: now, statusChangedAt: now } });
      await tx.purchaseOrderEvent.create({ data: { purchaseOrderId: po.id, type: "ORDERED", createdBy: by, createdAt: now } });
      await tx.stockAlert.updateMany({ where: { skuId: { in: po.lines.map((l) => l.skuId) }, status: "OPEN" }, data: { status: "RESOLVED", resolvedAt: now, resolution: "PURCHASE_ORDERED" } });
    }),
  );
}

/** 거래처가 입고 날짜를 확정 (전체 같은 날 또는 SKU별) → 재입고 예정일 안내 */
export async function confirmPurchaseOrder(poNo: string, dates: { all?: string; bySku?: Record<string, string> }, by: string, now = new Date()) {
  const po = await findPo(poNo);
  if (po.status !== "ORDERED") throw new PurchasingError(`발주한 상태에서만 날짜를 확정할 수 있어요 (현재: ${po.status})`);
  const dateOf = (skuCode: string) => {
    const t = dates.bySku?.[skuCode] ?? dates.all;
    if (!t) throw new PurchasingError(`입고 예정일이 없어요: ${skuCode}`);
    return parseKstDate(t);
  };
  try {
    await withBusyRetry(() =>
      prisma.$transaction(async (tx) => {
        for (const l of po.lines) {
          const d = dateOf(l.sku.skuCode);
          await tx.purchaseOrderLine.update({ where: { id: l.id }, data: { expectedAt: d } });
          await tx.purchaseOrderEvent.create({ data: { purchaseOrderId: po.id, lineId: l.id, type: "CONFIRMED", fromDate: l.expectedAt, toDate: d, createdBy: by, createdAt: now } });
        }
        await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "CONFIRMED", confirmedAt: now, statusChangedAt: now } });
      }),
    );
  } catch (e) {
    if (e instanceof PurchasingError) throw e;
    if (isConstraintError(e, "PurchaseOrder_confirm_guard")) throw new PurchasingError("모든 줄에 입고 예정일이 있어야 해요.");
    throw e;
  }
  for (const l of po.lines) await syncRestock(l.skuId, now);
}

/** 입고 예정일 변경 (거래처 일정 변경) → 신청자에게 "예정일 변경" */
export async function changeExpectedDate(poNo: string, skuCode: string, date: string, by: string, now = new Date()) {
  const po = await findPo(poNo);
  if (!["CONFIRMED", "PARTIALLY_RECEIVED"].includes(po.status)) throw new PurchasingError(`확정된 발주만 예정일을 바꿀 수 있어요 (현재: ${po.status})`);
  const line = po.lines.find((l) => l.sku.skuCode === skuCode);
  if (!line) throw new PurchasingError(`이 발주에 없는 SKU예요: ${skuCode}`);
  const d = parseKstDate(date);
  if (line.expectedAt?.getTime() === d.getTime()) return;
  await withBusyRetry(() =>
    prisma.$transaction(async (tx) => {
      await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { expectedAt: d } });
      await tx.purchaseOrderEvent.create({ data: { purchaseOrderId: po.id, lineId: line.id, type: "DATE_CHANGED", fromDate: line.expectedAt, toDate: d, createdBy: by, createdAt: now } });
    }),
  );
  await syncRestock(line.skuId, now);
}

/** 발주 취소 (입고 전만) → 안내했던 예정일이 없어지면 "재입고 일정 취소" */
export async function cancelPurchaseOrder(poNo: string, reason: string, by: string, now = new Date()) {
  const po = await findPo(poNo);
  if (!["DRAFT", "ORDERED", "CONFIRMED"].includes(po.status)) throw new PurchasingError(`입고가 시작되었거나 끝난 발주는 취소할 수 없어요 (현재: ${po.status})`);
  await withBusyRetry(() =>
    prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "CANCELED", canceledAt: now, statusChangedAt: now } });
      await tx.purchaseOrderEvent.create({ data: { purchaseOrderId: po.id, type: "CANCELED", memo: reason.slice(0, 500) || null, createdBy: by, createdAt: now } });
    }),
  );
  for (const l of po.lines) await syncRestock(l.skuId, now);
}

/**
 * 입고: 정상은 물류센터, 불량은 불량 창고 (원장). 발주 줄의 입고 수량은 트리거가 맞춤
 * 다 들어오면 입고 완료, 아니면 일부 입고. 그 뒤 재입고 알림·재주문 알림 확인
 */
export async function receivePurchaseOrder(poNo: string, lines: { skuCode: string; good: number; defect?: number }[], by: string, now = new Date()) {
  const po = await findPo(poNo);
  if (!["ORDERED", "CONFIRMED", "PARTIALLY_RECEIVED"].includes(po.status)) throw new PurchasingError(`입고할 수 있는 발주가 아니에요 (현재: ${po.status})`);
  for (const l of lines) {
    if (!Number.isInteger(l.good) || l.good < 0 || !Number.isInteger(l.defect ?? 0) || (l.defect ?? 0) < 0 || l.good + (l.defect ?? 0) < 1) throw new PurchasingError(`입고 수량이 올바르지 않아요: ${l.skuCode}`);
    if (!po.lines.some((x) => x.sku.skuCode === l.skuCode)) throw new PurchasingError(`이 발주에 없는 SKU예요: ${l.skuCode}`);
  }
  let receiptNo = "";
  try {
    await withBusyRetry(async () => {
      receiptNo = await nextNo("IN", now, (start) => prisma.inboundReceipt.count({ where: { receiptNo: { startsWith: start } } }));
      await prisma.$transaction(async (tx) => {
        const dc = await dcLocation(tx);
        const defect = await defectLocation(tx);
        const receipt = await tx.inboundReceipt.create({ data: { receiptNo, purchaseOrderId: po.id, locationId: dc.id, receivedAt: now, createdBy: by, createdAt: now } });
        for (const l of lines) {
          const poLine = po.lines.find((x) => x.sku.skuCode === l.skuCode)!;
          const rl = await tx.inboundReceiptLine.create({ data: { receiptId: receipt.id, purchaseOrderLineId: poLine.id, skuId: poLine.skuId, qtyGood: l.good, qtyDefect: l.defect ?? 0 } });
          const common = { skuId: poLine.skuId, type: "INBOUND" as const, refType: "INBOUND_ORDER" as const, refId: receiptNo, createdBy: by, occurredAt: now, inboundLineId: rl.id };
          if (l.good > 0) await recordMovement(tx, { ...common, locationId: dc.id, qty: l.good, memo: `발주 ${po.poNo}` });
          if ((l.defect ?? 0) > 0) {
            await ensureBalance(tx, poLine.skuId, defect.id);
            await recordMovement(tx, { ...common, locationId: defect.id, qty: l.defect!, memo: `발주 ${po.poNo} 입고 검수 불량` });
          }
        }
        const after = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
        const done = after.every((x) => x.qtyReceived >= x.qtyOrdered);
        const next = done ? "RECEIVED" : "PARTIALLY_RECEIVED";
        if (next !== po.status) await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: next, statusChangedAt: now } });
        await tx.purchaseOrderEvent.create({ data: { purchaseOrderId: po.id, type: "RECEIVED", memo: `${receiptNo} ${lines.map((l) => `${l.skuCode} 정상 ${l.good}${l.defect ? `·불량 ${l.defect}` : ""}`).join(", ")}`.slice(0, 500), createdBy: by, createdAt: now } });
      });
    });
  } catch (e) {
    if (isConstraintError(e, "InboundReceiptLine_over")) throw new PurchasingError("발주 수량보다 많이 입고할 수 없어요.");
    throw e;
  }
  for (const l of po.lines) await syncRestock(l.skuId, now);
  await checkLowStock(now);
  return receiptNo;
}

/** 일부 입고 후 남은 수량은 들어오지 않음 → 마감 (재입고 예정일에서 빠짐) */
export async function closePurchaseOrder(poNo: string, by: string, now = new Date()) {
  const po = await findPo(poNo);
  if (po.status !== "PARTIALLY_RECEIVED") throw new PurchasingError(`일부 입고된 발주만 마감할 수 있어요 (현재: ${po.status})`);
  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "RECEIVED", statusChangedAt: now } });
    await tx.purchaseOrderEvent.create({ data: { purchaseOrderId: po.id, type: "RECEIVED", memo: "잔량 마감", createdBy: by, createdAt: now } });
  });
  for (const l of po.lines) await syncRestock(l.skuId, now);
}

// ---------------------------------------------------------------
// 재주문점·재주문 알림
// ---------------------------------------------------------------
export async function setReorderPoint(skuCode: string, point: number, qty: number, now = new Date()) {
  if (!Number.isInteger(point) || point < 0 || !Number.isInteger(qty) || qty < 0) throw new PurchasingError("재주문점·수량은 0 이상의 정수예요.");
  const skuId = await skuIdOf(prisma, skuCode);
  const dc = await dcLocation(prisma);
  await ensureBalance(prisma, skuId, dc.id);
  await prisma.inventoryBalance.update({ where: { skuId_locationId: { skuId, locationId: dc.id } }, data: { reorderPoint: point, reorderQty: qty, updatedAt: now } });
  await checkLowStock(now, [skuId]);
}

/**
 * 판매 가능 수량 ≤ 재주문점이고 진행 중인 발주가 없으면 "재주문 필요" (관리자 알림 1번).
 * 회복(재주문점 위로)·발주 진행·재주문점 변경이면 해소
 */
export async function checkLowStock(now = new Date(), skuIds?: number[]) {
  const balances = await prisma.inventoryBalance.findMany({
    where: { location: { isOnlineSellable: true, isActive: true }, ...(skuIds ? { skuId: { in: skuIds } } : {}) },
    include: { sku: true },
  });
  const avail = await getAvailability(balances.map((b) => b.skuId));
  const openPo = new Set(
    (await prisma.purchaseOrderLine.findMany({ where: { skuId: { in: balances.map((b) => b.skuId) }, purchaseOrder: { status: { in: ["ORDERED", "CONFIRMED", "PARTIALLY_RECEIVED"] } } }, select: { skuId: true, qtyOrdered: true, qtyReceived: true } }))
      .filter((l) => l.qtyReceived < l.qtyOrdered)
      .map((l) => l.skuId),
  );
  let opened = 0;
  for (const b of balances) {
    const available = avail.get(b.skuId) ?? 0;
    const open = await prisma.stockAlert.findFirst({ where: { skuId: b.skuId, locationId: b.locationId, status: "OPEN" } });
    if (open) {
      const resolution = b.reorderPoint === 0 || available > b.reorderPoint ? (b.reorderPoint !== open.reorderPoint ? "THRESHOLD_CHANGED" : "RESTOCKED") : openPo.has(b.skuId) ? "PURCHASE_ORDERED" : null;
      if (resolution) await prisma.stockAlert.update({ where: { id: open.id }, data: { status: "RESOLVED", resolvedAt: now, resolution } });
      continue;
    }
    if (b.reorderPoint > 0 && available <= b.reorderPoint && !openPo.has(b.skuId)) {
      await prisma.$transaction(async (tx) => {
        const alert = await tx.stockAlert.create({ data: { skuId: b.skuId, locationId: b.locationId, availableAtOpen: available, reorderPoint: b.reorderPoint, openedAt: now } });
        await notify(tx, { customerId: null, type: "REORDER_NEEDED", title: `재주문 필요: ${b.sku.skuCode}`, body: `판매 가능 ${available}개 (재주문점 ${b.reorderPoint}개). 권장 발주 수량 ${b.reorderQty || "-"}개.`, dedupKey: `reorder:${alert.id}` }, now);
      });
      opened++;
    }
  }
  return opened;
}
