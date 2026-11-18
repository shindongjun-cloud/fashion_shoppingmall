// 고객 처리 (서버 전용). 로그인(auth)은 여기서 부르지 않습니다 → lib/current-customer.ts
// (auth.ts가 이 파일을 부르므로, 여기서 auth를 부르면 서로 부르는 순환 참조가 생김)
import { randomInt } from "node:crypto";
import type { CustomerGender, Fit, Prisma, WithdrawalReason } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  blindIndex,
  decryptOrNull,
  encrypt,
  encryptOrNull,
  maskEmail,
  maskName,
  maskPhone,
  normalizeEmail,
  normalizePhone,
} from "@/lib/crypto";
import { isConstraintError, releaseOrder, withBusyRetry } from "@/lib/inventory";

type Db = Prisma.TransactionClient | typeof prisma;

export const WITHDRAWAL_GRACE_DAYS = 7;
export const REJOIN_BLOCK_DAYS = 30;
export const LOGIN_HISTORY_RETENTION_DAYS = 90;
export const DORMANT_AFTER_DAYS = 365;
const DAY = 24 * 60 * 60 * 1000;

/** 사용자에게 그대로 보여 줄 수 있는 오류 */
export class CustomerError extends Error {}

// ---------------------------------------------------------------
// 가입 (첫 로그인 때 자동)
// ---------------------------------------------------------------

/** C + 숫자 10자리. 순번이 아니라 무작위라서 다른 고객 번호를 추측할 수 없습니다 */
export function generateCustomerNo() {
  return `C${String(randomInt(0, 10_000_000_000)).padStart(10, "0")}`;
}

/** 이 로그인 계정의 고객을 찾고, 없으면 만듭니다 (가입). 상태·등급 이력도 함께 */
export async function ensureCustomerForUser(userId: string, now = new Date()) {
  const existing = await prisma.customer.findUnique({ where: { userId } });
  if (existing) return existing;

  const welcome = await prisma.customerGrade.findFirstOrThrow({ where: { isActive: true }, orderBy: { minAmount: "asc" } });
  for (let attempt = 1; ; attempt++) {
    try {
      return await withBusyRetry(() =>
        prisma.$transaction(async (tx) => {
          // 같은 계정으로 동시에 두 번 로그인한 경우: 먼저 만든 쪽을 씀
          const again = await tx.customer.findUnique({ where: { userId } });
          if (again) return again;
          const customer = await tx.customer.create({
            data: {
              customerNo: generateCustomerNo(),
              userId,
              gradeId: welcome.id,
              joinedAt: now,
              statusReason: "SIGNUP", // 트리거가 이 값으로 상태 이력 첫 줄을 남김
              statusChangedBy: "SYSTEM",
              statusChangedAt: now,
            },
          });
          await tx.customerProfile.create({ data: { customerId: customer.id } });
          await tx.customerGradeHistory.create({
            data: { customerId: customer.id, toGradeId: welcome.id, reason: "SIGNUP", changedBy: "SYSTEM", changedAt: now },
          });
          return customer;
        }),
      );
    } catch (e) {
      // 고객번호가 우연히 겹치면 새 번호로 다시 (확률 매우 낮음)
      if (attempt < 5 && isConstraintError(e, "customerNo")) continue;
      throw e;
    }
  }
}

// ---------------------------------------------------------------
// 로그인
// ---------------------------------------------------------------

