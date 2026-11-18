// 반품 테스트: 신청(기간·상태) → 승인 → 회수 → 반품센터 도착 → 검수(정상·불량·반품 불가) → 재고 이동 → 환불(토스 부분·전액 취소)
import { removeTempDb } from "./helpers/temp-db"; // ⚠️ 반드시 첫 줄
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { placeOrder } from "../src/lib/checkout";
import { getAvailability, recordMovement } from "../src/lib/inventory";
import { confirmOrderPayment, defaultPaymentDeps, type PaymentDeps } from "../src/lib/payment";
import { autoConfirmDeliveredItems, deliverShipment, prepareOrder, registerShipment, shipShipment } from "../src/lib/order";
import { approveReturn, cancelReturn, inspectReturn, receiveReturn, registerReturnPickup, rejectReturn, requestReturn, retryReturnRefunds, ReturnError } from "../src/lib/returns";
import { subscribeRestock } from "../src/lib/restock";
import { requestWithdrawal } from "../src/lib/customer";
import { createTossApi } from "../src/lib/toss";
import { FakeToss } from "./helpers/fake-toss";
import { newShopper } from "./helpers/orders";
import type { ReturnInspection, ReturnReason } from "../src/generated/prisma/client";

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
const retErr = (fn: () => Promise<unknown>, re: RegExp) => assert.rejects(fn, (e) => e instanceof ReturnError && re.test(e.message));

const SHIRT = "SH26S002-WH-L"; // 판매가 약 4.9만
const KNIT = "KN26F003-IV-S"; // 판매가 약 10만
let dc = 0;
const skuId = new Map<string, number>();
const id = (c: string) => skuId.get(c)!;
let trackingSeq = 0;
const tracking = () => `6015${String(Date.now()).slice(-6)}${String(++trackingSeq).padStart(2, "0")}`;
async function setAvailable(code: string, n: number) {
  const diff = n - ((await getAvailability([id(code)])).get(id(code)) ?? 0);
  if (diff === 0) return;
  await prisma.$transaction((tx) =>
    recordMovement(tx, { skuId: id(code), locationId: dc, type: diff > 0 ? "INBOUND" : "ADJUST_OUT", qty: diff, refType: diff > 0 ? "INBOUND_ORDER" : "STOCK_COUNT", refId: "TEST", reason: "테스트 준비" }),
  );
}
const onHandAt = async (code: string, type: "WAREHOUSE" | "RETURN_CENTER" | "DEFECT") =>
  (await prisma.inventoryBalance.findFirst({ where: { skuId: id(code), location: { type, ...(type === "WAREHOUSE" ? { code: "ONLINE_DC" } : {}) } } }))?.onHand ?? 0;
function deps(fake: FakeToss): PaymentDeps {
  return { ...defaultPaymentDeps, toss: createTossApi({ transport: fake.transport, secretKey: () => "test_gsk_fake" }), waitForOtherMs: 3000 };
}

/** 주문 → 결제 → 출고 → 배송 완료 */
async function delivered(fake: FakeToss, codes: string[], zip = "06236") {
  for (const c of codes) await setAvailable(c, 10);
  const customerId = await newShopper("반품", zip);
  const placed = await placeOrder(customerId, codes.map((c) => ({ skuId: id(c), quantity: 1 })));
  assert.ok(!("error" in placed), JSON.stringify(placed));
  const order = await prisma.order.findUniqueOrThrow({ where: { orderNo: placed.orderNo } });
  const paymentKey = fake.authorize({ orderId: order.paymentOrderId, amount: order.totalPrice });
  assert.equal((await confirmOrderPayment({ customerId, paymentOrderId: order.paymentOrderId, paymentKey, amount: String(order.totalPrice) }, deps(fake))).kind, "PAID");
  await prepareOrder(order.orderNo, "ADMIN:test");
  const box = await registerShipment(order.orderNo, { courierCode: "CJ", trackingNo: tracking() }, "ADMIN:test");
  await shipShipment(box!.id);
  await deliverShipment(box!.id);
  const items = await prisma.orderItem.findMany({ where: { orderId: order.id }, orderBy: { lineNo: "asc" } });
  return { customerId, order: await prisma.order.findUniqueOrThrow({ where: { id: order.id } }), items };
}
/** 신청 → 승인 → 회수 → 도착 */
async function toReceived(customerId: number, orderNo: string, itemIds: number[], reason: ReturnReason) {
  const r = await requestReturn(customerId, orderNo, { orderItemIds: itemIds, reason });
  await approveReturn(r.returnNo);
  await registerReturnPickup(r.returnNo, "CJ", tracking());
  await receiveReturn(r.returnNo, "ADMIN:test");
  return r.returnNo;
}
const inspect = (fake: FakeToss, returnNo: string, results: [number, ReturnInspection][]) =>
  inspectReturn(returnNo, results.map(([orderItemId, inspection]) => ({ orderItemId, inspection })), "ADMIN:test", deps(fake));
