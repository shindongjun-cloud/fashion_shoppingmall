// 쿠폰 테스트 (임시 DB 복사본): 발급(가입·다운로드·코드·생일·등급·관리자) → 주문에 사용(예약) → 결제(사용) / 이탈·만료(복원) / 결제 후 취소(복원·소멸) → 반품 환불 → DB 제약
import { removeTempDb, TEMP_DB_PATH } from "./helpers/temp-db"; // ⚠️ 반드시 첫 줄
import { execFileSync } from "node:child_process";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { placeOrder, placeGuestOrder } from "../src/lib/checkout";
import { abandonOrder, confirmOrderPayment, defaultPaymentDeps, type PaymentDeps } from "../src/lib/payment";
import { getAvailability, recordMovement } from "../src/lib/inventory";
import { cancelPaidOrder, deliverShipment, prepareOrder, registerShipment, shipShipment } from "../src/lib/order";
import { approveReturn, inspectReturn, receiveReturn, registerReturnPickup, requestReturn } from "../src/lib/returns";
import { completeWithdrawal, requestWithdrawal } from "../src/lib/customer";
import {
  adminIssueCoupon,
  CODE_FAIL_LIMIT,
  couponOptionsFor,
  CouponError,
  createCouponPolicy,
  downloadCoupon,
  expireCoupons,
  issueBirthdayCoupons,
  issueGradeCoupons,
  notifyExpiringCoupons,
  redeemCouponCode,
  setPolicyStatus,
  usableCoupons,
} from "../src/lib/coupon";
import { couponChoices, couponValidTo } from "../src/lib/coupon-rules";
import { getCartSkus } from "../src/lib/catalog";
import { encrypt } from "../src/lib/crypto";
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
const couponErr = (fn: () => Promise<unknown>, re: RegExp) => assert.rejects(fn, (e) => e instanceof CouponError && re.test(e.message));

// 상품 (시드): 자켓 259,000(정상가) / 슬랙스 89,000(정상가) / 셔츠 49,000(시즌오프) / 니트 103,200(니트 위크) / 볼캡 27,000(시즌오프)
const JACKET = "JK26F001-BK-95";
const PANTS = "PT26F004-BK-28";
const SHIRT = "SH26S002-WH-L";
const KNIT = "KN26F003-IV-S";
const CAP = "CP26S006-BK-F";
let dc = 0;
const skuId = new Map<string, number>();
const id = (c: string) => skuId.get(c)!;
const policyId = new Map<string, number>();
let trackingSeq = 0;
const tracking = () => `6017${String(Date.now()).slice(-6)}${String(++trackingSeq).padStart(2, "0")}`;

async function setAvailable(code: string, n: number) {
  const diff = n - ((await getAvailability([id(code)])).get(id(code)) ?? 0);
  if (diff === 0) return;
  await prisma.$transaction((tx) =>
    recordMovement(tx, { skuId: id(code), locationId: dc, type: diff > 0 ? "INBOUND" : "ADJUST_OUT", qty: diff, refType: diff > 0 ? "INBOUND_ORDER" : "STOCK_COUNT", refId: "TEST", reason: "테스트 준비" }),
  );
}
function deps(fake: FakeToss, extra: Partial<PaymentDeps> = {}): PaymentDeps {
  return { ...defaultPaymentDeps, toss: createTossApi({ transport: fake.transport, secretKey: () => "test_gsk_fake" }), waitForOtherMs: 3000, ...extra };
}
const couponOf = (customerId: number, code: string) =>
  prisma.customerCoupon.findFirstOrThrow({ where: { customerId, policy: { code } }, orderBy: { id: "desc" } });
const reload = (couponId: number) => prisma.customerCoupon.findUniqueOrThrow({ where: { id: couponId } });
const cart = (...codes: string[]) => codes.map((c) => ({ skuId: id(c), quantity: 1 }));

/** 주문 + 결제 (가짜 토스) */
async function orderAndPay(fake: FakeToss, customerId: number, codes: string[], couponId: number | null = null, now = new Date()) {
  for (const c of codes) await setAvailable(c, 10);
  const placed = await placeOrder(customerId, cart(...codes), now, { couponId });
  assert.ok(!("error" in placed), JSON.stringify(placed));
  const order = await prisma.order.findUniqueOrThrow({ where: { orderNo: placed.orderNo } });
  const paymentKey = fake.authorize({ orderId: order.paymentOrderId, amount: order.totalPrice });
  const r = await confirmOrderPayment({ customerId, paymentOrderId: order.paymentOrderId, paymentKey, amount: String(order.totalPrice) }, deps(fake));
  return { order: await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: { orderBy: { lineNo: "asc" } }, coupons: { include: { items: true } } } }), result: r };
}

before(async () => {
  dc = (await prisma.inventoryLocation.findUniqueOrThrow({ where: { code: "ONLINE_DC" } })).id;
  for (const s of await prisma.sku.findMany({ select: { id: true, skuCode: true } })) skuId.set(s.skuCode, s.id);
  for (const p of await prisma.couponPolicy.findMany()) policyId.set(p.code, p.id);
  assert.ok(policyId.has("WELCOME_10"), "시드 쿠폰이 있어야 함 (npm run db:seed)");
});
after(async () => {
  await prisma.$disconnect();
  removeTempDb();
});

