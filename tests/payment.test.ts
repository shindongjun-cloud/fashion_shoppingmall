// 결제 테스트 (임시 DB 복사본 + 가짜 토스 서버)
// 실행: npm test
import { removeTempDb } from "./helpers/temp-db"; // ⚠️ 반드시 첫 줄 (DB 연결 전에 주소를 바꿈)
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { placeOrder } from "../src/lib/checkout";
import { ensureCustomerForUser, getPaidAmountLast12Months, requestWithdrawal, CustomerError } from "../src/lib/customer";
import { getAvailability, recordMovement } from "../src/lib/inventory";
import { decrypt } from "../src/lib/crypto";
import {
  cancelWaitingDepositOrder,
  closeStalePendingOrders,
  confirmOrderPayment,
  defaultPaymentDeps,
  expireOverdueDeposits,
  parseTossDate,
  PaymentError,
  reconcileOpenPayments,
  recordCheckoutFailure,
  receiveWebhook,
  requestPaymentCancel,
  retryOpenCancels,
  retryWebhooks,
  VA_RESERVATION_GRACE_MS,
  type PaymentDeps,
} from "../src/lib/payment";
import { createTossApi, getTossConfigProblem, maskForLog } from "../src/lib/toss";
import { FakeToss } from "./helpers/fake-toss";

class Rollback extends Error {}
const MIN = 60_000;
const DAY = 86_400_000;

function errorText(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const x = e as Error & { meta?: unknown; cause?: unknown };
  return `${e.message} ${JSON.stringify(x.meta ?? {})} ${x.cause ? errorText(x.cause) : ""}`;
}
/** SQL을 트랜잭션 안에서 실행하고 되돌림. 막혀야 하는 쓰기면 expected가 오류에 들어 있어야 함 */
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
  assert.ok(errorText(err).includes(expected), `다른 이유로 실패. 기대: ${expected}\n실제: ${errorText(err)}`);
}
async function passes(sqls: string | string[]) {
  let err: unknown = null;
  try {
    await prisma.$transaction(async (tx) => {
      for (const s of [sqls].flat()) await tx.$executeRawUnsafe(s);
      throw new Rollback();
    });
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof Rollback, `통과해야 하는데 막힘: ${errorText(err)}`);
}

// ---------------------------------------------------------------
// 준비
// ---------------------------------------------------------------
const SKU_CODE = "CP26S006-BK-F";
let skuId = 0;
let dc = 0;

async function newCustomer(name = "결제") {
  const user = await prisma.user.create({ data: { name } });
  return (await ensureCustomerForUser(user.id)).id;
}
async function available() {
  return (await getAvailability([skuId])).get(skuId) ?? 0;
}
async function setAvailable(n: number) {
  const diff = n - (await available());
  if (diff === 0) return;
  await prisma.$transaction((tx) =>
    recordMovement(tx, {
      skuId, locationId: dc, type: diff > 0 ? "INBOUND" : "ADJUST_OUT", qty: diff,
      refType: diff > 0 ? "INBOUND_ORDER" : "STOCK_COUNT", refId: "TEST", reason: "테스트 준비",
    }),
  );
}
function makeDeps(fake: FakeToss, over: Partial<PaymentDeps> = {}): PaymentDeps {
  return { ...defaultPaymentDeps, toss: createTossApi({ transport: fake.transport, secretKey: () => "test_gsk_fake" }), waitForOtherMs: 3000, ...over };
}
/** 고객 + 결제 대기 주문 (실제 placeOrder) + 토스 결제창 인증까지 */
async function checkout(fake: FakeToss, opts: { qty?: number; method?: "카드" | "가상계좌" | "간편결제"; dueDate?: Date; refundAccount?: boolean; customerId?: number } = {}) {
  await setAvailable(Math.max(5, (opts.qty ?? 1) + 2));
  const customerId = opts.customerId ?? (await newCustomer());
  const placed = await placeOrder(customerId, [{ skuId, quantity: opts.qty ?? 1 }]);
  assert.ok(!("error" in placed), JSON.stringify(placed));
  const order = await prisma.order.findUniqueOrThrow({ where: { paymentOrderId: placed.paymentOrderId } });
  const paymentKey = fake.authorize({ orderId: order.paymentOrderId, amount: order.totalPrice, method: opts.method, dueDate: opts.dueDate, refundAccount: opts.refundAccount });
  const input = { customerId, paymentOrderId: order.paymentOrderId, paymentKey, amount: String(order.totalPrice) };
  return { customerId, order, paymentKey, input };
}
const orderOf = (id: number) => prisma.order.findUniqueOrThrow({ where: { id } });
const paymentsOf = (orderId: number) => prisma.payment.findMany({ where: { orderId }, orderBy: { attemptNo: "asc" } });
const reservationsOf = (orderId: number) => prisma.inventoryReservation.findMany({ where: { orderId }, orderBy: { id: "asc" } });
const historyOf = async (paymentId: number) =>
  (await prisma.paymentStatusHistory.findMany({ where: { paymentId }, orderBy: { id: "asc" } })).map((h) => h.toStatus);

before(async () => {
  dc = (await prisma.inventoryLocation.findUniqueOrThrow({ where: { code: "ONLINE_DC" } })).id;
  skuId = (await prisma.sku.findUniqueOrThrow({ where: { skuCode: SKU_CODE } })).id;
});
after(async () => {
  await prisma.$disconnect();
  removeTempDb();
});

