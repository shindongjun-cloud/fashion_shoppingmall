// ⑦ 주문 테스트 (임시 DB 복사본 + 가짜 토스)
// 주문 생성(배송지 스냅샷·배송비·주문번호) → 결제(재고 할당) → 취소(출고 전) / 준비 → 출고(재고 차감) → 배송 완료 → 구매확정
// + 배송지 변경, 자동 구매확정, 개인정보 파기, DB 제약(앱을 거치지 않은 직접 수정)
import { removeTempDb } from "./helpers/temp-db"; // ⚠️ 반드시 첫 줄
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { placeOrder } from "../src/lib/checkout";
import { getCartSkus } from "../src/lib/catalog";
import { getAvailability, recordMovement } from "../src/lib/inventory";
import { confirmOrderPayment, defaultPaymentDeps, retryOpenCancels, syncFromToss, type PaymentDeps } from "../src/lib/payment";
import {
  adminCancelOrder,
  autoConfirmDeliveredItems,
  cancelPaidOrder,
  cancelShipment,
  changeOrderAddress,
  confirmPurchase,
  deliverShipment,
  OrderError,
  prepareOrder,
  purgeExpiredOrderPii,
  registerShipment,
  shipShipment,
} from "../src/lib/order";
import { AUTO_CONFIRM_DAYS, computeShipping, generateOrderNo, kstDateCode } from "../src/lib/order-rules";
import { AUTO_CONFIRM_DAYS as DB_AUTO_CONFIRM_DAYS } from "../prisma/db-constraints";
import { decrypt } from "../src/lib/crypto";
import { createTossApi } from "../src/lib/toss";
import { FakeToss } from "./helpers/fake-toss";
import { giveAddress, makePayableOrder, newShopper } from "./helpers/orders";

const DAY = 24 * 60 * 60 * 1000;
const ISO = (d: Date) => `'${d.toISOString().replace("Z", "+00:00")}'`;
const NOW = () => ISO(new Date());
class Rollback extends Error {}
function errorText(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const x = e as Error & { meta?: unknown; cause?: unknown };
  return `${e.message} ${JSON.stringify(x.meta ?? {})} ${x.cause ? errorText(x.cause) : ""}`;
}
/** SQL을 실행하면 expected를 포함한 오류로 막혀야 함 (트랜잭션은 항상 롤백) */
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
  assert.ok(errorText(err).includes(expected), `다른 이유로 실패. 기대: ${expected}\n실제: ${errorText(err).slice(0, 400)}`);
}
async function orderError(fn: () => Promise<unknown>, pattern: RegExp) {
  await assert.rejects(fn, (e) => e instanceof OrderError && pattern.test(e.message));
}

// ---------------------------------------------------------------
// 준비: 재고·가짜 토스·결제까지 마친 주문
// ---------------------------------------------------------------
const CODES = ["SH26S002-NV-M", "KN26F003-IV-M"]; // 두 상품 (나눠 보내기 시험)
const skuId = new Map<string, number>();
const price = new Map<number, number>();
let dc = 0;
const sku = (code: string) => skuId.get(code)!;

async function available(id: number) {
  return (await getAvailability([id])).get(id) ?? 0;
}
async function setAvailable(id: number, n: number) {
  const diff = n - (await available(id));
  if (diff === 0) return;
  await prisma.$transaction((tx) =>
    recordMovement(tx, { skuId: id, locationId: dc, type: diff > 0 ? "INBOUND" : "ADJUST_OUT", qty: diff, refType: diff > 0 ? "INBOUND_ORDER" : "STOCK_COUNT", refId: "TEST", reason: "테스트 준비" }),
  );
}
const onHand = async (id: number) => (await prisma.inventoryBalance.findUniqueOrThrow({ where: { skuId_locationId: { skuId: id, locationId: dc } } })).onHand;
function deps(fake: FakeToss, over: Partial<PaymentDeps> = {}): PaymentDeps {
  return { ...defaultPaymentDeps, toss: createTossApi({ transport: fake.transport, secretKey: () => "test_gsk_fake" }), waitForOtherMs: 3000, ...over };
}

/** 주소 있는 새 고객이 주문 → 결제(가짜 토스) 완료 */
async function paidOrder(fake: FakeToss, opts: { codes?: string[]; qty?: number; zip?: string; method?: "카드" | "가상계좌" } = {}) {
  const codes = opts.codes ?? [CODES[0]];
  for (const c of codes) await setAvailable(sku(c), 10);
  const customerId = await newShopper("주문", opts.zip);
  const placed = await placeOrder(customerId, codes.map((c) => ({ skuId: sku(c), quantity: opts.qty ?? 1 })));
  assert.ok(!("error" in placed), JSON.stringify(placed));
  const order = await prisma.order.findUniqueOrThrow({ where: { orderNo: placed.orderNo } });
  const paymentKey = fake.authorize({ orderId: order.paymentOrderId, amount: order.totalPrice, method: opts.method });
  const r = await confirmOrderPayment({ customerId, paymentOrderId: order.paymentOrderId, paymentKey, amount: String(order.totalPrice) }, deps(fake));
  if (opts.method === "가상계좌") {
    assert.equal(r.kind, "WAITING_DEPOSIT");
    fake.deposit(paymentKey);
    const p = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    await syncFromToss(p.id, "RECONCILE", deps(fake));
  } else {
    assert.equal(r.kind, "PAID", JSON.stringify(r));
  }
  return { customerId, order: await prisma.order.findUniqueOrThrow({ where: { id: order.id } }), paymentKey };
}
const itemsOf = (orderId: number) => prisma.orderItem.findMany({ where: { orderId }, orderBy: { lineNo: "asc" } });
const orderOf = (id: number) => prisma.order.findUniqueOrThrow({ where: { id } });
const reservationsOf = (orderId: number) => prisma.inventoryReservation.findMany({ where: { orderId }, orderBy: { id: "asc" } });
let trackingSeq = 0;
const tracking = () => `6012${String(Date.now()).slice(-6)}${String(++trackingSeq).padStart(2, "0")}`; // CJ 12자리
/** 준비 → 송장 → 출고까지 */
async function shipAll(orderNo: string, lineNos?: number[]) {
  await prepareOrder(orderNo, "ADMIN:test").catch((e) => {
    if (!(e instanceof OrderError && /준비할 상품이 없어요/.test(e.message))) throw e;
  });
  const box = await registerShipment(orderNo, { courierCode: "CJ", trackingNo: tracking(), lineNos }, "ADMIN:test");
  await shipShipment(box!.id);
  return box!;
}

before(async () => {
  dc = (await prisma.inventoryLocation.findUniqueOrThrow({ where: { code: "ONLINE_DC" } })).id;
  for (const c of CODES) skuId.set(c, (await prisma.sku.findUniqueOrThrow({ where: { skuCode: c } })).id);
  for (const s of await getCartSkus([...skuId.values()])) price.set(s.id, s.price);
});
after(async () => {
  await prisma.$disconnect();
  removeTempDb();
});