// ---------------------------------------------------------------
describe("발급", () => {
  test("가입하면 신규가입 쿠폰 1장 자동 + 알림, 사용 기간 = 발급일 포함 30일", async () => {
    const before = Date.now();
    const c = await newShopper("가입쿠폰");
    const cc = await couponOf(c, "WELCOME_10");
    assert.deepEqual([cc.status, cc.issueMethod, cc.issueKey], ["AVAILABLE", "AUTO", "SIGNUP"]);
    assert.equal(cc.validTo.getTime(), couponValidTo(cc.issuedAt, 30).getTime());
    assert.ok(cc.issuedAt.getTime() >= before - 1000);
    assert.equal(await prisma.notification.count({ where: { customerId: c, type: "COUPON_ISSUED" } }), 1);
    const h = await prisma.customerCouponHistory.findMany({ where: { customerCouponId: cc.id } });
    assert.deepEqual(h.map((x) => [x.fromStatus, x.toStatus, x.reason]), [[null, "AVAILABLE", "ISSUED:AUTO"]]);
  });

  test("다운로드: 1인 1장, 자동 발급 쿠폰은 다운로드 불가", async () => {
    const c = await newShopper("다운로드");
    await downloadCoupon(c, policyId.get("FREE_SHIP")!);
    await couponErr(() => downloadCoupon(c, policyId.get("FREE_SHIP")!), /이미 받은/);
    await couponErr(() => downloadCoupon(c, policyId.get("WELCOME_10")!), /받을 수 없는/);
  });

  test("선착순: 3장 남았는데 6명이 동시에 받으면 정확히 3명만", async () => {
    const now = new Date();
    const p = await createCouponPolicy({ code: "RUSH_3", name: "선착순", displayName: "선착순 3장", kind: "ORDER", discountType: "AMOUNT", discountValue: 1000, minOrderAmount: 10000, issueMethod: "DOWNLOAD", issueStartAt: new Date(now.getTime() - DAY), issueEndAt: new Date(now.getTime() + DAY), totalQuantity: 3, validDays: 7, targets: [{ targetType: "ALL" }], activate: true, by: "TEST" }, now);
    const people = await Promise.all(Array.from({ length: 6 }, (_, i) => newShopper(`선착순${i}`)));
    const results = await Promise.allSettled(people.map((c) => downloadCoupon(c, p.id)));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 3);
    for (const r of results.filter((x) => x.status === "rejected")) assert.match(String((r as PromiseRejectedResult).reason.message), /소진/);
    assert.equal((await prisma.couponPolicy.findUniqueOrThrow({ where: { id: p.id } })).issuedCount, 3);
  });

  test("긴급 중지하면 발급·결제 화면 후보에서 빠지고, 다시 켜면 돌아옴", async () => {
    const c = await newShopper("중지");
    await setPolicyStatus("WELCOME_10", "PAUSED");
    try {
      assert.equal((await usableCoupons(c)).some((x) => x.policy.code === "WELCOME_10"), false);
      const other = await newShopper("중지중가입"); // 중지 중 가입 → 가입 쿠폰 없음 (가입은 정상)
      assert.equal(await prisma.customerCoupon.count({ where: { customerId: other } }), 0);
    } finally {
      await setPolicyStatus("WELCOME_10", "ACTIVE");
    }
    assert.equal((await usableCoupons(c)).some((x) => x.policy.code === "WELCOME_10"), true);
  });

  test("코드: 대소문자·하이픈 무시, 1인 1회, 틀린 코드 10번이면 1시간 잠금 (맞는 코드도)", async () => {
    const c = await newShopper("코드");
    const r = await redeemCouponCode(c, " welcome-2026 ");
    assert.equal(r.policy.code, "CODE_WELCOME");
    await couponErr(() => redeemCouponCode(c, "WELCOME2026"), /이미 받은/);
    const d = await newShopper("코드대입");
    for (let i = 0; i < CODE_FAIL_LIMIT; i++) await couponErr(() => redeemCouponCode(d, `WRONG${i}XX`), /사용할 수 없는 쿠폰 코드/);
    await couponErr(() => redeemCouponCode(d, "WELCOME2026"), /1시간 뒤/);
    const later = new Date(Date.now() + 61 * 60 * 1000);
    assert.equal((await redeemCouponCode(d, "WELCOME2026", later)).policy.code, "CODE_WELCOME");
  });

  test("등급 쿠폰: 대상 등급만, 같은 달 여러 번 돌려도 1장 / 관리자 지급도 등급 규칙 적용", async () => {
    const welcome = await newShopper("등급웰컴");
    const gold = await newShopper("등급골드");
    const goldGrade = await prisma.customerGrade.findUniqueOrThrow({ where: { code: "GOLD" } });
    const cur = await prisma.customer.findUniqueOrThrow({ where: { id: gold } });
    await prisma.$transaction(async (tx) => {
      await tx.customerGradeHistory.create({ data: { customerId: gold, fromGradeId: cur.gradeId, toGradeId: goldGrade.id, reason: "ADMIN", changedBy: "TEST", changedAt: new Date() } });
      await tx.customer.update({ where: { id: gold }, data: { gradeId: goldGrade.id } });
    });
    await issueGradeCoupons();
    await issueGradeCoupons();
    assert.equal(await prisma.customerCoupon.count({ where: { customerId: gold, policy: { code: "GOLD_MONTHLY" } } }), 1);
    assert.equal(await prisma.customerCoupon.count({ where: { customerId: welcome, policy: { code: "GOLD_MONTHLY" } } }), 0);
    const welcomeNo = (await prisma.customer.findUniqueOrThrow({ where: { id: welcome } })).customerNo;
    await couponErr(() => adminIssueCoupon("GOLD_MONTHLY", welcomeNo, "ADMIN:test"), /등급/);
    // 다음 달에는 또 1장
    const nextMonth = new Date(Date.now() + 32 * DAY);
    await issueGradeCoupons(nextMonth);
    assert.equal(await prisma.customerCoupon.count({ where: { customerId: gold, policy: { code: "GOLD_MONTHLY" } } }), 2);
  });

  test("생일 쿠폰: 이번 달(한국 날짜) 생일 회원만, 해마다 1장", async () => {
    const kstMonth = new Date(Date.now() + 9 * 3600_000).getUTCMonth() + 1;
    const yes = await newShopper("생일O");
    const no = await newShopper("생일X");
    // 생일 월은 암호화한 생년월일과 함께 저장 (CHECK CustomerProfile_pairs_ck)
    const mm = (m: number) => String(m).padStart(2, "0");
    await prisma.customerProfile.update({ where: { customerId: yes }, data: { birthDateEnc: encrypt(`1990-${mm(kstMonth)}-15`), birthMonth: kstMonth } });
    await prisma.customerProfile.update({ where: { customerId: no }, data: { birthDateEnc: encrypt(`1990-${mm((kstMonth % 12) + 1)}-15`), birthMonth: (kstMonth % 12) + 1 } });
    await issueBirthdayCoupons();
    await issueBirthdayCoupons();
    assert.equal(await prisma.customerCoupon.count({ where: { customerId: yes, policy: { code: "BIRTHDAY_15" } } }), 1);
    assert.equal(await prisma.customerCoupon.count({ where: { customerId: no, policy: { code: "BIRTHDAY_15" } } }), 0);
  });

  test("만료: 기간 지나면 만료 표시, 7일 전 안내는 쿠폰마다 1번", async () => {
    const c = await newShopper("만료");
    const cc = await couponOf(c, "WELCOME_10");
    const in25 = new Date(Date.now() + 25 * DAY);
    assert.ok((await notifyExpiringCoupons(in25)) >= 1);
    await notifyExpiringCoupons(in25);
    assert.equal(await prisma.notification.count({ where: { customerId: c, type: "COUPON_EXPIRING" } }), 1);
    assert.ok((await expireCoupons(new Date(Date.now() + 31 * DAY))) >= 1);
    assert.equal((await reload(cc.id)).status, "EXPIRED");
  });
});

