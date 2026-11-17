// 고객 테스트 (임시 DB 복사본에서 실행 — dev.db는 바뀌지 않음)
import { removeTempDb } from "./helpers/temp-db"; // ⚠️ 반드시 첫 줄
import "dotenv/config";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { blindIndex } from "../src/lib/crypto";
import {
  addAddress,
  cancelWithdrawal,
  completeWithdrawal,
  CustomerError,
  deleteAddress,
  ensureCustomerForUser,
  getProfileView,
  isRejoinBlocked,
  markDormantCustomers,
  processDueWithdrawals,
  purgeOldLoginHistory,
  recalculateGrades,
  recordLogin,
  requestWithdrawal,
  saveBodyProfile,
  setDefaultAddress,
  suspendCustomer,
  unsuspendCustomer,
  updateProfile,
} from "../src/lib/customer";
import { confirmOrderPayment, defaultPaymentDeps, placeOrder } from "../src/lib/checkout";

class Rollback extends Error {}
const DAY = 24 * 60 * 60 * 1000;
const ISO = (d: Date) => `'${d.toISOString().replace("Z", "+00:00")}'`;
const NOW = () => ISO(new Date());

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
async function rejectsWith(fn: () => Promise<unknown>, message: string | RegExp) {
  await assert.rejects(fn, (e: unknown) => e instanceof CustomerError && (typeof message === "string" ? e.message.includes(message) : message.test(e.message)));
}

let seq = 0;
/** 새 로그인 계정(+GitHub 계정) + 가입 */
async function signup(name = "고객") {
  const n = ++seq;
  const user = await prisma.user.create({ data: { name: `${name}${n}` } });
  await prisma.account.create({ data: { userId: user.id, type: "oauth", provider: "github", providerAccountId: `gh-${n}-${Date.now()}` } });
  const customer = await ensureCustomerForUser(user.id);
  return { user, customer };
}
const historyOf = (customerId: number) => prisma.customerStatusHistory.findMany({ where: { customerId }, orderBy: { id: "asc" } });
const pastLogin = (customerId: number, daysAgo: number) =>
  prisma.customerLoginHistory.create({ data: { customerId, provider: "github", result: "SUCCESS", loggedInAt: new Date(Date.now() - daysAgo * DAY) } });

after(async () => {
  await prisma.$disconnect();
  removeTempDb();
});

// ---------------------------------------------------------------
describe("가입 · 로그인", () => {
  test("첫 로그인 = 가입: 고객번호·기본 등급·빈 프로필·상태 이력·등급 이력이 함께 생김", async () => {
    const { customer } = await signup();
    assert.match(customer.customerNo, /^C\d{10}$/);
    assert.equal(customer.status, "ACTIVE");
    const grade = await prisma.customerGrade.findUniqueOrThrow({ where: { id: customer.gradeId } });
    assert.equal(grade.code, "WELCOME");
    assert.ok(await prisma.customerProfile.findUnique({ where: { customerId: customer.id } }));
    const h = await historyOf(customer.id);
    assert.deepEqual(h.map((x) => [x.fromStatus, x.toStatus, x.reason]), [[null, "ACTIVE", "SIGNUP"]]);
    assert.equal(await prisma.customerGradeHistory.count({ where: { customerId: customer.id } }), 1);
  });

  test("다시 로그인해도 고객이 중복으로 생기지 않음 (동시에 두 번 불러도)", async () => {
    const user = await prisma.user.create({ data: { name: "중복" } });
    const [a, b] = await Promise.all([ensureCustomerForUser(user.id), ensureCustomerForUser(user.id)]);
    assert.equal(a.id, b.id);
    assert.equal(await prisma.customer.count({ where: { userId: user.id } }), 1);
  });

  test("로그인 기록 + 마지막 로그인 시각", async () => {
    const { customer } = await signup();
    await recordLogin(customer.id, { provider: "github", ipMasked: "1.2.3.*", userAgent: "test" });
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.ok(c.lastLoginAt);
    assert.equal(await prisma.customerLoginHistory.count({ where: { customerId: customer.id } }), 1);
  });

  test("1년 미접속 → 휴면, 다시 로그인하면 정상 (이력에 사유가 남음)", async () => {
    const { customer } = await signup();
    await prisma.customer.update({ where: { id: customer.id }, data: { lastLoginAt: new Date(Date.now() - 400 * DAY) } });
    assert.ok((await markDormantCustomers()) >= 1);
    assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).status, "DORMANT");
    await recordLogin(customer.id, { provider: "github" });
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.equal(c.status, "ACTIVE");
    assert.equal(c.dormantAt, null);
    assert.deepEqual((await historyOf(customer.id)).map((x) => x.reason), ["SIGNUP", "INACTIVITY", "LOGIN"]);
  });

  test("정지 → 해제 (사유가 이력에 남음)", async () => {
    const { customer } = await signup();
    await suspendCustomer(customer.id, "결제 도용 의심", "admin-1");
    const s = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.equal(s.status, "SUSPENDED");
    assert.equal(s.suspendedReason, "결제 도용 의심");
    await unsuspendCustomer(customer.id, "admin-1");
    const h = await historyOf(customer.id);
    assert.deepEqual(h.map((x) => [x.toStatus, x.reason, x.changedBy]).slice(1), [["SUSPENDED", "ABUSE", "admin-1"], ["ACTIVE", "APPEAL", "admin-1"]]);
    assert.equal(h[1].memo, "결제 도용 의심");
  });
});