// ---------------------------------------------------------------
describe("배송비·주문번호 계산 (순수)", () => {
  const policy = { id: 1, baseFee: 3000, freeShippingThreshold: 50000 };
  test("무료배송 경계: 49,999원은 3,000원, 50,000원은 무료", () => {
    assert.equal(computeShipping(policy, null, 49_999).fee, 3000);
    assert.equal(computeShipping(policy, null, 49_999).remainingForFree, 1);
    assert.equal(computeShipping(policy, null, 50_000).fee, 0);
    assert.equal(computeShipping(policy, null, 50_000).remainingForFree, 0);
  });
  test("제주·도서산간 추가 배송비는 무료배송이어도 붙음", () => {
    const jeju = { region: "JEJU" as const, extraFee: 3000, name: "제주" };
    assert.deepEqual([computeShipping(policy, jeju, 10_000).fee, computeShipping(policy, jeju, 80_000).fee], [6000, 3000]);
    assert.equal(computeShipping(policy, jeju, 80_000).region, "JEJU");
  });
  test("무료 기준이 없는 규칙은 항상 기본 배송비", () => {
    assert.equal(computeShipping({ id: 1, baseFee: 2500, freeShippingThreshold: null }, null, 1_000_000).fee, 2500);
  });
  test("주문번호: 한국 날짜 + 무작위 8자리 (UTC 15시 이후는 다음 날)", () => {
    const at = new Date("2026-11-18T15:30:00Z"); // 한국 11월 19일 00:30
    assert.equal(kstDateCode(at), "20261119");
    assert.match(generateOrderNo(at), /^20261119-\d{8}$/);
    const many = new Set(Array.from({ length: 200 }, () => generateOrderNo(at)));
    assert.ok(many.size >= 199, "무작위 (순번 아님)");
  });
  test("자동 구매확정 일수: 앱과 DB 트리거가 같은 값", () => assert.equal(AUTO_CONFIRM_DAYS, DB_AUTO_CONFIRM_DAYS));
});

// ---------------------------------------------------------------
describe("주문 생성: 주문번호·금액 구성·배송지 스냅샷·주문자", () => {
  test("주문 + 상품 줄(순번·금액 배분) + 배송지(암호화) + 예약(상품 줄과 1:1) + 이력", async () => {
    await setAvailable(sku(CODES[0]), 10);
    await setAvailable(sku(CODES[1]), 10);
    const customerId = await newShopper("생성");
    const r = await placeOrder(customerId, [{ skuId: sku(CODES[0]), quantity: 2 }, { skuId: sku(CODES[1]), quantity: 1 }]);
    assert.ok(!("error" in r), JSON.stringify(r));
    assert.match(r.orderNo, /^\d{8}-\d{8}$/);
    const o = await prisma.order.findUniqueOrThrow({ where: { orderNo: r.orderNo }, include: { items: { orderBy: { lineNo: "asc" } }, shippingAddress: true, reservations: true, statusHistory: true } });
    const itemsTotal = price.get(sku(CODES[0]))! * 2 + price.get(sku(CODES[1]))!;
    assert.equal(o.itemsTotal, itemsTotal);
    assert.equal(o.itemsListTotal - o.itemsDiscountTotal, o.itemsTotal);
    const expectedFee = itemsTotal >= 50000 ? 0 : 3000;
    assert.deepEqual([o.shippingBaseFee, o.shippingExtraFee, o.shippingFee], [expectedFee, 0, expectedFee]);
    assert.equal(o.totalPrice, itemsTotal + expectedFee);
    assert.equal(r.amount, o.totalPrice);
    assert.deepEqual(o.items.map((i) => i.lineNo), [1, 2]);
    assert.deepEqual(o.items.map((i) => [i.lineTotal, i.payAmount, i.status]), o.items.map((i) => [i.price * i.quantity, i.price * i.quantity, "AWAITING_PAYMENT"]));
    // 배송지: 암호문으로 복사 (원래 주소록과 같은 내용)
    const a = o.shippingAddress!;
    assert.ok(a.recipientEnc!.startsWith("v1:") && a.address1Enc!.startsWith("v1:"));
    assert.equal(decrypt(a.recipientEnc!), "김테스트");
    assert.equal(a.region, "NORMAL");
    assert.ok(a.phoneHash && a.phoneHash.length === 64, "받는 분 전화번호로 찾기 위한 해시");
    // 예약은 상품 줄마다
    assert.deepEqual(o.reservations.map((x) => x.orderItemId).sort(), o.items.map((i) => i.id).sort());
    assert.deepEqual(o.statusHistory.map((h) => [h.fromStatus, h.toStatus, h.changedBy]), [[null, "PENDING", "CUSTOMER"]]);
    assert.equal(o.fulfillmentStatus, "UNPAID");
    // 주문자: 로그인 계정 이름(프로필이 비어 있으면)을 암호화해 저장
    assert.equal(decrypt(o.ordererNameEnc!), "생성");
  });

  test("제주 배송지: 추가 배송비 3,000원 + 지역 JEJU", async () => {
    await setAvailable(sku(CODES[0]), 10);
    const customerId = await newShopper("제주", "63100");
    const r = await placeOrder(customerId, [{ skuId: sku(CODES[0]), quantity: 1 }]);
    assert.ok(!("error" in r));
    const o = await prisma.order.findUniqueOrThrow({ where: { orderNo: r.orderNo }, include: { shippingAddress: true } });
    assert.equal(o.shippingExtraFee, 3000);
    assert.equal(o.shippingAddress!.region, "JEJU");
    assert.equal(o.totalPrice, o.itemsTotal + o.shippingBaseFee + 3000);
  });

  test("도서산간(울릉 40200): 추가 배송비 5,000원", async () => {
    await setAvailable(sku(CODES[0]), 10);
    const customerId = await newShopper("울릉", "40200");
    const r = await placeOrder(customerId, [{ skuId: sku(CODES[0]), quantity: 1 }]);
    assert.ok(!("error" in r));
    const o = await prisma.order.findUniqueOrThrow({ where: { orderNo: r.orderNo }, include: { shippingAddress: true } });
    assert.deepEqual([o.shippingExtraFee, o.shippingAddress!.region], [5000, "REMOTE"]);
  });

  test("배송지가 없으면 주문 불가, 남의 주소록 id로는 주문 불가", async () => {
    await setAvailable(sku(CODES[0]), 10);
    const user = await prisma.user.create({ data: { name: "주소없음" } });
    const { ensureCustomerForUser } = await import("../src/lib/customer");
    const noAddr = (await ensureCustomerForUser(user.id)).id;
    const r1 = await placeOrder(noAddr, [{ skuId: sku(CODES[0]), quantity: 1 }]);
    assert.ok("error" in r1 && /배송지를 먼저 등록/.test(r1.error));
    const other = await newShopper("남");
    const otherAddr = await prisma.customerAddress.findFirstOrThrow({ where: { customerId: other } });
    const r2 = await placeOrder(noAddr, [{ skuId: sku(CODES[0]), quantity: 1 }], new Date(), { addressId: otherAddr.id });
    assert.ok("error" in r2 && /찾을 수 없어요/.test(r2.error), "남의 주소는 '없음'과 같게");
  });

  test("주문 뒤 주소록을 고치거나 지워도 주문 배송지는 그대로 (연결만 비움)", async () => {
    await setAvailable(sku(CODES[0]), 10);
    const customerId = await newShopper("주소록");
    const r = await placeOrder(customerId, [{ skuId: sku(CODES[0]), quantity: 1 }]);
    assert.ok(!("error" in r));
    const book = await prisma.customerAddress.findFirstOrThrow({ where: { customerId } });
    const { deleteAddress } = await import("../src/lib/customer");
    await giveAddress(customerId, { makeDefault: true }); // 기본 배송지는 지울 수 없을 수 있으니 다른 기본을 먼저 만듦
    await deleteAddress(customerId, book.id);
    const a = await prisma.orderShippingAddress.findFirstOrThrow({ where: { order: { orderNo: r.orderNo } } });
    assert.equal(a.sourceAddressId, null);
    assert.equal(decrypt(a.address1Enc!), "서울 강남구 테헤란로 1");
  });

  test("배송 메모는 주소록·주문 모두 암호문으로 저장 (공동현관 비밀번호 등)", async () => {
    await setAvailable(sku(CODES[0]), 10);
    const customerId = await newShopper("메모");
    await giveAddress(customerId, { makeDefault: true, memo: "공동현관 1234#" });
    const book = await prisma.customerAddress.findFirstOrThrow({ where: { customerId, isDefault: true } });
    assert.ok(book.deliveryMemoEnc!.startsWith("v1:"));
    const r = await placeOrder(customerId, [{ skuId: sku(CODES[0]), quantity: 1 }]);
    assert.ok(!("error" in r));
    const a = await prisma.orderShippingAddress.findFirstOrThrow({ where: { order: { orderNo: r.orderNo } } });
    assert.equal(decrypt(a.deliveryMemoEnc!), "공동현관 1234#");
  });
});

