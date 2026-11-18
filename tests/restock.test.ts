// 발주·입고·재입고 예정일·재입고 알림·재주문 알림 테스트 (임시 DB 복사본)
import { removeTempDb } from "./helpers/temp-db"; // ⚠️ 반드시 첫 줄
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { getAvailability, recordMovement } from "../src/lib/inventory";
import {
  cancelPurchaseOrder,
  changeExpectedDate,
  checkLowStock,
  closePurchaseOrder,
  confirmPurchaseOrder,
  createPurchaseOrder,
  orderPurchaseOrder,
  parseKstDate,
  PurchasingError,
  receivePurchaseOrder,
  setReorderPoint,
} from "../src/lib/purchasing";
import { cancelRestock, restockDates, restockJob, RestockError, subscribeRestock, syncRestock } from "../src/lib/restock";
import { placeOrder } from "../src/lib/checkout";
import { confirmOrderPayment, defaultPaymentDeps } from "../src/lib/payment";
import { abandonOrder } from "../src/lib/payment";
import { createTossApi } from "../src/lib/toss";
import { FakeToss } from "./helpers/fake-toss";
import { newShopper } from "./helpers/orders";

const DAY = 24 * 60 * 60 * 1000;
const NOW = () => `'${new Date().toISOString().replace("Z", "+00:00")}'`;
class Rollback extends Error {}
function errorText(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const x = e as Error & { meta?: unknown; cause?: unknown };
  return `${e.message} ${JSON.stringify(x.meta ?? {})} ${x.cause ? errorText(x.cause) : ""}`;
}
async function rejects(sqls: string | string[], expected: string) {
  let err: unknown = null;
  try {
    await prisma.$transaction(async (tx) => {
      for (const s of [sqls].flat()) await tx.$executeRawUnsafe(s);
      throw new Rollback();
    });
  } catch (e) {
    err = e;
  }
  assert.ok(!(err instanceof Rollback), `막혀야 하는데 통과됨 (기대: ${expected})`);
  assert.ok(errorText(err).includes(expected), `다른 이유로 실패. 기대: ${expected}\n실제: ${errorText(err).slice(0, 300)}`);
}
const purchErr = (fn: () => Promise<unknown>, re: RegExp) => assert.rejects(fn, (e) => e instanceof PurchasingError && re.test(e.message));

let dc = 0;
let supplier = "";
const skuId = new Map<string, number>();
const id = (code: string) => skuId.get(code)!;
const avail = async (code: string) => (await getAvailability([id(code)])).get(id(code)) ?? 0;
async function setAvailable(code: string, n: number) {
  const diff = n - (await avail(code));
  if (diff === 0) return;
  await prisma.$transaction((tx) =>
    recordMovement(tx, { skuId: id(code), locationId: dc, type: diff > 0 ? "INBOUND" : "ADJUST_OUT", qty: diff, refType: diff > 0 ? "INBOUND_ORDER" : "STOCK_COUNT", refId: "TEST", reason: "테스트 준비" }),
  );
}
// 재입고 알림만 (새 회원은 가입 축하 쿠폰 알림도 받으므로 종류로 거름)
const notificationsOf = (customerId: number) =>
  prisma.notification.findMany({ where: { customerId, type: { in: ["RESTOCK_SCHEDULED", "RESTOCK_RESCHEDULED", "RESTOCK_CANCELED", "RESTOCK_ARRIVED"] } }, orderBy: { id: "asc" } });
const subOf = (customerId: number, code: string) => prisma.restockSubscription.findFirstOrThrow({ where: { customerId, skuId: id(code) }, orderBy: { id: "desc" } });
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

/** 품절 SKU + 발주(DRAFT→ORDERED) */
async function soldOutWithPo(code: string, qty = 10) {
  await setAvailable(code, 0);
  const po = await createPurchaseOrder({ supplierCode: supplier, lines: [{ skuCode: code, qty }], by: "ADMIN:test" });
  await orderPurchaseOrder(po.poNo, "ADMIN:test");
  return po.poNo;
}

before(async () => {
  dc = (await prisma.inventoryLocation.findUniqueOrThrow({ where: { code: "ONLINE_DC" } })).id;
  supplier = (await prisma.manufacturer.findFirstOrThrow({ where: { isActive: true } })).code;
  for (const s of await prisma.sku.findMany({ select: { id: true, skuCode: true } })) skuId.set(s.skuCode, s.id);
});
after(async () => {
  await prisma.$disconnect();
  removeTempDb();
});

