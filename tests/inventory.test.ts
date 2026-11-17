// 재고 테스트 (임시 DB 복사본에서 실행 — dev.db는 바뀌지 않음)
// 실행: npm test
import { TEMP_DB_PATH, removeTempDb } from "./helpers/temp-db"; // ⚠️ 반드시 첫 줄 (DB 연결 전에 주소를 바꿈)
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/prisma";
import {
  isBusyError,
  withBusyRetry,
  confirmOrder,
  getAvailability,
  InsufficientStockError,
  recordMovement,
  releaseExpired,
  releaseOrder,
  reserveOrder,
} from "../src/lib/inventory";
import { abandonOrder, confirmOrderPayment, defaultPaymentDeps, placeOrder, type PaymentDeps } from "../src/lib/checkout";

class Rollback extends Error {}
const MIN = 60 * 1000;
const ISO = (d: Date) => `'${d.toISOString().replace("Z", "+00:00")}'`;

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
  assert.ok(errorText(err).includes(expected), `다른 이유로 실패. 기대: ${expected}\n실제: ${errorText(err)}`);
}

// ---------------------------------------------------------------
// 준비
// ---------------------------------------------------------------
let dc = 0; // 온라인 물류센터
let returnCenter = 0;
let userId = "";
const skuIdOf = new Map<string, number>();
const sku = (code: string) => skuIdOf.get(code)!;

async function balance(code: string) {
  return prisma.inventoryBalance.findUniqueOrThrow({ where: { skuId_locationId: { skuId: sku(code), locationId: dc } } });
}
async function available(code: string) {
  return (await getAvailability([sku(code)])).get(sku(code)) ?? 0;
}
/** 판매 가능 수량을 정확히 n개로 맞춤 (입고 또는 실사 조정 원장으로) */
async function setAvailable(code: string, n: number) {
  const diff = n - (await available(code));
  if (diff === 0) return;
  await prisma.$transaction((tx) =>
    recordMovement(tx, {
      skuId: sku(code), locationId: dc, type: diff > 0 ? "INBOUND" : "ADJUST_OUT", qty: diff,
      refType: diff > 0 ? "INBOUND_ORDER" : "STOCK_COUNT", refId: "TEST", reason: "테스트 준비",
    }),
  );
  assert.equal(await available(code), n);
}
let orderSeq = 0;
/** 테스트용 결제 대기 주문 (주문 항목 포함, 예약은 따로) */
async function makeOrder(items: { code: string; qty: number }[], owner = userId) {
  return prisma.order.create({
    data: {
      paymentOrderId: `order_test_${++orderSeq}_${Date.now()}`, orderName: "테스트", totalPrice: 1000, userId: owner,
      items: { create: items.map((i) => ({ skuId: sku(i.code), quantity: i.qty, listPrice: 1000, discountAmount: 0, price: 1000, styleCode: "T", skuCode: i.code, styleName: "T", colorName: "T", sizeName: "T" })) },
    },
  });
}

before(async () => {
  dc = (await prisma.inventoryLocation.findUniqueOrThrow({ where: { code: "ONLINE_DC" } })).id;
  returnCenter = (await prisma.inventoryLocation.findUniqueOrThrow({ where: { code: "RETURN_CENTER" } })).id;
  for (const s of await prisma.sku.findMany({ select: { id: true, skuCode: true } })) skuIdOf.set(s.skuCode, s.id);
  userId = (await prisma.user.create({ data: { name: "재고테스트", email: `inv-${Date.now()}@example.com` } })).id;
});
after(async () => {
  await prisma.$disconnect();
  removeTempDb();
});

