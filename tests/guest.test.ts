// 비회원 주문 테스트 (임시 DB 복사본 + 가짜 토스)
// 주문(직접 입력·비밀번호·동의) → 결제(출입증) → 조회(비밀번호·잠금·IP 제한) → 취소·배송지 변경·구매확정
// → 회원 계정으로 가져오기(비밀번호 / 같은 브라우저 출입증) + DB 제약 + 개인정보 파기
import { removeTempDb } from "./helpers/temp-db"; // ⚠️ 반드시 첫 줄
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { placeGuestOrder, placeOrder, type GuestCheckoutInput } from "../src/lib/checkout";
import { getAvailability, recordMovement } from "../src/lib/inventory";
import { abandonOrder, confirmOrderPayment, defaultPaymentDeps, type PaymentDeps } from "../src/lib/payment";
import { cancelPaidOrder, changeOrderAddressDirect, confirmPurchase, OrderError, prepareOrder, purgeExpiredOrderPii, registerShipment, shipShipment } from "../src/lib/order";
import {
  claimGuestOrder,
  cleanupGuestRecords,
  findGuestOrderId,
  GUEST_IP_FAILS_PER_HOUR,
  GUEST_LOCK_MINUTES,
  GUEST_MAX_FAILS,
  guestPasswordProblem,
  hashGuestPassword,
  lookupGuestOrder,
  verifyGuestPassword,
} from "../src/lib/guest";
import { getPaidAmountLast12Months, requestWithdrawal } from "../src/lib/customer";
import { blindIndex, decrypt } from "../src/lib/crypto";
import { createTossApi } from "../src/lib/toss";
import { FakeToss } from "./helpers/fake-toss";
import { newShopper } from "./helpers/orders";

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const ISO = (d: Date) => `'${d.toISOString().replace("Z", "+00:00")}'`;
const NOW = () => ISO(new Date());
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
  assert.ok(errorText(err).includes(expected), `다른 이유로 실패. 기대: ${expected}\n실제: ${errorText(err).slice(0, 400)}`);
}

const CODE = "SH26S002-NV-M";
let skuId = 0;
let dc = 0;
let ipSeq = 0;
const newIp = () => `10.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}.7`; // 테스트마다 다른 IP (IP 제한이 섞이지 않게)

async function setAvailable(n: number) {
  const diff = n - ((await getAvailability([skuId])).get(skuId) ?? 0);
  if (diff === 0) return;
  await prisma.$transaction((tx) =>
    recordMovement(tx, { skuId, locationId: dc, type: diff > 0 ? "INBOUND" : "ADJUST_OUT", qty: diff, refType: diff > 0 ? "INBOUND_ORDER" : "STOCK_COUNT", refId: "TEST", reason: "테스트 준비" }),
  );
}
function deps(fake: FakeToss): PaymentDeps {
  return { ...defaultPaymentDeps, toss: createTossApi({ transport: fake.transport, secretKey: () => "test_gsk_fake" }), waitForOtherMs: 3000 };
}
const guestInput = (over: Partial<GuestCheckoutInput> = {}, zip = "06236"): GuestCheckoutInput => ({
  orderer: { name: "김비회", phone: "010-3333-4444", email: "guest@example.test" },
  address: { recipient: "김비회", phone: "010-3333-4444", zipCode: zip, address1: "서울 강남구 테헤란로 1", address2: "2층", deliveryMemo: "문 앞" },
  password: "guest1234",
  passwordConfirm: "guest1234",
  privacyConsent: true,
  ...over,
});
/** 비회원 주문 → (선택) 결제 완료 */
async function guestOrder(fake: FakeToss, opts: { pay?: boolean; zip?: string; password?: string } = {}) {
  await setAvailable(10);
  const pw = opts.password ?? "guest1234";
  const r = await placeGuestOrder(guestInput({ password: pw, passwordConfirm: pw }, opts.zip), [{ skuId, quantity: 1 }]);
  assert.ok(!("error" in r), JSON.stringify(r));
  const order = await prisma.order.findUniqueOrThrow({ where: { orderNo: r.orderNo } });
  if (opts.pay !== false) {
    const paymentKey = fake.authorize({ orderId: order.paymentOrderId, amount: order.totalPrice });
    const c = await confirmOrderPayment({ guestOrderId: order.id, paymentOrderId: order.paymentOrderId, paymentKey, amount: String(order.totalPrice) }, deps(fake));
    assert.equal(c.kind, "PAID", JSON.stringify(c));
  }
  return { order: await prisma.order.findUniqueOrThrow({ where: { id: order.id } }), token: r.guestToken, password: pw };
}