// ---------------------------------------------------------------
describe("발주·입고", () => {
  const CODE = "JK26F001-BE-95";
  test("작성 → 발주 → 날짜 확정 → 일부 입고 → 입고 완료, 번호 형식·이력", async () => {
    await setAvailable(CODE, 0);
    const po = await createPurchaseOrder({ supplierCode: supplier, lines: [{ skuCode: CODE, qty: 5, unitCost: 30000 }], by: "ADMIN:test" });
    assert.match(po.poNo, /^PO-\d{8}-\d{3}$/);
    await orderPurchaseOrder(po.poNo, "ADMIN:test");
    await confirmPurchaseOrder(po.poNo, { all: day(7) }, "ADMIN:test");
    const r1 = await receivePurchaseOrder(po.poNo, [{ skuCode: CODE, good: 2, defect: 1 }], "ADMIN:test");
    assert.match(r1, /^IN-\d{8}-\d{3}$/);
    let p = await prisma.purchaseOrder.findUniqueOrThrow({ where: { poNo: po.poNo }, include: { lines: true, events: { orderBy: { id: "asc" } } } });
    assert.deepEqual([p.status, p.lines[0].qtyReceived], ["PARTIALLY_RECEIVED", 3]);
    assert.equal(await avail(CODE), 2, "정상 2개만 판매 가능, 불량 1개는 불량 창고");
    const defect = await prisma.inventoryBalance.findFirstOrThrow({ where: { skuId: id(CODE), location: { type: "DEFECT" } } });
    assert.equal(defect.onHand, 1);
    await receivePurchaseOrder(po.poNo, [{ skuCode: CODE, good: 2 }], "ADMIN:test");
    p = await prisma.purchaseOrder.findUniqueOrThrow({ where: { poNo: po.poNo }, include: { lines: true, events: { orderBy: { id: "asc" } } } });
    assert.deepEqual([p.status, p.lines[0].qtyReceived], ["RECEIVED", 5]);
    assert.deepEqual(p.events.map((e) => e.type), ["CREATED", "ORDERED", "CONFIRMED", "RECEIVED", "RECEIVED"]);
    // 원장: 입고 전표 줄마다 연결
    const ledgers = await prisma.inventoryLedger.findMany({ where: { inboundLineId: { not: null }, skuId: id(CODE) } });
    assert.equal(ledgers.reduce((n, l) => n + l.qty, 0), 5);
  });

  test("발주 수량보다 많이 입고·입고 시작 후 취소·날짜 없이 확정·보내기 전 입고는 거부", async () => {
    const po = await createPurchaseOrder({ supplierCode: supplier, lines: [{ skuCode: CODE, qty: 3 }], by: "ADMIN:test" });
    await purchErr(() => receivePurchaseOrder(po.poNo, [{ skuCode: CODE, good: 1 }], "ADMIN:test"), /입고할 수 있는 발주가 아니에요/);
    await orderPurchaseOrder(po.poNo, "ADMIN:test");
    await purchErr(() => confirmPurchaseOrder(po.poNo, {}, "ADMIN:test"), /입고 예정일이 없어요/);
    await purchErr(() => receivePurchaseOrder(po.poNo, [{ skuCode: CODE, good: 4 }], "ADMIN:test"), /발주 수량보다 많이/);
    await receivePurchaseOrder(po.poNo, [{ skuCode: CODE, good: 1 }], "ADMIN:test");
    await purchErr(() => cancelPurchaseOrder(po.poNo, "x", "ADMIN:test"), /취소할 수 없어요/);
    await closePurchaseOrder(po.poNo, "ADMIN:test"); // 잔량 마감
    assert.equal((await prisma.purchaseOrder.findUniqueOrThrow({ where: { poNo: po.poNo } })).status, "RECEIVED");
  });

  test("입고 예정일은 한국 날짜 0시로 저장, 잘못된 날짜 거부", () => {
    assert.equal(parseKstDate("2026-11-25").toISOString(), "2026-11-24T15:00:00.000Z");
    assert.throws(() => parseKstDate("2026/11/25"), PurchasingError);
  });
});