// ---------------------------------------------------------------
describe("주문에 사용", () => {
  test("상품 쿠폰 1장: 금액·줄 배분·예약 → 결제하면 사용됨, 다른 쿠폰은 그대로", async () => {
    const fake = new FakeToss();
    const c = await newShopper("상품쿠폰");
    await downloadCoupon(c, policyId.get("KNIT_15")!);
    const knit = await couponOf(c, "KNIT_15");
    const welcome = await couponOf(c, "WELCOME_10");
    const { order, result } = await orderAndPay(fake, c, [SHIRT, KNIT], knit.id);
    assert.equal(result.kind, "PAID");
    // 니트 103,200 × 15% = 15,480 (상품 쿠폰은 대상인 니트 줄에만)
    assert.equal(order.couponDiscountTotal, 15480);
    assert.equal(order.totalPrice, 152200 - 15480);
    const knitLine = order.items.find((i) => i.skuCode === KNIT)!;
    assert.deepEqual([knitLine.couponAllocated, knitLine.payAmount], [15480, 103200 - 15480]);
    assert.equal(order.items.find((i) => i.skuCode === SHIRT)!.couponAllocated, 0);
    assert.deepEqual(order.coupons.map((oc) => [oc.kind, oc.status, oc.discountAmount]), [["PRODUCT", "APPLIED", 15480]]);
    assert.equal((await reload(knit.id)).status, "USED");
    assert.equal((await reload(welcome.id)).status, "AVAILABLE", "고르지 않은 쿠폰은 그대로");
    // 쿠폰 이력: 발급 → 사용 중(주문) → 사용됨(주문)
    const h = await prisma.customerCouponHistory.findMany({ where: { customerCouponId: knit.id }, orderBy: { id: "asc" } });
    assert.deepEqual(h.map((x) => [x.toStatus, x.orderId]), [["AVAILABLE", null], ["IN_USE", order.id], ["USED", order.id]]);
  });

  test("장바구니 쿠폰 1장: 대상 줄 판매가 합계 기준, 줄 배분 합계 = 할인액", async () => {
    const fake = new FakeToss();
    const c = await newShopper("장바구니쿠폰");
    const welcome = await couponOf(c, "WELCOME_10");
    const { order } = await orderAndPay(fake, c, [SHIRT, KNIT], welcome.id);
    assert.equal(order.couponDiscountTotal, 10000); // 152,200 × 10% = 15,220 → 최대 10,000
    assert.equal(order.items.reduce((n, i) => n + i.couponAllocated, 0), 10000);
    for (const i of order.items) assert.equal(i.payAmount, i.lineTotal - i.couponAllocated);
  });

  test("배송비 쿠폰: 기본 배송비만 할인, 제주 추가 배송비는 그대로", async () => {
    const fake = new FakeToss();
    const c = await newShopper("제주배송쿠폰", "63100");
    await downloadCoupon(c, policyId.get("FREE_SHIP")!);
    const ship = await couponOf(c, "FREE_SHIP");
    const { order, result } = await orderAndPay(fake, c, [CAP], ship.id);
    assert.equal(result.kind, "PAID");
    assert.deepEqual([order.shippingBaseFee, order.shippingExtraFee, order.shippingDiscount], [3000, 3000, 3000]);
    assert.equal(order.totalPrice, 27000 + 6000 - 3000);
  });

  test("서버가 다시 계산: 대상 아닌 상품·조건 미달·남의 쿠폰은 주문 거부 (화면 값을 믿지 않음)", async () => {
    const c = await newShopper("검증");
    await downloadCoupon(c, policyId.get("KNIT_15")!);
    const knit = await couponOf(c, "KNIT_15");
    const welcome = await couponOf(c, "WELCOME_10");
    for (const code of [SHIRT, CAP, JACKET]) await setAvailable(code, 10);
    let r = await placeOrder(c, cart(SHIRT), new Date(), { couponId: knit.id });
    assert.ok("error" in r && /쿠폰 대상이 없어요/.test(r.error), JSON.stringify(r));
    r = await placeOrder(c, cart(CAP), new Date(), { couponId: welcome.id }); // 27,000 < 30,000
    assert.ok("error" in r && /30,000원 이상일 때/.test(r.error), JSON.stringify(r));
    const other = await newShopper("남");
    r = await placeOrder(other, cart(JACKET), new Date(), { couponId: welcome.id });
    assert.ok("error" in r && /지금 쓸 수 없어요/.test(r.error), "남의 쿠폰은 후보에 없음");
    // 행사 상품 제외 쿠폰(테스트용 정책): 셔츠·볼캡(시즌오프)만으로는 대상 0원
    const saleExcl = await createCouponPolicy({ code: "SALE_EXCL_T", name: "행사 제외", displayName: "행사 제외 5천원", kind: "ORDER", discountType: "AMOUNT", discountValue: 5000, minOrderAmount: 50000, applyToSaleItems: false, issueMethod: "DOWNLOAD", issueStartAt: new Date(Date.now() - DAY), issueEndAt: new Date(Date.now() + DAY), validDays: 7, targets: [{ targetType: "ALL" }], activate: true, by: "TEST" });
    await downloadCoupon(c, saleExcl.id);
    const cart5000 = await couponOf(c, "SALE_EXCL_T");
    r = await placeOrder(c, cart(SHIRT, CAP), new Date(), { couponId: cart5000.id });
    assert.ok("error" in r && /할인 행사 중인 상품에는/.test(r.error), JSON.stringify(r));
    assert.ok("error" in r);
    r = await placeOrder(c, cart(PANTS), new Date(), { couponId: cart5000.id });
    assert.ok(!("error" in r), JSON.stringify(r));
  });

  test("결제창 이탈 → 쿠폰 바로 복원 / 다시 주문하면 이전 주문은 대체되고 같은 쿠폰 다시 사용", async () => {
    const c = await newShopper("이탈");
    const welcome = await couponOf(c, "WELCOME_10");
    await setAvailable(JACKET, 10);
    const a = await placeOrder(c, cart(JACKET), new Date(), { couponId: welcome.id });
    assert.ok(!("error" in a));
    assert.equal((await reload(welcome.id)).status, "IN_USE");
    // 결제창을 닫지 않고(이탈 처리 없이) 다시 주문 → 이전 주문 대체 + 쿠폰 재사용
    assert.ok((await usableCoupons(c)).some((x) => x.id === welcome.id), "내 결제 대기 주문이 잡은 쿠폰도 후보");
    const b = await placeOrder(c, cart(JACKET), new Date(), { couponId: welcome.id });
    assert.ok(!("error" in b), JSON.stringify(b));
    const prev = await prisma.orderCoupon.findFirstOrThrow({ where: { order: { orderNo: a.orderNo } } });
    assert.equal(prev.status, "RELEASED");
    await abandonOrder(c, b.paymentOrderId, "PAYMENT_FAILED");
    assert.equal((await reload(welcome.id)).status, "AVAILABLE");
    const h = await prisma.customerCouponHistory.findMany({ where: { customerCouponId: welcome.id }, orderBy: { id: "asc" } });
    assert.deepEqual(h.map((x) => x.toStatus), ["AVAILABLE", "IN_USE", "AVAILABLE", "IN_USE", "AVAILABLE"]);
  });

  test("다른 탭에서 결제 승인 중인 주문의 쿠폰은 새 주문에 못 씀", async () => {
    const c = await newShopper("두탭");
    const welcome = await couponOf(c, "WELCOME_10");
    await setAvailable(JACKET, 10);
    const a = await placeOrder(c, cart(JACKET), new Date(), { couponId: welcome.id });
    assert.ok(!("error" in a));
    const order = await prisma.order.findUniqueOrThrow({ where: { orderNo: a.orderNo } });
    await prisma.payment.create({ data: { orderId: order.id, attemptNo: 1, pgOrderId: order.paymentOrderId, paymentKey: `pk_${Date.now()}`, status: "IN_PROGRESS", amount: order.totalPrice, balanceAmount: order.totalPrice, confirmIdempotencyKey: `k-${Date.now()}`, statusSource: "CONFIRM", statusChangedAt: new Date() } });
    const b = await placeOrder(c, cart(JACKET), new Date(), { couponId: welcome.id });
    assert.ok("error" in b, JSON.stringify(b));
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PENDING", "승인 중인 주문은 대체되지 않음");
  });

  test("주문 뒤 쿠폰이 긴급 중지되면 토스를 부르지 않고 실패 + 쿠폰 복원", async () => {
    const fake = new FakeToss();
    const c = await newShopper("중지결제");
    const welcome = await couponOf(c, "WELCOME_10");
    await setAvailable(JACKET, 10);
    const placed = await placeOrder(c, cart(JACKET), new Date(), { couponId: welcome.id });
    assert.ok(!("error" in placed));
    const order = await prisma.order.findUniqueOrThrow({ where: { orderNo: placed.orderNo } });
    await setPolicyStatus("WELCOME_10", "PAUSED");
    try {
      const paymentKey = fake.authorize({ orderId: order.paymentOrderId, amount: order.totalPrice });
      const r = await confirmOrderPayment({ customerId: c, paymentOrderId: order.paymentOrderId, paymentKey, amount: String(order.totalPrice) }, deps(fake));
      assert.deepEqual([r.kind, r.kind === "FAILED" ? r.code : ""], ["FAILED", "COUPON_UNAVAILABLE"]);
      assert.equal(fake.count("confirm"), 0);
      assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "CANCELED");
      assert.equal((await reload(welcome.id)).status, "AVAILABLE");
    } finally {
      await setPolicyStatus("WELCOME_10", "ACTIVE");
    }
  });

  test("결제 후 전체 취소 → 기간이 남았으면 쿠폰 복원, 지났으면 만료", async () => {
    const fake = new FakeToss();
    const a = await newShopper("취소복원");
    const wa = await couponOf(a, "WELCOME_10");
    const pa = await orderAndPay(fake, a, [JACKET], wa.id);
    assert.equal(await cancelPaidOrder(a, pa.order.orderNo, { reason: "단순 변심" }, deps(fake)), "DONE");
    assert.equal((await reload(wa.id)).status, "AVAILABLE");
    assert.equal((await prisma.orderCoupon.findFirstOrThrow({ where: { orderId: pa.order.id } })).status, "CANCELED");

    const b = await newShopper("취소만료");
    const wb = await couponOf(b, "WELCOME_10");
    const pb = await orderAndPay(fake, b, [JACKET], wb.id);
    const future = new Date(wb.validTo.getTime() + DAY);
    assert.equal(await cancelPaidOrder(b, pb.order.orderNo, { reason: "단순 변심" }, deps(fake, { now: () => future })), "DONE");
    assert.equal((await reload(wb.id)).status, "EXPIRED");
  });

  test("부분 반품 환불 = 그 상품의 실결제액(쿠폰 배분 차감) − 반품 배송비", async () => {
    const fake = new FakeToss();
    const c = await newShopper("쿠폰반품");
    const welcome = await couponOf(c, "WELCOME_10");
    const { order } = await orderAndPay(fake, c, [JACKET, PANTS], welcome.id);
    await prepareOrder(order.orderNo, "ADMIN:test");
    const box = await registerShipment(order.orderNo, { courierCode: "CJ", trackingNo: tracking() }, "ADMIN:test");
    await shipShipment(box!.id);
    await deliverShipment(box!.id);
    const pants = order.items.find((i) => i.skuCode === PANTS)!;
    assert.ok(pants.couponAllocated > 0);
    const r = await requestReturn(c, order.orderNo, { orderItemIds: [pants.id], reason: "DEFECT" });
    await approveReturn(r.returnNo);
    await registerReturnPickup(r.returnNo, "CJ", tracking());
    await receiveReturn(r.returnNo, "ADMIN:test");
    await inspectReturn(r.returnNo, [{ orderItemId: pants.id, inspection: "RESELLABLE" }], "ADMIN:test", deps(fake));
    const ret = await prisma.returnRequest.findUniqueOrThrow({ where: { returnNo: r.returnNo } });
    assert.equal(ret.refundAmount, pants.payAmount, "판매자 사유·남은 상품 있음 → 실결제액 그대로");
    assert.equal((await reload(welcome.id)).status, "USED", "부분 반품은 쿠폰을 돌려주지 않음");
  });

  test("비회원 주문은 쿠폰 없이 (DB CHECK)", async () => {
    await setAvailable(CAP, 10);
    const g = await placeGuestOrder(
      { orderer: { name: "비회원", phone: "010-2222-3333", email: "g@example.test" }, address: { recipient: "비회원", phone: "010-2222-3333", zipCode: "06236", address1: "서울" }, password: "pass1234", passwordConfirm: "pass1234", privacyConsent: true },
      cart(CAP),
    );
    assert.ok(!("error" in g));
    const o = await prisma.order.findUniqueOrThrow({ where: { orderNo: g.orderNo } });
    assert.deepEqual([o.couponDiscountTotal, o.shippingDiscount], [0, 0]);
    await rejects(`UPDATE "Order" SET "couponDiscountTotal" = 1000 WHERE "id" = ${o.id}`, "Order_");
  });

  test("탈퇴하면 남은 쿠폰 회수, 사용한 쿠폰 기록은 그대로", async () => {
    const fake = new FakeToss();
    const c = await newShopper("탈퇴쿠폰");
    await downloadCoupon(c, policyId.get("FREE_SHIP")!);
    const welcome = await couponOf(c, "WELCOME_10");
    const { order } = await orderAndPay(fake, c, [JACKET], welcome.id);
    await prepareOrder(order.orderNo, "ADMIN:test");
    const box = await registerShipment(order.orderNo, { courierCode: "CJ", trackingNo: tracking() }, "ADMIN:test");
    await shipShipment(box!.id);
    await deliverShipment(box!.id);
    await prisma.orderItem.updateMany({ where: { orderId: order.id }, data: { status: "CONFIRMED", statusChangedAt: new Date(), statusChangedBy: "CUSTOMER", confirmedAt: new Date(), confirmType: "MANUAL" } });
    await requestWithdrawal(c, { reasonCode: "OTHER" });
    await completeWithdrawal(c, new Date(Date.now() + 8 * DAY)); // 7일 철회 기간 뒤
    assert.equal((await couponOf(c, "FREE_SHIP")).status, "REVOKED");
    assert.equal((await reload(welcome.id)).status, "USED");
  });

  test("결제 화면 목록: 대상 SKU는 서버가 계산, 할인 금액 큰 순서로 보여 줄 뿐 고르지 않음", async () => {
    const c = await newShopper("후보");
    await downloadCoupon(c, policyId.get("KNIT_15")!);
    await downloadCoupon(c, policyId.get("CART_5000")!);
    const skus = await getCartSkus([id(KNIT), id(PANTS)]);
    const options = await couponOptionsFor(c, skus);
    const knitOpt = options.find((o) => o.name === "니트 15% 쿠폰")!;
    assert.deepEqual(knitOpt.eligibleSkuIds, [id(KNIT)]);
    const cart5000 = options.find((o) => o.name === "5만원 이상 5,000원 할인")!;
    assert.deepEqual(cart5000.eligibleSkuIds, [id(KNIT), id(PANTS)], "행사 상품(니트 위크)에도 쓸 수 있음 (사용자 요청)");
    const lines = [{ skuId: id(KNIT), lineTotal: 103200 }, { skuId: id(PANTS), lineTotal: 89000 }];
    const list = couponChoices(lines, 0, options);
    // 니트 15% = 15,480 > 신규가입 10% (19,220 → 최대 10,000) > 5천원 (대상 슬랙스 89,000원)
    assert.deepEqual(list.map((x) => [x.coupon.name, x.amount]), [["니트 15% 쿠폰", 15480], ["신규가입 10% 할인", 10000], ["5만원 이상 5,000원 할인", 5000]]);
  });

  test("니트(행사 중, 103,200원)만 주문: 니트 15% · 5만원 이상 5천원 · 신규가입 10% 모두 고를 수 있고, 1장 골라 결제 (사용자 지적 사례)", async () => {
    const fake = new FakeToss();
    const c = await newShopper("니트만");
    await downloadCoupon(c, policyId.get("KNIT_15")!);
    await downloadCoupon(c, policyId.get("CART_5000")!);
    const options = await couponOptionsFor(c, await getCartSkus([id(KNIT)]));
    const list = couponChoices([{ skuId: id(KNIT), lineTotal: 103200 }], 0, options);
    assert.deepEqual(list.map((x) => [x.coupon.name, x.amount]), [["니트 15% 쿠폰", 15480], ["신규가입 10% 할인", 10000], ["5만원 이상 5,000원 할인", 5000]]);
    const cart5000 = await couponOf(c, "CART_5000");
    const { order, result } = await orderAndPay(fake, c, [KNIT], cart5000.id);
    assert.equal(result.kind, "PAID");
    assert.deepEqual([order.couponDiscountTotal, order.totalPrice], [5000, 103200 - 5000]);
    assert.equal(order.coupons.length, 1);
  });

  test("쿠폰은 주문당 1장: 화면을 거치지 않고 두 번째 쿠폰을 넣어도 DB가 거부 (종류가 달라도)", async () => {
    const c = await newShopper("두장");
    await downloadCoupon(c, policyId.get("FREE_SHIP")!);
    const welcome = await couponOf(c, "WELCOME_10");
    const ship = await couponOf(c, "FREE_SHIP");
    await setAvailable(CAP, 10);
    await setAvailable(SHIRT, 10);
    const placed = await placeOrder(c, cart(CAP, SHIRT), new Date(), { couponId: welcome.id }); // 76,000원 (배송비 무료)
    assert.ok(!("error" in placed), JSON.stringify(placed));
    const o = await prisma.order.findUniqueOrThrow({ where: { orderNo: placed.orderNo } });
    await rejects(
      `INSERT INTO "OrderCoupon" ("orderId","customerCouponId","kind","couponName","discountAmount","status","createdAt","updatedAt") VALUES (${o.id}, ${ship.id}, 'SHIPPING', 't', 3000, 'RESERVED', ${NOW()}, ${NOW()})`,
      "OrderCoupon_one_per_order",
    );
    assert.equal((await reload(ship.id)).status, "AVAILABLE");
  });
});