/** 로그인 기록 + 마지막 로그인 시각. 휴면 고객이 로그인하면 정상으로 되돌림 */
export async function recordLogin(
  customerId: number,
  input: { provider: string; result?: "SUCCESS" | "BLOCKED_SUSPENDED"; ipMasked?: string | null; userAgent?: string | null },
  now = new Date(),
) {
  await withBusyRetry(() =>
    prisma.$transaction(async (tx) => {
      await tx.customerLoginHistory.create({
        data: {
          customerId,
          provider: input.provider,
          result: input.result ?? "SUCCESS",
          ipMasked: input.ipMasked ?? null,
          userAgent: input.userAgent?.slice(0, 500) ?? null,
          loggedInAt: now,
        },
      });
      if ((input.result ?? "SUCCESS") !== "SUCCESS") return;
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
      await tx.customer.update({
        where: { id: customerId },
        data: {
          lastLoginAt: now,
          ...(customer.status === "DORMANT"
            ? { status: "ACTIVE", dormantAt: null, statusReason: "LOGIN", statusMemo: null, statusChangedBy: "SYSTEM", statusChangedAt: now }
            : {}),
        },
      });
    }),
  );
}

/** 재가입 제한 확인용 해시 (로그인 제공자 + 그 서비스의 계정 번호). 개인정보가 아닌 값만 해시 */
export function rejoinHash(provider: string, providerAccountId: string) {
  return blindIndex("rejoin", `${provider}:${providerAccountId}`);
}

/** 탈퇴 후 30일 안에 같은 로그인 계정으로 다시 가입하려는지 */
export async function isRejoinBlocked(provider: string, providerAccountId: string, now = new Date()) {
  const found = await prisma.customerWithdrawal.findFirst({
    where: { rejoinBlockHash: rejoinHash(provider, providerAccountId), rejoinBlockUntil: { gt: now } },
  });
  return found !== null;
}

// ---------------------------------------------------------------
// 프로필 (암호화 저장, 마스킹 표시)
// ---------------------------------------------------------------

export type ProfileInput = {
  name?: string;
  phone?: string;
  birthDate?: string; // YYYY-MM-DD
  gender?: CustomerGender;
  contactEmail?: string;
};

/** 만 나이 */
export function ageOn(birth: Date, today: Date) {
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const m = today.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < birth.getUTCDate())) age--;
  return age;
}

export async function updateProfile(customerId: number, input: ProfileInput, now = new Date()) {
  const data: Prisma.CustomerProfileUncheckedUpdateInput = {};

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name && (name.length > 30 || /[<>]/.test(name))) throw new CustomerError("이름은 30자 이내로 입력해 주세요.");
    data.nameEnc = encryptOrNull(name || null);
  }
  if (input.phone !== undefined) {
    if (input.phone.trim() === "") {
      data.phoneEnc = null;
      data.phoneHash = null;
    } else {
      const phone = normalizePhone(input.phone);
      if (!phone) throw new CustomerError("휴대폰 번호 형식이 올바르지 않아요. (예: 010-1234-5678)");
      data.phoneEnc = encrypt(phone);
      data.phoneHash = blindIndex("phone", phone);
    }
  }
  if (input.birthDate !== undefined) {
    if (input.birthDate.trim() === "") {
      data.birthDateEnc = null;
      data.birthMonth = null;
    } else {
      const m = input.birthDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const birth = m ? new Date(`${input.birthDate}T00:00:00Z`) : null;
      if (!m || !birth || Number.isNaN(birth.getTime()) || birth.toISOString().slice(0, 10) !== input.birthDate) {
        throw new CustomerError("생년월일을 YYYY-MM-DD 형식으로 입력해 주세요.");
      }
      if (birth > now) throw new CustomerError("생년월일이 미래일 수 없어요.");
      // 개인정보보호법: 만 14세 미만은 법정대리인 동의가 필요 → 이 몰은 만 14세 미만 가입을 받지 않음
      if (ageOn(birth, now) < 14) throw new CustomerError("만 14세 미만은 가입할 수 없어요.");
      data.birthDateEnc = encrypt(input.birthDate);
      data.birthMonth = Number(m[2]);
    }
  }
  if (input.gender !== undefined) data.gender = input.gender;
  if (input.contactEmail !== undefined) {
    if (input.contactEmail.trim() === "") {
      data.contactEmailEnc = null;
      data.emailHash = null;
    } else {
      const email = normalizeEmail(input.contactEmail);
      if (!email) throw new CustomerError("이메일 형식이 올바르지 않아요.");
      data.contactEmailEnc = encrypt(email);
      data.emailHash = blindIndex("email", email);
    }
  }

  try {
    await prisma.customerProfile.upsert({
      where: { customerId },
      update: data,
      create: { ...(data as Prisma.CustomerProfileUncheckedCreateInput), customerId },
    });
  } catch (e) {
    if (isConstraintError(e, "CustomerProfile_phone_unique")) throw new CustomerError("이미 다른 회원이 사용 중인 휴대폰 번호예요.");
    if (isConstraintError(e, "CustomerProfile_withdrawn")) throw new CustomerError("탈퇴한 회원은 정보를 수정할 수 없어요.");
    throw e;
  }
}