// ---------------------------------------------------------------
describe("프로필 (암호화 · 마스킹 · 검증)", () => {
  test("DB에는 암호문만 저장되고, 화면에는 마스킹해서 보여 줌", async () => {
    const { customer } = await signup();
    await updateProfile(customer.id, { name: "홍길동", phone: "010-1234-5678", birthDate: "1995-03-15", gender: "MALE", contactEmail: "Hong@Example.com" });
    const [raw] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "CustomerProfile" WHERE "customerId" = ${customer.id}`);
    const rawText = JSON.stringify(raw);
    for (const plain of ["홍길동", "01012345678", "010-1234-5678", "1995-03-15", "hong@example.com"]) {
      assert.ok(!rawText.includes(plain), `평문 "${plain}"이 DB에 그대로 있음`);
    }
    assert.equal(Number(raw.birthMonth), 3);
    assert.equal(raw.phoneHash, blindIndex("phone", "01012345678"));
    const view = await getProfileView(customer.id);
    assert.deepEqual(view.masked, { name: "홍*동", phone: "010-****-5678", email: "ho**@example.com", birthDate: "1995-**-**" });
  });

  test("잘못된 입력은 친절한 오류", async () => {
    const { customer } = await signup();
    await rejectsWith(() => updateProfile(customer.id, { phone: "02-123-4567" }), "휴대폰 번호 형식");
    await rejectsWith(() => updateProfile(customer.id, { birthDate: "2020-02-30" }), "YYYY-MM-DD");
    await rejectsWith(() => updateProfile(customer.id, { birthDate: "2099-01-01" }), "미래");
    await rejectsWith(() => updateProfile(customer.id, { contactEmail: "nope" }), "이메일");
  });

  test("만 14세 미만 가입 불가 (생일 하루 전까지는 13세)", async () => {
    const { customer } = await signup();
    const today = new Date("2026-11-17T00:00:00Z");
    await rejectsWith(() => updateProfile(customer.id, { birthDate: "2012-11-18" }, today), "만 14세 미만");
    await updateProfile(customer.id, { birthDate: "2012-11-17" }, today); // 오늘 만 14세
  });

  test("같은 휴대폰 번호로 두 명 가입 불가 (표기가 달라도)", async () => {
    const a = await signup();
    const b = await signup();
    await updateProfile(a.customer.id, { phone: "010-5555-0001" });
    await rejectsWith(() => updateProfile(b.customer.id, { phone: "01055550001" }), "이미 다른 회원");
    await updateProfile(a.customer.id, { phone: "010-5555-0001" }); // 본인이 같은 번호로 다시 저장은 OK
  });

  test("비우면 삭제 (암호문과 검색 해시가 함께 지워짐)", async () => {
    const { customer } = await signup();
    await updateProfile(customer.id, { phone: "010-7777-0001" });
    await updateProfile(customer.id, { phone: "" });
    const p = await prisma.customerProfile.findUniqueOrThrow({ where: { customerId: customer.id } });
    assert.equal(p.phoneEnc, null);
    assert.equal(p.phoneHash, null);
  });

  test("체형 정보 범위 검사", async () => {
    const { customer } = await signup();
    await saveBodyProfile(customer.id, { heightCm: 178, weightKg: 70, topSize: "100", shoeSizeMm: 270, preferredFit: "REGULAR" });
    await rejectsWith(() => saveBodyProfile(customer.id, { heightCm: 300 }), "키 100~230");
  });
});

// ---------------------------------------------------------------
describe("배송지", () => {
  const addr = (label: string, makeDefault = false) => ({
    label, recipient: "홍길동", phone: "010-1234-5678", zipCode: "04780", address1: "서울 성동구 성수이로 1", address2: "101호", makeDefault,
  });

  test("첫 배송지는 자동으로 기본, 새 기본을 지정하면 기존 기본은 해제", async () => {
    const { customer } = await signup();
    const a = await addAddress(customer.id, addr("집"));
    assert.equal(a.isDefault, true);
    const b = await addAddress(customer.id, addr("회사", true));
    const rows = await prisma.customerAddress.findMany({ where: { customerId: customer.id }, orderBy: { id: "asc" } });
    assert.deepEqual(rows.map((r) => [r.id, r.isDefault]), [[a.id, false], [b.id, true]]);
    await setDefaultAddress(customer.id, a.id);
    assert.equal((await prisma.customerAddress.findUniqueOrThrow({ where: { id: a.id } })).isDefault, true);
  });

  test("기본 배송지를 지우면 다른 배송지가 기본이 됨", async () => {
    const { customer } = await signup();
    const a = await addAddress(customer.id, addr("집"));
    const b = await addAddress(customer.id, addr("회사"));
    await deleteAddress(customer.id, a.id);
    assert.equal((await prisma.customerAddress.findUniqueOrThrow({ where: { id: b.id } })).isDefault, true);
  });

  test("다른 고객의 배송지는 바꾸거나 지울 수 없음", async () => {
    const a = await signup();
    const b = await signup();
    const addrA = await addAddress(a.customer.id, addr("집"));
    await rejectsWith(() => setDefaultAddress(b.customer.id, addrA.id), "찾을 수 없어요");
    await rejectsWith(() => deleteAddress(b.customer.id, addrA.id), "찾을 수 없어요");
  });

  test("배송지는 최대 20개", async () => {
    const { customer } = await signup();
    for (let i = 0; i < 20; i++) await addAddress(customer.id, addr(`주소${i}`));
    await rejectsWith(() => addAddress(customer.id, addr("21번째")), "최대 20개");
  });

  test("주소·수령인·연락처는 암호문으로 저장", async () => {
    const { customer } = await signup();
    await addAddress(customer.id, addr("집"));
    const [raw] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "CustomerAddress" WHERE "customerId" = ${customer.id}`);
    const text = JSON.stringify(raw);
    for (const plain of ["홍길동", "01012345678", "성수이로", "101호"]) assert.ok(!text.includes(plain), `평문 "${plain}"`);
  });
});