const returnOf = (returnNo: string) => prisma.returnRequest.findUniqueOrThrow({ where: { returnNo }, include: { items: true } });

before(async () => {
  dc = (await prisma.inventoryLocation.findUniqueOrThrow({ where: { code: "ONLINE_DC" } })).id;
  for (const s of await prisma.sku.findMany({ select: { id: true, skuCode: true } })) skuId.set(s.skuCode, s.id);
});
after(async () => {
  await prisma.$disconnect();
  removeTempDb();
});

// ---------------------------------------------------------------
describe("반품 신청: 기간·상태·주인", () => {
  test("배송 완료 상품만, 단순 변심 7일·불량 30일, 구매확정·배송중·남의 주문은 불가", async () => {
    const fake = new FakeToss();
    const { customerId, order, items } = await delivered(fake, [SHIRT]);
    const [it] = items;
    const later = (d: number) => new Date(it.deliveredAt!.getTime() + d * DAY);
    await retErr(() => requestReturn(customerId, order.orderNo, { orderItemIds: [it.id], reason: "CHANGE_OF_MIND" }, later(8)), /7일/);
    const stranger = await newShopper("남");
    await retErr(() => requestReturn(stranger, order.orderNo, { orderItemIds: [it.id], reason: "DEFECT" }), /찾을 수 없어요/);
    const r = await requestReturn(customerId, order.orderNo, { orderItemIds: [it.id], reason: "DEFECT" }, later(20)); // 불량은 30일
    assert.match(r.returnNo, /^R\d{8}-\d{8}-1$/);
    assert.equal(r.fault, "SELLER");
    assert.equal((await prisma.orderItem.findUniqueOrThrow({ where: { id: it.id } })).status, "RETURN_REQUESTED");
    await retErr(() => requestReturn(customerId, order.orderNo, { orderItemIds: [it.id], reason: "SIZE" }), /배송 완료된 상품만/);
  });

  test("반품 중에는 자동 구매확정 안 됨, 철회하면 다시 배송 완료", async () => {
    const fake = new FakeToss();
    const { customerId, order, items } = await delivered(fake, [SHIRT]);
    const r = await requestReturn(customerId, order.orderNo, { orderItemIds: [items[0].id], reason: "SIZE" });
    await autoConfirmDeliveredItems(new Date(Date.now() + 30 * DAY));
    assert.equal((await prisma.orderItem.findUniqueOrThrow({ where: { id: items[0].id } })).status, "RETURN_REQUESTED");
    await cancelReturn(customerId, r.returnNo);
    assert.equal((await returnOf(r.returnNo)).status, "CANCELED");
    assert.equal((await prisma.orderItem.findUniqueOrThrow({ where: { id: items[0].id } })).status, "DELIVERED");
  });

  test("구매확정한 상품은 반품 불가, 회수 시작 뒤에는 고객 철회 불가, 거절하면 배송 완료로", async () => {
    const fake = new FakeToss();
    const a = await delivered(fake, [SHIRT]);
    await prisma.orderItem.update({ where: { id: a.items[0].id }, data: { status: "CONFIRMED", statusChangedAt: new Date(), statusChangedBy: "CUSTOMER", confirmedAt: new Date(), confirmType: "MANUAL" } });
    await retErr(() => requestReturn(a.customerId, a.order.orderNo, { orderItemIds: [a.items[0].id], reason: "SIZE" }), /구매확정한 상품은/);
    const b = await delivered(fake, [SHIRT]);
    const r = await requestReturn(b.customerId, b.order.orderNo, { orderItemIds: [b.items[0].id], reason: "SIZE" });
    await approveReturn(r.returnNo);
    await registerReturnPickup(r.returnNo, "CJ", tracking());
    await retErr(() => cancelReturn(b.customerId, r.returnNo), /회수가 시작된/);
    const c = await delivered(fake, [SHIRT]);
    const r2 = await requestReturn(c.customerId, c.order.orderNo, { orderItemIds: [c.items[0].id], reason: "SIZE" });
    await rejectReturn(r2.returnNo, "착용 흔적 사진 확인");
    assert.equal((await prisma.orderItem.findUniqueOrThrow({ where: { id: c.items[0].id } })).status, "DELIVERED");
  });
});