/** 화면 표시용: 복호화 + 마스킹 (원문은 "수정" 폼에서만 필요할 때 따로) */
export async function getProfileView(customerId: number) {
  const p = await prisma.customerProfile.findUnique({ where: { customerId } });
  const name = decryptOrNull(p?.nameEnc);
  const phone = decryptOrNull(p?.phoneEnc);
  const email = decryptOrNull(p?.contactEmailEnc);
  const birthDate = decryptOrNull(p?.birthDateEnc);
  return {
    masked: {
      name: name ? maskName(name) : null,
      phone: phone ? maskPhone(phone) : null,
      email: email ? maskEmail(email) : null,
      birthDate: birthDate ? `${birthDate.slice(0, 4)}-**-**` : null,
    },
    gender: p?.gender ?? "UNDISCLOSED",
    hasPhone: phone !== null,
  };
}

// ---------------------------------------------------------------
// 체형 정보
// ---------------------------------------------------------------
export async function saveBodyProfile(
  customerId: number,
  input: { heightCm?: number | null; weightKg?: number | null; topSize?: string | null; bottomSize?: string | null; shoeSizeMm?: number | null; preferredFit?: Fit | null; showInReviews?: boolean },
) {
  const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim().slice(0, 10) : null);
  const data = {
    heightCm: input.heightCm ?? null,
    weightKg: input.weightKg ?? null,
    topSize: clean(input.topSize),
    bottomSize: clean(input.bottomSize),
    shoeSizeMm: input.shoeSizeMm ?? null,
    preferredFit: input.preferredFit ?? null,
    showInReviews: input.showInReviews ?? false,
  };
  try {
    await prisma.customerBodyProfile.upsert({ where: { customerId }, update: data, create: { customerId, ...data } });
  } catch (e) {
    if (isConstraintError(e, "CustomerBodyProfile_range_ck")) throw new CustomerError("키 100~230cm, 몸무게 25~200kg, 신발 200~330mm 범위로 입력해 주세요.");
    throw e;
  }
}

// ---------------------------------------------------------------
// 배송지
// ---------------------------------------------------------------
export type AddressInput = {
  label: string;
  recipient: string;
  phone: string;
  zipCode: string;
  address1: string;
  address2?: string;
  deliveryMemo?: string;
  makeDefault?: boolean;
};

function validateAddress(input: AddressInput) {
  const label = input.label.trim();
  const recipient = input.recipient.trim();
  const phone = normalizePhone(input.phone);
  const address1 = input.address1.trim();
  if (!label || label.length > 20) throw new CustomerError("배송지 이름은 1~20자로 입력해 주세요.");
  if (!recipient || recipient.length > 30) throw new CustomerError("받는 분 이름을 입력해 주세요.");
  if (!phone) throw new CustomerError("받는 분 휴대폰 번호 형식이 올바르지 않아요.");
  if (!/^\d{5}$/.test(input.zipCode.trim())) throw new CustomerError("우편번호는 숫자 5자리예요.");
  if (!address1) throw new CustomerError("주소를 입력해 주세요.");
  if ((input.deliveryMemo ?? "").length > 100) throw new CustomerError("배송 메모는 100자 이내로 입력해 주세요.");
  return {
    label,
    recipientEnc: encrypt(recipient),
    phoneEnc: encrypt(phone),
    zipCode: input.zipCode.trim(),
    address1Enc: encrypt(address1),
    address2Enc: encryptOrNull(input.address2?.trim() || null),
    deliveryMemoEnc: encryptOrNull(input.deliveryMemo?.trim() || null), // 공동현관 비밀번호 등이 들어가므로 암호화
  };
}