// ---------------------------------------------------------------
describe("기본 흐름: 입고 → 예약 → 확정 / 해제 / 만료", () => {
  const CODE = "PT26F004-BK-30";

  test("입고하면 원장 1줄 + 실재고 증가 (balanceAfter = 직전 + 수량)", async () => {
    const before = await balance(CODE);
    const row = await prisma.$transaction((tx) =>
      recordMovement(tx, { skuId: sku(CODE), locationId: dc, type: "INBOUND", qty: 5, refType: "INBOUND_ORDER", refId: "PO-T1" }),
    );
    assert.equal(row.balanceAfter, before.onHand + 5);
    assert.equal((await balance(CODE)).onHand, before.onHand + 5);
  });

  test("예약: 판매 가능 수량만 줄고 실재고는 그대로", async () => {
    await setAvailable(CODE, 5);
    const before = await balance(CODE);
    const order = await makeOrder([{ code: CODE, qty: 2 }]);
    await prisma.$transaction((tx) => reserveOrder(tx, order.id, [{ skuId: sku(CODE), qty: 2 }]));
    const afterB = await balance(CODE);
    assert.equal(afterB.onHand, before.onHand);
    assert.equal(afterB.reserved, before.reserved + 2);
    assert.equal(await available(CODE), 3);
  });

  test("확정: 예약이 판매 원장(SALE)으로 바뀌고 실재고 감소", async () => {
    await setAvailable(CODE, 5);
    const order = await makeOrder([{ code: CODE, qty: 2 }]);
    await prisma.$transaction((tx) => reserveOrder(tx, order.id, [{ skuId: sku(CODE), qty: 2 }]));
    const reservedState = await balance(CODE);
    await prisma.$transaction((tx) => confirmOrder(tx, order.id));
    const afterB = await balance(CODE);
    assert.equal(afterB.onHand, reservedState.onHand - 2);
    assert.equal(afterB.reserved, reservedState.reserved - 2);
    assert.equal(await available(CODE), 3, "확정해도 판매 가능 수량은 예약 때와 같음");
    const sale = await prisma.inventoryLedger.findFirstOrThrow({ where: { refType: "ORDER", refId: String(order.id), type: "SALE" } });
    assert.equal(sale.qty, -2);
    assert.equal(sale.balanceAfter, afterB.onHand);
  });

  test("해제: 판매 가능 수량이 돌아오고 원장은 생기지 않음", async () => {
    await setAvailable(CODE, 5);
    const order = await makeOrder([{ code: CODE, qty: 2 }]);
    await prisma.$transaction((tx) => reserveOrder(tx, order.id, [{ skuId: sku(CODE), qty: 2 }]));
    assert.equal(await releaseOrder(prisma, order.id, "PAYMENT_FAILED"), 1);
    assert.equal(await available(CODE), 5);
    assert.equal(await prisma.inventoryLedger.count({ where: { refType: "ORDER", refId: String(order.id) } }), 0);
  });

  test("만료: 시간이 지난 예약은 화면 수량에서 바로 빠지고, 정리하면 EXPIRED", async () => {
    await setAvailable(CODE, 5);
    const reservedBefore = (await balance(CODE)).reserved; // 앞 테스트의 예약이 남아 있을 수 있으므로 기준값을 잡아 둠
    const order = await makeOrder([{ code: CODE, qty: 2 }]);
    const past = new Date(Date.now() - 30 * MIN);
    await prisma.$transaction((tx) => reserveOrder(tx, order.id, [{ skuId: sku(CODE), qty: 2 }], past)); // 30분 전 예약 → 10분 전 만료
    assert.equal(await available(CODE), 5, "만료된 예약은 안내 수량에서 제외");
    assert.equal(await releaseExpired(prisma, new Date(), [sku(CODE)]), 1);
    const r = await prisma.inventoryReservation.findFirstOrThrow({ where: { orderId: order.id } });
    assert.equal(r.status, "EXPIRED");
    assert.equal((await balance(CODE)).reserved, reservedBefore);
  });

  test("만료된 예약은 확정할 수 없음 (DB 트리거)", async () => {
    await setAvailable(CODE, 5);
    const order = await makeOrder([{ code: CODE, qty: 1 }]);
    await prisma.$transaction((tx) => reserveOrder(tx, order.id, [{ skuId: sku(CODE), qty: 1 }], new Date(Date.now() - 30 * MIN)));
    await assert.rejects(prisma.$transaction((tx) => confirmOrder(tx, order.id)), (e) => errorText(e).includes("만료된 예약은 확정할 수 없습니다"));
    await releaseExpired();
  });

  test("안전재고는 팔지 않음: 실재고 3, 안전재고 1이면 3개 예약 불가", async () => {
    const code = "JK26F001-BK-110"; // seed에서 안전재고 1
    await setAvailable(code, 2);
    const b = await balance(code);
    assert.equal(b.onHand - b.reserved - b.safetyStock, 2);
    const order = await makeOrder([{ code, qty: 3 }]);
    await assert.rejects(prisma.$transaction((tx) => reserveOrder(tx, order.id, [{ skuId: sku(code), qty: 3 }])), InsufficientStockError);
  });
});