// ---------------------------------------------------------------
describe("반품 재고 이동 + 환불", () => {
  test("단순 변심 1개 반품(무료배송 깨짐): 반품센터 + → 검수 정상 → 물류센터 복귀, 환불 = 실결제액 − 왕복 6,000원, 부분 취소", async () => {
    const fake = new FakeToss();
    const { customerId, order, items } = await delivered(fake, [SHIRT, KNIT]);
    assert.equal(order.shippingBaseFee, 0, "5만원 이상이라 무료배송");
    const shirt = items.find((i) => i.skuCode === SHIRT)!;
    const keptAfter = items.filter((i) => i.id !== shirt.id).reduce((n, i) => n + i.lineTotal, 0);
    const dcBefore = await onHandAt(SHIRT, "WAREHOUSE");
    const returnNo = await toReceived(customerId, order.orderNo, [shirt.id], "CHANGE_OF_MIND");
    assert.equal(await onHandAt(SHIRT, "RETURN_CENTER"), 1, "도착: 반품센터 +1 (판매 불가)");
    assert.equal(await onHandAt(SHIRT, "WAREHOUSE"), dcBefore, "검수 전에는 판매 재고에 안 들어감");
    const res = await inspect(fake, returnNo, [[shirt.id, "RESELLABLE"]]);
    assert.equal(res.status, "COMPLETED");
    assert.equal(await onHandAt(SHIRT, "RETURN_CENTER"), 0);
    assert.equal(await onHandAt(SHIRT, "WAREHOUSE"), dcBefore + 1, "정상 → 물류센터 복귀 (다시 판매)");
    const r = await returnOf(returnNo);
    const expectedFee = keptAfter < 50000 ? 6000 : 3000;
    assert.deepEqual([r.returnShippingFee, r.refundAmount], [expectedFee, shirt.payAmount - expectedFee]);
    const cancel = await prisma.paymentCancel.findUniqueOrThrow({ where: { id: r.paymentCancelId! } });
    assert.deepEqual([cancel.status, cancel.cancelAmount, cancel.requestedBy], ["DONE", r.refundAmount, "SYSTEM"]);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { payments: true } });
    assert.deepEqual([o.status, o.payments[0].status], ["PAID", "PARTIAL_CANCELED"], "다른 상품은 그대로 → 부분 취소");
    assert.equal((await prisma.orderItem.findUniqueOrThrow({ where: { id: shirt.id } })).status, "RETURNED");
    const ledgers = await prisma.inventoryLedger.findMany({ where: { refType: "RETURN", refId: returnNo }, orderBy: { id: "asc" } });
    assert.deepEqual(ledgers.map((l) => [l.type, l.qty]), [["RETURN_IN", 1], ["TRANSFER_OUT", -1], ["TRANSFER_IN", 1]]);
  });

  test("무료배송 주문에서 비싼 상품을 반품해 남은 금액이 5만원 아래로 → 처음 배송비까지 왕복 6,000원 차감 (실제 결제 화면 확인 중 발견한 버그)", async () => {
    const fake = new FakeToss();
    const { customerId, order, items } = await delivered(fake, [SHIRT, KNIT]);
    assert.equal(order.shippingBaseFee, 0);
    const knit = items.find((i) => i.skuCode === KNIT)!;
    const shirt = items.find((i) => i.skuCode === SHIRT)!;
    assert.ok(shirt.lineTotal < 50000 && shirt.lineTotal + knit.lineTotal >= 50000, "반품 전에는 무료, 반품 후 남는 셔츠만으로는 기준 미달");
    const returnNo = await toReceived(customerId, order.orderNo, [knit.id], "CHANGE_OF_MIND");
    await inspect(fake, returnNo, [[knit.id, "RESELLABLE"]]);
    const r = await returnOf(returnNo);
    assert.deepEqual([r.returnShippingFee, r.refundAmount], [6000, knit.payAmount - 6000]);
  });

  test("불량(판매자 사유) 전부 반품: 반품 배송비 없음 + 처음 배송비까지 전액 환불 → 주문 취소, 상품은 불량 창고", async () => {
    const fake = new FakeToss();
    const { customerId, order, items } = await delivered(fake, [SHIRT]);
    const dcBefore = await onHandAt(SHIRT, "WAREHOUSE");
    const defectBefore = await onHandAt(SHIRT, "DEFECT");
    const returnNo = await toReceived(customerId, order.orderNo, [items[0].id], "DEFECT");
    await inspect(fake, returnNo, [[items[0].id, "DEFECTIVE"]]);
    const r = await returnOf(returnNo);
    assert.deepEqual([r.status, r.returnShippingFee, r.refundAmount], ["COMPLETED", 0, order.totalPrice], "상품 + 처음 배송비 전액");
    assert.equal(await onHandAt(SHIRT, "WAREHOUSE"), dcBefore, "불량은 판매 재고로 안 돌아감");
    assert.equal(await onHandAt(SHIRT, "DEFECT"), defectBefore + 1);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.deepEqual([o.status, o.fulfillmentStatus], ["CANCELED", "RETURNED"], "남은 상품 없이 반품으로 끝남");
  });

  test("반품 불가(사용 흔적): 환불 없음, 반품센터에서 고객에게 반송, 상품은 다시 배송 완료", async () => {
    const fake = new FakeToss();
    const { customerId, order, items } = await delivered(fake, [SHIRT]);
    const returnNo = await toReceived(customerId, order.orderNo, [items[0].id], "CHANGE_OF_MIND");
    const res = await inspect(fake, returnNo, [[items[0].id, "NOT_RETURNABLE"]]);
    assert.equal(res.status, "REJECTED");
    const r = await returnOf(returnNo);
    assert.deepEqual([r.status, r.refundAmount], ["REJECTED", 0]);
    assert.equal(await onHandAt(SHIRT, "RETURN_CENTER"), 0, "반송으로 반품센터에서 나감");
    assert.equal((await prisma.orderItem.findUniqueOrThrow({ where: { id: items[0].id } })).status, "DELIVERED");
    assert.equal(fake.count("cancel"), 0, "환불 요청 없음");
  });

  test("섞인 결과: 하나는 정상(환불), 하나는 반품 불가 → 환불은 정상 상품만", async () => {
    const fake = new FakeToss();
    const { customerId, order, items } = await delivered(fake, [SHIRT, KNIT]);
    const returnNo = await toReceived(customerId, order.orderNo, items.map((i) => i.id), "DEFECT");
    await inspect(fake, returnNo, [[items[0].id, "RESELLABLE"], [items[1].id, "NOT_RETURNABLE"]]);
    const r = await returnOf(returnNo);
    assert.equal(r.status, "COMPLETED");
    assert.equal(r.refundAmount, items[0].payAmount, "판매자 사유지만 남는 상품(반품 불가 반송)이 있어 처음 배송비는 환불 안 함");
  });

  test("제주 주문 단순 변심: 반품 배송비에 제주 추가 배송비 포함", async () => {
    const fake = new FakeToss();
    const { customerId, order, items } = await delivered(fake, [SHIRT], "63100");
    const returnNo = await toReceived(customerId, order.orderNo, [items[0].id], "SIZE");
    await inspect(fake, returnNo, [[items[0].id, "RESELLABLE"]]);
    const r = await returnOf(returnNo);
    assert.equal(r.returnShippingFee, 3000 + 3000, "편도 기본 + 제주 추가 (원래 유료배송이라 처음 배송비 차감 없음)");
  });

  test("환불 실패 → 검수 완료로 남음 → 정기 작업이 다시 시도해 완료", async () => {
    const fake = new FakeToss();
    const { customerId, order, items } = await delivered(fake, [SHIRT]);
    const returnNo = await toReceived(customerId, order.orderNo, [items[0].id], "DEFECT");
    fake.faults.push({ op: "cancel", type: "error", status: 500, code: "FAILED_INTERNAL_SYSTEM_PROCESSING" });
    const res = await inspect(fake, returnNo, [[items[0].id, "RESELLABLE"]]);
    assert.equal(res.status, "INSPECTED");
    assert.equal((await returnOf(returnNo)).status, "INSPECTED");
    await retryReturnRefunds({ ...deps(fake), now: () => new Date(Date.now() + 5 * 60 * 1000) });
    const r = await returnOf(returnNo);
    assert.equal(r.status, "COMPLETED");
    assert.equal((await prisma.paymentCancel.count({ where: { requestedByRef: returnNo, status: "DONE" } })), 1, "환불은 정확히 한 번");
  });

  test("품절이던 상품이 반품 검수로 돌아오면 재입고 알림", async () => {
    const fake = new FakeToss();
    const { customerId, order, items } = await delivered(fake, [SHIRT]);
    await setAvailable(SHIRT, 0);
    const waiter = await newShopper("반품재입고");
    await subscribeRestock(waiter, id(SHIRT));
    const returnNo = await toReceived(customerId, order.orderNo, [items[0].id], "SIZE");
    await inspect(fake, returnNo, [[items[0].id, "RESELLABLE"]]);
    const s = await prisma.restockSubscription.findFirstOrThrow({ where: { customerId: waiter } });
    assert.equal(s.status, "ARRIVED");
  });

  test("반품 진행 중이면 탈퇴 불가", async () => {
    const fake = new FakeToss();
    const { customerId, order, items } = await delivered(fake, [SHIRT]);
    await requestReturn(customerId, order.orderNo, { orderItemIds: [items[0].id], reason: "SIZE" });
    await assert.rejects(() => requestWithdrawal(customerId, { reasonCode: "OTHER" }), /반품/);
  });

  test("반품 진행 알림은 회원 알림함에 단계별로", async () => {
    const fake = new FakeToss();
    const { customerId, order, items } = await delivered(fake, [SHIRT]);
    const returnNo = await toReceived(customerId, order.orderNo, [items[0].id], "DEFECT");
    await inspect(fake, returnNo, [[items[0].id, "RESELLABLE"]]);
    const titles = (await prisma.notification.findMany({ where: { customerId, type: "RETURN_UPDATE" }, orderBy: { id: "asc" } })).map((n) => n.title);
    assert.deepEqual(titles, ["반품 신청 접수", "반품 승인", "반품 회수 시작", "반품 도착", "반품 환불 완료"]);
  });
});