/** 배송지 추가. 첫 배송지거나 makeDefault면 기본 배송지로 (기존 기본은 먼저 해제) */
export async function addAddress(customerId: number, input: AddressInput) {
  const data = validateAddress(input);
  try {
    return await prisma.$transaction(async (tx) => {
      const count = await tx.customerAddress.count({ where: { customerId } });
      const makeDefault = input.makeDefault || count === 0;
      if (makeDefault) await tx.customerAddress.updateMany({ where: { customerId, isDefault: true }, data: { isDefault: false } });
      return tx.customerAddress.create({ data: { ...data, customerId, isDefault: makeDefault } });
    });
  } catch (e) {
    if (isConstraintError(e, "CustomerAddress_guard")) throw new CustomerError("배송지는 최대 20개까지 저장할 수 있어요.");
    throw e;
  }
}

/** 기본 배송지 변경: 기존 기본 해제 → 새 기본 지정 (순서가 반대면 DB 트리거가 막음) */
export async function setDefaultAddress(customerId: number, addressId: number) {
  await prisma.$transaction(async (tx) => {
    const target = await tx.customerAddress.findFirst({ where: { id: addressId, customerId } });
    if (!target) throw new CustomerError("배송지를 찾을 수 없어요.");
    await tx.customerAddress.updateMany({ where: { customerId, isDefault: true, id: { not: addressId } }, data: { isDefault: false } });
    await tx.customerAddress.update({ where: { id: addressId }, data: { isDefault: true } });
  });
}