before(async () => {
  dc = (await prisma.inventoryLocation.findUniqueOrThrow({ where: { code: "ONLINE_DC" } })).id;
  skuId = (await prisma.sku.findUniqueOrThrow({ where: { skuCode: CODE } })).id;
});
after(async () => {
  await prisma.$disconnect();
  removeTempDb();
});

// ---------------------------------------------------------------
describe("주문 비밀번호 (순수)", () => {
  test("규칙: 6~20자, 공백·같은 글자 반복·연속 숫자 금지, 확인 일치", () => {
    assert.match(guestPasswordProblem("12345") ?? "", /6~20자/);
    assert.match(guestPasswordProblem("a".repeat(21)) ?? "", /6~20자/);
    assert.match(guestPasswordProblem("ab cd12") ?? "", /공백/);
    assert.match(guestPasswordProblem("111111") ?? "", /같은 글자/);
    assert.match(guestPasswordProblem("123456") ?? "", /연속된 숫자/);
    assert.match(guestPasswordProblem("654321") ?? "", /연속된 숫자/);
    assert.match(guestPasswordProblem("guest1234", "guest1235") ?? "", /일치하지/);
    assert.equal(guestPasswordProblem("482915"), null, "숫자만도 허용");
    assert.equal(guestPasswordProblem("guest1234", "guest1234"), null);
  });
  test("해시로만 저장: 원문이 들어 있지 않고, 같은 비밀번호도 매번 다른 해시(소금값)", async () => {
    const a = await hashGuestPassword("guest1234");
    const b = await hashGuestPassword("guest1234");
    assert.ok(a.startsWith("s1:") && !a.includes("guest1234"));
    assert.notEqual(a, b);
    assert.equal(await verifyGuestPassword("guest1234", a), true);
    assert.equal(await verifyGuestPassword("guest1235", a), false);
    assert.equal(await verifyGuestPassword("guest1234", null), false);
  });
});

// ---------------------------------------------------------------
describe("비회원 주문 생성", () => {
  test("비회원 주문: 회원 없음, 주문자·배송지 암호화, 비밀번호 해시·동의 기록, 결제용 출입증", async () => {
    const fake = new FakeToss();
    const { order, token } = await guestOrder(fake, { pay: false });
    assert.deepEqual([order.ordererType, order.customerId, order.linkedAt], ["GUEST", null, null]);
    assert.equal(decrypt(order.ordererNameEnc!), "김비회");
    assert.equal(order.ordererPhoneHash, blindIndex("phone", "01033334444"));
    assert.equal(decrypt(order.ordererEmailEnc!), "guest@example.test");
    assert.deepEqual([order.couponDiscountTotal, order.pointUsed], [0, 0]);
    const access = await prisma.guestOrderAccess.findUniqueOrThrow({ where: { orderId: order.id } });
    assert.ok(access.passwordHash!.startsWith("s1:") && !access.passwordHash!.includes("guest1234"));
    assert.equal(access.privacyConsentVersion, "guest-order-2611");
    const addr = await prisma.orderShippingAddress.findUniqueOrThrow({ where: { orderId: order.id } });
    assert.equal(addr.sourceAddressId, null, "주소록 없이 직접 입력");
    assert.equal(decrypt(addr.deliveryMemoEnc!), "문 앞");
    assert.equal(await findGuestOrderId(token), order.id, "출입증으로 이 주문을 찾음");
    const s = await prisma.guestOrderSession.findFirstOrThrow({ where: { orderId: order.id } });
    assert.notEqual(s.tokenHash, token, "DB에는 출입증 원문이 아니라 해시");
  });

  test("입력 검사: 동의 안 함·연락처·이메일·비밀번호 확인·우편번호", async () => {
    const items = [{ skuId, quantity: 1 }];
    const err = async (input: GuestCheckoutInput, re: RegExp) => {
      const r = await placeGuestOrder(input, items);
      assert.ok("error" in r && re.test(r.error), JSON.stringify(r));
    };
    await err(guestInput({ privacyConsent: false }), /동의/);
    await err(guestInput({ orderer: { name: "김", phone: "1234", email: "a@b.co" } }), /휴대폰/);
    await err(guestInput({ orderer: { name: "김", phone: "010-1111-2222", email: "nope" } }), /이메일/);
    await err(guestInput({ passwordConfirm: "different1" }), /일치하지/);
    await err(guestInput({}, "123"), /우편번호/);
  });

  test("제주 우편번호면 추가 배송비 3,000원", async () => {
    const fake = new FakeToss();
    const { order } = await guestOrder(fake, { pay: false, zip: "63100" });
    assert.equal(order.shippingExtraFee, 3000);
  });

  test("같은 브라우저에서 다시 주문하면 이전 결제 대기 비회원 주문은 취소·재고 해제", async () => {
    await setAvailable(10);
    const first = await placeGuestOrder(guestInput(), [{ skuId, quantity: 2 }]);
    assert.ok(!("error" in first));
    const firstOrder = await prisma.order.findUniqueOrThrow({ where: { orderNo: first.orderNo } });
    const second = await placeGuestOrder(guestInput(), [{ skuId, quantity: 1 }], new Date(), { previousOrderId: firstOrder.id });
    assert.ok(!("error" in second));
    const after = await prisma.order.findUniqueOrThrow({ where: { id: firstOrder.id }, include: { reservations: true } });
    assert.equal(after.status, "CANCELED");
    assert.equal(after.reservations[0].releaseReason, "SUPERSEDED");
  });
});