// ---------------------------------------------------------------
describe("탈퇴: 신청 → 7일 유예(철회 가능) → 익명화 + 로그인 계정 삭제", () => {
  async function richCustomer() {
    const s = await signup("탈퇴");
    await updateProfile(s.customer.id, { name: "탈퇴자", phone: `010-9${String(seq).padStart(3, "0")}-${String(Date.now()).slice(-4)}`, birthDate: "1990-01-01" });
    await addAddress(s.customer.id, { label: "집", recipient: "탈퇴자", phone: "010-1111-2222", zipCode: "04780", address1: "서울" });
    await saveBodyProfile(s.customer.id, { heightCm: 170 });
    return s;
  }

  test("신청하면 WITHDRAW_PENDING + 7일 뒤 처리 예정, 그동안 주문 불가", async () => {
    const { customer } = await richCustomer();
    const w = await requestWithdrawal(customer.id, { reasonCode: "LOW_USAGE" });
    assert.equal(Math.round((w.scheduledAt.getTime() - w.requestedAt.getTime()) / DAY), 7);
    assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).status, "WITHDRAW_PENDING");
    const sku = await prisma.sku.findFirstOrThrow({ where: { skuCode: "SH26S002-WH-L" } });
    const r = await placeOrder(customer.id, [{ skuId: sku.id, quantity: 1 }]);
    assert.ok("error" in r && r.error.includes("주문할 수 없는 회원 상태"), JSON.stringify(r));
  });

  test("7일 안에 철회하면 원래대로 (개인정보 그대로)", async () => {
    const { customer } = await richCustomer();
    await requestWithdrawal(customer.id, { reasonCode: "OTHER", reasonText: "실수" });
    await cancelWithdrawal(customer.id);
    assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).status, "ACTIVE");
    assert.equal((await getProfileView(customer.id)).masked.name, "탈*자");
    assert.deepEqual((await historyOf(customer.id)).map((x) => x.reason), ["SIGNUP", "WITHDRAW_REQUEST", "WITHDRAW_CANCEL"]);
  });

  test("유예 기간 전에는 처리 불가", async () => {
    const { customer } = await richCustomer();
    await requestWithdrawal(customer.id, { reasonCode: "PRIVACY" });
    await rejectsWith(() => completeWithdrawal(customer.id), "철회 기간");
  });

  test("처리: 개인정보·배송지·체형·로그인 계정 파기, 주문은 남음, 재가입 30일 제한", async () => {
    const { user, customer } = await richCustomer();
    // 탈퇴 전에 결제 완료한 주문 1건
    const sku = await prisma.sku.findFirstOrThrow({ where: { skuCode: "SH26S002-WH-L" } });
    const placed = await placeOrder(customer.id, [{ skuId: sku.id, quantity: 1 }]);
    assert.ok(!("error" in placed), JSON.stringify(placed));
    const order = await prisma.order.findUniqueOrThrow({ where: { paymentOrderId: placed.paymentOrderId } });
    const paid = await confirmOrderPayment(
      { customerId: customer.id, paymentOrderId: placed.paymentOrderId, paymentKey: "pk_w", amount: order.totalPrice },
      { ...defaultPaymentDeps, confirmPayment: async () => ({ ok: true }) },
    );
    assert.equal(paid.ok, true);
    const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id } });

    const requested = new Date();
    await requestWithdrawal(customer.id, { reasonCode: "PRIVACY" }, requested);
    const later = new Date(requested.getTime() + 8 * DAY);
    assert.ok((await processDueWithdrawals(later)) >= 1); // 앞 테스트에서 신청만 해 둔 고객도 함께 처리될 수 있음

    const c = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.equal(c.status, "WITHDRAWN");
    assert.equal(c.userId, null);
    assert.ok(c.withdrawnAt && c.anonymizedAt);
    const p = await prisma.customerProfile.findUniqueOrThrow({ where: { customerId: customer.id } });
    assert.deepEqual([p.nameEnc, p.phoneEnc, p.phoneHash, p.birthDateEnc, p.birthMonth], [null, null, null, null, null]);
    assert.equal(await prisma.customerAddress.count({ where: { customerId: customer.id } }), 0);
    assert.equal(await prisma.customerBodyProfile.count({ where: { customerId: customer.id } }), 0);
    assert.equal(await prisma.user.count({ where: { id: user.id } }), 0, "로그인 계정 삭제");
    assert.equal(await prisma.account.count({ where: { userId: user.id } }), 0);
    // 주문은 남음 (전자상거래법)
    const keptOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(keptOrder.customerId, customer.id);
    assert.equal(keptOrder.status, "PAID");
    // 재가입 제한: 30일 동안 같은 GitHub 계정 차단, 그 뒤 허용
    assert.equal(await isRejoinBlocked(account.provider, account.providerAccountId, later), true);
    assert.equal(await isRejoinBlocked(account.provider, account.providerAccountId, new Date(later.getTime() + 31 * DAY)), false);
    assert.equal(await isRejoinBlocked("github", "someone-else", later), false);
    assert.deepEqual((await historyOf(customer.id)).map((x) => x.toStatus), ["ACTIVE", "WITHDRAW_PENDING", "WITHDRAWN"]);
  });

  test("결제 대기 중인 주문이 있으면 탈퇴 신청 불가", async () => {
    const { customer } = await signup();
    const sku = await prisma.sku.findFirstOrThrow({ where: { skuCode: "SH26S002-WH-L" } });
    const r = await placeOrder(customer.id, [{ skuId: sku.id, quantity: 1 }]);
    assert.ok(!("error" in r));
    await rejectsWith(() => requestWithdrawal(customer.id, { reasonCode: "OTHER" }), "결제 대기 중인 주문");
  });

  test("탈퇴 신청을 두 번 할 수 없음", async () => {
    const { customer } = await signup();
    await requestWithdrawal(customer.id, { reasonCode: "OTHER" });
    await rejectsWith(() => requestWithdrawal(customer.id, { reasonCode: "OTHER" }), "이미 탈퇴를 신청");
  });

  test("정지된 회원도 탈퇴는 신청할 수 있음 (개인정보 파기 요구권)", async () => {
    const { customer } = await signup();
    await suspendCustomer(customer.id, "테스트", "admin");
    await requestWithdrawal(customer.id, { reasonCode: "OTHER" });
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.equal(c.status, "WITHDRAW_PENDING");
    assert.equal(c.suspendedAt, null);
  });
});