// ---------------------------------------------------------------
describe("결제: 재고 할당 + 상품 상태", () => {
  test("결제 완료 → 상품 결제 완료, 진행 요약 PAID, 재고 할당(실재고 그대로), 이력", async () => {
    const fake = new FakeToss();
    await setAvailable(sku(CODES[0]), 10); // paidOrder가 재고를 채우기 전에 기준값을 잡으면 입고분이 섞임
    const before = await onHand(sku(CODES[0]));
    const { order } = await paidOrder(fake);
    assert.equal(order.status, "PAID");
    assert.equal(order.fulfillmentStatus, "PAID");
    const [item] = await itemsOf(order.id);
    assert.equal(item.status, "PAID");
    assert.ok(item.paidAt);
    assert.deepEqual((await reservationsOf(order.id)).map((r) => r.status), ["ALLOCATED"]);
    assert.equal(await onHand(sku(CODES[0])), before, "실재고는 출고 때 감소");
    const h = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id }, orderBy: { id: "asc" } });
    assert.deepEqual(h.map((x) => x.toStatus), ["PENDING", "PAID"]);
    const ih = await prisma.orderItemStatusHistory.findMany({ where: { orderItemId: item.id }, orderBy: { id: "asc" } });
    assert.deepEqual(ih.map((x) => x.toStatus), ["AWAITING_PAYMENT", "PAID"]);
  });

  test("할당된 재고는 시간이 지나도 만료되지 않음 (만료 정리를 돌려도 그대로)", async () => {
    const fake = new FakeToss();
    const { order } = await paidOrder(fake);
    const { releaseExpired } = await import("../src/lib/inventory");
    await releaseExpired(prisma, new Date(Date.now() + 30 * DAY));
    assert.deepEqual((await reservationsOf(order.id)).map((r) => r.status), ["ALLOCATED"]);
  });
});

// ---------------------------------------------------------------
describe("고객 취소 (출고 전)", () => {
  test("결제 완료 상태에서 취소 → 토스 전액 취소 → 할당 해제(원장 기록 없음) → 주문·상품 취소, 이력에 고객·사유", async () => {
    const fake = new FakeToss();
    const { customerId, order } = await paidOrder(fake);
    const avail = await available(sku(CODES[0]));
    const hand = await onHand(sku(CODES[0]));
    const code = await cancelPaidOrder(customerId, order.orderNo, { reason: "단순 변심" }, deps(fake));
    assert.equal(code, "DONE");
    const o = await orderOf(order.id);
    assert.deepEqual([o.status, o.fulfillmentStatus], ["CANCELED", "CANCELED"]);
    assert.ok(o.canceledAt);
    assert.deepEqual((await itemsOf(order.id)).map((i) => i.status), ["CANCELED"]);
    const [r] = await reservationsOf(order.id);
    assert.deepEqual([r.status, r.releaseReason], ["RELEASED", "ORDER_CANCELED"]);
    assert.equal(await available(sku(CODES[0])), avail + 1, "바로 다시 팔 수 있음");
    assert.equal(await onHand(sku(CODES[0])), hand, "실재고는 그대로 (물건이 창고를 떠난 적 없음)");
    assert.equal(await prisma.inventoryLedger.count({ where: { refType: "ORDER", refId: String(order.id) } }), 0, "판매·복구 원장 없음");
    const last = await prisma.orderStatusHistory.findFirstOrThrow({ where: { orderId: order.id }, orderBy: { id: "desc" } });
    assert.deepEqual([last.toStatus, last.changedBy], ["CANCELED", "CUSTOMER"]);
    assert.match(last.memo ?? "", /단순 변심/);
    assert.equal((await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } })).status, "CANCELED");
  });

  test("상품 준비중이면 고객 직접 취소 불가 (토스 호출 없음)", async () => {
    const fake = new FakeToss();
    const { customerId, order } = await paidOrder(fake);
    await prepareOrder(order.orderNo, "ADMIN:test");
    assert.equal(await cancelPaidOrder(customerId, order.orderNo, { reason: "변심" }, deps(fake)), "PREPARING");
    assert.equal(fake.count("cancel"), 0);
    assert.equal((await orderOf(order.id)).status, "PAID");
  });

  test("토스 취소가 거절되면 주문·할당 그대로 (FAILED)", async () => {
    const fake = new FakeToss();
    const { customerId, order } = await paidOrder(fake);
    fake.faults.push({ op: "cancel", type: "error", status: 400, code: "NOT_CANCELABLE_PAYMENT", message: "취소할 수 없는 결제" });
    assert.equal(await cancelPaidOrder(customerId, order.orderNo, { reason: "변심" }, deps(fake)), "FAILED");
    assert.equal((await orderOf(order.id)).status, "PAID");
    assert.deepEqual((await reservationsOf(order.id)).map((r) => r.status), ["ALLOCATED"]);
  });

  test("취소 응답이 끊기면(결과 모름) 할당 유지 + 그동안 상품 준비 불가 → 정기 작업이 확인 후 취소 완료", async () => {
    const fake = new FakeToss();
    const { customerId, order } = await paidOrder(fake);
    fake.faults.push({ op: "cancel", type: "timeout-after" });
    assert.equal(await cancelPaidOrder(customerId, order.orderNo, { reason: "변심" }, deps(fake)), "RESULT_PENDING");
    assert.equal((await orderOf(order.id)).status, "PAID");
    assert.deepEqual((await reservationsOf(order.id)).map((r) => r.status), ["ALLOCATED"], "환불 확정 전에는 재고를 풀지 않음");
    await orderError(() => prepareOrder(order.orderNo, "ADMIN:test"), /결제 취소가 처리 중/);
    // 정기 작업: 토스에 물어보니 취소됨 → 반영
    const late = { ...deps(fake), now: () => new Date(Date.now() + 2 * 60 * 1000) };
    await retryOpenCancels(late);
    assert.equal((await orderOf(order.id)).status, "CANCELED");
    assert.equal((await reservationsOf(order.id))[0].status, "RELEASED");
  });

  test("가상계좌로 입금한 주문: 환불 계좌 없으면 NEED_REFUND_ACCOUNT, 있으면 취소", async () => {
    const fake = new FakeToss();
    const { customerId, order } = await paidOrder(fake, { method: "가상계좌" });
    assert.equal((await orderOf(order.id)).status, "PAID");
    assert.equal(await cancelPaidOrder(customerId, order.orderNo, { reason: "변심" }, deps(fake)), "NEED_REFUND_ACCOUNT");
    const code = await cancelPaidOrder(customerId, order.orderNo, { reason: "변심", refundAccount: { bankCode: "88", accountNumber: "110123456789", holderName: "김테스트" } }, deps(fake));
    assert.equal(code, "DONE");
    assert.equal((await orderOf(order.id)).status, "CANCELED");
  });

  test("남의 주문은 취소할 수 없음 (없는 주문과 같은 결과), 이상한 주문번호도 NOT_FOUND", async () => {
    const fake = new FakeToss();
    const { order } = await paidOrder(fake);
    const stranger = await newShopper("남");
    assert.equal(await cancelPaidOrder(stranger, order.orderNo, { reason: "x" }, deps(fake)), "NOT_FOUND");
    assert.equal(await cancelPaidOrder(stranger, "'; DROP TABLE x;--", { reason: "x" }, deps(fake)), "NOT_FOUND");
    assert.equal((await orderOf(order.id)).status, "PAID");
  });

  test("이미 취소된 주문을 다시 취소 → NOT_CANCELABLE (두 번 환불 안 됨)", async () => {
    const fake = new FakeToss();
    const { customerId, order } = await paidOrder(fake);
    assert.equal(await cancelPaidOrder(customerId, order.orderNo, { reason: "변심" }, deps(fake)), "DONE");
    assert.equal(await cancelPaidOrder(customerId, order.orderNo, { reason: "변심" }, deps(fake)), "NOT_CANCELABLE");
    assert.equal(fake.count("cancel"), 1);
  });
});