// ---------------------------------------------------------------
describe("카드·간편결제 승인", () => {
  test("정상: 주문 결제 완료, 결제 DONE + 카드 상세(가린 번호), 재고 확정, API 기록(멱등키)", async () => {
    const fake = new FakeToss();
    const { order, input } = await checkout(fake);
    const r = await confirmOrderPayment(input, makeDeps(fake));
    assert.deepEqual(r, { kind: "PAID", orderId: order.id });
    const o = await orderOf(order.id);
    assert.equal(o.status, "PAID");
    assert.ok(o.paidAt);
    const [p] = await paymentsOf(order.id);
    assert.equal(p.status, "DONE");
    assert.equal(p.method, "CARD");
    assert.ok(p.approvedAt && p.receiptUrl?.startsWith("https://"));
    assert.equal(p.balanceAmount, order.totalPrice);
    const card = await prisma.paymentCard.findUniqueOrThrow({ where: { paymentId: p.id } });
    assert.equal(card.numberMasked, "43301234****123*");
    assert.equal(card.cardType, "CREDIT");
    assert.deepEqual((await reservationsOf(order.id)).map((x) => x.status), ["CONFIRMED"]);
    assert.deepEqual(await historyOf(p.id), ["IN_PROGRESS", "DONE"]);
    // API 기록: 승인 1건, 멱등키 헤더 = 저장된 키
    const logs = await prisma.paymentApiLog.findMany({ where: { paymentId: p.id } });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].operation, "CONFIRM");
    assert.equal(logs[0].outcome, "SUCCESS");
    assert.equal(logs[0].idempotencyKey, p.confirmIdempotencyKey);
    assert.equal(fake.calls[0].headers["Idempotency-Key"], p.confirmIdempotencyKey);
    assert.equal(fake.calls[0].headers.Authorization, `Basic ${Buffer.from("test_gsk_fake:").toString("base64")}`);
    // 고객 마지막 주문 시각
    assert.ok((await prisma.customer.findUniqueOrThrow({ where: { id: input.customerId } })).lastOrderAt);
  });

  test("간편결제(카드 연결): 간편결제 상세 + 카드 상세 모두 저장", async () => {
    const fake = new FakeToss();
    const { order, input } = await checkout(fake, { method: "간편결제" });
    assert.equal((await confirmOrderPayment(input, makeDeps(fake))).kind, "PAID");
    const [p] = await paymentsOf(order.id);
    assert.equal(p.method, "EASY_PAY");
    assert.equal((await prisma.paymentEasyPay.findUniqueOrThrow({ where: { paymentId: p.id } })).provider, "토스페이");
    assert.ok(await prisma.paymentCard.findUnique({ where: { paymentId: p.id } }));
  });

  test("새로고침·뒤로 가기(같은 결제 키로 다시 옴): 토스를 다시 부르지 않고 완료 화면", async () => {
    const fake = new FakeToss();
    const { order, input } = await checkout(fake);
    await confirmOrderPayment(input, makeDeps(fake));
    const r = await confirmOrderPayment(input, makeDeps(fake));
    assert.deepEqual(r, { kind: "PAID", orderId: order.id });
    assert.equal(fake.count("confirm"), 1);
    assert.equal((await paymentsOf(order.id)).length, 1);
  });

  test("동시에 두 번 들어옴(탭 2개·연타): 토스 승인은 1번, 두 요청 모두 결제 완료 화면", async () => {
    const fake = new FakeToss();
    const { order, input } = await checkout(fake);
    const deps = makeDeps(fake);
    const [a, b] = await Promise.all([confirmOrderPayment(input, deps), confirmOrderPayment(input, deps)]);
    assert.deepEqual([a.kind, b.kind], ["PAID", "PAID"]);
    assert.equal(fake.count("confirm"), 1, "토스 승인 요청은 정확히 1번");
    assert.equal(fake.applied.confirm, 1);
    assert.equal((await paymentsOf(order.id)).length, 1);
    assert.equal((await orderOf(order.id)).status, "PAID");
  });

  test("금액 위조: 토스를 부르지 않음, 실패 기록(AMOUNT_MISMATCH), 주문 취소, 재고 해제", async () => {
    const fake = new FakeToss();
    const { order, input } = await checkout(fake);
    const r = await confirmOrderPayment({ ...input, amount: "100" }, makeDeps(fake));
    assert.equal(r.kind, "FAILED");
    assert.equal(r.kind === "FAILED" && r.code, "AMOUNT_MISMATCH");
    assert.equal(fake.count("confirm"), 0);
    const [p] = await paymentsOf(order.id);
    assert.equal(p.status, "ABORTED");
    assert.equal(p.failCode, "AMOUNT_MISMATCH");
    assert.equal((await orderOf(order.id)).status, "CANCELED");
    assert.deepEqual((await reservationsOf(order.id)).map((x) => [x.status, x.releaseReason]), [["RELEASED", "PAYMENT_FAILED"]]);
  });

  test("주소창 값 형식 검사: 1e3·소수·음수 금액, 이상한 주문번호, 너무 긴 결제 키 → 아무것도 기록하지 않음", async () => {
    const fake = new FakeToss();
    const { order, input } = await checkout(fake);
    for (const bad of [
      { amount: "1e3" }, { amount: `${order.totalPrice}.0` }, { amount: "-1" }, { amount: "" }, { amount: null },
      { paymentOrderId: "abc" }, { paymentOrderId: "order_<script>" }, { paymentKey: "x".repeat(201) }, { paymentKey: 123 },
    ]) {
      const r = await confirmOrderPayment({ ...input, ...bad } as typeof input, makeDeps(fake));
      assert.deepEqual(r, { kind: "FAILED", code: "INVALID_REQUEST" }, JSON.stringify(bad));
    }
    assert.equal(fake.calls.length, 0);
    assert.equal((await paymentsOf(order.id)).length, 0);
    assert.equal((await orderOf(order.id)).status, "PENDING");
  });

  test("다른 고객의 주문번호로 승인 시도 → 주문을 찾을 수 없음 (토스 호출 없음)", async () => {
    const fake = new FakeToss();
    const { input } = await checkout(fake);
    const stranger = await newCustomer("남");
    const r = await confirmOrderPayment({ ...input, customerId: stranger }, makeDeps(fake));
    assert.deepEqual(r, { kind: "FAILED", code: "ORDER_NOT_FOUND" });
    assert.equal(fake.calls.length, 0);
  });

  test("카드사 거절: 실패 기록(코드·메시지), 주문 취소, 재고 해제, 실패 화면 코드", async () => {
    const fake = new FakeToss();
    fake.faults.push({ op: "confirm", type: "error", status: 403, code: "REJECT_CARD_COMPANY", message: "카드사 거절" });
    const { order, input } = await checkout(fake);
    const r = await confirmOrderPayment(input, makeDeps(fake));
    assert.deepEqual(r, { kind: "FAILED", code: "REJECT_CARD_COMPANY", orderId: order.id });
    const [p] = await paymentsOf(order.id);
    assert.deepEqual([p.status, p.failCode, p.failMessage], ["ABORTED", "REJECT_CARD_COMPANY", "카드사 거절"]);
    assert.equal((await orderOf(order.id)).status, "CANCELED");
    assert.equal((await reservationsOf(order.id))[0].releaseReason, "PAYMENT_FAILED");
    const log = await prisma.paymentApiLog.findFirstOrThrow({ where: { paymentId: p.id } });
    assert.deepEqual([log.outcome, log.httpStatus, log.errorCode], ["FAIL", 403, "REJECT_CARD_COMPANY"]);
  });

  test("재고가 그 사이 소진: 토스를 부르지 않음(돈이 나가지 않음), OUT_OF_STOCK", async () => {
    const fake = new FakeToss();
    const { order, input } = await checkout(fake);
    // 예약을 만료시키고 남은 재고를 0으로
    await prisma.$executeRawUnsafe(`UPDATE "InventoryReservation" SET "status" = 'EXPIRED', "releasedAt" = '${new Date().toISOString().replace("Z", "+00:00")}' WHERE "orderId" = ${order.id}`);
    await setAvailable(0);
    const r = await confirmOrderPayment(input, makeDeps(fake));
    assert.equal(r.kind === "FAILED" && r.code, "OUT_OF_STOCK");
    assert.equal(fake.count("confirm"), 0);
    assert.equal((await paymentsOf(order.id))[0].status, "ABORTED");
    assert.equal((await orderOf(order.id)).status, "CANCELED");
  });
});