// ---------------------------------------------------------------
describe("동시 주문: 마지막 1개", () => {
  const CODE = "CP26S006-NV-F";

  test("같은 연결에서 5개 주문이 동시에 예약 → 정확히 1개만 성공", async () => {
    await setAvailable(CODE, 1);
    const orders = await Promise.all([1, 2, 3, 4, 5].map(() => makeOrder([{ code: CODE, qty: 1 }])));
    const results = await Promise.allSettled(
      orders.map((o) => prisma.$transaction((tx) => reserveOrder(tx, o.id, [{ skuId: sku(CODE), qty: 1 }]))),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.ok(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof InsufficientStockError));
    assert.equal(await available(CODE), 0);
    const b = await balance(CODE);
    assert.ok(b.reserved <= b.onHand);
  });

  test("서로 다른 DB 연결 2개가 동시에 주문 → 1개 성공, 나머지는 잠금 오류가 아니라 '재고 부족' 안내", async () => {
    await releaseExpired();
    await setAvailable(CODE, 1);
    const otherDb = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: "file:" + TEMP_DB_PATH.split("\\").join("/") }) });
    try {
      const buyers = await Promise.all([1, 2].map(() => prisma.user.create({ data: { name: "동시구매" } })));
      // 두 번째 고객은 "다른 연결"에서 주문 (lib의 placeOrder는 기본 연결을 쓰므로 같은 로직을 다른 연결로 흉내)
      const [o1, o2] = await Promise.all([makeOrder([{ code: CODE, qty: 1 }], buyers[0].id), makeOrder([{ code: CODE, qty: 1 }], buyers[1].id)]);
      const results = await Promise.allSettled([
        withBusyRetry(() => prisma.$transaction((tx) => reserveOrder(tx, o1.id, [{ skuId: sku(CODE), qty: 1 }]))),
        withBusyRetry(() => otherDb.$transaction((tx) => reserveOrder(tx, o2.id, [{ skuId: sku(CODE), qty: 1 }]))),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      assert.ok(failed.reason instanceof InsufficientStockError, `잠금 오류가 아닌 재고 부족이어야 함: ${errorText(failed.reason).slice(0, 200)}`);
    } finally {
      await otherDb.$disconnect();
    }
  });

  test("[참고] 다시 시도 없이 두 연결이 충돌하면 한쪽은 DB 잠금 오류(SQLITE_BUSY) — 그래서 withBusyRetry가 필요", async () => {
    await releaseExpired();
    await prisma.inventoryReservation.updateMany({ where: { skuId: sku(CODE), status: "RESERVED" }, data: { status: "RELEASED", releasedAt: new Date(), releaseReason: "ADMIN" } });
    await setAvailable(CODE, 1);
    const other = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${TEMP_DB_PATH.replace(/\\/g, "/")}` }) });
    try {
      const [o1, o2] = await Promise.all([makeOrder([{ code: CODE, qty: 1 }]), makeOrder([{ code: CODE, qty: 1 }])]);
      const results = await Promise.allSettled([
        prisma.$transaction((tx) => reserveOrder(tx, o1.id, [{ skuId: sku(CODE), qty: 1 }])),
        other.$transaction((tx) => reserveOrder(tx, o2.id, [{ skuId: sku(CODE), qty: 1 }])),
      ]);
      const ok = results.filter((r) => r.status === "fulfilled").length;
      assert.equal(ok, 1, `성공 ${ok}개: ${results.map((r) => (r.status === "rejected" ? errorText(r.reason).slice(0, 120) : "ok")).join(" | ")}`);
      const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      assert.ok(failed.reason instanceof InsufficientStockError || isBusyError(failed.reason));
      const b = await balance(CODE);
      assert.ok(b.reserved <= b.onHand - b.safetyStock);
    } finally {
      await other.$disconnect();
    }
  });
});

// ---------------------------------------------------------------
describe("주문 생성 (placeOrder)", () => {
  const CODE = "SH26S002-NV-M";

  test("주문 생성 = 주문 + 항목 + 예약 (한 트랜잭션)", async () => {
    await setAvailable(CODE, 3);
    const r = await placeOrder(userId, [{ skuId: sku(CODE), quantity: 2 }]);
    assert.ok(!("error" in r), JSON.stringify(r));
    const order = await prisma.order.findUniqueOrThrow({ where: { paymentOrderId: r.paymentOrderId }, include: { reservations: true } });
    assert.equal(order.status, "PENDING");
    assert.equal(order.reservations.length, 1);
    assert.equal(order.reservations[0].qty, 2);
    assert.equal(await available(CODE), 1);
  });

  test("같은 고객이 다시 주문하면 이전 결제 대기 주문의 예약은 풀림 (SUPERSEDED)", async () => {
    await setAvailable(CODE, 3);
    const first = await placeOrder(userId, [{ skuId: sku(CODE), quantity: 2 }]);
    assert.ok(!("error" in first));
    const second = await placeOrder(userId, [{ skuId: sku(CODE), quantity: 2 }]);
    assert.ok(!("error" in second), "이전 예약이 풀려서 다시 2개를 잡을 수 있어야 함");
    const firstOrder = await prisma.order.findUniqueOrThrow({ where: { paymentOrderId: first.paymentOrderId }, include: { reservations: true } });
    assert.equal(firstOrder.reservations[0].status, "RELEASED");
    assert.equal(firstOrder.reservations[0].releaseReason, "SUPERSEDED");
  });

  test("재고가 부족하면 주문 자체가 만들어지지 않음", async () => {
    await setAvailable(CODE, 1);
    const otherUser = (await prisma.user.create({ data: { name: "다른고객" } })).id;
    const before = await prisma.order.count();
    const r = await placeOrder(otherUser, [{ skuId: sku(CODE), quantity: 2 }]);
    assert.ok("error" in r && r.error.includes("재고가 부족"), JSON.stringify(r));
    assert.equal(await prisma.order.count(), before);
  });

  test("결제를 진행하지 않으면(abandonOrder) 예약이 바로 풀림", async () => {
    // 새 고객: 같은 고객이면 이전 결제 대기 주문의 예약이 SUPERSEDED로 풀려 수량 계산이 달라짐
    const buyer = (await prisma.user.create({ data: { name: "이탈고객" } })).id;
    await setAvailable(CODE, 2);
    const r = await placeOrder(buyer, [{ skuId: sku(CODE), quantity: 2 }]);
    assert.ok(!("error" in r));
    assert.equal(await available(CODE), 0);
    assert.equal(await abandonOrder(buyer, r.paymentOrderId, "PRICE_CHANGED"), true);
    assert.equal(await available(CODE), 2);
  });

  test("다른 사람의 주문은 풀 수 없음", async () => {
    await setAvailable(CODE, 2);
    const r = await placeOrder(userId, [{ skuId: sku(CODE), quantity: 1 }]);
    assert.ok(!("error" in r));
    assert.equal(await abandonOrder("someone-else", r.paymentOrderId, "PAYMENT_FAILED"), false);
  });
});

// ---------------------------------------------------------------
describe("결제 승인 (confirmOrderPayment) — 토스는 가짜로 대체", () => {
  const CODE = "KN26F003-IV-M";
  type Calls = { confirm: number; cancel: number };

  function fakeDeps(over: Partial<PaymentDeps> = {}, calls: Calls = { confirm: 0, cancel: 0 }) {
    const deps: PaymentDeps = {
      ...defaultPaymentDeps,
      confirmPayment: async () => {
        calls.confirm++;
        return { ok: true };
      },
      cancelPayment: async () => {
        calls.cancel++;
        return { ok: true };
      },
      ...over,
    };
    return { deps, calls };
  }
  async function newPendingOrder(qty = 1, now = new Date()) {
    // 같은 고객의 이전 주문 예약이 풀리지 않도록 테스트마다 새 고객 사용
    const owner = (await prisma.user.create({ data: { name: "결제테스트" } })).id;
    const r = await placeOrder(owner, [{ skuId: sku(CODE), quantity: qty }], now);
    assert.ok(!("error" in r), JSON.stringify(r));
    const order = await prisma.order.findUniqueOrThrow({ where: { paymentOrderId: r.paymentOrderId } });
    return { owner, order, input: { userId: owner, paymentOrderId: r.paymentOrderId, paymentKey: `pk_${order.id}`, amount: order.totalPrice } };
  }
  const reservationsOf = (orderId: number) => prisma.inventoryReservation.findMany({ where: { orderId }, orderBy: { id: "asc" } });

  test("성공: 주문 PAID, 예약 확정, 판매 원장 생성, 실재고 감소", async () => {
    await setAvailable(CODE, 3);
    const { order, input } = await newPendingOrder(1);
    const onHandBefore = (await balance(CODE)).onHand;
    const { deps, calls } = fakeDeps();
    const r = await confirmOrderPayment(input, deps);
    assert.deepEqual(r, { ok: true, orderId: order.id });
    assert.equal(calls.confirm, 1);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PAID");
    assert.equal((await reservationsOf(order.id))[0].status, "CONFIRMED");
    assert.equal((await balance(CODE)).onHand, onHandBefore - 1);
  });

  test("이미 결제된 주문을 다시 승인하면 토스를 다시 부르지 않음 (새로고침)", async () => {
    await setAvailable(CODE, 3);
    const { input } = await newPendingOrder(1);
    await confirmOrderPayment(input, fakeDeps().deps);
    const { deps, calls } = fakeDeps();
    const r = await confirmOrderPayment(input, deps);
    assert.equal(r.ok, true);
    assert.equal(calls.confirm, 0);
  });

  test("금액이 다르면 토스 승인 요청 자체를 하지 않음", async () => {
    await setAvailable(CODE, 3);
    const { input } = await newPendingOrder(1);
    const { deps, calls } = fakeDeps();
    const r = await confirmOrderPayment({ ...input, amount: 100 }, deps);
    assert.equal(r.ok, false);
    assert.equal(calls.confirm, 0);
  });

  test("토스 승인 실패: 예약 해제(PAYMENT_FAILED), 주문은 결제 대기, 판매 원장 없음", async () => {
    await setAvailable(CODE, 3);
    const { order, input } = await newPendingOrder(1);
    const { deps } = fakeDeps({ confirmPayment: async () => ({ ok: false, code: "REJECT_CARD_COMPANY", message: "카드사 거절" }) });
    const r = await confirmOrderPayment(input, deps);
    assert.deepEqual(r, { ok: false, message: "카드사 거절" });
    const [res] = await reservationsOf(order.id);
    assert.equal(res.status, "RELEASED");
    assert.equal(res.releaseReason, "PAYMENT_FAILED");
    assert.equal(await prisma.inventoryLedger.count({ where: { refType: "ORDER", refId: String(order.id) } }), 0);
  });

  test("승인 후 저장 실패 → 토스 결제 취소(보상), 주문 CANCELED, 예약 COMPENSATED, 실재고 그대로", async () => {
    await setAvailable(CODE, 3);
    const { order, input } = await newPendingOrder(1);
    const onHandBefore = (await balance(CODE)).onHand;
    const { deps, calls } = fakeDeps({ finalize: async () => { throw new Error("DB 저장 실패 흉내"); } });
    const r = await confirmOrderPayment(input, deps);
    assert.equal(r.ok, false);
    assert.equal(calls.confirm, 1);
    assert.equal(calls.cancel, 1, "결제 취소를 반드시 호출");
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "CANCELED");
    assert.equal((await reservationsOf(order.id))[0].releaseReason, "COMPENSATED");
    assert.equal((await balance(CODE)).onHand, onHandBefore);
  });

  test("보상(결제 취소)까지 실패하면 CANCEL_FAILED로 남겨 사람이 확인하게 함", async () => {
    await setAvailable(CODE, 3);
    const { order, input } = await newPendingOrder(1);
    const { deps } = fakeDeps({
      finalize: async () => { throw new Error("DB 저장 실패 흉내"); },
      cancelPayment: async () => ({ ok: false, code: "NETWORK", message: "취소 실패 흉내" }),
    });
    const r = await confirmOrderPayment(input, deps);
    assert.equal(r.ok, false);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "CANCEL_FAILED");
  });

  test("예약이 만료됐어도 재고가 있으면 다시 잡고(RENEWED) 결제 성공", async () => {
    await setAvailable(CODE, 3);
    const { order, input } = await newPendingOrder(1, new Date(Date.now() - 30 * MIN)); // 이미 만료된 예약
    const { deps, calls } = fakeDeps();
    const r = await confirmOrderPayment(input, deps);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(calls.confirm, 1);
    const statuses = (await reservationsOf(order.id)).map((x) => x.status);
    assert.deepEqual(statuses, ["EXPIRED", "CONFIRMED"]);
  });

  test("만료 1분 전 예약은 승인 전에 갱신 (승인 도중 만료 방지)", async () => {
    await setAvailable(CODE, 3);
    const { order, input } = await newPendingOrder(1, new Date(Date.now() - 19 * MIN)); // 1분 남음
    const r = await confirmOrderPayment(input, fakeDeps().deps);
    assert.equal(r.ok, true, JSON.stringify(r));
    const rs = await reservationsOf(order.id);
    assert.deepEqual(rs.map((x) => [x.status, x.releaseReason]), [["RELEASED", "RENEWED"], ["CONFIRMED", null]]);
  });

  test("예약이 만료됐고 그 사이 재고가 팔렸으면 토스 승인 없이 실패 (고객 돈이 나가지 않음)", async () => {
    await setAvailable(CODE, 1);
    const { order, input } = await newPendingOrder(1, new Date(Date.now() - 30 * MIN));
    // 다른 고객이 마지막 1개를 가져감 (만료된 예약을 정리하고 예약)
    const thief = await makeOrder([{ code: CODE, qty: 1 }]);
    await prisma.$transaction((tx) => reserveOrder(tx, thief.id, [{ skuId: sku(CODE), qty: 1 }]));
    const { deps, calls } = fakeDeps();
    const r = await confirmOrderPayment(input, deps);
    assert.equal(r.ok, false);
    assert.equal(calls.confirm, 0, "토스 승인을 부르면 안 됨");
    assert.ok((await reservationsOf(order.id)).every((x) => x.status !== "RESERVED"));
  });
});

// ---------------------------------------------------------------
describe("재고 DB 제약 (앱을 거치지 않은 직접 수정도 막힘)", () => {
  const CODE = "SN26S005-WH-260";
  const now = () => ISO(new Date());
  const later = () => ISO(new Date(Date.now() + 20 * MIN));
  let orderId = 0;
  before(async () => {
    await setAvailable(CODE, 5);
    orderId = (await makeOrder([{ code: CODE, qty: 1 }])).id;
  });
  const bal = () => `"skuId" = ${sku(CODE)} AND "locationId" = ${dc}`;
  const reserve = (qty = 1, loc = dc, status = "RESERVED") =>
    `INSERT INTO "InventoryReservation" ("orderId","skuId","locationId",qty,status,"expiresAt","createdAt") VALUES (${orderId}, ${sku(CODE)}, ${loc}, ${qty}, '${status}', ${later()}, ${now()})`;
  const ledger = (type: string, qty: number, balanceAfter: string, extra = "") =>
    `INSERT INTO "InventoryLedger" ("skuId","locationId",type,qty,"balanceAfter","refType","refId","occurredAt","createdAt"${extra ? ",reason" : ""}) VALUES (${sku(CODE)}, ${dc}, '${type}', ${qty}, ${balanceAfter}, 'INBOUND_ORDER', 'T', ${now()}, ${now()}${extra ? `, '${extra}'` : ""})`;
  const onHandPlus = (q: number) => `(SELECT "onHand" + ${q} FROM "InventoryBalance" WHERE ${bal()})`;

  test("실재고 숫자 직접 수정 금지", () => rejects(`UPDATE "InventoryBalance" SET "onHand" = 999 WHERE ${bal()}`, "InventoryBalance_onhand_guard"));
  test("예약 수량 직접 수정 금지", () => rejects(`UPDATE "InventoryBalance" SET reserved = 3 WHERE ${bal()}`, "InventoryBalance_reserved_guard"));
  test("잔고 행을 0이 아닌 수량으로 생성 금지", () =>
    rejects(`INSERT INTO "InventoryBalance" ("skuId","locationId","onHand",reserved,"safetyStock","createdAt","updatedAt") VALUES (${sku(CODE)}, ${returnCenter}, 10, 0, 0, ${now()}, ${now()})`, "InventoryBalance_insert_zero"));
  test("잔고 행 삭제 금지 (원장이 있음)", () => rejects(`DELETE FROM "InventoryBalance" WHERE ${bal()}`, "InventoryBalance_no_delete"));
  test("원장 수정·삭제 금지", async () => {
    await rejects(`UPDATE "InventoryLedger" SET qty = 100 WHERE "skuId" = ${sku(CODE)}`, "InventoryLedger_append_only");
    await rejects(`DELETE FROM "InventoryLedger" WHERE "skuId" = ${sku(CODE)}`, "InventoryLedger_append_only");
  });
  test("원장 balanceAfter가 직전 실재고 + 수량과 다르면 거부", () => rejects(ledger("INBOUND", 1, "999"), "balanceAfter가 직전 실재고"));
  test("정상 원장은 통과하고 실재고에 자동 반영", async () => {
    const beforeQty = (await balance(CODE)).onHand;
    let err: unknown = null;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(ledger("INBOUND", 2, onHandPlus(2)));
        const [{ onHand }] = await tx.$queryRawUnsafe<{ onHand: bigint }[]>(`SELECT "onHand" FROM "InventoryBalance" WHERE ${bal()}`);
        assert.equal(Number(onHand), beforeQty + 2);
        throw new Rollback();
      });
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof Rollback, errorText(err));
  });
  test("유형별 부호: 입고에 음수 금지 / 판매에 양수 금지", async () => {
    await rejects(ledger("INBOUND", -1, onHandPlus(-1)), "InventoryLedger_sign_ck");
    await rejects(ledger("ADJUST_OUT", 1, onHandPlus(1), "사유"), "InventoryLedger_sign_ck");
  });
  test("판매(SALE) 원장은 예약 없이 직접 넣을 수 없음", () => rejects(ledger("SALE", -1, onHandPlus(-1)), "InventoryLedger_sale_ck"));
  test("조정 출고는 사유 필수", () => rejects(ledger("ADJUST_OUT", -1, onHandPlus(-1)), "InventoryLedger_reason_ck"));
  test("예약된 수량보다 실재고를 적게 만들 수 없음", async () => {
    // 5개 중 5개 예약 후 1개 조정 출고 시도
    await rejects([reserve(5), ledger("ADJUST_OUT", -1, onHandPlus(-1), "분실")], "결제 대기 예약보다 실재고가 적어집니다");
  });
  test("판매 가능 수량보다 많이 예약 금지", () => rejects(reserve(999), "InventoryReservation_insufficient"));
  test("안전재고는 실재고 안에 있어도 예약 금지 (CHECK 예약≤실재고로는 못 잡고 트리거만 잡는 경우)", async () => {
    // 실재고 5, 안전재고 2 → 판매 가능 3. 4개 예약은 '예약 ≤ 실재고'(4 ≤ 5)는 통과하지만 판매 가능 수량을 넘음
    await rejects([`UPDATE "InventoryBalance" SET "safetyStock" = 2 WHERE ${bal()}`, reserve(4)], "InventoryReservation_insufficient");
  });
  test("온라인 판매 위치가 아닌 곳(반품센터)에서 예약 금지", () => rejects(reserve(1, returnCenter), "온라인 판매 위치가 아닙니다"));
  test("처음부터 확정 상태로 예약 생성 금지", () => rejects(reserve(1, dc, "CONFIRMED"), "RESERVED 상태로만"));
  test("같은 주문·SKU에 활성 예약 중복 금지", () => rejects([reserve(1), reserve(1)], "이미 있습니다"));
  test("확정된 예약을 다시 RESERVED로 되돌리기 금지", () =>
    rejects([reserve(1), `UPDATE "InventoryReservation" SET status = 'CONFIRMED', "confirmedAt" = ${now()} WHERE "orderId" = ${orderId} AND status = 'RESERVED'`,
      `UPDATE "InventoryReservation" SET status = 'RESERVED', "confirmedAt" = NULL WHERE "orderId" = ${orderId}`], "이미 처리된 예약"));
  test("예약 수량 변경 금지 (해제 후 새로 예약)", () =>
    rejects([reserve(1), `UPDATE "InventoryReservation" SET qty = 3 WHERE "orderId" = ${orderId}`], "InventoryReservation_immutable"));
  test("예약 삭제 금지", () => rejects([reserve(1), `DELETE FROM "InventoryReservation" WHERE "orderId" = ${orderId}`], "InventoryReservation_no_delete"));
  test("해제(RELEASED)는 사유 필수", () =>
    rejects([reserve(1), `UPDATE "InventoryReservation" SET status = 'RELEASED', "releasedAt" = ${now()} WHERE "orderId" = ${orderId}`], "InventoryReservation_state_ck"));
  test("결제 대기 예약이 있는 위치는 판매 중지 금지", () =>
    rejects([reserve(1), `UPDATE "InventoryLocation" SET "isOnlineSellable" = 0 WHERE id = ${dc}`], "InventoryLocation_deactivate_guard"));
  test("반품센터를 온라인 판매 위치로 지정 금지", () =>
    rejects(`UPDATE "InventoryLocation" SET "isOnlineSellable" = 1 WHERE id = ${returnCenter}`, "InventoryLocation_online_ck"));
});