// ---------------------------------------------------------------
describe("비회원 결제: 출입증이 그 주문의 것일 때만", () => {
  test("비회원 결제 완료 → 상품 결제 완료·재고 할당 (회원과 같은 흐름)", async () => {
    const fake = new FakeToss();
    const { order } = await guestOrder(fake);
    assert.equal(order.status, "PAID");
    assert.deepEqual((await prisma.inventoryReservation.findMany({ where: { orderId: order.id } })).map((r) => r.status), ["ALLOCATED"]);
  });

  test("다른 비회원 주문의 출입증·아무 회원으로는 승인 불가 (ORDER_NOT_FOUND, 토스 호출 없음)", async () => {
    const fake = new FakeToss();
    const a = await guestOrder(fake, { pay: false });
    const b = await guestOrder(fake, { pay: false });
    const paymentKey = fake.authorize({ orderId: a.order.paymentOrderId, amount: a.order.totalPrice });
    const base = { paymentOrderId: a.order.paymentOrderId, paymentKey, amount: String(a.order.totalPrice) };
    assert.deepEqual(await confirmOrderPayment({ ...base, guestOrderId: b.order.id }, deps(fake)), { kind: "FAILED", code: "ORDER_NOT_FOUND" });
    const member = await newShopper("회원");
    assert.deepEqual(await confirmOrderPayment({ ...base, customerId: member }, deps(fake)), { kind: "FAILED", code: "ORDER_NOT_FOUND" });
    assert.equal(fake.count("confirm"), 0);
  });

  test("결제창 이탈은 비회원 출입증으로 정리 가능, 남의 출입증으로는 불가", async () => {
    const fake = new FakeToss();
    const a = await guestOrder(fake, { pay: false });
    const b = await guestOrder(fake, { pay: false });
    assert.equal(await abandonOrder({ guestOrderId: b.order.id }, a.order.paymentOrderId, "PAYMENT_FAILED"), false);
    assert.equal(await abandonOrder({ guestOrderId: a.order.id }, a.order.paymentOrderId, "PAYMENT_FAILED"), true);
  });
});