// ---------------------------------------------------------------
describe("배송지 변경", () => {
  test("상품 준비 전: 다른 주소록으로 변경 → 버전 2 + 이전 주소 이력", async () => {
    const fake = new FakeToss();
    const { customerId, order } = await paidOrder(fake);
    const office = await giveAddress(customerId, { label: "회사", zipCode: "04524" });
    await changeOrderAddress(customerId, order.orderNo, office.id);
    const a = await prisma.orderShippingAddress.findUniqueOrThrow({ where: { orderId: order.id }, include: { history: true } });
    assert.deepEqual([a.version, a.zipCode, a.sourceAddressId, a.changedBy], [2, "04524", office.id, "CUSTOMER"]);
    assert.equal(a.history.length, 1);
    assert.deepEqual([a.history[0].version, a.history[0].zipCode], [1, "06236"]);
  });

  test("배송비가 달라지는 지역(서울 → 제주)으로는 변경 불가, 같은 추가 배송비 지역끼리는 가능", async () => {
    const fake = new FakeToss();
    const { customerId, order } = await paidOrder(fake);
    const jeju = await giveAddress(customerId, { zipCode: "63100" });
    await orderError(() => changeOrderAddress(customerId, order.orderNo, jeju.id), /배송비가 달라지는 지역/);
    const j = await paidOrder(fake, { zip: "63100" });
    const jeju2 = await giveAddress(j.customerId, { zipCode: "63300" });
    await changeOrderAddress(j.customerId, j.order.orderNo, jeju2.id);
  });

  test("상품 준비가 시작되면 변경 불가, 남의 주소록·취소된 주문도 불가", async () => {
    const fake = new FakeToss();
    const { customerId, order } = await paidOrder(fake);
    const home2 = await giveAddress(customerId, {});
    const stranger = await newShopper("남");
    const strangerAddr = await prisma.customerAddress.findFirstOrThrow({ where: { customerId: stranger } });
    await orderError(() => changeOrderAddress(customerId, order.orderNo, strangerAddr.id), /찾을 수 없어요/);
    await prepareOrder(order.orderNo, "ADMIN:test");
    await orderError(() => changeOrderAddress(customerId, order.orderNo, home2.id), /상품 준비가 시작되어/);
    const c = await paidOrder(fake);
    await cancelPaidOrder(c.customerId, c.order.orderNo, { reason: "x" }, deps(fake));
    const a2 = await giveAddress(c.customerId, {});
    await orderError(() => changeOrderAddress(c.customerId, c.order.orderNo, a2.id), /취소·만료된 주문/);
  });
});