// ---------------------------------------------------------------
describe("쿠폰 DB 제약", () => {
  test("정책: 활성화 후 규칙·대상 변경 금지, 발급 수 직접 수정 금지, 정률 90% 초과 금지, 삭제 금지", async () => {
    const p = policyId.get("WELCOME_10")!;
    await rejects(`UPDATE "CouponPolicy" SET "discountValue" = 50 WHERE "id" = ${p}`, "CouponPolicy_rules_fixed");
    await rejects(`INSERT INTO "CouponPolicyTarget" ("policyId","targetType","mode","createdAt") VALUES (${p}, 'ALL', 'EXCLUDE', ${NOW()})`, "CouponPolicyTarget_draft_only");
    await rejects(`UPDATE "CouponPolicy" SET "issuedCount" = 0 WHERE "id" = ${p}`, "CouponPolicy_issued_count");
    await rejects(`DELETE FROM "CouponPolicy" WHERE "id" = ${p}`, "CouponPolicy_no_delete");
    await rejects(
      `INSERT INTO "CouponPolicy" ("code","name","displayName","kind","discountType","discountValue","minOrderAmount","applyToSaleItems","issueMethod","issueStartAt","issueEndAt","issuedCount","perCustomerLimit","validDays","status","statusChangedAt","createdBy","createdAt","updatedAt") VALUES ('BAD_95','x','x','ORDER','RATE',95,0,1,'DOWNLOAD',${NOW()},'2099-01-01T00:00:00.000+00:00',0,1,7,'DRAFT',${NOW()},'t',${NOW()},${NOW()})`,
      "CouponPolicy_values_ck",
    );
    await rejects(
      `INSERT INTO "CouponPolicy" ("code","name","displayName","kind","discountType","discountValue","minOrderAmount","applyToSaleItems","issueMethod","issueStartAt","issueEndAt","issuedCount","perCustomerLimit","validDays","status","statusChangedAt","createdBy","createdAt","updatedAt") VALUES ('BAD_LIVE','x','x','ORDER','AMOUNT',1000,0,1,'DOWNLOAD',${NOW()},'2099-01-01T00:00:00.000+00:00',0,1,7,'ACTIVE',${NOW()},'t',${NOW()},${NOW()})`,
      "CouponPolicy_insert_draft",
    );
  });

  test("발급: 사용 기간 조작·한도 초과·사용됨 상태로 발급 금지, 주인·기간 변경 금지", async () => {
    const c = await newShopper("제약발급");
    const p = policyId.get("FREE_SHIP")!;
    const issued = `'${new Date().toISOString().replace("Z", "+00:00")}'`;
    await rejects(
      `INSERT INTO "CustomerCoupon" ("couponNo","policyId","customerId","issueMethod","issuedBy","issuedAt","validFrom","validTo","status","statusChangedAt","createdAt","updatedAt") VALUES ('CPTESTAAAAAA', ${p}, ${c}, 'DOWNLOAD', 'CUSTOMER', ${issued}, ${issued}, '2099-01-01T00:00:00.000+00:00', 'AVAILABLE', ${issued}, ${issued}, ${issued})`,
      "CustomerCoupon_validity",
    );
    await downloadCoupon(c, p);
    const cc = await couponOf(c, "FREE_SHIP");
    await rejects(
      `INSERT INTO "CustomerCoupon" ("couponNo","policyId","customerId","issueMethod","issuedBy","issuedAt","validFrom","validTo","status","statusChangedAt","createdAt","updatedAt") SELECT 'CPTESTBBBBBB', "policyId", "customerId", "issueMethod", "issuedBy", "issuedAt", "validFrom", "validTo", 'AVAILABLE', "statusChangedAt", "createdAt", "updatedAt" FROM "CustomerCoupon" WHERE "id" = ${cc.id}`,
      "CustomerCoupon_limit",
    );
    await rejects(`UPDATE "CustomerCoupon" SET "validTo" = '2099-01-01T00:00:00.000+00:00' WHERE "id" = ${cc.id}`, "CustomerCoupon_fixed");
    await rejects(`UPDATE "CustomerCoupon" SET "customerId" = 1 WHERE "id" = ${cc.id}`, "CustomerCoupon_fixed");
    await rejects(`DELETE FROM "CustomerCoupon" WHERE "id" = ${cc.id}`, "CustomerCoupon_no_delete");
  });

  test("상태는 주문을 따라서만: 직접 '사용됨'·'사용 중'·결제 대기 중 복원 금지, 기간 남은 쿠폰 만료 금지", async () => {
    const c = await newShopper("제약상태");
    const welcome = await couponOf(c, "WELCOME_10");
    await rejects(`UPDATE "CustomerCoupon" SET "status" = 'USED', "statusChangedAt" = ${NOW()} WHERE "id" = ${welcome.id}`, "CustomerCoupon_transition");
    await rejects(`UPDATE "CustomerCoupon" SET "status" = 'IN_USE', "statusChangedAt" = ${NOW()} WHERE "id" = ${welcome.id}`, "CustomerCoupon_order_sync");
    await rejects(`UPDATE "CustomerCoupon" SET "status" = 'EXPIRED', "statusChangedAt" = ${NOW()} WHERE "id" = ${welcome.id}`, "기간이 남은");
    await setAvailable(JACKET, 10);
    const a = await placeOrder(c, cart(JACKET), new Date(), { couponId: welcome.id });
    assert.ok(!("error" in a));
    await rejects(`UPDATE "CustomerCoupon" SET "status" = 'AVAILABLE', "statusChangedAt" = ${NOW()} WHERE "id" = ${welcome.id}`, "CustomerCoupon_order_sync");
    const oc = await prisma.orderCoupon.findFirstOrThrow({ where: { order: { orderNo: a.orderNo } } });
    await rejects(`UPDATE "OrderCoupon" SET "status" = 'APPLIED', "appliedAt" = ${NOW()} WHERE "id" = ${oc.id}`, "OrderCoupon_order_sync");
    await rejects(`UPDATE "OrderCoupon" SET "status" = 'RELEASED', "releasedAt" = ${NOW()} WHERE "id" = ${oc.id}`, "OrderCoupon_order_sync");
    await rejects(`UPDATE "OrderCoupon" SET "discountAmount" = 1 WHERE "id" = ${oc.id}`, "OrderCoupon_fixed");
    await rejects(`DELETE FROM "OrderItemCoupon" WHERE "orderCouponId" = ${oc.id}`, "OrderItemCoupon_no_delete");
  });

  test("주문 쿠폰: 남의 쿠폰·주문당 장바구니 2장·대상 아닌 상품 배분·배송비 쿠폰 과다 할인 금지", async () => {
    const c = await newShopper("제약주문");
    const other = await newShopper("제약남");
    await downloadCoupon(c, policyId.get("KNIT_15")!);
    await downloadCoupon(c, policyId.get("CART_5000")!);
    await downloadCoupon(c, policyId.get("FREE_SHIP")!);
    const theirs = await couponOf(other, "WELCOME_10");
    const welcome = await couponOf(c, "WELCOME_10");
    const cart5000 = await couponOf(c, "CART_5000");
    const knit = await couponOf(c, "KNIT_15");
    const ship = await couponOf(c, "FREE_SHIP");
    for (const code of [SHIRT, CAP]) await setAvailable(code, 10);
    const placed = await placeOrder(c, cart(SHIRT, CAP), new Date()); // 76,000원, 쿠폰 없이
    assert.ok(!("error" in placed));
    const o = await prisma.order.findUniqueOrThrow({ where: { orderNo: placed.orderNo }, include: { items: true } });
    const ins = (couponId: number, kind: string, amount: number) =>
      `INSERT INTO "OrderCoupon" ("orderId","customerCouponId","kind","couponName","discountAmount","status","createdAt","updatedAt") VALUES (${o.id}, ${couponId}, '${kind}', 't', ${amount}, 'RESERVED', ${NOW()}, ${NOW()})`;
    await rejects(ins(theirs.id, "ORDER", 1000), "OrderCoupon_owner");
    await rejects([ins(welcome.id, "ORDER", 1000), ins(cart5000.id, "ORDER", 1000)], "OrderCoupon_one_per_order");
    await rejects(ins(welcome.id, "PRODUCT", 1000), "쿠폰 종류가 정책과 다릅니다");
    await rejects(ins(ship.id, "SHIPPING", 1000), "OrderCoupon_shipping"); // 무료배송 주문(배송비 0)
    await rejects([ins(knit.id, "PRODUCT", 1000), `INSERT INTO "OrderItemCoupon" ("orderCouponId","orderItemId","amount") SELECT MAX(id), ${o.items[0].id}, 1000 FROM "OrderCoupon"`], "OrderItemCoupon_target");
    // 정액 쿠폰 금액보다 많이
    await rejects(ins(cart5000.id, "ORDER", 6000), "OrderCoupon_amount");
  });

  test("결제 시작 전 검사: 쿠폰 할인과 줄 배분이 안 맞으면 결제를 시작할 수 없음", async () => {
    const c = await newShopper("제약결제");
    const welcome = await couponOf(c, "WELCOME_10");
    await setAvailable(JACKET, 10);
    const placed = await placeOrder(c, cart(JACKET), new Date());
    assert.ok(!("error" in placed));
    const o = await prisma.order.findUniqueOrThrow({ where: { orderNo: placed.orderNo }, include: { items: true } });
    // 주문 금액에는 쿠폰이 없는데 쿠폰 기록만 추가 → 결제 시작 거부
    await rejects(
      [
        `INSERT INTO "OrderCoupon" ("orderId","customerCouponId","kind","couponName","discountAmount","status","createdAt","updatedAt") VALUES (${o.id}, ${welcome.id}, 'ORDER', 't', 10000, 'RESERVED', ${NOW()}, ${NOW()})`,
        `INSERT INTO "OrderItemCoupon" ("orderCouponId","orderItemId","amount") SELECT MAX(id), ${o.items[0].id}, 10000 FROM "OrderCoupon"`,
        `INSERT INTO "Payment" ("orderId","attemptNo","pgOrderId","status","amount","balanceAmount","canceledAmount","statusSource","statusChangedAt","createdAt","updatedAt") VALUES (${o.id}, 1, '${o.paymentOrderId}', 'IN_PROGRESS', ${o.totalPrice}, ${o.totalPrice}, 0, 'CONFIRM', ${NOW()}, ${NOW()}, ${NOW()})`,
      ],
      "Payment_coupon_ready",
    );
  });
});

// ---------------------------------------------------------------
describe("전체 정합성", () => {
  test("위 시나리오를 모두 거친 DB가 db:verify 규칙(쿠폰 상태·금액·배분 일치 등)을 통과", () => {
    // 오류가 있으면 db-verify가 0이 아닌 코드로 끝나 execFileSync가 예외를 던짐
    const out = execFileSync(process.execPath, ["--import", "tsx", "scripts/db-verify.ts"], {
      env: { ...process.env, DATABASE_URL: `file:${TEMP_DB_PATH.replace(/\\/g, "/")}` },
      encoding: "utf8",
    });
    assert.match(out, /통과: 오류 0건/);
  });
});