// ---------------------------------------------------------------
describe("반품 DB 제약", () => {
  test("반품 재고는 단계대로만: 도착 전 반품센터 입고·물류센터로 도착·검수 전 이동 금지, 검수 결과 변경 금지", async () => {
    const fake = new FakeToss();
    const { customerId, order, items } = await delivered(fake, [SHIRT]);
    const r = await requestReturn(customerId, order.orderNo, { orderItemIds: [items[0].id], reason: "SIZE" });
    const ri = (await returnOf(r.returnNo)).items[0];
    const rc = (await prisma.inventoryLocation.findFirstOrThrow({ where: { type: "RETURN_CENTER" } })).id;
    const ledger = (type: string, loc: number, qty: number) =>
      `INSERT INTO "InventoryLedger" ("skuId","locationId","type","qty","balanceAfter","refType","refId","returnItemId","occurredAt","createdAt") SELECT ${id(SHIRT)}, ${loc}, '${type}', ${qty}, b."onHand" + ${qty}, 'RETURN', '${r.returnNo}', ${ri.id}, ${NOW()}, ${NOW()} FROM "InventoryBalance" b WHERE b."skuId" = ${id(SHIRT)} AND b."locationId" = ${loc}`;
    await prisma.inventoryBalance.upsert({ where: { skuId_locationId: { skuId: id(SHIRT), locationId: rc } }, update: {}, create: { skuId: id(SHIRT), locationId: rc } });
    await rejects(ledger("RETURN_IN", rc, 1), "반품 도착은 반품센터에, 도착한 반품마다");
    await approveReturn(r.returnNo);
    await registerReturnPickup(r.returnNo, "CJ", tracking());
    await receiveReturn(r.returnNo, "ADMIN:test");
    await rejects(ledger("RETURN_IN", rc, 1), "도착한 반품마다 한 번만");
    await rejects(ledger("TRANSFER_IN", dc, 1), "검수를 통과한(정상·불량) 반품만");
    await rejects(`UPDATE "OrderItem" SET "status" = 'RETURNED', "returnedAt" = ${NOW()}, "statusChangedAt" = ${NOW()} WHERE "id" = ${items[0].id}`, "OrderItem_return_guard");
    await rejects(`UPDATE "ReturnRequest" SET "status" = 'INSPECTED', "inspectedAt" = ${NOW()}, "refundAmount" = 0, "statusChangedAt" = ${NOW()} WHERE "id" = ${r.id}`, "모든 반품 상품을 검수해야");
    await inspect(fake, r.returnNo, [[items[0].id, "RESELLABLE"]]);
    await rejects(`UPDATE "ReturnItem" SET "inspection" = 'DEFECTIVE' WHERE "id" = ${ri.id}`, "ReturnItem_fixed");
    await rejects(`UPDATE "ReturnRequest" SET "refundAmount" = 1 WHERE "id" = ${r.id}`, "ReturnRequest_fixed");
    await rejects(`DELETE FROM "ReturnRequest" WHERE "id" = ${r.id}`, "ReturnRequest_no_delete");
  });

  test("환불이 끝나지 않았는데 완료 금지, 고객 사유인데 귀책을 판매자로 기록 금지, 반품 기간 지난 상품 담기 금지", async () => {
    const fake = new FakeToss();
    const { customerId, order, items } = await delivered(fake, [SHIRT]);
    const returnNo = await toReceived(customerId, order.orderNo, [items[0].id], "SIZE");
    fake.faults.push({ op: "cancel", type: "error", status: 500, code: "FAILED_INTERNAL_SYSTEM_PROCESSING" });
    await inspect(fake, returnNo, [[items[0].id, "RESELLABLE"]]);
    await rejects(`UPDATE "ReturnRequest" SET "status" = 'COMPLETED', "completedAt" = ${NOW()}, "statusChangedAt" = ${NOW()} WHERE "returnNo" = '${returnNo}'`, "ReturnRequest_");
    const b = await delivered(fake, [SHIRT]);
    await rejects(
      `INSERT INTO "ReturnRequest" ("returnNo","orderId","status","reason","fault","requestedBy","returnShippingFee","statusChangedAt","requestedAt","createdAt","updatedAt") VALUES ('R${b.order.orderNo}-9', ${b.order.id}, 'REQUESTED', 'CHANGE_OF_MIND', 'SELLER', 'CUSTOMER', 0, ${NOW()}, ${NOW()}, ${NOW()}, ${NOW()})`,
      "ReturnRequest_values_ck",
    );
    const late = `'${new Date(Date.now() + 10 * DAY).toISOString().replace("Z", "+00:00")}'`;
    await rejects(
      [
        `INSERT INTO "ReturnRequest" ("returnNo","orderId","status","reason","fault","requestedBy","returnShippingFee","statusChangedAt","requestedAt","createdAt","updatedAt") VALUES ('R${b.order.orderNo}-8', ${b.order.id}, 'REQUESTED', 'SIZE', 'CUSTOMER', 'CUSTOMER', 0, ${late}, ${late}, ${NOW()}, ${NOW()})`,
        `INSERT INTO "ReturnItem" ("returnRequestId","orderItemId","qty") SELECT id, ${b.items[0].id}, 1 FROM "ReturnRequest" WHERE "returnNo" = 'R${b.order.orderNo}-8'`,
      ],
      "ReturnItem_window",
    );
  });
});