// ---------------------------------------------------------------
describe("출고 → 배송 완료 → 구매확정", () => {
  test("준비 → 송장 → 출고: 상품 배송중, 재고 확정(SALE 원장, 출고 시각) + 실재고 감소, 진행 요약", async () => {
    const fake = new FakeToss();
    const { order } = await paidOrder(fake);
    const before = await onHand(sku(CODES[0]));
    await prepareOrder(order.orderNo, "ADMIN:kim");
    assert.equal((await orderOf(order.id)).fulfillmentStatus, "PREPARING");
    const box = await registerShipment(order.orderNo, { courierCode: "cj", trackingNo: "6012-3456-7890" }, "ADMIN:kim");
    assert.equal(box!.trackingNo, "601234567890", "하이픈은 빼고 저장");
    assert.equal(await onHand(sku(CODES[0])), before, "송장 등록만으로는 차감 안 됨");
    const shipped = await shipShipment(box!.id);
    const [item] = await itemsOf(order.id);
    assert.equal(item.status, "SHIPPED");
    assert.equal(item.statusChangedBy, "ADMIN");
    const [r] = await reservationsOf(order.id);
    assert.deepEqual([r.status, r.shipmentId], ["CONFIRMED", box!.id]);
    const sale = await prisma.inventoryLedger.findFirstOrThrow({ where: { reservationId: r.id, type: "SALE" } });
    assert.equal(sale.qty, -1);
    assert.equal(sale.occurredAt.getTime(), shipped!.shippedAt!.getTime(), "판매 원장의 일어난 시각 = 출고 시각");
    assert.equal(await onHand(sku(CODES[0])), before - 1);
    assert.equal((await orderOf(order.id)).fulfillmentStatus, "SHIPPED");
  });

  test("나눠 보내기: 2개 중 1개 출고 → 일부 배송중, 나머지 출고 → 배송중", async () => {
    const fake = new FakeToss();
    const { order } = await paidOrder(fake, { codes: CODES });
    await shipAll(order.orderNo, [1]);
    assert.equal((await orderOf(order.id)).fulfillmentStatus, "PARTIALLY_SHIPPED");
    assert.deepEqual((await itemsOf(order.id)).map((i) => i.status), ["SHIPPED", "PREPARING"]);
    await shipAll(order.orderNo, [2]);
    assert.equal((await orderOf(order.id)).fulfillmentStatus, "SHIPPED");
  });

  test("배송 완료 → 자동확정 예정일 +7일, 고객 구매확정 → 전체 확정 시각", async () => {
    const fake = new FakeToss();
    const { customerId, order } = await paidOrder(fake);
    const box = await shipAll(order.orderNo);
    const done = await deliverShipment(box.id);
    const [item] = await itemsOf(order.id);
    assert.equal(item.status, "DELIVERED");
    assert.equal(item.autoConfirmAt!.getTime(), done!.deliveredAt!.getTime() + AUTO_CONFIRM_DAYS * DAY);
    assert.equal((await orderOf(order.id)).fulfillmentStatus, "DELIVERED");
    await confirmPurchase(customerId, order.orderNo, item.id);
    await confirmPurchase(customerId, order.orderNo, item.id); // 두 번 눌러도 같은 결과
    const after = await itemsOf(order.id);
    assert.deepEqual([after[0].status, after[0].confirmType, after[0].statusChangedBy], ["CONFIRMED", "MANUAL", "CUSTOMER"]);
    const o = await orderOf(order.id);
    assert.equal(o.fulfillmentStatus, "CONFIRMED");
    assert.ok(o.confirmedAt);
  });

  test("배송중에도 고객이 구매확정 가능, 출고 전에는 불가, 남의 주문은 불가", async () => {
    const fake = new FakeToss();
    const { customerId, order } = await paidOrder(fake);
    const [item] = await itemsOf(order.id);
    await orderError(() => confirmPurchase(customerId, order.orderNo, item.id), /배송이 시작된 상품만/);
    await shipAll(order.orderNo);
    const stranger = await newShopper("남");
    await orderError(() => confirmPurchase(stranger, order.orderNo, item.id), /찾을 수 없어요/);
    await confirmPurchase(customerId, order.orderNo, item.id);
    assert.equal((await itemsOf(order.id))[0].status, "CONFIRMED");
  });

  test("자동 구매확정: 7일 전에는 그대로, 7일이 지나면 AUTO 확정", async () => {
    const fake = new FakeToss();
    const { order } = await paidOrder(fake);
    const box = await shipAll(order.orderNo);
    const done = await deliverShipment(box.id);
    const at = done!.deliveredAt!.getTime();
    await autoConfirmDeliveredItems(new Date(at + AUTO_CONFIRM_DAYS * DAY - 1000));
    assert.equal((await itemsOf(order.id))[0].status, "DELIVERED");
    await autoConfirmDeliveredItems(new Date(at + AUTO_CONFIRM_DAYS * DAY + 1000));
    const [item] = await itemsOf(order.id);
    assert.deepEqual([item.status, item.confirmType, item.statusChangedBy], ["CONFIRMED", "AUTO", "SYSTEM"]);
  });

  test("출고 후에는 고객·관리자 모두 전체 취소 불가 (반품으로)", async () => {
    const fake = new FakeToss();
    const { customerId, order } = await paidOrder(fake);
    await shipAll(order.orderNo);
    assert.equal(await cancelPaidOrder(customerId, order.orderNo, { reason: "x" }, deps(fake)), "PREPARING");
    await orderError(() => adminCancelOrder(order.orderNo, "관리자", "ADMIN:test", deps(fake)), /출고된 상품/);
    assert.equal(fake.count("cancel"), 0);
  });

  test("관리자 취소 (상품 준비중 + 송장만 등록): 송장 취소 → 환불 → 할당 해제 → 주문 취소", async () => {
    const fake = new FakeToss();
    const { order } = await paidOrder(fake);
    await prepareOrder(order.orderNo, "ADMIN:test");
    const box = await registerShipment(order.orderNo, { courierCode: "CJ", trackingNo: tracking() }, "ADMIN:test");
    const r = await adminCancelOrder(order.orderNo, "품절로 출고 불가", "ADMIN:test", deps(fake));
    assert.equal(r?.status, "DONE");
    assert.equal((await prisma.shipment.findUniqueOrThrow({ where: { id: box!.id } })).status, "CANCELED");
    const o = await orderOf(order.id);
    assert.deepEqual([o.status, o.fulfillmentStatus], ["CANCELED", "CANCELED"]);
    assert.equal((await reservationsOf(order.id))[0].status, "RELEASED");
    const last = await prisma.orderStatusHistory.findFirstOrThrow({ where: { orderId: order.id }, orderBy: { id: "desc" } });
    assert.equal(last.changedBy, "ADMIN");
  });

  test("송장 취소 후 다시 등록 가능, 같은 송장 중복·자릿수 오류·없는 택배사는 거부", async () => {
    const fake = new FakeToss();
    const { order } = await paidOrder(fake);
    await prepareOrder(order.orderNo, "ADMIN:test");
    const no = tracking();
    const box = await registerShipment(order.orderNo, { courierCode: "CJ", trackingNo: no }, "ADMIN:test");
    await orderError(() => registerShipment(order.orderNo, { courierCode: "CJ", trackingNo: tracking() }, "ADMIN:test"), /상자에 담을 상품이 없어요/);
    await cancelShipment(box!.id);
    assert.equal((await itemsOf(order.id))[0].status, "PREPARING", "송장 취소해도 상품은 준비중");
    await orderError(() => registerShipment(order.orderNo, { courierCode: "CJ", trackingNo: no }, "ADMIN:test"), /이미 등록된 송장/);
    await orderError(() => registerShipment(order.orderNo, { courierCode: "CJ", trackingNo: "123" }, "ADMIN:test"), /자릿수/);
    await orderError(() => registerShipment(order.orderNo, { courierCode: "FEDEX", trackingNo: tracking() }, "ADMIN:test"), /사용할 수 없는 택배사/);
    await registerShipment(order.orderNo, { courierCode: "CJ", trackingNo: tracking() }, "ADMIN:test");
  });

  test("결제 전 주문은 준비·출고 불가", async () => {
    await setAvailable(sku(CODES[0]), 10);
    const customerId = await newShopper("결제전");
    const r = await placeOrder(customerId, [{ skuId: sku(CODES[0]), quantity: 1 }]);
    assert.ok(!("error" in r));
    await orderError(() => prepareOrder(r.orderNo, "ADMIN:test"), /결제 완료 주문만/);
  });
});