// ---------------------------------------------------------------
describe("등급 재산정 (최근 12개월 결제 금액)", () => {
  test("30만원 이상 → 실버, 1년이 지나 실적이 빠지면 → 웰컴 (이력 기록)", async () => {
    const { customer } = await signup("등급");
    const now = new Date();
    await prisma.order.create({
      data: { paymentOrderId: `order_grade_${Date.now()}`, orderName: "등급", totalPrice: 350000, status: "PAID", customerId: customer.id, createdAt: new Date(now.getTime() - 10 * DAY) },
    });
    await recalculateGrades(now);
    const silver = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id }, include: { grade: true } });
    assert.equal(silver.grade.code, "SILVER");
    await recalculateGrades(new Date(now.getTime() + 400 * DAY));
    const back = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id }, include: { grade: true } });
    assert.equal(back.grade.code, "WELCOME");
    const h = await prisma.customerGradeHistory.findMany({ where: { customerId: customer.id }, orderBy: { id: "asc" }, include: { toGrade: true } });
    assert.deepEqual(h.map((x) => [x.reason, x.toGrade.code]), [["SIGNUP", "WELCOME"], ["PERIODIC", "SILVER"], ["PERIODIC", "WELCOME"]]);
    assert.equal(h[1].purchaseAmount, 350000);
  });
});