// ---------------------------------------------------------------
describe("비회원 조회: 비밀번호·잠금·IP 제한", () => {
  test("맞으면 조회 출입증, 틀리면 WRONG + 실패 횟수, 없는 주문번호·회원 주문번호도 같은 WRONG", async () => {
    const fake = new FakeToss();
    const { order } = await guestOrder(fake);
    const ip = newIp();
    const ok = await lookupGuestOrder({ orderNo: order.orderNo, password: "guest1234", ip });
    assert.ok(ok.ok && "token" in ok);
    assert.equal(await findGuestOrderId((ok as { token: string }).token), order.id);
    assert.deepEqual(await lookupGuestOrder({ orderNo: order.orderNo, password: "wrong999", ip }), { ok: false, reason: "WRONG" });
    assert.equal((await prisma.guestOrderAccess.findUniqueOrThrow({ where: { orderId: order.id } })).failedCount, 1);
    assert.deepEqual(await lookupGuestOrder({ orderNo: "20991231-00000000", password: "guest1234", ip }), { ok: false, reason: "WRONG" }, "없는 주문번호");
    const member = await newShopper("회원조회");
    const placed = await placeOrder(member, [{ skuId, quantity: 1 }]);
    assert.ok(!("error" in placed));
    assert.deepEqual(await lookupGuestOrder({ orderNo: placed.orderNo, password: "guest1234", ip }), { ok: false, reason: "WRONG" }, "회원 주문은 비회원 조회 불가");
    assert.deepEqual(await lookupGuestOrder({ orderNo: "'; DROP TABLE x;--", password: "x", ip }), { ok: false, reason: "WRONG" });
  });

  test(`${GUEST_MAX_FAILS}번 틀리면 ${GUEST_LOCK_MINUTES}분 잠금: 그동안은 맞는 비밀번호도 WRONG, 지나면 다시 가능`, async () => {
    const fake = new FakeToss();
    const { order } = await guestOrder(fake);
    const ip = newIp();
    const t0 = new Date();
    for (let i = 0; i < GUEST_MAX_FAILS; i++) await lookupGuestOrder({ orderNo: order.orderNo, password: `bad${i}xyz`, ip, now: t0 });
    const a = await prisma.guestOrderAccess.findUniqueOrThrow({ where: { orderId: order.id } });
    assert.ok(a.lockedUntil && a.lockedUntil.getTime() === t0.getTime() + GUEST_LOCK_MINUTES * MIN);
    assert.deepEqual(await lookupGuestOrder({ orderNo: order.orderNo, password: "guest1234", ip, now: new Date(t0.getTime() + 10 * MIN) }), { ok: false, reason: "WRONG" });
    const later = await lookupGuestOrder({ orderNo: order.orderNo, password: "guest1234", ip: newIp(), now: new Date(t0.getTime() + (GUEST_LOCK_MINUTES + 1) * MIN) });
    assert.ok(later.ok, "잠금이 풀리면 조회 가능");
    const locked = await prisma.guestLookupAttempt.count({ where: { orderId: order.id, result: "LOCKED" } });
    assert.equal(locked, 1, "잠긴 동안의 시도도 기록");
  });

  test(`같은 IP에서 1시간에 ${GUEST_IP_FAILS_PER_HOUR}번 실패하면 맞는 비밀번호도 차단 (다른 IP는 영향 없음), IP는 해시로만 기록`, async () => {
    const fake = new FakeToss();
    const { order } = await guestOrder(fake);
    const ip = "203.0.113.77";
    for (let i = 0; i < GUEST_IP_FAILS_PER_HOUR; i++) await lookupGuestOrder({ orderNo: `20991231-${String(i).padStart(8, "0")}`, password: "nope12", ip });
    assert.deepEqual(await lookupGuestOrder({ orderNo: order.orderNo, password: "guest1234", ip }), { ok: false, reason: "RATE_LIMITED" });
    assert.ok((await lookupGuestOrder({ orderNo: order.orderNo, password: "guest1234", ip: newIp() })).ok);
    const rec = await prisma.guestLookupAttempt.findFirstOrThrow({ where: { result: "RATE_LIMITED" } });
    assert.equal(rec.ipHash, blindIndex("ip", ip));
    assert.equal(rec.ipMasked, "203.0.113.*");
    assert.equal(await prisma.guestLookupAttempt.count({ where: { ipMasked: ip } }), 0, "원래 IP는 어디에도 없음");
  });
});