// ---------------------------------------------------------------
describe("개인정보 파기 (주문 5년)", () => {
  test("5년 지난 주문: 주문자·배송지·변경 이력 암호문 비움, 주문 기록·금액은 남음 / 최근 주문은 그대로", async () => {
    const sixYearsAgo = new Date(Date.now() - 6 * 365 * DAY);
    const customerId = await newShopper("오래된");
    const old = await makePayableOrder(customerId, { price: 10000, now: sixYearsAgo });
    await prisma.order.update({ where: { id: old.id }, data: { ordererNameEnc: null } }).catch(() => null); // (날것 주문은 원래 주문자 없음)
    const recent = await makePayableOrder(customerId, { price: 10000 });
    const n = await purgeExpiredOrderPii(new Date());
    assert.ok(n >= 1);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: old.id }, include: { shippingAddress: true } });
    assert.ok(o.piiPurgedAt);
    assert.deepEqual([o.shippingAddress!.recipientEnc, o.shippingAddress!.address1Enc, o.shippingAddress!.phoneEnc], [null, null, null]);
    assert.equal(o.shippingAddress!.zipCode, "06236", "우편번호(지역 통계)는 남김");
    assert.equal(o.totalPrice, old.totalPrice);
    const r = await prisma.order.findUniqueOrThrow({ where: { id: recent.id }, include: { shippingAddress: true } });
    assert.equal(r.piiPurgedAt, null);
    assert.ok(r.shippingAddress!.recipientEnc);
  });

  test("5년이 안 된 주문의 개인정보는 DB가 파기를 막음", async () => {
    const customerId = await newShopper("최근");
    const o = await makePayableOrder(customerId, { price: 10000 });
    await rejects(`UPDATE "OrderShippingAddress" SET "recipientEnc" = NULL, "phoneEnc" = NULL, "address1Enc" = NULL, "address2Enc" = NULL, "phoneHash" = NULL, "piiPurgedAt" = ${NOW()} WHERE "orderId" = ${o.id}`, "OrderShippingAddress_purge");
    await rejects(`UPDATE "Order" SET "piiPurgedAt" = ${NOW()} WHERE "id" = ${o.id}`, "Order_orderer_fixed");
  });
});