/** 배송지 삭제. 기본 배송지를 지우면 가장 최근에 쓴(없으면 최근 추가한) 배송지가 기본이 됨 */
export async function deleteAddress(customerId: number, addressId: number) {
  await prisma.$transaction(async (tx) => {
    const target = await tx.customerAddress.findFirst({ where: { id: addressId, customerId } });
    if (!target) throw new CustomerError("배송지를 찾을 수 없어요.");
    await tx.customerAddress.delete({ where: { id: addressId } });
    if (target.isDefault) {
      const next = await tx.customerAddress.findFirst({
        where: { customerId },
        orderBy: [{ lastUsedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
      });
      if (next) await tx.customerAddress.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  });
}

/** 화면 표시용 배송지 목록 (복호화, 연락처는 마스킹) */
export async function listAddresses(customerId: number) {
  const rows = await prisma.customerAddress.findMany({ where: { customerId }, orderBy: [{ isDefault: "desc" }, { id: "asc" }] });
  return rows.map((a) => {
    const phone = decryptOrNull(a.phoneEnc) ?? "";
    return {
      id: a.id,
      label: a.label,
      isDefault: a.isDefault,
      recipient: decryptOrNull(a.recipientEnc) ?? "",
      phoneMasked: maskPhone(phone),
      zipCode: a.zipCode,
      address1: decryptOrNull(a.address1Enc) ?? "",
      address2: decryptOrNull(a.address2Enc),
      deliveryMemo: decryptOrNull(a.deliveryMemoEnc),
    };
  });
}

// ---------------------------------------------------------------
// 상태 변경 공통 (사유·시각을 함께 바꿔야 트리거가 통과시키고 이력을 남김)
// ---------------------------------------------------------------
function statusChange(reason: Prisma.CustomerUpdateInput["statusReason"], now: Date, by = "SYSTEM", memo: string | null = null) {
  return { statusReason: reason, statusMemo: memo, statusChangedBy: by, statusChangedAt: now };
}

// ---------------------------------------------------------------
// 탈퇴: 신청 → 7일 유예(철회 가능) → 익명화 + 로그인 계정 삭제
// ---------------------------------------------------------------
export async function requestWithdrawal(
  customerId: number,
  input: { reasonCode: WithdrawalReason; reasonText?: string },
  now = new Date(),
) {
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
  if (!["ACTIVE", "DORMANT", "SUSPENDED"].includes(customer.status)) {
    throw new CustomerError("이미 탈퇴를 신청했거나 탈퇴한 회원이에요.");
  }
  if ((input.reasonText ?? "").length > 500) throw new CustomerError("사유는 500자 이내로 입력해 주세요.");
  // 결제가 끝나지 않은 주문이 있으면 탈퇴 불가
  // 입금 대기(가상계좌), 결제 결과 확인 중, 환불 확인 중인 주문이 있으면 정리된 뒤에 탈퇴 (돈이 걸려 있음)
  const openMoney = await prisma.order.findFirst({
    where: {
      customerId,
      OR: [{ status: { in: ["WAITING_DEPOSIT", "CANCEL_FAILED"] } }, { payments: { some: { status: { in: ["IN_PROGRESS", "UNKNOWN"] } } } }],
    },
  });
  if (openMoney) throw new CustomerError("입금 대기·결제 확인 중·환불 확인 중인 주문이 있어요. 처리가 끝난 뒤 탈퇴해 주세요.");
  // 결제했지만 아직 구매확정 전인 상품(결제 완료~배송 완료)이 있으면 탈퇴 불가: 배송·반품·환불이 남아 있음
  const inDelivery = await prisma.orderItem.findFirst({ where: { order: { customerId }, status: { in: ["PAID", "PREPARING", "SHIPPED", "DELIVERED"] } } });
  if (inDelivery) throw new CustomerError("배송 준비·배송 중이거나 구매확정 전인 주문이 있어요. 구매확정(또는 취소)한 뒤 탈퇴해 주세요.");
  // (더 구체적인 안내를 먼저: 입금 대기 주문도 재고를 잡고 있어서 아래 검사에 함께 걸림)
  const pending = await prisma.inventoryReservation.findFirst({ where: { order: { customerId }, status: "RESERVED" } });
  if (pending) throw new CustomerError("결제 대기 중인 주문이 있어요. 주문을 마치거나 취소한 뒤 탈퇴해 주세요.");

  return prisma.$transaction(async (tx) => {
    const withdrawal = await tx.customerWithdrawal.create({
      data: {
        customerId,
        reasonCode: input.reasonCode,
        reasonText: input.reasonText?.trim() || null,
        requestedAt: now,
        scheduledAt: new Date(now.getTime() + WITHDRAWAL_GRACE_DAYS * DAY),
      },
    });
    await tx.customer.update({
      where: { id: customerId },
      data: {
        status: "WITHDRAW_PENDING",
        suspendedAt: null,
        suspendedReason: null,
        dormantAt: null,
        ...statusChange("WITHDRAW_REQUEST", now, "CUSTOMER"),
      },
    });
    return withdrawal;
  });
}

export async function cancelWithdrawal(customerId: number, now = new Date()) {
  await prisma.$transaction(async (tx) => {
    const open = await tx.customerWithdrawal.findFirst({ where: { customerId, completedAt: null, canceledAt: null } });
    if (!open) throw new CustomerError("철회할 탈퇴 신청이 없어요.");
    await tx.customerWithdrawal.update({ where: { id: open.id }, data: { canceledAt: now } });
    await tx.customer.update({ where: { id: customerId }, data: { status: "ACTIVE", ...statusChange("WITHDRAW_CANCEL", now, "CUSTOMER") } });
  });
}

/**
 * 탈퇴 완료: 유예 기간이 지난 신청만. 순서가 중요합니다(트리거가 검사):
 * ① 개인정보 파기(프로필 비움, 체형·배송지 삭제) → ② 신청 완료 + 재가입 제한 해시 → ③ 고객 WITHDRAWN + userId 비움 → ④ 로그인 계정 삭제
 * 주문·결제 기록은 남습니다 (전자상거래법 5년). 남은 결제 대기 예약은 해제.
 */
export async function completeWithdrawal(customerId: number, now = new Date()) {
  await withBusyRetry(() =>
    prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: customerId }, include: { user: { include: { accounts: true } } } });
      const open = await tx.customerWithdrawal.findFirst({ where: { customerId, completedAt: null, canceledAt: null } });
      if (customer.status !== "WITHDRAW_PENDING" || !open) throw new CustomerError("처리할 탈퇴 신청이 없어요.");
      if (open.scheduledAt > now) throw new CustomerError("철회 기간(7일)이 끝나야 탈퇴가 처리돼요.");

      // ① 개인정보 파기
      await tx.customerProfile.updateMany({
        where: { customerId },
        data: { nameEnc: null, phoneEnc: null, phoneHash: null, birthDateEnc: null, birthMonth: null, contactEmailEnc: null, emailHash: null, gender: "UNDISCLOSED" },
      });
      await tx.customerBodyProfile.deleteMany({ where: { customerId } });
      await tx.customerAddress.deleteMany({ where: { customerId } });
      const pendingOrders = await tx.order.findMany({ where: { customerId, status: "PENDING" }, select: { id: true } });
      for (const o of pendingOrders) await releaseOrder(tx, o.id, "ADMIN", now);

      // ② 신청 완료 + 재가입 제한 (로그인 계정이 여러 개면 첫 번째 기준. 지금은 GitHub 하나)
      const account = customer.user?.accounts[0];
      await tx.customerWithdrawal.update({
        where: { id: open.id },
        data: {
          completedAt: now,
          ...(account
            ? { rejoinBlockHash: rejoinHash(account.provider, account.providerAccountId), rejoinBlockUntil: new Date(now.getTime() + REJOIN_BLOCK_DAYS * DAY) }
            : {}),
        },
      });

      // ③ 고객 익명화
      await tx.customer.update({
        where: { id: customerId },
        data: { status: "WITHDRAWN", userId: null, withdrawnAt: now, anonymizedAt: now, ...statusChange("WITHDRAW_COMPLETE", now) },
      });

      // ④ 로그인 계정 삭제 (Account·Session은 함께 삭제됨)
      if (customer.userId) await tx.user.delete({ where: { id: customer.userId } });
    }),
  );
}