// ---------------------------------------------------------------
describe("재입고 예정일 (상품 화면)", () => {
  const CODE = "JK26F001-BE-100";
  test("확정된 발주 중 다 안 들어온 가장 빠른 날짜, 다 들어오거나 취소·작성 중이면 빠짐", async () => {
    await setAvailable(CODE, 0);
    const a = await createPurchaseOrder({ supplierCode: supplier, lines: [{ skuCode: CODE, qty: 2 }], by: "ADMIN:test" });
    const b = await createPurchaseOrder({ supplierCode: supplier, lines: [{ skuCode: CODE, qty: 2 }], by: "ADMIN:test" });
    assert.equal((await restockDates([id(CODE)])).get(id(CODE)), undefined, "작성 중 발주는 일정 아님");
    for (const po of [a, b]) await orderPurchaseOrder(po.poNo, "ADMIN:test");
    await confirmPurchaseOrder(a.poNo, { all: day(10) }, "ADMIN:test");
    await confirmPurchaseOrder(b.poNo, { all: day(5) }, "ADMIN:test");
    assert.equal((await restockDates([id(CODE)])).get(id(CODE))!.getTime(), parseKstDate(day(5)).getTime(), "가장 빠른 날짜");
    await receivePurchaseOrder(b.poNo, [{ skuCode: CODE, good: 2 }], "ADMIN:test");
    assert.equal((await restockDates([id(CODE)])).get(id(CODE))!.getTime(), parseKstDate(day(10)).getTime(), "다 들어온 발주는 빠짐");
    await setAvailable(CODE, 0);
    await cancelPurchaseOrder(a.poNo, "거래처 생산 중단", "ADMIN:test");
    assert.equal((await restockDates([id(CODE)])).get(id(CODE)), undefined);
  });
});

// ---------------------------------------------------------------
describe("재입고 알림", () => {
  test("품절일 때만 신청, 두 번 눌러도 1건, 취소하면 다시 신청 가능", async () => {
    const CODE = "SH26S002-SB-S";
    const c = await newShopper("알림1");
    await setAvailable(CODE, 3);
    await assert.rejects(() => subscribeRestock(c, id(CODE)), RestockError);
    await setAvailable(CODE, 0);
    const s1 = await subscribeRestock(c, id(CODE));
    const s2 = await subscribeRestock(c, id(CODE));
    assert.equal(s1.id, s2.id);
    assert.equal(await cancelRestock(c, s1.id), true);
    const s3 = await subscribeRestock(c, id(CODE));
    assert.notEqual(s3.id, s1.id);
  });

  test("날짜 확정 → 예정일 안내, 날짜 변경 → 변경 안내, 발주 취소 → 일정 취소 안내(다시 대기), 같은 안내는 한 번만", async () => {
    const CODE = "SH26S002-SB-L";
    const c = await newShopper("알림2");
    const poNo = await soldOutWithPo(CODE);
    await subscribeRestock(c, id(CODE));
    await confirmPurchaseOrder(poNo, { all: day(7) }, "ADMIN:test");
    let s = await subOf(c, CODE);
    assert.equal(s.status, "SCHEDULED");
    assert.equal(s.notifiedExpectedAt!.getTime(), parseKstDate(day(7)).getTime());
    await syncRestock(id(CODE)); // 다시 확인해도 같은 안내는 안 보냄
    await changeExpectedDate(poNo, CODE, day(9), "ADMIN:test");
    await cancelPurchaseOrder(poNo, "거래처 사정", "ADMIN:test");
    s = await subOf(c, CODE);
    assert.equal(s.status, "WAITING");
    const types = (await notificationsOf(c)).map((n) => n.type);
    assert.deepEqual(types, ["RESTOCK_SCHEDULED", "RESTOCK_RESCHEDULED", "RESTOCK_CANCELED"]);
    const body = (await notificationsOf(c))[1].body;
    assert.match(body, /이전 안내/);
  });

  test("입고되면 신청자 전원에게 '재입고됐어요' 한 번 (끝), 알림함 링크는 상품 화면", async () => {
    const CODE = "SH26S002-NV-M";
    const [a, b] = [await newShopper("알림3a"), await newShopper("알림3b")];
    const poNo = await soldOutWithPo(CODE);
    await subscribeRestock(a, id(CODE));
    await subscribeRestock(b, id(CODE));
    await confirmPurchaseOrder(poNo, { all: day(3) }, "ADMIN:test");
    await receivePurchaseOrder(poNo, [{ skuCode: CODE, good: 10 }], "ADMIN:test");
    for (const c of [a, b]) {
      const s = await subOf(c, CODE);
      assert.deepEqual([s.status, Boolean(s.arrivedAt), Boolean(s.closedAt)], ["ARRIVED", true, true]);
      const n = await notificationsOf(c);
      assert.deepEqual(n.map((x) => x.type), ["RESTOCK_SCHEDULED", "RESTOCK_ARRIVED"]);
      assert.match(n[1].linkUrl!, /^\/products\/SH26S002\?color=NV$/);
    }
    await syncRestock(id(CODE));
    assert.equal((await notificationsOf(a)).length, 2, "다시 확인해도 중복 알림 없음");
  });

  test("재입고 안내 뒤 그 상품을 결제하면 '구매함'", async () => {
    const CODE = "KN26F003-IV-S";
    const c = await newShopper("알림구매");
    const poNo = await soldOutWithPo(CODE);
    await subscribeRestock(c, id(CODE));
    await receivePurchaseOrder(poNo, [{ skuCode: CODE, good: 5 }], "ADMIN:test");
    const placed = await placeOrder(c, [{ skuId: id(CODE), quantity: 1 }]);
    assert.ok(!("error" in placed));
    const order = await prisma.order.findUniqueOrThrow({ where: { orderNo: placed.orderNo } });
    const fake = new FakeToss();
    const paymentKey = fake.authorize({ orderId: order.paymentOrderId, amount: order.totalPrice });
    const r = await confirmOrderPayment({ customerId: c, paymentOrderId: order.paymentOrderId, paymentKey, amount: String(order.totalPrice) }, { ...defaultPaymentDeps, toss: createTossApi({ transport: fake.transport, secretKey: () => "test_gsk_fake" }) });
    assert.equal(r.kind, "PAID");
    assert.equal((await subOf(c, CODE)).status, "PURCHASED");
  });

  test("주문 취소로 재고가 풀리면 정기 작업이 재입고 알림, 90일 지난 신청은 만료", async () => {
    const CODE = "KN26F003-IV-M";
    await setAvailable(CODE, 1);
    const buyer = await newShopper("마지막1개");
    const placed = await placeOrder(buyer, [{ skuId: id(CODE), quantity: 1 }]);
    assert.ok(!("error" in placed));
    assert.equal(await avail(CODE), 0);
    const waiter = await newShopper("기다림");
    await subscribeRestock(waiter, id(CODE));
    await abandonOrder(buyer, placed.paymentOrderId, "PAYMENT_FAILED"); // 결제창 이탈 → 재고 풀림
    await restockJob();
    assert.equal((await subOf(waiter, CODE)).status, "ARRIVED");
    // 만료
    await setAvailable(CODE, 0);
    const old = await newShopper("오래기다림");
    await subscribeRestock(old, id(CODE));
    const r = await restockJob(new Date(Date.now() + 91 * DAY));
    assert.ok(r.expired >= 1);
    assert.equal((await subOf(old, CODE)).status, "EXPIRED");
  });
});