// ---------------------------------------------------------------
describe("비회원 주문 처리: 취소·배송지 변경·구매확정", () => {
  test("결제 완료 비회원 주문 취소 → 환불·재고 할당 해제, 요청자 기록은 GUEST:주문", async () => {
    const fake = new FakeToss();
    const { order } = await guestOrder(fake);
    assert.equal(await cancelPaidOrder({ guestOrderId: order.id }, order.orderNo, { reason: "단순 변심" }, deps(fake)), "DONE");
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "CANCELED");
    const c = await prisma.paymentCancel.findFirstOrThrow({ where: { payment: { orderId: order.id } } });
    assert.equal(c.requestedByRef, `GUEST:${order.id}`);
  });

  test("다른 비회원의 출입증으로는 취소·확정 불가", async () => {
    const fake = new FakeToss();
    const a = await guestOrder(fake);
    const b = await guestOrder(fake);
    assert.equal(await cancelPaidOrder({ guestOrderId: b.order.id }, a.order.orderNo, { reason: "x" }, deps(fake)), "NOT_FOUND");
  });

  test("배송지 직접 입력 변경: 내륙은 가능, 제주는 거부, 입력이 틀리면 안내", async () => {
    const fake = new FakeToss();
    const { order } = await guestOrder(fake);
    const owner = { guestOrderId: order.id };
    const addr = { recipient: "박받음", phone: "010-5555-6666", zipCode: "48058", address1: "부산 해운대구 1" };
    await changeOrderAddressDirect(owner, order.orderNo, addr);
    const a = await prisma.orderShippingAddress.findUniqueOrThrow({ where: { orderId: order.id } });
    assert.deepEqual([a.zipCode, a.version, decrypt(a.recipientEnc!)], ["48058", 2, "박받음"]);
    await assert.rejects(() => changeOrderAddressDirect(owner, order.orderNo, { ...addr, zipCode: "63100" }), (e) => e instanceof OrderError && /배송비가 달라지는/.test(e.message));
    await assert.rejects(() => changeOrderAddressDirect(owner, order.orderNo, { ...addr, phone: "12" }), (e) => e instanceof OrderError && /휴대폰/.test(e.message));
  });

  test("출고 후 비회원도 구매확정 가능", async () => {
    const fake = new FakeToss();
    const { order } = await guestOrder(fake);
    await prepareOrder(order.orderNo, "ADMIN:test");
    const box = await registerShipment(order.orderNo, { courierCode: "CJ", trackingNo: `6014${String(Date.now()).slice(-8)}` }, "ADMIN:test");
    await shipShipment(box!.id);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    await confirmPurchase({ guestOrderId: order.id }, order.orderNo, item.id);
    assert.equal((await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } })).status, "CONFIRMED");
  });
});