// ---------------------------------------------------------------
describe("주문 DB 제약 (앱을 거치지 않은 직접 수정도 막힘)", () => {
  let pending = 0; // 결제 대기 주문
  let pendingItem = 0;
  let paid = 0; // 결제 완료 주문
  let paidItem = 0;
  let shipped = 0; // 출고된 주문
  let shippedPayment = 0;
  before(async () => {
    const fake = new FakeToss();
    await setAvailable(sku(CODES[0]), 20);
    const c = await newShopper("제약");
    const r = await placeOrder(c, [{ skuId: sku(CODES[0]), quantity: 1 }]);
    assert.ok(!("error" in r));
    const p = await prisma.order.findUniqueOrThrow({ where: { orderNo: r.orderNo }, include: { items: true } });
    pending = p.id;
    pendingItem = p.items[0].id;
    const a = await paidOrder(fake);
    paid = a.order.id;
    paidItem = (await itemsOf(paid))[0].id;
    const b = await paidOrder(fake);
    await shipAll(b.order.orderNo);
    shipped = b.order.id;
    shippedPayment = (await prisma.payment.findFirstOrThrow({ where: { orderId: shipped } })).id;
  });

  test("결제액 공식이 틀리면 거부", () => rejects(`UPDATE "Order" SET "totalPrice" = "totalPrice" + 1 WHERE "id" = ${pending}`, "Order_total_fixed"));
  test("금액 구성 칸 변경 금지 (배송비·할인)", () => rejects(`UPDATE "Order" SET "shippingFee" = 0, "shippingBaseFee" = 0 WHERE "id" = ${pending}`, "Order_total_fixed"));
  test("주문번호 형식·변경", async () => {
    await rejects(`UPDATE "Order" SET "orderNo" = '20990101-00000077' WHERE "id" = ${pending}`, "Order_total_fixed");
  });
  test("진행 요약은 직접 바꿀 수 없음", () => rejects(`UPDATE "Order" SET "fulfillmentStatus" = 'DELIVERED' WHERE "id" = ${paid}`, "Order_fulfillment_guard"));
  test("주문 상품의 가격·수량·실결제액 변경 금지", async () => {
    await rejects(`UPDATE "OrderItem" SET "price" = 1 WHERE "id" = ${pendingItem}`, "OrderItem_immutable");
    await rejects(`UPDATE "OrderItem" SET "payAmount" = 1 WHERE "id" = ${pendingItem}`, "OrderItem_immutable");
  });
  test("주문 상품 삭제 금지, 결제된 주문에 상품 추가 금지", async () => {
    await rejects(`DELETE FROM "OrderItem" WHERE "id" = ${pendingItem}`, "OrderItem_no_delete");
    await rejects(
      `INSERT INTO "OrderItem" ("orderId","lineNo","skuId",quantity,"listPrice","discountAmount",price,"lineListTotal","lineDiscountTotal","lineTotal","payAmount","styleCode","skuCode","styleName","colorName","sizeName","statusChangedAt","createdAt") VALUES (${paid}, 2, ${sku(CODES[1])}, 1, 1000, 0, 1000, 1000, 0, 1000, 1000, 'X','X','X','X','X', ${NOW()}, ${NOW()})`,
      "OrderItem_insert_guard",
    );
  });
  test("상품 상태 건너뛰기·되돌리기 금지", async () => {
    await rejects(`UPDATE "OrderItem" SET "status" = 'SHIPPED', "preparingAt" = ${NOW()}, "shippedAt" = ${NOW()} WHERE "id" = ${paidItem}`, "OrderItem_status_transition");
    await rejects(`UPDATE "OrderItem" SET "status" = 'AWAITING_PAYMENT', "paidAt" = NULL WHERE "id" = ${paidItem}`, "OrderItem_status_transition");
  });
  test("배송중은 출고 상자 없이 직접 바꿀 수 없음", () =>
    rejects([`UPDATE "OrderItem" SET "status" = 'PREPARING', "preparingAt" = ${NOW()} WHERE "id" = ${paidItem}`, `UPDATE "OrderItem" SET "status" = 'SHIPPED', "shippedAt" = ${NOW()} WHERE "id" = ${paidItem}`], "OrderItem_shipment_only"));
  test("결제 전 상품은 준비 불가", () => rejects(`UPDATE "OrderItem" SET "status" = 'PREPARING', "paidAt" = ${NOW()}, "preparingAt" = ${NOW()} WHERE "id" = ${pendingItem}`, "OrderItem_status_transition"));
  test("상품 단위 취소는 지금 불가 (⑩ 클레임)", () => rejects(`UPDATE "OrderItem" SET "status" = 'CANCELED', "canceledAt" = ${NOW()} WHERE "id" = ${paidItem}`, "OrderItem_cancel_guard"));
  test("단계 시각이 빠지면 거부 (CHECK)", () => rejects(`UPDATE "OrderItem" SET "status" = 'PREPARING' WHERE "id" = ${paidItem}`, "OrderItem_state_ck"));
  test("이력은 수정·삭제 금지", async () => {
    await rejects(`UPDATE "OrderStatusHistory" SET "memo" = 'x' WHERE "orderId" = ${paid}`, "OrderStatusHistory_append_only");
    await rejects(`DELETE FROM "OrderItemStatusHistory" WHERE "orderItemId" = ${paidItem}`, "OrderItemStatusHistory_append_only");
  });
  test("할당된 재고를 환불 전에 풀기 금지", () =>
    rejects(`UPDATE "InventoryReservation" SET "status" = 'RELEASED', "releasedAt" = ${NOW()}, "releaseReason" = 'ADMIN' WHERE "orderId" = ${paid}`, "InventoryReservation_release_guard"));
  test("할당은 만료되지 않음", () =>
    rejects(`UPDATE "InventoryReservation" SET "status" = 'EXPIRED', "allocatedAt" = NULL, "releasedAt" = ${NOW()} WHERE "orderId" = ${paid}`, "허용되지 않은 예약 상태 변경"));
  test("출고된 주문: 전액 취소 금지 (PG 반영 제외), 주문 전체 취소 금지", async () => {
    await rejects(
      `INSERT INTO "PaymentCancel" ("paymentId","cancelAmount","taxFreeAmount","reasonCode","reasonText","requestedBy","status","idempotencyKey","requestedAt","updatedAt") SELECT ${shippedPayment}, p."balanceAmount", 0, 'ADMIN', '테스트', 'ADMIN', 'REQUESTED', 'ck_${Date.now()}', ${NOW()}, ${NOW()} FROM "Payment" p WHERE p."id" = ${shippedPayment}`,
      "PaymentCancel_shipped",
    );
    await rejects(`UPDATE "Order" SET "status" = 'CANCELED', "canceledAt" = ${NOW()}, "statusChangedAt" = ${NOW()} WHERE "id" = ${shipped}`, "Order_shipped_guard");
  });
  test("고객 요청 취소는 상품 준비 후 불가 (DB)", async () => {
    const fake = new FakeToss();
    const a = await paidOrder(fake);
    await prepareOrder(a.order.orderNo, "ADMIN:test");
    const pay = await prisma.payment.findFirstOrThrow({ where: { orderId: a.order.id } });
    await rejects(
      `INSERT INTO "PaymentCancel" ("paymentId","cancelAmount","taxFreeAmount","reasonCode","reasonText","requestedBy","status","idempotencyKey","requestedAt","updatedAt") VALUES (${pay.id}, 100, 0, 'CUSTOMER_REQUEST', '변심', 'CUSTOMER', 'REQUESTED', 'ck_c_${Date.now()}', ${NOW()}, ${NOW()})`,
      "PaymentCancel_customer_preparing",
    );
  });
  test("배송지 없이 결제 시작 금지, 상품 합계가 주문 금액과 다르면 결제 시작 금지", async () => {
    const c = await newShopper("결제검사");
    const { makeRawOrder } = await import("./helpers/orders");
    const raw = await makeRawOrder(c, [{ skuId: sku(CODES[0]), qty: 1 }]);
    const pay = (orderId: number, pg: string, amount: number) =>
      `INSERT INTO "Payment" ("orderId","attemptNo","provider","pgOrderId","status","amount","balanceAmount","statusSource","statusChangedAt","createdAt","updatedAt") VALUES (${orderId}, 1, 'TOSS', '${pg}', 'IN_PROGRESS', ${amount}, ${amount}, 'CONFIRM', ${NOW()}, ${NOW()}, ${NOW()})`;
    await rejects(pay(raw.id, raw.paymentOrderId, raw.totalPrice), "배송지가 없는 주문은 결제할 수 없습니다");
  });
  test("배송지: 버전을 올리지 않은 변경·결제 대기 아닌 주문에 새 배송지 금지", async () => {
    await rejects(`UPDATE "OrderShippingAddress" SET "zipCode" = '04524' WHERE "orderId" = ${paid}`, "OrderShippingAddress_version");
    await rejects(`UPDATE "OrderShippingAddress" SET "orderId" = ${pending} WHERE "orderId" = ${paid}`, "OrderShippingAddress_fixed");
    await rejects(`DELETE FROM "OrderShippingAddress" WHERE "orderId" = ${paid}`, "OrderShippingAddress_no_delete");
  });
  test("배송지: 평문 주소 금지 (암호문만)", () =>
    rejects(`UPDATE "OrderShippingAddress" SET "address1Enc" = '서울 강남구', "version" = "version" + 1, "changedBy" = 'ADMIN' WHERE "orderId" = ${pending}`, "OrderShippingAddress_values_ck"));
  test("배송지: 지역이 우편번호와 다르면 거부", () =>
    rejects(`UPDATE "OrderShippingAddress" SET "region" = 'JEJU', "version" = "version" + 1, "changedBy" = 'ADMIN' WHERE "orderId" = ${pending}`, "OrderShippingAddress_region"));
  test("출고: 반품·교환 종류는 아직 금지, 결제 전 주문 출고 금지, 송장은 숫자만", async () => {
    const courier = (await prisma.courier.findUniqueOrThrow({ where: { code: "CJ" } })).id;
    const ins = (order: number, type: string, no: string) =>
      `INSERT INTO "Shipment" ("orderId","type","status","locationId","courierId","trackingNo","statusChangedAt","createdBy","createdAt","updatedAt") VALUES (${order}, '${type}', 'READY', ${dc}, ${courier}, '${no}', ${NOW()}, 'ADMIN:t', ${NOW()}, ${NOW()})`;
    await rejects(ins(paid, "RETURN_PICKUP", "601200000001"), "Shipment_insert_guard");
    await rejects(ins(pending, "OUTBOUND", "601200000002"), "결제 완료된 주문만");
    await rejects(ins(paid, "OUTBOUND", "6012-0000-03"), "Shipment_tracking_ck");
  });
  test("출고 상자: 준비중이 아닌 상품은 담기 금지, 빈 상자 출고 금지", async () => {
    const courier = (await prisma.courier.findUniqueOrThrow({ where: { code: "CJ" } })).id;
    const no = `6013${String(Date.now()).slice(-8)}`;
    await rejects(
      [
        `INSERT INTO "Shipment" ("orderId","type","status","locationId","courierId","trackingNo","statusChangedAt","createdBy","createdAt","updatedAt") VALUES (${paid}, 'OUTBOUND', 'READY', ${dc}, ${courier}, '${no}', ${NOW()}, 'ADMIN:t', ${NOW()}, ${NOW()})`,
        `INSERT INTO "ShipmentItem" ("shipmentId","orderItemId","qty") VALUES ((SELECT id FROM "Shipment" WHERE "trackingNo" = '${no}'), ${paidItem}, 1)`,
      ],
      "상품 준비중인 상품만",
    );
    await rejects(
      [
        `INSERT INTO "Shipment" ("orderId","type","status","locationId","courierId","trackingNo","statusChangedAt","createdBy","createdAt","updatedAt") VALUES (${paid}, 'OUTBOUND', 'READY', ${dc}, ${courier}, '${no}', ${NOW()}, 'ADMIN:t', ${NOW()}, ${NOW()})`,
        `UPDATE "Shipment" SET "status" = 'SHIPPED', "shippedAt" = ${NOW()}, "statusChangedAt" = ${NOW()} WHERE "trackingNo" = '${no}'`,
      ],
      "빈 상자는 출고할 수 없습니다",
    );
  });
  test("출고 기록·출고 뒤 송장 변경 금지, 출고 → 송장 등록으로 되돌리기 금지", async () => {
    await rejects(`DELETE FROM "Shipment" WHERE "orderId" = ${shipped}`, "Shipment_no_delete");
    await rejects(`UPDATE "Shipment" SET "trackingNo" = '601299999999' WHERE "orderId" = ${shipped}`, "Shipment_fixed");
    await rejects(`UPDATE "Shipment" SET "status" = 'READY', "shippedAt" = NULL WHERE "orderId" = ${shipped}`, "Shipment_transition");
  });
  test("배송비 규칙: 기간 겹침 금지, 주문에 쓰인 규칙의 금액 변경 금지, 추가 배송 지역 변경 금지", async () => {
    await rejects(`INSERT INTO "ShippingPolicy" ("code","name","baseFee","freeShippingThreshold","validFrom","createdAt") VALUES ('X-1', 'x', 2500, NULL, ${NOW()}, ${NOW()})`, "ShippingPolicy_no_overlap");
    await rejects(`UPDATE "ShippingPolicy" SET "baseFee" = 2500 WHERE "code" = 'STD-2611'`, "ShippingPolicy_used_fixed");
    await rejects(`UPDATE "ShippingSurchargeZone" SET "extraFee" = 1 WHERE "region" = 'JEJU'`, "ShippingSurchargeZone_guard");
    await rejects(`DELETE FROM "ShippingSurchargeZone" WHERE "region" = 'JEJU'`, "ShippingSurchargeZone_guard");
  });
  test("주문 시각에 적용 중인 배송비 규칙·금액이 아니면 주문 생성 거부", async () => {
    const c = await newShopper("규칙");
    const cols = `"ordererType","orderNo","paymentOrderId","orderName","customerId","status","statusChangedAt","itemsListTotal","itemsDiscountTotal","itemsTotal","shippingBaseFee","shippingFee","totalPrice","shippingPolicyId","freeShippingThreshold","createdAt","updatedAt"`;
    const std = `(SELECT id FROM "ShippingPolicy" WHERE code = 'STD-2611')`;
    // 1만원 주문인데 기본 배송비 0 (무료 기준 5만원 미만)
    await rejects(`INSERT INTO "Order" (${cols}) VALUES ('MEMBER', '20990101-00000101', 'order_rule_1', 'x', ${c}, 'PENDING', ${NOW()}, 10000, 0, 10000, 0, 0, 10000, ${std}, 50000, ${NOW()}, ${NOW()})`, "기본 배송비가 배송비 규칙과 다릅니다");
    // 도입 전 규칙(이미 끝남)으로 지금 주문
    await rejects(`INSERT INTO "Order" (${cols}) VALUES ('MEMBER', '20990101-00000102', 'order_rule_2', 'x', ${c}, 'PENDING', ${NOW()}, 10000, 0, 10000, 0, 0, 10000, (SELECT id FROM "ShippingPolicy" WHERE code = 'LEGACY-FREE'), NULL, ${NOW()}, ${NOW()})`, "적용 중인 배송비 규칙이 아닙니다");
    // 결제액 공식 위반 (CHECK)
    await rejects(`INSERT INTO "Order" (${cols}) VALUES ('MEMBER', '20990101-00000103', 'order_rule_3', 'x', ${c}, 'PENDING', ${NOW()}, 10000, 0, 10000, 3000, 3000, 12000, ${std}, 50000, ${NOW()}, ${NOW()})`, "Order_amount_math_ck");
    // 주문번호 형식 (CHECK)
    await rejects(`INSERT INTO "Order" (${cols}) VALUES ('MEMBER', '2099-0101-1', 'order_rule_4', 'x', ${c}, 'PENDING', ${NOW()}, 10000, 0, 10000, 3000, 3000, 13000, ${std}, 50000, ${NOW()}, ${NOW()})`, "Order_no_ck");
  });
  test("주문자 정보 변경 금지 (평문·다른 값)", () => rejects(`UPDATE "Order" SET "ordererNameEnc" = 'v1:a:b:c' WHERE "id" = ${paid}`, "Order_orderer_fixed"));
});