// ---------------------------------------------------------------
describe("로그인 기록 보관 (3개월)", () => {
  test("3개월 지난 기록만 정리되고 최근 기록은 남음", async () => {
    const { customer } = await signup();
    const old = await pastLogin(customer.id, 100);
    const recent = await pastLogin(customer.id, 10);
    await purgeOldLoginHistory();
    assert.equal(await prisma.customerLoginHistory.count({ where: { id: old.id } }), 0);
    assert.equal(await prisma.customerLoginHistory.count({ where: { id: recent.id } }), 1);
  });
});

// ---------------------------------------------------------------
describe("고객 DB 제약 (앱을 거치지 않은 직접 수정도 막힘)", () => {
  let a = 0;
  let b = 0;
  let withdrawn = 0;
  before(async () => {
    a = (await signup()).customer.id;
    b = (await signup()).customer.id;
    // 탈퇴 완료 고객 하나
    const w = (await signup()).customer.id;
    const t0 = new Date();
    await requestWithdrawal(w, { reasonCode: "OTHER" }, t0);
    await completeWithdrawal(w, new Date(t0.getTime() + 8 * DAY));
    withdrawn = w;
  });
  const grade = `(SELECT id FROM "CustomerGrade" WHERE code = 'WELCOME')`;
  const newCustomer = (no: string, status = "ACTIVE") =>
    `INSERT INTO "Customer" ("customerNo", status, "gradeId", "joinChannel", "joinedAt", "statusReason", "statusChangedAt", "createdAt", "updatedAt") VALUES ('${no}', '${status}', ${grade}, 'WEB', ${NOW()}, 'SIGNUP', ${NOW()}, ${NOW()}, ${NOW()})`;
  const setStatus = (id: number, status: string, changeTime = true) =>
    `UPDATE "Customer" SET status = '${status}'${changeTime ? `, "statusChangedAt" = ${ISO(new Date(Date.now() + 1000))}, "statusReason" = 'ADMIN'` : ""} WHERE id = ${id}`;

  test("처음부터 탈퇴 상태로 생성 금지", () => rejects(newCustomer("C0000000099", "WITHDRAWN"), "Customer_status_insert"));
  test("고객번호 형식", () => rejects(newCustomer("X123"), "Customer_no_ck"));
  test("상태만 바꾸고 사유·시각을 안 바꾸면 거부", () => rejects(setStatus(a, "SUSPENDED", false), "statusChangedAt"));
  test("정상에서 바로 탈퇴 완료 금지 (유예를 거쳐야 함)", () => rejects(setStatus(a, "WITHDRAWN"), "허용되지 않은 상태 변경"));
  test("탈퇴 완료 고객은 되살릴 수 없음", () => rejects(setStatus(withdrawn, "ACTIVE"), "탈퇴 완료된 고객"));
  test("완료된 탈퇴 신청 없이 탈퇴 처리 금지", () =>
    rejects([setStatus(a, "WITHDRAW_PENDING"), `UPDATE "Customer" SET status = 'WITHDRAWN', "userId" = NULL, "withdrawnAt" = ${NOW()}, "anonymizedAt" = ${NOW()}, "statusChangedAt" = ${ISO(new Date(Date.now() + 5000))} WHERE id = ${a}`], "완료된 탈퇴 신청 없이"));
  test("개인정보를 남긴 채 탈퇴 처리 금지", async () => {
    await updateProfile(b, { name: "남은이름" });
    const past = (d: number) => ISO(new Date(Date.now() - d * DAY));
    await rejects([
      setStatus(b, "WITHDRAW_PENDING"),
      `INSERT INTO "CustomerWithdrawal" ("customerId","reasonCode","requestedAt","scheduledAt","completedAt") VALUES (${b}, 'OTHER', ${past(10)}, ${past(3)}, ${NOW()})`,
      `UPDATE "Customer" SET status = 'WITHDRAWN', "userId" = NULL, "withdrawnAt" = ${NOW()}, "anonymizedAt" = ${NOW()}, "statusChangedAt" = ${ISO(new Date(Date.now() + 5000))} WHERE id = ${b}`,
    ], "개인정보(프로필·배송지·체형)를 먼저 파기");
  });
  test("탈퇴 고객은 로그인 계정이 없어야 함 (CHECK)", () => rejects(`UPDATE "Customer" SET "userId" = (SELECT id FROM "User" LIMIT 1) WHERE id = ${withdrawn}`, "Customer_withdrawn_ck"));
  test("등급 이력 없이 등급 변경 금지", () => rejects(`UPDATE "Customer" SET "gradeId" = (SELECT id FROM "CustomerGrade" WHERE code = 'VIP') WHERE id = ${a}`, "Customer_grade_guard"));
  test("고객 행 삭제 금지", () => rejects(`DELETE FROM "Customer" WHERE id = ${a}`, "Customer_no_delete"));
  test("개인정보 평문 저장 금지 (암호문 형식 CHECK)", () => rejects(`UPDATE "CustomerProfile" SET "nameEnc" = '홍길동' WHERE "customerId" = ${a}`, "CustomerProfile_enc_ck"));
  test("휴대폰 암호문과 검색 해시는 함께", () => rejects(`UPDATE "CustomerProfile" SET "phoneEnc" = 'v1:a:b:c', "phoneHash" = NULL WHERE "customerId" = ${a}`, "CustomerProfile_pairs_ck"));
  test("검색 해시 형식 (64자리 16진수)", () => rejects(`UPDATE "CustomerProfile" SET "phoneEnc" = 'v1:a:b:c', "phoneHash" = 'abc' WHERE "customerId" = ${a}`, "CustomerProfile_hash_ck"));
  test("휴대폰 해시 중복 금지 (DB 트리거)", async () => {
    const h = "a".repeat(64);
    await rejects([
      `UPDATE "CustomerProfile" SET "phoneEnc" = 'v1:a:b:c', "phoneHash" = '${h}' WHERE "customerId" = ${a}`,
      `UPDATE "CustomerProfile" SET "phoneEnc" = 'v1:a:b:c', "phoneHash" = '${h}' WHERE "customerId" = ${b}`,
    ], "CustomerProfile_phone_unique");
  });
  test("탈퇴 고객에게 개인정보 다시 저장 금지", () => rejects(`UPDATE "CustomerProfile" SET "birthMonth" = 3, "birthDateEnc" = 'v1:a:b:c' WHERE "customerId" = ${withdrawn}`, "CustomerProfile_withdrawn"));
  test("탈퇴 고객에게 배송지 추가 금지", () =>
    rejects(`INSERT INTO "CustomerAddress" ("customerId",label,"recipientEnc","phoneEnc","zipCode","address1Enc","isDefault","createdAt","updatedAt") VALUES (${withdrawn}, '집', 'v1:a:b:c', 'v1:a:b:c', '04780', 'v1:a:b:c', 1, ${NOW()}, ${NOW()})`, "CustomerAddress_guard"));
  test("기본 배송지 2개 금지", () => {
    const ins = (isDefault: number) => `INSERT INTO "CustomerAddress" ("customerId",label,"recipientEnc","phoneEnc","zipCode","address1Enc","isDefault","createdAt","updatedAt") VALUES (${a}, '집', 'v1:a:b:c', 'v1:a:b:c', '04780', 'v1:a:b:c', ${isDefault}, ${NOW()}, ${NOW()})`;
    return rejects([ins(1), ins(1)], "CustomerAddress_default_one");
  });
  test("우편번호 형식", () =>
    rejects(`INSERT INTO "CustomerAddress" ("customerId",label,"recipientEnc","phoneEnc","zipCode","address1Enc","isDefault","createdAt","updatedAt") VALUES (${a}, '집', 'v1:a:b:c', 'v1:a:b:c', '123', 'v1:a:b:c', 0, ${NOW()}, ${NOW()})`, "CustomerAddress_zip_ck"));
  test("체형 범위 (키 300cm 금지)", () => rejects(`INSERT INTO "CustomerBodyProfile" ("customerId","heightCm","showInReviews","updatedAt") VALUES (${a}, 300, 0, ${NOW()})`, "CustomerBodyProfile_range_ck"));
  test("탈퇴 유예 7일 미만 금지", () =>
    rejects(`INSERT INTO "CustomerWithdrawal" ("customerId","reasonCode","requestedAt","scheduledAt") VALUES (${a}, 'OTHER', ${NOW()}, ${ISO(new Date(Date.now() + 3 * DAY))})`, "CustomerWithdrawal_grace_ck"));
  test("진행 중인 탈퇴 신청 2개 금지", () => {
    const ins = `INSERT INTO "CustomerWithdrawal" ("customerId","reasonCode","requestedAt","scheduledAt") VALUES (${a}, 'OTHER', ${NOW()}, ${ISO(new Date(Date.now() + 8 * DAY))})`;
    return rejects([ins, ins], "CustomerWithdrawal_open_one");
  });
  test("처리 끝난 탈퇴 신청은 수정 금지", () => rejects(`UPDATE "CustomerWithdrawal" SET "reasonText" = '수정' WHERE "customerId" = ${withdrawn}`, "CustomerWithdrawal_immutable"));
  test("상태·등급 이력 수정·삭제 금지", async () => {
    await rejects(`UPDATE "CustomerStatusHistory" SET memo = 'x' WHERE "customerId" = ${a}`, "CustomerStatusHistory_append_only");
    await rejects(`DELETE FROM "CustomerStatusHistory" WHERE "customerId" = ${a}`, "CustomerStatusHistory_append_only");
    await rejects(`DELETE FROM "CustomerGradeHistory" WHERE "customerId" = ${a}`, "CustomerGradeHistory_append_only");
  });
  test("로그인 기록: 수정 금지, 3개월 안 된 기록 삭제 금지, 원본 IP 저장 금지", async () => {
    const recent = await pastLogin(a, 1);
    await rejects(`UPDATE "CustomerLoginHistory" SET provider = 'x' WHERE id = ${recent.id}`, "CustomerLoginHistory_append_only");
    await rejects(`DELETE FROM "CustomerLoginHistory" WHERE id = ${recent.id}`, "CustomerLoginHistory_retention");
    await rejects(`INSERT INTO "CustomerLoginHistory" ("customerId",provider,result,"ipMasked","loggedInAt") VALUES (${a}, 'github', 'SUCCESS', '123.45.67.89', ${NOW()})`, "CustomerLoginHistory_values_ck");
  });
  test("정상(ACTIVE)이 아닌 고객의 주문 금지", () =>
    rejects(`INSERT INTO "Order" ("paymentOrderId","orderName","totalPrice",status,"createdAt","customerId") VALUES ('order_x_${Date.now()}', 'x', 1000, 'PENDING', ${NOW()}, ${withdrawn})`, "Order_customer_active"));
});