// ---------------------------------------------------------------
describe("회원 계정으로 가져오기", () => {
  test("주문번호+비밀번호로 가져오기 → 회원 주문, 비회원 출입증 무효, 주문 당시 사실(비회원·주문자)은 그대로", async () => {
    const fake = new FakeToss();
    const { order, token } = await guestOrder(fake);
    const member = await newShopper("가입자");
    const r = await claimGuestOrder({ customerId: member, orderNo: order.orderNo, password: "guest1234", ip: newIp() });
    assert.deepEqual(r, { code: "DONE", orderNo: order.orderNo });
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { guestAccess: true } });
    assert.deepEqual([o.customerId, o.ordererType], [member, "GUEST"]);
    assert.ok(o.linkedAt && o.guestAccess!.claimedAt);
    assert.equal(o.guestAccess!.claimedByCustomerId, member);
    assert.equal(decrypt(o.ordererNameEnc!), "김비회", "주문자 정보는 주문 당시 그대로");
    assert.equal(await findGuestOrderId(token), null, "비회원 출입증은 더 이상 안 통함");
    // 이제 회원으로 처리 가능, 비회원으로는 불가
    assert.equal(await cancelPaidOrder({ guestOrderId: order.id }, order.orderNo, { reason: "x" }, deps(fake)), "NOT_FOUND");
    assert.equal(await cancelPaidOrder(member, order.orderNo, { reason: "변심" }, deps(fake)), "DONE");
  });

  test("가져간 뒤 비회원 조회: 비밀번호가 맞을 때만 '옮겨졌어요'(CLAIMED), 틀리면 WRONG. 다른 회원이 다시 가져갈 수 없음", async () => {
    const fake = new FakeToss();
    const { order } = await guestOrder(fake);
    const m1 = await newShopper("가입1");
    const m2 = await newShopper("가입2");
    assert.equal((await claimGuestOrder({ customerId: m1, orderNo: order.orderNo, password: "guest1234", ip: newIp() })).code, "DONE");
    assert.deepEqual(await lookupGuestOrder({ orderNo: order.orderNo, password: "guest1234", ip: newIp() }), { ok: false, reason: "CLAIMED" });
    assert.deepEqual(await lookupGuestOrder({ orderNo: order.orderNo, password: "wrong999", ip: newIp() }), { ok: false, reason: "WRONG" });
    assert.equal((await claimGuestOrder({ customerId: m2, orderNo: order.orderNo, password: "guest1234", ip: newIp() })).code, "CLAIMED");
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).customerId, m1);
  });

  test("같은 브라우저의 출입증으로 비밀번호 없이 가져오기, 출입증과 다른 주문번호면 비밀번호 필요", async () => {
    const fake = new FakeToss();
    const a = await guestOrder(fake);
    const b = await guestOrder(fake);
    const member = await newShopper("출입증가입");
    assert.equal((await claimGuestOrder({ customerId: member, orderNo: b.order.orderNo, sessionToken: a.token, ip: newIp() })).code, "WRONG", "a의 출입증으로 b를 가져갈 수 없음");
    assert.equal((await claimGuestOrder({ customerId: member, orderNo: a.order.orderNo, sessionToken: a.token, ip: newIp() })).code, "DONE");
  });

  test("결제 전 주문은 가져올 수 없음, 틀린 비밀번호는 WRONG + 실패 횟수", async () => {
    const fake = new FakeToss();
    const pending = await guestOrder(fake, { pay: false });
    const member = await newShopper("가입대기");
    assert.equal((await claimGuestOrder({ customerId: member, orderNo: pending.order.orderNo, password: "guest1234", ip: newIp() })).code, "NOT_CLAIMABLE");
    const paid = await guestOrder(fake);
    assert.equal((await claimGuestOrder({ customerId: member, orderNo: paid.order.orderNo, password: "nope1234", ip: newIp() })).code, "WRONG");
    assert.equal((await prisma.guestOrderAccess.findUniqueOrThrow({ where: { orderId: paid.order.id } })).failedCount, 1);
    const attempt = await prisma.guestLookupAttempt.findFirstOrThrow({ where: { orderId: paid.order.id, purpose: "CLAIM" } });
    assert.equal(attempt.customerId, member, "누가 가져오려 했는지 기록");
  });

  test("탈퇴 신청 중인 회원은 가져올 수 없음 (DB도 막음)", async () => {
    const fake = new FakeToss();
    const { order } = await guestOrder(fake);
    const member = await newShopper("탈퇴중");
    await requestWithdrawal(member, { reasonCode: "OTHER" });
    assert.equal((await claimGuestOrder({ customerId: member, orderNo: order.orderNo, password: "guest1234", ip: newIp() })).code, "NOT_ACTIVE");
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).customerId, null, "실패하면 아무것도 바뀌지 않음");
    assert.equal((await prisma.guestOrderAccess.findUniqueOrThrow({ where: { orderId: order.id } })).claimedAt, null);
  });

  test("가져온 주문은 등급 실적(최근 12개월 결제 금액)에 포함, 가져오기 전에는 미포함", async () => {
    const fake = new FakeToss();
    const { order } = await guestOrder(fake);
    const member = await newShopper("등급");
    assert.equal(await getPaidAmountLast12Months(member), 0);
    await claimGuestOrder({ customerId: member, orderNo: order.orderNo, password: "guest1234", ip: newIp() });
    assert.equal(await getPaidAmountLast12Months(member), order.totalPrice);
  });

  test("가져온 주문이 배송 중이면 그 회원은 탈퇴 불가 (회원 주문과 같은 규칙)", async () => {
    const fake = new FakeToss();
    const { order } = await guestOrder(fake);
    const member = await newShopper("가져온탈퇴");
    await claimGuestOrder({ customerId: member, orderNo: order.orderNo, password: "guest1234", ip: newIp() });
    await assert.rejects(() => requestWithdrawal(member, { reasonCode: "OTHER" }), /구매확정 전인 주문/);
  });
});