// ---------------------------------------------------------------
describe("응답을 못 받았을 때 (실패로 단정하지 않음)", () => {
  test("토스는 승인했는데 응답이 끊김 → 바로 조회해서 결제 완료 (승인은 1번)", async () => {
    const fake = new FakeToss();
    fake.faults.push({ op: "confirm", type: "timeout-after" });
    const { order, input } = await checkout(fake);
    const r = await confirmOrderPayment(input, makeDeps(fake));
    assert.deepEqual(r, { kind: "PAID", orderId: order.id });
    assert.equal(fake.applied.confirm, 1);
    assert.equal(fake.count("get"), 1);
    const [p] = await paymentsOf(order.id);
    assert.deepEqual(await historyOf(p.id), ["IN_PROGRESS", "UNKNOWN", "DONE"]);
    const logs = await prisma.paymentApiLog.findMany({ where: { paymentId: p.id }, orderBy: { id: "asc" } });
    assert.deepEqual(logs.map((l) => [l.operation, l.outcome]), [["CONFIRM", "TIMEOUT"], ["GET_PAYMENT", "SUCCESS"]]);
  });

  test("토스에 도착하기 전에 끊김 → 조회하니 승인 전 → 같은 멱등키로 다시 승인 → 완료", async () => {
    const fake = new FakeToss();
    fake.faults.push({ op: "confirm", type: "timeout-before" });
    const { order, input } = await checkout(fake);
    const r = await confirmOrderPayment(input, makeDeps(fake));
    assert.equal(r.kind, "PAID");
    const confirms = fake.calls.filter((c) => c.op === "confirm");
    assert.equal(confirms.length, 2);
    assert.equal(confirms[0].headers["Idempotency-Key"], confirms[1].headers["Idempotency-Key"], "재시도는 같은 멱등키");
    assert.equal(fake.applied.confirm, 1);
    assert.deepEqual(await historyOf((await paymentsOf(order.id))[0].id), ["IN_PROGRESS", "UNKNOWN", "IN_PROGRESS", "DONE"]);
  });

  test("토스 서버 오류(500)도 결과 모름으로 처리 → 조회로 확정", async () => {
    const fake = new FakeToss();
    fake.faults.push({ op: "confirm", type: "error", status: 500, code: "FAILED_PAYMENT_INTERNAL_SYSTEM_PROCESSING" });
    const { input } = await checkout(fake);
    // 500이 왔지만 실제로는 처리되지 않음 → 조회 결과 승인 전 → 재승인
    assert.equal((await confirmOrderPayment(input, makeDeps(fake))).kind, "PAID");
    assert.equal(fake.applied.confirm, 1);
  });

  test("응답도 끊기고 조회도 실패 → '결제 확인 중' + 재고 유지 → 정기 작업(대사)이 확정", async () => {
    const fake = new FakeToss();
    fake.faults.push({ op: "confirm", type: "timeout-after" }, { op: "get", type: "timeout-before" });
    const { order, input } = await checkout(fake);
    const r = await confirmOrderPayment(input, makeDeps(fake));
    assert.deepEqual(r, { kind: "PROCESSING", orderId: order.id });
    assert.equal((await paymentsOf(order.id))[0].status, "UNKNOWN");
    assert.equal((await orderOf(order.id)).status, "PENDING");
    assert.equal((await reservationsOf(order.id))[0].status, "RESERVED", "결과를 모르는 동안 재고는 잡아 둠");
    // 같은 고객이 다른 탭에서 새 주문을 만들어도, 결과 확인 중인 주문의 재고는 풀지 않음
    await setAvailable(10);
    const again = await placeOrder(input.customerId, [{ skuId, quantity: 1 }]);
    assert.ok(!("error" in again));
    assert.equal((await reservationsOf(order.id))[0].status, "RESERVED");
    assert.equal((await orderOf(order.id)).status, "PENDING");
    // 정기 작업
    assert.equal(await reconcileOpenPayments(makeDeps(fake)), 1);
    assert.equal((await orderOf(order.id)).status, "PAID");
  });

  test("승인 가능 시간(10분)이 지난 결제는 대사에서 만료 처리 + 재고 해제", async () => {
    const fake = new FakeToss();
    fake.faults.push({ op: "confirm", type: "timeout-before" }, { op: "get", type: "timeout-before" });
    const { order, input } = await checkout(fake);
    assert.equal((await confirmOrderPayment(input, makeDeps(fake))).kind, "PROCESSING");
    const later = new Date(Date.now() + 11 * MIN);
    await reconcileOpenPayments(makeDeps(fake, { now: () => later }));
    const [p] = await paymentsOf(order.id);
    assert.equal(p.status, "EXPIRED");
    assert.equal(fake.applied.confirm, 0, "10분이 지나면 다시 승인하지 않음");
    assert.equal((await orderOf(order.id)).status, "CANCELED");
    assert.equal((await reservationsOf(order.id))[0].status, "RELEASED");
  });

  test("'이미 처리된 결제' 응답 → 실패로 단정하지 않고 조회해서 맞춤", async () => {
    const fake = new FakeToss();
    const { order, input } = await checkout(fake);
    // 다른 경로로 이미 승인됨
    fake.payments.get(input.paymentKey)!.status = "DONE";
    fake.payments.get(input.paymentKey)!.approvedAt = new Date().toISOString().replace("Z", "+09:00");
    const r = await confirmOrderPayment(input, makeDeps(fake));
    assert.equal(r.kind, "PAID");
    assert.equal((await orderOf(order.id)).status, "PAID");
  });
});

// ---------------------------------------------------------------
describe("승인 후 주문 처리 실패 → 결제 취소(보상)", () => {
  const failingFinalize = async () => {
    throw new Error("DB 저장 실패 흉내");
  };

  test("보상 취소 성공: 결제 CANCELED, 주문 취소, 재고 COMPENSATED, 실재고 그대로", async () => {
    const fake = new FakeToss();
    const { order, input } = await checkout(fake);
    const onHandBefore = (await prisma.inventoryBalance.findUniqueOrThrow({ where: { skuId_locationId: { skuId, locationId: dc } } })).onHand;
    const r = await confirmOrderPayment(input, makeDeps(fake, { finalizeOrder: failingFinalize }));
    assert.deepEqual(r, { kind: "FAILED", code: "ORDER_ERROR_REFUNDED", orderId: order.id });
    const [p] = await paymentsOf(order.id);
    assert.equal(p.status, "CANCELED");
    assert.equal(p.canceledAmount, order.totalPrice);
    const [c] = await prisma.paymentCancel.findMany({ where: { paymentId: p.id } });
    assert.deepEqual([c.status, c.reasonCode, c.requestedBy], ["DONE", "ORDER_ERROR", "SYSTEM"]);
    assert.equal((await orderOf(order.id)).status, "CANCELED");
    assert.equal((await reservationsOf(order.id))[0].releaseReason, "COMPENSATED");
    assert.equal((await prisma.inventoryBalance.findUniqueOrThrow({ where: { skuId_locationId: { skuId, locationId: dc } } })).onHand, onHandBefore);
    assert.equal(fake.payments.get(input.paymentKey)!.status, "CANCELED", "토스에서도 취소됨");
  });

  test("보상 취소까지 실패 → 주문 '환불 확인 중'(CANCEL_FAILED), 재고 해제. 나중에 다시 취소하면 주문 취소", async () => {
    const fake = new FakeToss();
    fake.faults.push({ op: "cancel", type: "error", status: 400, code: "FAILED_REFUND_PROCESS" });
    const { order, input } = await checkout(fake);
    const r = await confirmOrderPayment(input, makeDeps(fake, { finalizeOrder: failingFinalize }));
    assert.deepEqual(r, { kind: "FAILED", code: "ORDER_ERROR_REFUND_PENDING", orderId: order.id });
    const [p] = await paymentsOf(order.id);
    assert.equal(p.status, "DONE", "돈은 아직 결제된 상태");
    assert.equal((await orderOf(order.id)).status, "CANCEL_FAILED");
    assert.equal((await reservationsOf(order.id))[0].status, "RELEASED");
    // 새로고침해도 같은 안내
    assert.deepEqual(await confirmOrderPayment(input, makeDeps(fake)), { kind: "FAILED", code: "ORDER_ERROR_REFUND_PENDING", orderId: order.id });
    // 관리자가 다시 취소
    const again = await requestPaymentCancel(p.id, { reasonCode: "ADMIN", reasonText: "수동 환불", requestedBy: "ADMIN", requestedByRef: "admin1" }, makeDeps(fake));
    assert.equal(again.status, "DONE");
    assert.equal((await orderOf(order.id)).status, "CANCELED");
  });

  test("보상 취소 응답이 끊김 → 취소 UNKNOWN → 정기 작업이 같은 멱등키로 재요청 → 한 번만 취소", async () => {
    const fake = new FakeToss();
    fake.faults.push({ op: "cancel", type: "timeout-after" });
    const { order, input } = await checkout(fake);
    await confirmOrderPayment(input, makeDeps(fake, { finalizeOrder: failingFinalize }));
    const [p] = await paymentsOf(order.id);
    const [c] = await prisma.paymentCancel.findMany({ where: { paymentId: p.id } });
    assert.equal(c.status, "UNKNOWN");
    assert.equal((await orderOf(order.id)).status, "CANCEL_FAILED");
    assert.equal(await retryOpenCancels(makeDeps(fake, { now: () => new Date(Date.now() + 2 * MIN) })), 1);
    assert.equal(fake.applied.cancel, 1, "토스 취소는 정확히 1번");
    const cancels = fake.calls.filter((x) => x.op === "cancel");
    assert.equal(cancels[0].headers["Idempotency-Key"], cancels[1].headers["Idempotency-Key"]);
    assert.equal((await prisma.paymentCancel.findUniqueOrThrow({ where: { id: c.id } })).status, "DONE");
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status, "CANCELED");
    assert.equal((await orderOf(order.id)).status, "CANCELED");
  });
});