// ---------------------------------------------------------------
describe("배송지 변경: 지역별 경계 (서울 외 내륙·섬·제주 → 내륙)", () => {
  test("서울 → 부산·대전(추가 배송비 없는 내륙)은 변경됨, 지역은 일반", async () => {
    const fake = new FakeToss();
    const { customerId, order } = await paidOrder(fake);
    for (const zip of ["48058", "35233"]) {
      const a = await giveAddress(customerId, { zipCode: zip });
      await changeOrderAddress(customerId, order.orderNo, a.id);
      const now = await prisma.orderShippingAddress.findUniqueOrThrow({ where: { orderId: order.id } });
      assert.deepEqual([now.zipCode, now.region], [zip, "NORMAL"]);
    }
    assert.equal((await prisma.orderShippingAddress.findUniqueOrThrow({ where: { orderId: order.id } })).version, 3);
  });

  test("서울 → 강화 본섬(23016, 내륙 취급)은 변경, 강화 섬 지역(23004, 도서산간)은 거부", async () => {
    const fake = new FakeToss();
    const { customerId, order } = await paidOrder(fake);
    const mainland = await giveAddress(customerId, { zipCode: "23016" });
    await changeOrderAddress(customerId, order.orderNo, mainland.id);
    const island = await giveAddress(customerId, { zipCode: "23004" });
    await orderError(() => changeOrderAddress(customerId, order.orderNo, island.id), /배송비가 달라지는 지역/);
  });

  test("제주 → 서울(추가 배송비가 없어지는 쪽)도 거부: 이미 낸 3,000원 차액 환불은 고객센터(⑩ 클레임)", async () => {
    const fake = new FakeToss();
    const { customerId, order } = await paidOrder(fake, { zip: "63100" });
    const seoul = await giveAddress(customerId, { zipCode: "04524" });
    await orderError(() => changeOrderAddress(customerId, order.orderNo, seoul.id), /배송비가 달라지는 지역/);
    assert.equal((await prisma.orderShippingAddress.findUniqueOrThrow({ where: { orderId: order.id } })).zipCode, "63100");
  });
});