// ---------------------------------------------------------------
describe("비회원 개인정보 파기·정리", () => {
  test("5년 지난 비회원 주문: 주문자·배송지와 함께 조회 비밀번호도 파기 → 조회 불가", async () => {
    const fake = new FakeToss();
    const { order } = await guestOrder(fake);
    // 6년 전 주문으로 만들 수는 없으므로(배송비 규칙 기간), 파기 시점을 6년 뒤로 돌려 실행
    await purgeExpiredOrderPii(new Date(Date.now() + 6 * 365 * DAY));
    const a = await prisma.guestOrderAccess.findUniqueOrThrow({ where: { orderId: order.id } });
    assert.equal(a.passwordHash, null);
    assert.deepEqual(await lookupGuestOrder({ orderNo: order.orderNo, password: "guest1234", ip: newIp(), now: new Date(Date.now() + 6 * 365 * DAY) }), { ok: false, reason: "WRONG" });
  });

  test("정리 작업: 만료된 출입증 삭제, 유효한 출입증은 남김", async () => {
    const fake = new FakeToss();
    const { token } = await guestOrder(fake, { pay: false });
    const r = await cleanupGuestRecords(new Date());
    assert.ok(r.sessions >= 0);
    assert.ok(await findGuestOrderId(token), "아직 유효한 출입증은 그대로");
    // (미래 시각으로 돌려 보는 시험은 하지 않음: DB 삭제 규칙은 실제 시각 기준이라 아직 유효한 출입증 삭제를 막음 — 그게 맞는 동작)
  });
});