// ---------------------------------------------------------------
describe("재주문 필요 (품절 임박 운영 알림)", () => {
  const CODE = "PT26F004-BK-30";
  test("재주문점 이하 → 알림 1번(관리자), 다시 확인해도 중복 없음, 발주하면 해소, 재고 회복도 해소", async () => {
    await setAvailable(CODE, 2);
    const before = await prisma.notification.count({ where: { audience: "ADMIN" } });
    await setReorderPoint(CODE, 3, 20);
    let open = await prisma.stockAlert.findFirstOrThrow({ where: { skuId: id(CODE), status: "OPEN" } });
    assert.deepEqual([open.availableAtOpen, open.reorderPoint], [2, 3]);
    await checkLowStock();
    assert.equal(await prisma.notification.count({ where: { audience: "ADMIN" } }), before + 1, "관리자 알림 1번");
    const po = await createPurchaseOrder({ supplierCode: supplier, lines: [{ skuCode: CODE, qty: 20 }], by: "ADMIN:test" });
    await orderPurchaseOrder(po.poNo, "ADMIN:test");
    open = await prisma.stockAlert.findUniqueOrThrow({ where: { id: open.id } });
    assert.deepEqual([open.status, open.resolution], ["RESOLVED", "PURCHASE_ORDERED"]);
    await checkLowStock();
    assert.equal(await prisma.stockAlert.count({ where: { skuId: id(CODE), status: "OPEN" } }), 0, "발주 진행 중이면 다시 안 엶");
    await receivePurchaseOrder(po.poNo, [{ skuCode: CODE, good: 20 }], "ADMIN:test");
    await setAvailable(CODE, 1);
    await checkLowStock();
    const again = await prisma.stockAlert.findFirstOrThrow({ where: { skuId: id(CODE), status: "OPEN" } });
    await setAvailable(CODE, 10);
    await checkLowStock();
    assert.equal((await prisma.stockAlert.findUniqueOrThrow({ where: { id: again.id } })).resolution, "RESTOCKED");
  });
});