// ---------------------------------------------------------------
describe("가상계좌", () => {
  // 실제 입금 알림처럼 거래 키는 결제마다 다름 (가짜 토스의 마지막 거래 키)
  const depositBody = (paymentOrderId: string, secret: string, status = "DONE", tx = `tx_dep_${paymentOrderId}`) =>
    JSON.stringify({ createdAt: "2026-11-18T10:00:00.000000", secret, status, transactionKey: tx, orderId: paymentOrderId });

  test("발급: 입금 대기, 계좌번호 암호화, 재고 예약을 입금 기한 + 1시간까지 연장", async () => {
    const fake = new FakeToss();
    const due = new Date(Date.now() + 3 * DAY);
    due.setMilliseconds(0);
    const { order, input } = await checkout(fake, { method: "가상계좌", dueDate: due });
    const r = await confirmOrderPayment(input, makeDeps(fake));
    assert.deepEqual(r, { kind: "WAITING_DEPOSIT", orderId: order.id });
    assert.equal((await orderOf(order.id)).status, "WAITING_DEPOSIT");
    const [p] = await paymentsOf(order.id);
    assert.equal(p.status, "WAITING_FOR_DEPOSIT");
    assert.ok(p.secretHash && p.secretHash.length === 64, "secret은 해시로만");
    const va = await prisma.paymentVirtualAccount.findUniqueOrThrow({ where: { paymentId: p.id } });
    assert.ok(!va.accountNumberEnc.includes("X6516"), "평문 계좌번호 저장 금지");
    assert.equal(decrypt(va.accountNumberEnc), fake.payments.get(input.paymentKey)!.virtualAccount!.accountNumber);
    assert.equal(va.dueDate.getTime(), due.getTime(), "입금 기한(시간대 없는 값)을 한국 시간으로 해석");
    const rs = await reservationsOf(order.id);
    assert.deepEqual(rs.map((x) => [x.status, x.releaseReason]), [["RELEASED", "RENEWED"], ["RESERVED", null]]);
    assert.equal(rs[1].expiresAt.getTime(), due.getTime() + VA_RESERVATION_GRACE_MS);
  });

  test("입금 웹훅(DEPOSIT_CALLBACK, secret 일치) → 토스 조회로 확인 → 결제 완료 + 재고 확정", async () => {
    const fake = new FakeToss();
    const { order, input } = await checkout(fake, { method: "가상계좌" });
    await confirmOrderPayment(input, makeDeps(fake));
    fake.deposit(input.paymentKey);
    const secret = fake.payments.get(input.paymentKey)!.secret!;
    const res = await receiveWebhook(depositBody(order.paymentOrderId, secret), { transmissionId: "t1", retriedCount: "0" }, makeDeps(fake));
    assert.equal(res.httpStatus, 200);
    const ev = await prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { id: res.eventId! } });
    assert.equal(ev.status, "PROCESSED");
    assert.ok(!ev.payload.includes(secret), "웹훅 원문의 secret은 가려서 저장");
    assert.equal((await orderOf(order.id)).status, "PAID");
    const [p] = await paymentsOf(order.id);
    assert.equal(p.status, "DONE");
    assert.ok((await prisma.paymentVirtualAccount.findUniqueOrThrow({ where: { paymentId: p.id } })).depositedAt);
    assert.equal((await reservationsOf(order.id)).at(-1)!.status, "CONFIRMED");
  });

  test("secret이 틀린 입금 웹훅(위조) → 무시, 토스 조회도 하지 않음, 주문 그대로", async () => {
    const fake = new FakeToss();
    const { order, input } = await checkout(fake, { method: "가상계좌" });
    await confirmOrderPayment(input, makeDeps(fake));
    const getsBefore = fake.count("get");
    const res = await receiveWebhook(depositBody(order.paymentOrderId, "forged-secret"), {}, makeDeps(fake));
    assert.equal(res.httpStatus, 200);
    assert.equal((await prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { id: res.eventId! } })).status, "IGNORED");
    assert.equal(fake.count("get"), getsBefore);
    assert.equal((await orderOf(order.id)).status, "WAITING_DEPOSIT");
  });

  test("같은 웹훅이 두 번 와도 한 번만 처리", async () => {
    const fake = new FakeToss();
    const { order, input } = await checkout(fake, { method: "가상계좌" });
    await confirmOrderPayment(input, makeDeps(fake));
    fake.deposit(input.paymentKey);
    const body = depositBody(order.paymentOrderId, fake.payments.get(input.paymentKey)!.secret!);
    const first = await receiveWebhook(body, { retriedCount: "0" }, makeDeps(fake));
    const second = await receiveWebhook(body, { retriedCount: "1" }, makeDeps(fake));
    assert.equal(second.duplicate, true);
    assert.equal(await prisma.paymentWebhookEvent.count({ where: { pgOrderId: order.paymentOrderId } }), 1);
    assert.ok(first.eventId);
  });

  test("웹훅 내용은 믿지 않음: '입금 완료'라고 위조해도 토스 조회 결과가 입금 대기면 그대로", async () => {
    const fake = new FakeToss();
    const { order, input } = await checkout(fake, { method: "가상계좌" });
    await confirmOrderPayment(input, makeDeps(fake));
    const forged = { ...fake.payments.get(input.paymentKey)!, status: "DONE", approvedAt: "2026-11-18T10:00:00+09:00" };
    const res = await receiveWebhook(JSON.stringify({ eventType: "PAYMENT_STATUS_CHANGED", createdAt: "2026-11-18T10:00:00.000000", data: forged }), {}, makeDeps(fake));
    assert.equal(res.httpStatus, 200);
    assert.equal((await orderOf(order.id)).status, "WAITING_DEPOSIT");
    assert.equal((await paymentsOf(order.id))[0].status, "WAITING_FOR_DEPOSIT");
  });

  test("입금 기한 지남 → 정기 작업이 토스 확인 후 만료, 주문 '입금 기한 만료', 재고 DEPOSIT_EXPIRED", async () => {
    const fake = new FakeToss();
    const { order, input } = await checkout(fake, { method: "가상계좌", dueDate: new Date(Date.now() + 60 * MIN) });
    await confirmOrderPayment(input, makeDeps(fake));
    const later = new Date(Date.now() + 2 * 60 * MIN);
    assert.equal(await expireOverdueDeposits(makeDeps(fake, { now: () => later })), 1);
    const [p] = await paymentsOf(order.id);
    assert.equal(p.status, "EXPIRED");
    assert.equal((await prisma.paymentVirtualAccount.findUniqueOrThrow({ where: { paymentId: p.id } })).expired, true);
    assert.equal((await orderOf(order.id)).status, "EXPIRED");
    assert.equal((await reservationsOf(order.id)).at(-1)!.releaseReason, "DEPOSIT_EXPIRED");
  });

  test("기한이 지났지만 실제로는 입금됨(웹훅 유실) → 만료시키지 않고 결제 완료", async () => {
    const fake = new FakeToss();
    const { order, input } = await checkout(fake, { method: "가상계좌", dueDate: new Date(Date.now() + 60 * MIN) });
    await confirmOrderPayment(input, makeDeps(fake));
    fake.deposit(input.paymentKey);
    assert.equal(await expireOverdueDeposits(makeDeps(fake, { now: () => new Date(Date.now() + 2 * 60 * MIN) })), 0);
    assert.equal((await orderOf(order.id)).status, "PAID");
  });

  test("고객이 입금 전 주문 취소 → 전액 취소(금액·환불계좌 없이 요청), 주문 취소, 재고 ORDER_CANCELED", async () => {
    const fake = new FakeToss();
    const { order, input } = await checkout(fake, { method: "가상계좌" });
    await confirmOrderPayment(input, makeDeps(fake));
    assert.equal(await cancelWaitingDepositOrder(input.customerId, order.id, makeDeps(fake)), "DONE");
    const req = fake.calls.find((x) => x.op === "cancel")!.body as Record<string, unknown>;
    assert.equal(req.cancelAmount, undefined, "전액 취소는 금액을 보내지 않음");
    assert.equal(req.refundReceiveAccount, undefined);
    assert.equal((await paymentsOf(order.id))[0].status, "CANCELED");
    assert.equal((await orderOf(order.id)).status, "CANCELED");
    assert.equal((await reservationsOf(order.id)).at(-1)!.releaseReason, "ORDER_CANCELED");
    // 다른 사람 주문은 취소 불가, 두 번 취소 불가
    assert.equal(await cancelWaitingDepositOrder(input.customerId + 99999, order.id, makeDeps(fake)), "NOT_FOUND");
    assert.equal(await cancelWaitingDepositOrder(input.customerId, order.id, makeDeps(fake)), "NOT_WAITING");
  });

  test("입금 대기 중에는 탈퇴 신청 불가", async () => {
    const fake = new FakeToss();
    const { input } = await checkout(fake, { method: "가상계좌" });
    await confirmOrderPayment(input, makeDeps(fake));
    await assert.rejects(() => requestWithdrawal(input.customerId, { reasonCode: "OTHER" }), (e) => e instanceof CustomerError && /입금 대기/.test(e.message));
  });

  test("입금된 가상계좌 취소: 환불 계좌 없으면 거부, 있으면 취소 후 계좌 암호문 파기(가린 값만 남김)", async () => {
    const fake = new FakeToss();
    const { order, input } = await checkout(fake, { method: "가상계좌" });
    await confirmOrderPayment(input, makeDeps(fake));
    fake.deposit(input.paymentKey);
    await receiveWebhook(depositBody(order.paymentOrderId, fake.payments.get(input.paymentKey)!.secret!), {}, makeDeps(fake));
    const [p] = await paymentsOf(order.id);
    assert.equal(p.status, "DONE");
    await assert.rejects(
      () => requestPaymentCancel(p.id, { reasonCode: "CUSTOMER_REQUEST", reasonText: "단순 변심", requestedBy: "CUSTOMER" }, makeDeps(fake)),
      (e) => e instanceof PaymentError && /환불 계좌/.test(e.message),
    );
    const r = await requestPaymentCancel(
      p.id,
      { reasonCode: "CUSTOMER_REQUEST", reasonText: "단순 변심", requestedBy: "CUSTOMER", refundAccount: { bankCode: "88", accountNumber: "110-123-456789", holderName: "홍길동" } },
      makeDeps(fake),
    );
    assert.equal(r.status, "DONE");
    const sent = fake.calls.filter((x) => x.op === "cancel").at(-1)!.body as { refundReceiveAccount: { accountNumber: string } };
    assert.equal(sent.refundReceiveAccount.accountNumber, "110-123-456789", "토스에는 원래 계좌번호를 보냄");
    const ra = await prisma.paymentRefundAccount.findFirstOrThrow({ where: { paymentId: p.id } });
    assert.deepEqual([ra.accountNumberEnc, ra.holderNameEnc, ra.accountNumberMasked, ra.holderNameMasked], [null, null, "********6789", "홍*동"]);
    assert.ok(ra.wipedAt);
    // API 기록에도 원래 계좌번호가 남지 않음
    const log = await prisma.paymentApiLog.findFirstOrThrow({ where: { paymentId: p.id, operation: "CANCEL" }, orderBy: { id: "desc" } });
    assert.ok(!log.requestBody!.includes("456789") || log.requestBody!.includes("********6789"));
    assert.ok(!log.requestBody!.includes("110-123-456789"));
  });
});