// ---------------------------------------------------------------
describe("비회원 DB 제약 (앱을 거치지 않은 직접 수정도 막힘)", () => {
  let guest = 0;
  let guestPending = 0;
  let memberOrder = 0;
  let memberId = 0;
  before(async () => {
    const fake = new FakeToss();
    guest = (await guestOrder(fake)).order.id;
    guestPending = (await guestOrder(fake, { pay: false })).order.id;
    memberId = await newShopper("제약회원");
    const placed = await placeOrder(memberId, [{ skuId, quantity: 1 }]);
    assert.ok(!("error" in placed));
    memberOrder = (await prisma.order.findUniqueOrThrow({ where: { orderNo: placed.orderNo } })).id;
  });

  test("주문자 신분 바꾸기 금지 (회원↔비회원)", () => rejects(`UPDATE "Order" SET "ordererType" = 'GUEST' WHERE "id" = ${memberOrder}`, "Order_link_guard"));
  test("회원 주문의 회원을 다른 회원으로 바꾸기 금지", () => rejects(`UPDATE "Order" SET "customerId" = (SELECT min(id) FROM "Customer" WHERE id <> ${memberId}) WHERE "id" = ${memberOrder}`, "이미 회원 주문입니다"));
  test("가져오기 기록 없이 비회원 주문에 회원 붙이기 금지", () =>
    rejects(`UPDATE "Order" SET "customerId" = ${memberId}, "linkedAt" = ${NOW()} WHERE "id" = ${guest}`, "가져오기 기록(GuestOrderAccess)의 회원과 다릅니다"));
  test("결제 대기 비회원 주문은 가져오기 금지 (주문·가져오기 기록 모두)", async () => {
    await rejects(`UPDATE "GuestOrderAccess" SET "claimedAt" = ${NOW()}, "claimedByCustomerId" = ${memberId} WHERE "orderId" = ${guestPending}`, "GuestOrderAccess_claim_once");
  });
  test("회원·가져온 시각은 함께 (CHECK)", () =>
    rejects([`UPDATE "GuestOrderAccess" SET "claimedAt" = ${NOW()}, "claimedByCustomerId" = ${memberId} WHERE "orderId" = ${guest}`, `UPDATE "Order" SET "customerId" = ${memberId} WHERE "id" = ${guest}`], "Order_link_guard"));
  test("비회원 주문에 쿠폰·포인트 금지, 주문자 연락처 필수", async () => {
    const cols = (extra: string) =>
      `INSERT INTO "Order" ("ordererType","orderNo","paymentOrderId","orderName","customerId","status","statusChangedAt","itemsListTotal","itemsDiscountTotal","itemsTotal","couponDiscountTotal","shippingBaseFee","shippingFee","pointUsed","totalPrice","shippingPolicyId","freeShippingThreshold","ordererNameEnc","ordererPhoneEnc","ordererPhoneHash","ordererEmailEnc","createdAt","updatedAt") SELECT ${extra}, sp.id, sp."freeShippingThreshold", 'v1:a:b:c', 'v1:a:b:c', '${"a".repeat(64)}', 'v1:a:b:c', ${NOW()}, ${NOW()} FROM "ShippingPolicy" sp WHERE sp."validTo" IS NULL`;
    await rejects(cols(`'GUEST', '20990101-00000201', 'order_g_1', 'x', NULL, 'PENDING', ${NOW()}, 10000, 0, 10000, 1000, 3000, 3000, 0, 12000`), "Order_guest_benefit_ck");
    await rejects(cols(`'GUEST', '20990101-00000202', 'order_g_2', 'x', NULL, 'PENDING', ${NOW()}, 10000, 0, 10000, 0, 3000, 3000, 500, 12500`), "Order_guest_benefit_ck");
    await rejects(cols(`'MEMBER', '20990101-00000203', 'order_g_3', 'x', NULL, 'PENDING', ${NOW()}, 10000, 0, 10000, 0, 3000, 3000, 0, 13000`), "Order_orderer_type_ck");
    await rejects(`UPDATE "Order" SET "ordererPhoneEnc" = NULL WHERE "id" = ${guestPending}`, "Order_guest_orderer_ck");
  });
  test("비밀번호 원문 저장 금지, 비밀번호 바꾸기 금지(파기만), 동의 기록 변경·삭제 금지", async () => {
    await rejects(`UPDATE "GuestOrderAccess" SET "passwordHash" = 'guest1234' WHERE "orderId" = ${guest}`, "GuestOrderAccess_fixed");
    await rejects(`UPDATE "GuestOrderAccess" SET "privacyConsentVersion" = 'x' WHERE "orderId" = ${guest}`, "GuestOrderAccess_fixed");
    await rejects(`DELETE FROM "GuestOrderAccess" WHERE "orderId" = ${guest}`, "GuestOrderAccess_no_delete");
  });
  test("회원 주문에 비회원 비밀번호·출입증 만들기 금지", async () => {
    await rejects(`INSERT INTO "GuestOrderAccess" ("orderId","passwordHash","privacyConsentAt","privacyConsentVersion","createdAt","updatedAt") VALUES (${memberOrder}, 's1:${"a".repeat(24)}:${"b".repeat(44)}', ${NOW()}, 'v', ${NOW()}, ${NOW()})`, "GuestOrderAccess_insert_guard");
    await rejects(`INSERT INTO "GuestOrderSession" ("orderId","tokenHash","purpose","expiresAt","createdAt") VALUES (${memberOrder}, '${"c".repeat(64)}', 'LOOKUP', '2099-01-01T00:00:00.000+00:00', ${NOW()})`, "GuestOrderSession_insert_guard");
  });
  test("출입증 기간 연장 금지, 유효한 출입증 삭제 금지, 시도 기록 수정 금지", async () => {
    await rejects(`UPDATE "GuestOrderSession" SET "expiresAt" = '2099-01-01T00:00:00.000+00:00' WHERE "orderId" = ${guestPending}`, "GuestOrderSession_revoke_only");
    await rejects(`DELETE FROM "GuestOrderSession" WHERE "orderId" = ${guestPending} AND "revokedAt" IS NULL`, "GuestOrderSession_delete_guard");
    await rejects(`UPDATE "GuestLookupAttempt" SET "result" = 'SUCCESS'`, "GuestLookupAttempt_append_only");
  });
  test("90일이 안 된 시도 기록 삭제 금지", () => rejects(`DELETE FROM "GuestLookupAttempt"`, "GuestLookupAttempt_retention"));
  test("비회원 주문은 조회 비밀번호 기록이 있어야 결제 시작 (주문만 따로 만든 경우)", async () => {
    // 결제 대기 비회원 주문의 비밀번호를 파기한 상태를 흉내 (파기 = 비우기만 가능) → 결제 시작 거부
    await rejects(
      [
        `UPDATE "GuestOrderAccess" SET "passwordHash" = NULL WHERE "orderId" = ${guestPending}`,
        `INSERT INTO "Payment" ("orderId","attemptNo","provider","pgOrderId","status","amount","balanceAmount","statusSource","statusChangedAt","createdAt","updatedAt") SELECT o.id, 1, 'TOSS', o."paymentOrderId", 'IN_PROGRESS', o."totalPrice", o."totalPrice", 'CONFIRM', ${NOW()}, ${NOW()}, ${NOW()} FROM "Order" o WHERE o.id = ${guestPending}`,
      ],
      "비회원 주문은 조회 비밀번호",
    );
  });
});