/** 처리 예정일이 지난 탈퇴 신청을 모두 완료 (배포 후 매일 크론). 완료한 개수 */
export async function processDueWithdrawals(now = new Date()) {
  const due = await prisma.customerWithdrawal.findMany({
    where: { completedAt: null, canceledAt: null, scheduledAt: { lte: now } },
    select: { customerId: true },
  });
  for (const w of due) await completeWithdrawal(w.customerId, now);
  return due.length;
}

// ---------------------------------------------------------------
// 정지 / 해제 (관리자 단계에서 화면을 붙일 함수)
// ---------------------------------------------------------------
export async function suspendCustomer(customerId: number, reason: string, by: string, now = new Date()) {
  if (!reason.trim()) throw new CustomerError("정지 사유를 입력해 주세요.");
  await prisma.customer.update({
    where: { id: customerId },
    data: { status: "SUSPENDED", suspendedAt: now, suspendedReason: reason.trim(), dormantAt: null, ...statusChange("ABUSE", now, by, reason.trim()) },
  });
}
export async function unsuspendCustomer(customerId: number, by: string, now = new Date()) {
  await prisma.customer.update({
    where: { id: customerId },
    data: { status: "ACTIVE", suspendedAt: null, suspendedReason: null, ...statusChange("APPEAL", now, by) },
  });
}