// ---------------------------------------------------------------
describe("부분·전체 취소", () => {
  async function paid(fake: FakeToss, qty = 3) {
    const c = await checkout(fake, { qty });
    assert.equal((await confirmOrderPayment(c.input, makeDeps(fake))).kind, "PAID");
    return { ...c, payment: (await paymentsOf(c.order.id))[0] };
  }

  test("부분 취소 2번 → 부분취소 → 전액취소, 금액·잔액·이력이 트리거로 계산됨", async () => {
    const fake = new FakeToss();
    const { order, payment } = await paid(fake);
    const part = Math.floor(order.totalPrice / 3);
    const deps = makeDeps(fake);
    assert.equal((await requestPaymentCancel(payment.id, { amount: part, reasonCode: "ADMIN", reasonText: "1개 반품", requestedBy: "ADMIN" }, deps)).status, "DONE");
    let p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    assert.deepEqual([p.status, p.canceledAmount, p.balanceAmount], ["PARTIAL_CANCELED", part, order.totalPrice - part]);
    assert.equal((fake.calls.filter((x) => x.op === "cancel")[0].body as { cancelAmount: number }).cancelAmount, part, "부분 취소는 금액 지정");
    assert.equal((await orderOf(order.id)).status, "PAID", "부분 취소는 주문 상태 유지");
    assert.equal(await requestPaymentCancel(payment.id, { reasonCode: "ADMIN", reasonText: "나머지 취소", requestedBy: "ADMIN" }, deps).then((r) => r.status), "DONE");
    p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    assert.deepEqual([p.status, p.canceledAmount, p.balanceAmount], ["CANCELED", order.totalPrice, 0]);
    assert.deepEqual(await historyOf(p.id), ["IN_PROGRESS", "DONE", "PARTIAL_CANCELED", "CANCELED"]);
    assert.equal((await orderOf(order.id)).status, "CANCELED");
  });

  test("남은 금액보다 많이 취소 → 토스를 부르기 전에 거부", async () => {
    const fake = new FakeToss();
    const { order, payment } = await paid(fake);
    await assert.rejects(
      () => requestPaymentCancel(payment.id, { amount: order.totalPrice + 1, reasonCode: "ADMIN", reasonText: "x", requestedBy: "ADMIN" }, makeDeps(fake)),
      (e) => e instanceof PaymentError && /많아요/.test(e.message),
    );
    assert.equal(fake.count("cancel"), 0);
  });

  test("동시에 두 번 취소(각 60%) → 하나만 진행, 합계가 결제 금액을 넘지 않음", async () => {
    const fake = new FakeToss();
    const { order, payment } = await paid(fake);
    const amount = Math.ceil(order.totalPrice * 0.6);
    const deps = makeDeps(fake);
    const results = await Promise.allSettled([
      requestPaymentCancel(payment.id, { amount, reasonCode: "ADMIN", reasonText: "a", requestedBy: "ADMIN" }, deps),
      requestPaymentCancel(payment.id, { amount, reasonCode: "ADMIN", reasonText: "b", requestedBy: "ADMIN" }, deps),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    assert.equal(fake.applied.cancel, 1);
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).canceledAmount, amount);
  });

  test("토스 상점관리자에서 직접 취소 → 웹훅으로 반영(PG_SYNC), 주문 취소", async () => {
    const fake = new FakeToss();
    const { order, payment, input } = await paid(fake);
    fake.cancelOutside(input.paymentKey, order.totalPrice);
    const data = fake.payments.get(input.paymentKey)!;
    const res = await receiveWebhook(JSON.stringify({ eventType: "PAYMENT_STATUS_CHANGED", createdAt: "2026-11-18T10:00:00.000000", data }), {}, makeDeps(fake));
    assert.equal((await prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { id: res.eventId! } })).status, "PROCESSED");
    const [c] = await prisma.paymentCancel.findMany({ where: { paymentId: payment.id } });
    assert.deepEqual([c.reasonCode, c.status, c.cancelAmount], ["PG_SYNC", "DONE", order.totalPrice]);
    assert.equal((await orderOf(order.id)).status, "CANCELED");
  });

  test("등급 산정 금액은 부분 취소를 뺀 순결제 금액", async () => {
    const fake = new FakeToss();
    const { order, payment, customerId } = await paid(fake);
    await requestPaymentCancel(payment.id, { amount: 1000, reasonCode: "ADMIN", reasonText: "x", requestedBy: "ADMIN" }, makeDeps(fake));
    assert.equal(await getPaidAmountLast12Months(customerId), order.totalPrice - 1000);
  });
});