// ---------------------------------------------------------------
describe("재고 보강 DB 제약", () => {
  test("발주는 작성 중으로만 생성, 입고 수량 직접 수정 금지, 보낸 발주 수량 변경 금지", async () => {
    const sup = (await prisma.manufacturer.findFirstOrThrow()).id;
    await rejects(`INSERT INTO "PurchaseOrder" ("poNo","supplierId","status","statusChangedAt","createdBy","createdAt","updatedAt","orderedAt") VALUES ('PO-20991231-001', ${sup}, 'ORDERED', ${NOW()}, 'x', ${NOW()}, ${NOW()}, ${NOW()})`, "PurchaseOrder_insert_draft");
    const po = await createPurchaseOrder({ supplierCode: supplier, lines: [{ skuCode: "JK26F001-BK-95", qty: 3 }], by: "ADMIN:test" });
    await orderPurchaseOrder(po.poNo, "ADMIN:test");
    const line = await prisma.purchaseOrderLine.findFirstOrThrow({ where: { purchaseOrder: { poNo: po.poNo } } });
    await rejects(`UPDATE "PurchaseOrderLine" SET "qtyReceived" = 3 WHERE "id" = ${line.id}`, "PurchaseOrderLine_received_guard");
    await rejects(`UPDATE "PurchaseOrderLine" SET "qtyOrdered" = 30 WHERE "id" = ${line.id}`, "PurchaseOrderLine_fixed");
    await rejects(`DELETE FROM "PurchaseOrder" WHERE "poNo" = '${po.poNo}'`, "PurchaseOrder_no_delete");
    await rejects(`UPDATE "PurchaseOrder" SET "status" = 'RECEIVED', "statusChangedAt" = ${NOW()} WHERE "poNo" = '${po.poNo}'`, "입고된 수량이 없습니다");
  });
  test("재입고 알림 중복 신청 금지, 끝난 신청 되살리기 금지, 알림 내용 변경·삭제 금지", async () => {
    const CODE = "JK26F001-BE-95";
    await setAvailable(CODE, 0);
    const c = await newShopper("제약");
    const s = await subscribeRestock(c, id(CODE));
    await rejects(`INSERT INTO "RestockSubscription" ("customerId","skuId","status","expiresAt","createdAt","updatedAt") VALUES (${c}, ${id(CODE)}, 'WAITING', '2099-01-01T00:00:00.000+00:00', ${NOW()}, ${NOW()})`, "RestockSubscription_duplicate");
    await cancelRestock(c, s.id);
    await rejects(`UPDATE "RestockSubscription" SET "status" = 'WAITING', "closedAt" = NULL WHERE "id" = ${s.id}`, "RestockSubscription_transition");
    const n = await prisma.notification.findFirstOrThrow();
    await rejects(`UPDATE "Notification" SET "body" = '조작' WHERE "id" = ${n.id}`, "Notification_update_guard");
    await rejects(`DELETE FROM "Notification" WHERE "id" = ${n.id}`, "Notification_no_delete");
  });
  test("관리자 알림이 아닌데 회원 없음·외부 링크 금지 (CHECK)", () =>
    rejects(`INSERT INTO "Notification" ("customerId","audience","type","channel","title","body","linkUrl","dedupKey","status","sentAt","createdAt") VALUES (NULL, 'CUSTOMER', 'RESTOCK_ARRIVED', 'IN_APP', 't', 'b', 'https://evil.example', 'x-1', 'SENT', ${NOW()}, ${NOW()})`, "Notification_values_ck"));
  test("입고 전표·줄 수정 금지, 원장 반품 반송 유형은 음수만", async () => {
    const r = await prisma.inboundReceiptLine.findFirstOrThrow();
    await rejects(`UPDATE "InboundReceiptLine" SET "qtyGood" = 999 WHERE "id" = ${r.id}`, "InboundReceiptLine_append_only");
    await rejects(`UPDATE "InboundReceipt" SET "memo" = 'x'`, "InboundReceipt_append_only");
  });
});