/** 1년 넘게 로그인하지 않은 고객을 휴면으로 (배포 후 매일 크론). 바꾼 개수 */
export async function markDormantCustomers(now = new Date()) {
  const cutoff = new Date(now.getTime() - DORMANT_AFTER_DAYS * DAY);
  const targets = await prisma.customer.findMany({
    where: { status: "ACTIVE", OR: [{ lastLoginAt: { lt: cutoff } }, { lastLoginAt: null, joinedAt: { lt: cutoff } }] },
    select: { id: true },
  });
  for (const t of targets) {
    await prisma.customer.update({ where: { id: t.id }, data: { status: "DORMANT", dormantAt: now, ...statusChange("INACTIVITY", now) } });
  }
  return targets.length;
}

// ---------------------------------------------------------------
// 등급 재산정 (최근 12개월 결제 완료 금액)
// ---------------------------------------------------------------
/** 최근 12개월 결제 완료 금액 (등급 산정과 같은 기준) */
/** 순결제 금액 = 결제 금액 − 취소 금액. 결제 완료 시각(paidAt) 기준 기간 */
async function netPaidByCustomer(db: Db, from: Date, to: Date, customerId?: number) {
  const rows = await db.payment.groupBy({
    by: ["orderId"],
    where: {
      status: { in: ["DONE", "PARTIAL_CANCELED"] },
      order: { status: "PAID", paidAt: { gte: from, lt: to }, ...(customerId ? { customerId } : {}) },
    },
    _sum: { amount: true, canceledAmount: true },
  });
  const orders = await db.order.findMany({ where: { id: { in: rows.map((r) => r.orderId) } }, select: { id: true, customerId: true } });
  const result = new Map<number, number>();
  for (const r of rows) {
    const cid = orders.find((o) => o.id === r.orderId)!.customerId;
    if (cid === null) continue; // 비회원 주문 (가져오기 전)은 등급 실적에 없음
    result.set(cid, (result.get(cid) ?? 0) + (r._sum.amount ?? 0) - (r._sum.canceledAmount ?? 0));
  }
  return result;
}

export async function getPaidAmountLast12Months(customerId: number, now = new Date()) {
  return (await netPaidByCustomer(prisma, new Date(now.getTime() - 365 * DAY), now, customerId)).get(customerId) ?? 0;
}

export async function recalculateGrades(now = new Date(), db: Db = prisma) {
  const from = new Date(now.getTime() - 365 * DAY);
  const grades = await db.customerGrade.findMany({ where: { isActive: true }, orderBy: { minAmount: "desc" } });
  const customers = await db.customer.findMany({ where: { status: { not: "WITHDRAWN" } }, select: { id: true, gradeId: true } });
  const sums = await netPaidByCustomer(db, from, now); // 부분 취소한 금액은 빼고 계산
  let changed = 0;
  for (const c of customers) {
    const amount = sums.get(c.id) ?? 0;
    const target = grades.find((g) => g.minAmount <= amount);
    if (!target || target.id === c.gradeId) continue;
    // 이력을 먼저 남겨야 등급을 바꿀 수 있음 (트리거 Customer_grade_guard)
    await prisma.$transaction(async (tx) => {
      await tx.customerGradeHistory.create({
        data: { customerId: c.id, fromGradeId: c.gradeId, toGradeId: target.id, reason: "PERIODIC", purchaseAmount: amount, periodFrom: from, periodTo: now, changedBy: "SYSTEM", changedAt: now },
      });
      await tx.customer.update({ where: { id: c.id }, data: { gradeId: target.id } });
    });
    changed++;
  }
  return changed;
}

/** 3개월 지난 로그인 기록 삭제 (배포 후 매일 크론). 삭제한 개수 */
export async function purgeOldLoginHistory(now = new Date()) {
  const cutoff = new Date(now.getTime() - LOGIN_HISTORY_RETENTION_DAYS * DAY - 60 * 1000); // 1분 여유 (DB 시각과 오차)
  const result = await prisma.customerLoginHistory.deleteMany({ where: { loggedInAt: { lt: cutoff } } });
  return result.count;
}