// ---------------------------------------------------------------
describe("결제창 실패·이탈, 방치 주문", () => {
  test("결제창 취소(주문번호 없이 옴) → 가장 최근 결제 대기 주문의 시도 기록 + 재고 해제 + 주문 취소", async () => {
    const fake = new FakeToss();
    const { order, customerId } = await checkout(fake);
    const r = await recordCheckoutFailure(customerId, { code: "PAY_PROCESS_CANCELED", message: "사용자가 취소" });
    assert.deepEqual(r, { code: "PAY_PROCESS_CANCELED", orderId: order.id });
    const [p] = await paymentsOf(order.id);
    assert.deepEqual([p.status, p.statusSource, p.failCode, p.paymentKey], ["ABORTED", "WINDOW", "PAY_PROCESS_CANCELED", null]);
    assert.equal((await orderOf(order.id)).status, "CANCELED");
    assert.equal((await reservationsOf(order.id))[0].status, "RELEASED");
  });

  test("결제창 실패 코드가 이상하면 기본 코드로 (주소창 값 검증)", async () => {
    const fake = new FakeToss();
    const { customerId } = await checkout(fake);
    assert.equal((await recordCheckoutFailure(customerId, { code: "<script>" })).code, "PAY_PROCESS_ABORTED");
  });

  test("다른 탭에서 승인 진행 중인 주문은 결제창 실패 처리로 건드리지 않음", async () => {
    const fake = new FakeToss();
    fake.faults.push({ op: "confirm", type: "timeout-after" }, { op: "get", type: "timeout-before" });
    const { order, input, customerId } = await checkout(fake);
    assert.equal((await confirmOrderPayment(input, makeDeps(fake))).kind, "PROCESSING");
    await recordCheckoutFailure(customerId, { paymentOrderId: order.paymentOrderId, code: "PAY_PROCESS_ABORTED" });
    assert.equal((await orderOf(order.id)).status, "PENDING");
    assert.equal((await reservationsOf(order.id))[0].status, "RESERVED");
  });

  test("1시간 넘게 방치된 결제 대기 주문은 정기 작업이 취소", async () => {
    const fake = new FakeToss();
    const { order } = await checkout(fake);
    assert.ok((await closeStalePendingOrders(new Date(Date.now() + 61 * MIN))) >= 1);
    assert.equal((await orderOf(order.id)).status, "CANCELED");
  });
});

// ---------------------------------------------------------------
describe("웹훅 처리 실패·위조 데이터", () => {
  test("우리 결제가 아닌 웹훅 → 무시(IGNORED), 형식이 틀린 본문 → 400", async () => {
    const fake = new FakeToss();
    const res = await receiveWebhook(JSON.stringify({ eventType: "PAYMENT_STATUS_CHANGED", data: { paymentKey: "unknown_key", orderId: "order_x123", status: "DONE", totalAmount: 1 } }), {}, makeDeps(fake));
    assert.equal((await prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { id: res.eventId! } })).status, "IGNORED");
    assert.equal((await receiveWebhook("{not json", {}, makeDeps(fake))).httpStatus, 400);
  });

  test("토스 조회가 실패하면 FAILED로 남기고 정기 작업이 다시 처리", async () => {
    const fake = new FakeToss();
    const { order, input } = await checkout(fake, { method: "가상계좌" });
    await confirmOrderPayment(input, makeDeps(fake));
    fake.deposit(input.paymentKey);
    fake.faults.push({ op: "get", type: "timeout-before" });
    const body = JSON.stringify({ createdAt: "2026-11-18T10:00:00.000000", secret: fake.payments.get(input.paymentKey)!.secret, status: "DONE", transactionKey: "tx_r", orderId: order.paymentOrderId });
    const res = await receiveWebhook(body, {}, makeDeps(fake));
    assert.equal((await prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { id: res.eventId! } })).status, "FAILED");
    assert.equal((await orderOf(order.id)).status, "WAITING_DEPOSIT");
    await retryWebhooks(makeDeps(fake));
    assert.equal((await prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { id: res.eventId! } })).status, "PROCESSED");
    assert.equal((await orderOf(order.id)).status, "PAID");
  });

  test("토스 금액이 우리 기록과 다르면 반영하지 않음 (위조·버그 방지)", async () => {
    const fake = new FakeToss();
    const { order, input } = await checkout(fake, { method: "가상계좌" });
    await confirmOrderPayment(input, makeDeps(fake));
    fake.deposit(input.paymentKey);
    fake.payments.get(input.paymentKey)!.totalAmount = 1; // 토스 쪽 금액이 다르다고 가정
    await receiveWebhook(JSON.stringify({ eventType: "PAYMENT_STATUS_CHANGED", data: fake.payments.get(input.paymentKey) }), {}, makeDeps(fake));
    const ev = await prisma.paymentWebhookEvent.findFirstOrThrow({ where: { paymentKey: input.paymentKey }, orderBy: { id: "desc" } });
    assert.equal(ev.status, "FAILED");
    assert.match(ev.lastError ?? "", /다릅니다/);
    assert.equal((await orderOf(order.id)).status, "WAITING_DEPOSIT");
  });
});

// ---------------------------------------------------------------
describe("설정·날짜·로그 가리기", () => {
  test("토스 키 설정 검사", () => {
    assert.equal(getTossConfigProblem({ NEXT_PUBLIC_TOSS_CLIENT_KEY: "test_gck_a", TOSS_SECRET_KEY: "test_gsk_b" }), null);
    assert.match(getTossConfigProblem({ NEXT_PUBLIC_TOSS_CLIENT_KEY: "test_gck_a", TOSS_SECRET_KEY: "" })!, /시크릿 키.*비어/);
    assert.match(getTossConfigProblem({ NEXT_PUBLIC_TOSS_CLIENT_KEY: "", TOSS_SECRET_KEY: "test_gsk_b" })!, /클라이언트 키.*비어/);
    assert.match(getTossConfigProblem({ NEXT_PUBLIC_TOSS_CLIENT_KEY: "test_gck_a", TOSS_SECRET_KEY: "live_gsk_b" })!, /모드/);
    assert.match(getTossConfigProblem({ NEXT_PUBLIC_TOSS_CLIENT_KEY: "test_ck_a", TOSS_SECRET_KEY: "test_sk_b" })!, /결제위젯/);
  });

  test("토스 날짜: 시간대가 없으면 한국 시간으로 해석", () => {
    assert.equal(parseTossDate("2026-11-20T23:59:59")!.toISOString(), "2026-11-20T14:59:59.000Z");
    assert.equal(parseTossDate("2026-11-20T10:00:00+09:00")!.toISOString(), "2026-11-20T01:00:00.000Z");
    assert.equal(parseTossDate("이상한 값"), null);
    assert.equal(parseTossDate(null), null);
  });

  test("로그 가리기: secret·계좌번호·이름·전화·이메일", () => {
    const masked = maskForLog({
      secret: "ps_abc",
      virtualAccount: { accountNumber: "X6516123456789", customerName: "홍길동", refundReceiveAccount: { accountNumber: "110123456789", holderName: "김철수" } },
      customerMobilePhone: "01012345678",
      customerEmail: "hong@example.com",
      card: { number: "43301234****123*" },
    }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(masked.secret, "[가림]");
    assert.equal(masked.virtualAccount.accountNumber, "*********6789");
    assert.equal(masked.virtualAccount.customerName, "홍*동");
    assert.equal(masked.virtualAccount.refundReceiveAccount.accountNumber, "********6789");
    assert.equal(masked.customerMobilePhone, "010-****-5678");
    assert.equal(masked.customerEmail, "ho**@example.com");
    assert.equal(masked.card.number, "43301234****123*");
  });
});

// ---------------------------------------------------------------
describe("결제·주문 DB 제약 (앱을 거치지 않은 직접 수정도 막힘)", () => {
  const NOW = () => `'${new Date().toISOString().replace("Z", "+00:00")}'`;
  let pendingOrder = 0;
  let pendingTotal = 0;
  let pendingPgId = "";
  let paidPayment = 0;
  let paidOrder = 0;
  let paidTotal = 0;

  before(async () => {
    const fake = new FakeToss();
    const a = await checkout(fake);
    pendingOrder = a.order.id;
    pendingTotal = a.order.totalPrice;
    pendingPgId = a.order.paymentOrderId;
    const b = await checkout(fake);
    await confirmOrderPayment(b.input, makeDeps(fake));
    paidOrder = b.order.id;
    paidTotal = b.order.totalPrice;
    paidPayment = (await paymentsOf(b.order.id))[0].id;
  });
  const insertPayment = (o: { status?: string; amount?: number; attemptNo?: number; key?: string; order?: number; pg?: string; extra?: string }) =>
    `INSERT INTO "Payment" ("orderId", "attemptNo", "provider", "pgOrderId", "paymentKey", "status", "amount", "canceledAmount", "balanceAmount", "taxFreeAmount", "currency", "confirmIdempotencyKey", "statusSource", "statusChangedAt", "createdAt", "updatedAt"${o.extra ? ", " + o.extra.split("=")[0] : ""})
     VALUES (${o.order ?? pendingOrder}, ${o.attemptNo ?? 1}, 'TOSS', '${o.pg ?? pendingPgId}', '${o.key ?? "k_" + Math.random()}', '${o.status ?? "IN_PROGRESS"}', ${o.amount ?? pendingTotal}, 0, ${o.amount ?? pendingTotal}, 0, 'KRW', 'idem_${Math.random()}', 'CONFIRM', ${NOW()}, ${NOW()}, ${NOW()}${o.extra ? ", " + o.extra.split("=")[1] : ""})`;

  test("정상 승인 시작(IN_PROGRESS) 행은 통과", () => passes(insertPayment({})));
  test("결제를 처음부터 완료(DONE)로 생성 금지", () => rejects(insertPayment({ status: "DONE", extra: `"approvedAt"=${NOW()}` }), "Payment_insert_guard"));
  test("결제 금액 ≠ 주문 금액 금지", () => rejects(insertPayment({ amount: pendingTotal - 1 }), "Payment_amount_match"));
  test("토스 주문번호 ≠ 주문 번호 금지", () => rejects(insertPayment({ pg: "order_other_123" }), "토스 주문번호가 주문과 다릅니다"));
  test("시도 번호 건너뛰기 금지", () => rejects(insertPayment({ attemptNo: 3 }), "시도 번호"));
  test("한 주문에 진행 중 결제 2개 금지 (동시 승인 방지)", () => rejects([insertPayment({}), insertPayment({ attemptNo: 2 })], "Payment_one_active"));
  test("결제 완료된 주문에 새 결제 시작 금지", () =>
    rejects(insertPayment({ order: paidOrder, attemptNo: 2, amount: paidTotal, pg: "x" }).replace(`'x'`, `(SELECT "paymentOrderId" FROM "Order" WHERE "id" = ${paidOrder})`), "Payment_order_pending"));
  test("취소 금액 직접 수정 금지", () => rejects(`UPDATE "Payment" SET "canceledAmount" = 100, "balanceAmount" = "amount" - 100 WHERE "id" = ${paidPayment}`, "Payment_amount_guard"));
  test("잔액 ≠ 결제 금액 − 취소 금액 금지 (CHECK)", () => rejects(`UPDATE "Payment" SET "balanceAmount" = 1 WHERE "id" = ${paidPayment}`, "Payment_amounts_ck"));
  test("완료 → 승인 중 되돌리기 금지", () => rejects(`UPDATE "Payment" SET "status" = 'IN_PROGRESS' WHERE "id" = ${paidPayment}`, "Payment_status_transition"));
  test("결제 금액·주문 변경 금지", () => rejects(`UPDATE "Payment" SET "amount" = 1 WHERE "id" = ${paidPayment}`, "Payment_immutable"));
  test("결제 키 바꿔치기 금지", () => rejects(`UPDATE "Payment" SET "paymentKey" = 'other' WHERE "id" = ${paidPayment}`, "Payment_key_fixed"));
  test("결제 삭제 금지", () => rejects(`DELETE FROM "Payment" WHERE "id" = ${paidPayment}`, "Payment_no_delete"));
  test("실패(ABORTED)는 실패 코드 필수", () =>
    rejects(insertPayment({ status: "ABORTED", extra: `"failedAt"=${NOW()}` }), "Payment_state_ck"));
  test("secret은 해시(64자 16진수)만", () => rejects(`UPDATE "Payment" SET "secretHash" = 'ps_plain_secret' WHERE "id" = ${paidPayment}`, "Payment_keys_ck"));

  test("주문을 결제 완료로 생성 금지", () =>
    rejects(`INSERT INTO "Order" ("paymentOrderId", "orderName", "totalPrice", "status", "paidAt", "createdAt", "customerId") VALUES ('order_direct_paid', 'x', 1000, 'PAID', ${NOW()}, ${NOW()}, (SELECT "customerId" FROM "Order" WHERE "id" = ${pendingOrder}))`, "Order_insert_pending"));
  test("결제 없이 주문을 결제 완료로 변경 금지", () => rejects(`UPDATE "Order" SET "status" = 'PAID', "paidAt" = ${NOW()} WHERE "id" = ${pendingOrder}`, "Order_paid_guard"));
  test("결제된 주문을 결제 취소 없이 주문 취소 금지", () => rejects(`UPDATE "Order" SET "status" = 'CANCELED', "canceledAt" = ${NOW()} WHERE "id" = ${paidOrder}`, "Order_cancel_guard"));
  test("주문 금액 변경 금지", () => rejects(`UPDATE "Order" SET "totalPrice" = 1 WHERE "id" = ${pendingOrder}`, "Order_total_fixed"));
  test("주문 삭제 금지", () => rejects(`DELETE FROM "Order" WHERE "id" = ${pendingOrder}`, "Order_no_delete"));
  test("토스 주문번호 규칙 위반 금지 (특수문자)", () =>
    rejects(`INSERT INTO "Order" ("paymentOrderId", "orderName", "totalPrice", "status", "createdAt", "customerId") VALUES ('order#bad!', 'x', 1000, 'PENDING', ${NOW()}, (SELECT "customerId" FROM "Order" WHERE "id" = ${pendingOrder}))`, "Order_payment_order_id_ck"));
  test("결제 완료 주문에 재고 예약 추가 금지", () =>
    rejects(`INSERT INTO "InventoryReservation" ("orderId", "skuId", "locationId", "qty", "status", "expiresAt", "createdAt") VALUES (${paidOrder}, ${skuId}, ${dc}, 1, 'RESERVED', '2099-01-01T00:00:00.000+00:00', ${NOW()})`, "InventoryReservation_order_open"));

  const insertCancel = (o: { payment?: number; amount: number; status?: string; reason?: string; tx?: string }) =>
    `INSERT INTO "PaymentCancel" ("paymentId", "cancelAmount", "taxFreeAmount", "reasonCode", "reasonText", "requestedBy", "status", "idempotencyKey", "transactionKey", "requestedAt", "canceledAt", "updatedAt")
     VALUES (${o.payment ?? paidPayment}, ${o.amount}, 0, '${o.reason ?? "ADMIN"}', '테스트', 'ADMIN', '${o.status ?? "REQUESTED"}', 'ck_${Math.random()}', ${o.tx ? `'${o.tx}'` : "NULL"}, ${NOW()}, ${o.status === "DONE" ? NOW() : "NULL"}, ${NOW()})`;
  test("남은 금액을 넘는 취소 금지 (진행 중인 취소 포함)", () => rejects([insertCancel({ amount: paidTotal - 1 }), insertCancel({ amount: 2 })], "PaymentCancel_exceeds"));
  test("승인 전 결제는 취소 금지", async () => {
    const p = await prisma.payment.create({ data: { orderId: pendingOrder, attemptNo: 1, pgOrderId: pendingPgId, paymentKey: `k_cancel_${Date.now()}`, status: "IN_PROGRESS", amount: pendingTotal, balanceAmount: pendingTotal, confirmIdempotencyKey: `i_${Date.now()}`, statusSource: "CONFIRM", statusChangedAt: new Date() } }).catch(() => null);
    // (위 생성은 다른 테스트와 겹치지 않게 트랜잭션 밖에서 1회만 — 이미 있으면 null)
    const target = p ?? (await prisma.payment.findFirstOrThrow({ where: { orderId: pendingOrder, status: "IN_PROGRESS" } }));
    await rejects(insertCancel({ payment: target.id, amount: 1 }), "PaymentCancel_payment_state");
  });
  test("앱 취소를 처음부터 DONE으로 생성 금지 (PG_SYNC만 허용)", () => rejects(insertCancel({ amount: 1, status: "DONE", tx: "t_x" }), "PaymentCancel_insert_guard"));
  test("토스 쪽 취소 반영(PG_SYNC DONE)은 허용 → 트리거가 결제 금액·상태 계산", async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(insertCancel({ amount: 1000, status: "DONE", reason: "PG_SYNC", tx: `t_${Date.now()}` }));
      const p = await tx.payment.findUniqueOrThrow({ where: { id: paidPayment } });
      assert.deepEqual([p.status, p.canceledAmount, p.balanceAmount], ["PARTIAL_CANCELED", 1000, paidTotal - 1000]);
      throw new Rollback();
    }).catch((e) => assert.ok(e instanceof Rollback, errorText(e)));
  });
  test("취소 완료를 되돌리기 금지 / 취소 내용 변경 금지 / 삭제 금지", async () => {
    const t = `t_${Date.now()}`;
    await rejects([insertCancel({ amount: 1000, status: "DONE", reason: "PG_SYNC", tx: t }), `UPDATE "PaymentCancel" SET "status" = 'FAILED', "failCode" = 'X', "transactionKey" = NULL, "canceledAt" = NULL WHERE "transactionKey" = '${t}'`], "PaymentCancel_transition");
    await rejects([insertCancel({ amount: 1000, status: "DONE", reason: "PG_SYNC", tx: t }), `UPDATE "PaymentCancel" SET "cancelAmount" = 1 WHERE "transactionKey" = '${t}'`], "PaymentCancel_immutable");
    await rejects([insertCancel({ amount: 1000, status: "DONE", reason: "PG_SYNC", tx: t }), `DELETE FROM "PaymentCancel" WHERE "transactionKey" = '${t}'`], "PaymentCancel_no_delete");
  });
  test("카드번호 원문 저장 금지 (가린 값만)", () => rejects(`UPDATE "PaymentCard" SET "numberMasked" = '4330123456781234' WHERE "paymentId" = ${paidPayment}`, "PaymentCard_values_ck"));
  test("카드 상세는 카드·간편결제 결제에만", async () => {
    const fake = new FakeToss();
    const v = await checkout(fake, { method: "가상계좌" });
    await confirmOrderPayment(v.input, makeDeps(fake));
    const vp = (await paymentsOf(v.order.id))[0].id;
    await rejects(`INSERT INTO "PaymentCard" ("paymentId", "issuerCode", "numberMasked", "installmentPlanMonths", "isInterestFree", "approveNo", "cardType", "ownerType", "useCardPoint", "amount") VALUES (${vp}, '41', '1234****', 0, 0, '1', 'CREDIT', 'PERSONAL', 0, 1)`, "PaymentCard_method");
    await rejects(`UPDATE "PaymentVirtualAccount" SET "accountNumberEnc" = '1234567890' WHERE "paymentId" = ${vp}`, "PaymentVirtualAccount");
  });
  test("상태 이력 수정·삭제 금지", async () => {
    await rejects(`UPDATE "PaymentStatusHistory" SET "toStatus" = 'CANCELED' WHERE "paymentId" = ${paidPayment}`, "PaymentStatusHistory_append_only");
    await rejects(`DELETE FROM "PaymentStatusHistory" WHERE "paymentId" = ${paidPayment}`, "PaymentStatusHistory_append_only");
  });
  test("API 기록 수정 금지, 1년 안 된 기록 삭제 금지, 응답 없는 시간 초과에 HTTP 상태 금지", async () => {
    await rejects(`UPDATE "PaymentApiLog" SET "errorCode" = 'X' WHERE "paymentId" = ${paidPayment}`, "PaymentApiLog_append_only");
    await rejects(`DELETE FROM "PaymentApiLog" WHERE "paymentId" = ${paidPayment}`, "PaymentApiLog_retention");
    await rejects(`INSERT INTO "PaymentApiLog" ("operation", "httpMethod", "path", "httpStatus", "outcome", "durationMs", "createdAt") VALUES ('CONFIRM', 'POST', '/v1/payments/confirm', 200, 'TIMEOUT', 1, ${NOW()})`, "PaymentApiLog_values_ck");
  });
  test("웹훅 원문 변경·삭제 금지", async () => {
    await rejects([`INSERT INTO "PaymentWebhookEvent" ("eventType", "dedupKey", "payload", "status", "receivedAt") VALUES ('X', 'd_${Date.now()}', '{}', 'RECEIVED', ${NOW()})`, `UPDATE "PaymentWebhookEvent" SET "payload" = '{"x":1}' WHERE "eventType" = 'X'`], "PaymentWebhookEvent_immutable");
    await rejects([`INSERT INTO "PaymentWebhookEvent" ("eventType", "dedupKey", "payload", "status", "receivedAt") VALUES ('X', 'd2_${Date.now()}', '{}', 'RECEIVED', ${NOW()})`, `DELETE FROM "PaymentWebhookEvent" WHERE "eventType" = 'X'`], "PaymentWebhookEvent_no_delete");
  });
});
