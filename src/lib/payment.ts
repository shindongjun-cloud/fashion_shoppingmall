// 결제 처리 (서버 전용)
//
// 흐름 (카드·간편결제)
//   successUrl → confirmOrderPayment
//     ① 입력 검사 → ② 주문 확인 → ③ Payment(IN_PROGRESS) 생성 = "승인 권한 선점" (동시 요청은 DB 트리거가 1개만 통과)
//     ④ 재고 예약 확인 → ⑤ 토스 승인 (멱등키)
//     ⑥ 토스 결과를 Payment에 먼저 저장 (돈에 관한 사실이 우선) → ⑦ 주문 결제 완료 + 재고 확정
//     ⑦이 실패하면 결제 취소(보상). 토스 응답을 못 받으면 UNKNOWN → 토스에 물어서 확정 (바로 1번, 이후 정기 작업)
// 가상계좌
//   ⑤에서 WAITING_FOR_DEPOSIT → 재고 예약을 입금 기한 + 1시간까지 연장, 주문 WAITING_DEPOSIT
//   입금 → 웹훅(DEPOSIT_CALLBACK)·정기 작업이 토스 조회로 확인 → ⑦
//   기한이 지나면 정기 작업이 토스에 확인 후 만료 처리 (토스는 만료 웹훅을 보내지 않음)
import { createHash, randomUUID } from "crypto";
import type { Order, Payment, PaymentActor, PaymentCancelReason, PaymentMethod, PaymentStatusSource, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { blindIndex, decrypt, encrypt, maskAccountNumber, maskName } from "@/lib/crypto";
import { confirmOrder, ensureOrderReserved, ensureReservedTx, InsufficientStockError, isConstraintError, releaseOrder, withBusyRetry } from "@/lib/inventory";
import { maskForLog, tossApi, type TossApi, type TossPayment, type TossResult } from "@/lib/toss";

type Tx = Prisma.TransactionClient;

export const VA_RESERVATION_GRACE_MS = 60 * 60 * 1000; // 가상계좌 재고 예약: 입금 기한 + 1시간 (웹훅 지연 대비)
export const STALE_IN_PROGRESS_MS = 2 * 60 * 1000; // 승인 중 상태가 이보다 오래되면 정기 작업이 확인
export const CONFIRM_WINDOW_MS = 10 * 60 * 1000; // 토스 승인 가능 시간 (결제 인증 후 10분)
export const STALE_CANCEL_MS = 60 * 1000;
export const RECHECK_MIN_INTERVAL_MS = 5 * 1000; // 확인 중 화면에서 같은 결제를 토스에 다시 묻는 최소 간격
export const WEBHOOK_MAX_ATTEMPTS = 5;
export const API_LOG_RETENTION_DAYS = 365;
const DAY = 24 * 60 * 60 * 1000;

export class PaymentError extends Error {}

// ---------------------------------------------------------------
// 의존성 (테스트에서 가짜 토스·시계·주문 완료 실패를 끼워 넣음)
// ---------------------------------------------------------------
export type PaymentDeps = {
  toss: TossApi;
  now: () => Date;
  /** ⑦ 주문 결제 완료 + 재고 확정. 테스트에서 실패를 흉내 낼 수 있게 바꿔 끼울 수 있음 */
  finalizeOrder: (tx: Tx, order: Order, payment: Payment, now: Date) => Promise<void>;
  /** 동시 요청이 끝나기를 기다리는 시간 (테스트에서 줄임) */
  waitForOtherMs: number;
};

async function defaultFinalizeOrder(tx: Tx, order: Order, payment: Payment, now: Date) {
  // 입금 대기였다면 예약이 만료됐을 수 있음 → 있으면 다시 잡고, 없으면 InsufficientStockError
  await ensureReservedTx(tx, order.id, now);
  await confirmOrder(tx, order.id, now); // 예약 확정 → 트리거가 판매 원장 생성, 실재고 감소
  await tx.order.update({ where: { id: order.id }, data: { status: "PAID", paidAt: payment.approvedAt ?? now } });
  await tx.customer.update({ where: { id: order.customerId }, data: { lastOrderAt: now } }); // 휴면·등급 산정 참고
}

export const defaultPaymentDeps: PaymentDeps = {
  toss: tossApi,
  now: () => new Date(),
  finalizeOrder: defaultFinalizeOrder,
  waitForOtherMs: 8000,
};

// ---------------------------------------------------------------
// 토스 값 → 우리 값
// ---------------------------------------------------------------
const METHOD_MAP: Record<string, PaymentMethod> = {
  카드: "CARD",
  가상계좌: "VIRTUAL_ACCOUNT",
  간편결제: "EASY_PAY",
  계좌이체: "TRANSFER",
  휴대폰: "MOBILE_PHONE",
  문화상품권: "GIFT_CERTIFICATE",
  도서문화상품권: "GIFT_CERTIFICATE",
  게임문화상품권: "GIFT_CERTIFICATE",
};
export const mapMethod = (method: string | null | undefined): PaymentMethod | null => (method ? (METHOD_MAP[method] ?? null) : null);
const CARD_TYPE = { 신용: "CREDIT", 체크: "CHECK", 기프트: "GIFT" } as const;
const OWNER_TYPE = { 개인: "PERSONAL", 법인: "CORPORATE" } as const;

/**
 * 토스 날짜 → Date.
 * 결제 시각은 "2024-01-01T10:00:00+09:00"(시간대 있음), 가상계좌 입금 기한·웹훅 시각은 시간대 없이 옴 → 한국 시간(+09:00)으로 해석
 */
export function parseTossDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const hasZone = /([+-]\d\d:?\d\d|Z)$/.test(value);
  const d = new Date(hasZone ? value : `${value}+09:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const secretHashOf = (secret: string) => blindIndex("toss-secret", secret);
const truncate = (s: string | null | undefined, n: number) => (s ? s.slice(0, n) : null);

// ---------------------------------------------------------------
// 토스 결제 정보 → 우리 DB (Payment + 수단별 상세 + 현금영수증 + 취소)
// ---------------------------------------------------------------
export class PaymentMismatchError extends Error {}

/**
 * 토스가 알려 준 결제 상태를 우리 Payment에 반영합니다. (트랜잭션 안에서)
 * 결제 키·주문번호·금액이 우리 기록과 다르면 반영하지 않습니다 (위조·버그 방지).
 */
export async function applyTossPayment(tx: Tx, paymentId: number, tp: TossPayment, source: PaymentStatusSource, now: Date): Promise<Payment> {
  let p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if ((p.paymentKey && tp.paymentKey !== p.paymentKey) || tp.orderId !== p.pgOrderId || tp.totalAmount !== p.amount) {
    throw new PaymentMismatchError(
      `토스 결제 정보가 우리 기록과 다릅니다 (payment ${p.id}: key ${tp.paymentKey === p.paymentKey}, orderId ${tp.orderId === p.pgOrderId}, amount ${tp.totalAmount}/${p.amount})`,
    );
  }

  const method = mapMethod(tp.method) ?? p.method;
  const approvedAt = parseTossDate(tp.approvedAt);
  const common: Prisma.PaymentUpdateInput = {
    method,
    suppliedAmount: tp.suppliedAmount ?? p.suppliedAmount,
    vat: tp.vat ?? p.vat,
    taxFreeAmount: tp.taxFreeAmount ?? p.taxFreeAmount,
    isPartialCancelable: tp.isPartialCancelable ?? p.isPartialCancelable,
    transferBankCode: tp.transfer?.bankCode ?? p.transferBankCode,
    receiptUrl: tp.receipt?.url && tp.receipt.url.startsWith("https://") ? tp.receipt.url : p.receiptUrl,
    lastTransactionKey: tp.lastTransactionKey ?? p.lastTransactionKey,
    requestedAt: parseTossDate(tp.requestedAt) ?? p.requestedAt,
    secretHash: tp.secret ? secretHashOf(tp.secret) : p.secretHash,
    syncedAt: now,
  };
  const status = (s: Payment["status"], extra: Prisma.PaymentUpdateInput = {}) =>
    tx.payment.update({ where: { id: p.id }, data: { ...common, ...extra, status: s, statusSource: source, statusChangedAt: now } });

  const open = p.status === "IN_PROGRESS" || p.status === "UNKNOWN";
  const approved = approvedAt !== null && ["DONE", "PARTIAL_CANCELED", "CANCELED"].includes(tp.status);
  if (approved && (p.status === "ABORTED" || p.status === "EXPIRED")) {
    // 토스는 승인했는데 우리는 실패·만료로 기록함 → 돈만 빠져나간 상태. 자동으로 덮지 말고 사람이 확인하도록 오류로 남김
    throw new PaymentMismatchError(`토스에서는 승인된 결제를 우리는 ${p.status}로 기록했습니다 (payment ${p.id}) — 수동 확인·환불 필요`);
  }

  // 1) 기본 상태 맞추기 (취소는 아래 3)에서 취소 행으로 반영 → 트리거가 상태를 바꿈)
  if (approved && (open || p.status === "WAITING_FOR_DEPOSIT")) {
    p = await status("DONE", { approvedAt });
  } else if ((tp.status === "WAITING_FOR_DEPOSIT" || (tp.status === "CANCELED" && !approved && method === "VIRTUAL_ACCOUNT")) && open) {
    p = await status("WAITING_FOR_DEPOSIT");
  } else if (tp.status === "ABORTED" && open) {
    p = await status("ABORTED", { failCode: tp.failure?.code ?? "ABORTED", failMessage: truncate(tp.failure?.message, 510), failedAt: now });
  } else if (tp.status === "EXPIRED" && (open || p.status === "WAITING_FOR_DEPOSIT")) {
    p = await status("EXPIRED", { expiredAt: now });
  } else {
    p = await tx.payment.update({ where: { id: p.id }, data: common });
  }

  // 2) 수단별 상세
  if (tp.card && (p.method === "CARD" || p.method === "EASY_PAY")) {
    const data = {
      issuerCode: tp.card.issuerCode,
      acquirerCode: tp.card.acquirerCode ?? null,
      numberMasked: tp.card.number,
      installmentPlanMonths: tp.card.installmentPlanMonths ?? 0,
      isInterestFree: tp.card.isInterestFree ?? false,
      interestPayer: tp.card.interestPayer ?? null,
      approveNo: tp.card.approveNo,
      cardType: CARD_TYPE[tp.card.cardType as keyof typeof CARD_TYPE] ?? "UNKNOWN",
      ownerType: OWNER_TYPE[tp.card.ownerType as keyof typeof OWNER_TYPE] ?? "UNKNOWN",
      acquireStatus: tp.card.acquireStatus ?? null,
      useCardPoint: tp.card.useCardPoint ?? false,
      amount: tp.card.amount,
    };
    // upsert는 SQLite에서 INSERT 트리거를 실행하므로 쓰지 않음 (있으면 수정, 없으면 추가)
    if (await tx.paymentCard.findUnique({ where: { paymentId: p.id } })) {
      await tx.paymentCard.update({ where: { paymentId: p.id }, data: { acquireStatus: data.acquireStatus } });
    } else {
      await tx.paymentCard.create({ data: { paymentId: p.id, ...data } });
    }
  }
  if (tp.easyPay && p.method === "EASY_PAY" && !(await tx.paymentEasyPay.findUnique({ where: { paymentId: p.id } }))) {
    await tx.paymentEasyPay.create({
      data: { paymentId: p.id, provider: tp.easyPay.provider, amount: tp.easyPay.amount ?? 0, discountAmount: tp.easyPay.discountAmount ?? 0 },
    });
  }
  if (tp.virtualAccount && p.method === "VIRTUAL_ACCOUNT") {
    const va = tp.virtualAccount;
    const existing = await tx.paymentVirtualAccount.findUnique({ where: { paymentId: p.id } });
    const mutable = {
      expired: va.expired ?? false,
      settlementStatus: va.settlementStatus ?? null,
      refundStatus: va.refundStatus ?? null,
      depositedAt: existing?.depositedAt ?? (approvedAt && approved ? approvedAt : null),
    };
    if (existing) {
      await tx.paymentVirtualAccount.update({ where: { paymentId: p.id }, data: mutable });
    } else {
      const dueDate = parseTossDate(va.dueDate);
      if (!dueDate) throw new PaymentMismatchError(`가상계좌 입금 기한 형식이 올바르지 않습니다: ${va.dueDate}`);
      await tx.paymentVirtualAccount.create({
        data: {
          paymentId: p.id,
          accountType: va.accountType === "고정" ? "FIXED" : "NORMAL",
          bankCode: va.bankCode,
          accountNumberEnc: encrypt(va.accountNumber),
          customerNameEnc: va.customerName ? encrypt(va.customerName) : null,
          dueDate,
          ...mutable,
        },
      });
    }
    // 결제창에서 받은 환불 계좌가 있으면 보관 (입금 후 재고가 없을 때 자동 환불에 사용)
    const rra = va.refundReceiveAccount;
    if (rra?.accountNumber && rra.holderName && (await tx.paymentRefundAccount.count({ where: { paymentId: p.id } })) === 0) {
      await tx.paymentRefundAccount.create({ data: refundAccountData(p.id, { bankCode: rra.bankCode, accountNumber: rra.accountNumber, holderName: rra.holderName }) });
    }
  }

  // 현금영수증
  const cr = tp.cashReceipt;
  if (cr?.receiptKey && (cr.type === "소득공제" || cr.type === "지출증빙") && !(await tx.cashReceipt.findUnique({ where: { receiptKey: cr.receiptKey } }))) {
    await tx.cashReceipt.create({
      data: {
        paymentId: p.id,
        type: cr.type === "소득공제" ? "INCOME_DEDUCTION" : "EXPENSE_PROOF",
        receiptKey: cr.receiptKey,
        issueNumber: cr.issueNumber ?? null,
        receiptUrl: cr.receiptUrl?.startsWith("https://") ? cr.receiptUrl : null,
        amount: cr.amount ?? p.amount,
        taxFreeAmount: cr.taxFreeAmount ?? 0,
        issuedAt: approvedAt ?? now,
      },
    });
  }

  // 3) 취소: 토스에 있는데 우리에게 없는 취소를 반영 (우리가 요청 중인 같은 금액의 취소가 있으면 그것을 완료로)
  const cancels = [...(tp.cancels ?? [])].filter((c) => !c.cancelStatus || c.cancelStatus === "DONE").sort((a, b) => a.canceledAt.localeCompare(b.canceledAt));
  for (const c of cancels) {
    if (await tx.paymentCancel.findUnique({ where: { transactionKey: c.transactionKey } })) continue;
    const canceledAt = parseTossDate(c.canceledAt) ?? now;
    const pending = await tx.paymentCancel.findFirst({
      where: { paymentId: p.id, status: { in: ["REQUESTED", "UNKNOWN"] }, cancelAmount: c.cancelAmount },
      orderBy: { id: "asc" },
    });
    if (pending) {
      await tx.paymentCancel.update({
        where: { id: pending.id },
        data: { status: "DONE", transactionKey: c.transactionKey, canceledAt, refundableAmountAfter: c.refundableAmount ?? null },
      });
    } else {
      await tx.paymentCancel.create({
        data: {
          paymentId: p.id,
          cancelAmount: c.cancelAmount,
          taxFreeAmount: c.taxFreeAmount ?? 0,
          reasonCode: "PG_SYNC",
          reasonText: (c.cancelReason ?? "").trim().slice(0, 200) || "토스에서 취소됨",
          requestedBy: "SYSTEM",
          status: "DONE",
          idempotencyKey: `pg-sync-${c.transactionKey}`,
          transactionKey: c.transactionKey,
          refundableAmountAfter: c.refundableAmount ?? null,
          requestedAt: canceledAt,
          canceledAt,
        },
      });
    }
  }
  await wipeUsedRefundAccounts(tx, p.id, now);
  return tx.payment.findUniqueOrThrow({ where: { id: p.id } });
}

function refundAccountData(paymentId: number, a: { bankCode: string; accountNumber: string; holderName: string }) {
  return {
    paymentId,
    bankCode: a.bankCode,
    accountNumberEnc: encrypt(a.accountNumber),
    accountNumberMasked: maskAccountNumber(a.accountNumber),
    holderNameEnc: encrypt(a.holderName),
    holderNameMasked: maskName(a.holderName),
  };
}

/** 환불이 끝난(취소 DONE) 환불 계좌는 암호문을 파기하고 가린 값만 남김 */
async function wipeUsedRefundAccounts(tx: Tx, paymentId: number, now: Date) {
  await tx.paymentRefundAccount.updateMany({
    where: { paymentId, accountNumberEnc: { not: null }, cancels: { some: { status: "DONE" } } },
    data: { accountNumberEnc: null, holderNameEnc: null, wipedAt: now },
  });
}

// ---------------------------------------------------------------
// 결제 상태 → 주문·재고 반영
// ---------------------------------------------------------------
export type SettleResult =
  | { kind: "PAID" }
  | { kind: "WAITING_DEPOSIT" }
  | { kind: "PROCESSING" }
  | { kind: "FAILED"; code: string; message?: string }
  | { kind: "CANCELED" };

/**
 * 결제 상태를 보고 주문·재고를 맞춥니다. 여러 번 불러도 안전합니다 (이미 반영된 것은 건너뜀).
 *  DONE        → 주문 결제 완료 + 재고 확정 (실패하면 결제 취소 = 보상)
 *  WAITING     → 재고 예약을 입금 기한까지 연장 + 주문 입금 대기
 *  ABORTED·EXPIRED → 재고 해제 + 주문 취소/만료
 *  CANCELED(전액) → 주문 취소 + 재고 해제
 */
export async function settleOrder(paymentId: number, deps: PaymentDeps = defaultPaymentDeps): Promise<SettleResult> {
  const now = deps.now();
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { order: true, virtualAccount: true } });
  const order = payment.order;

  switch (payment.status) {
    case "IN_PROGRESS":
    case "UNKNOWN":
      return { kind: "PROCESSING" };

    case "WAITING_FOR_DEPOSIT": {
      if (order.status === "WAITING_DEPOSIT") return { kind: "WAITING_DEPOSIT" };
      if (order.status !== "PENDING") return { kind: "FAILED", code: "ORDER_CLOSED" };
      const due = payment.virtualAccount?.dueDate;
      if (!due) throw new PaymentError(`가상계좌 정보가 없습니다 (payment ${payment.id})`);
      try {
        await withBusyRetry(() =>
          prisma.$transaction(async (tx) => {
            // 입금 기한 + 1시간까지 재고를 잡아 둠 (예약 만료 시각은 바꿀 수 없으므로 풀고 다시 잡음)
            await ensureReservedTx(tx, order.id, now, { expiresAt: new Date(due.getTime() + VA_RESERVATION_GRACE_MS) });
            await tx.order.update({ where: { id: order.id }, data: { status: "WAITING_DEPOSIT" } });
          }),
        );
        return { kind: "WAITING_DEPOSIT" };
      } catch (e) {
        if (!(e instanceof InsufficientStockError)) throw e;
        // 계좌는 발급됐지만 재고가 없음 → 입금 전이므로 가상계좌를 취소 (환불 계좌 불필요)
        await requestPaymentCancel(payment.id, { reasonCode: "OUT_OF_STOCK", reasonText: "재고 소진으로 가상계좌 발급 취소", requestedBy: "SYSTEM" }, deps);
        return { kind: "FAILED", code: "OUT_OF_STOCK" };
      }
    }

    case "DONE":
    case "PARTIAL_CANCELED": {
      if (order.status === "PAID") return { kind: "PAID" };
      if (order.status === "CANCEL_FAILED") return { kind: "FAILED", code: "ORDER_ERROR_REFUND_PENDING" };
      try {
        // 이미 닫힌 주문(취소·만료)인데 결제가 완료됨 → 주문을 살리지 않고 환불 (아래 보상으로)
        if (order.status !== "PENDING" && order.status !== "WAITING_DEPOSIT") throw new PaymentError(`닫힌 주문(${order.status})의 결제가 완료됨`);
        await withBusyRetry(() => prisma.$transaction((tx) => deps.finalizeOrder(tx, order, payment, now)));
        return { kind: "PAID" };
      } catch (error) {
        // 돈은 결제됐는데 주문을 완료하지 못함 → 결제 취소(보상). 실패하면 사람이 확인하도록 CANCEL_FAILED
        const outOfStock = error instanceof InsufficientStockError;
        console.error(`[결제 보상] 주문 ${order.id} 완료 처리 실패 → 결제 취소 시도`, error);
        const refundAccount = await prisma.paymentRefundAccount.findFirst({ where: { paymentId: payment.id, accountNumberEnc: { not: null } }, orderBy: { id: "desc" } });
        const needsAccount = payment.method === "VIRTUAL_ACCOUNT";
        const cancel =
          needsAccount && !refundAccount
            ? { status: "FAILED" as const, message: "환불 계좌가 없어 자동 환불할 수 없습니다" }
            : await requestPaymentCancel(
                payment.id,
                {
                  reasonCode: outOfStock ? "OUT_OF_STOCK" : "ORDER_ERROR",
                  reasonText: outOfStock ? "재고 소진으로 자동 취소" : "주문 처리 오류로 자동 취소",
                  requestedBy: "SYSTEM",
                  existingRefundAccountId: refundAccount?.id,
                },
                deps,
              );
        if (cancel.status === "DONE") return { kind: "FAILED", code: outOfStock ? "OUT_OF_STOCK" : "ORDER_ERROR_REFUNDED" };
        await withBusyRetry(() =>
          prisma.$transaction(async (tx) => {
            await releaseOrder(tx, order.id, "COMPENSATED", now);
            const fresh = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
            if (fresh.status !== "CANCEL_FAILED" && fresh.status !== "CANCELED") {
              await tx.order.update({ where: { id: order.id }, data: { status: "CANCEL_FAILED" } });
            }
          }),
        );
        console.error(`[결제 보상 실패] 주문 ${order.id} — 수동 환불 필요`, cancel);
        return { kind: "FAILED", code: "ORDER_ERROR_REFUND_PENDING" };
      }
    }

    case "ABORTED":
    case "EXPIRED": {
      const reason = payment.status === "EXPIRED" && order.status === "WAITING_DEPOSIT" ? "DEPOSIT_EXPIRED" : "PAYMENT_FAILED";
      await closeOrderIfNoLivePayment(order.id, payment.status === "EXPIRED" && order.status === "WAITING_DEPOSIT" ? "EXPIRED" : "CANCELED", reason, now);
      return { kind: "FAILED", code: payment.failCode ?? (payment.status === "EXPIRED" ? "EXPIRED" : "ABORTED"), message: payment.failMessage ?? undefined };
    }

    case "CANCELED": {
      if (order.status === "PAID") {
        // 결제 완료 후 전액 취소: 재고 되돌리기(반품 입고)는 ⑩ 클레임 단계에서. 여기서는 주문 상태만
        await withBusyRetry(() => prisma.order.update({ where: { id: order.id }, data: { status: "CANCELED", canceledAt: payment.canceledAt ?? now } }));
      } else {
        await closeOrderIfNoLivePayment(order.id, "CANCELED", order.status === "CANCEL_FAILED" || payment.approvedAt ? "COMPENSATED" : "ORDER_CANCELED", now);
      }
      return { kind: "CANCELED" };
    }
  }
}

/** 돈이 걸린 결제가 없으면 주문을 닫고(취소·만료) 재고 예약을 풂 */
async function closeOrderIfNoLivePayment(orderId: number, to: "CANCELED" | "EXPIRED", reason: "PAYMENT_FAILED" | "DEPOSIT_EXPIRED" | "ORDER_CANCELED" | "COMPENSATED" | "SUPERSEDED" | "PRICE_CHANGED", now: Date) {
  await withBusyRetry(() =>
    prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      const live = await tx.payment.count({ where: { orderId, status: { in: ["IN_PROGRESS", "UNKNOWN", "WAITING_FOR_DEPOSIT", "DONE", "PARTIAL_CANCELED"] } } });
      if (live > 0) return;
      await releaseOrder(tx, orderId, reason, now);
      if (["PENDING", "WAITING_DEPOSIT", "CANCEL_FAILED"].includes(order.status)) {
        const target = to === "EXPIRED" && order.status !== "WAITING_DEPOSIT" ? "CANCELED" : to;
        await tx.order.update({ where: { id: orderId }, data: { status: target, canceledAt: now } });
      }
    }),
  );
}

// ---------------------------------------------------------------
// 결제 승인 (successUrl)
// ---------------------------------------------------------------
export type ConfirmInput = { customerId: number; paymentOrderId: unknown; paymentKey: unknown; amount: unknown };
export type ConfirmOutcome =
  | { kind: "PAID"; orderId: number }
  | { kind: "WAITING_DEPOSIT"; orderId: number }
  | { kind: "PROCESSING"; orderId: number }
  | { kind: "FAILED"; code: string; orderId?: number };

const PG_ORDER_ID = /^[A-Za-z0-9_=-]{6,64}$/;

function toOutcome(orderId: number, s: SettleResult): ConfirmOutcome {
  if (s.kind === "PAID" || s.kind === "WAITING_DEPOSIT" || s.kind === "PROCESSING") return { kind: s.kind, orderId };
  if (s.kind === "CANCELED") return { kind: "FAILED", code: "ORDER_CLOSED", orderId };
  return { kind: "FAILED", code: s.code, orderId };
}

/** 주문의 현재 상태로 결과를 돌려줌 (새로고침·뒤로 가기·동시 요청) */
async function outcomeFromState(orderId: number): Promise<ConfirmOutcome> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.status === "PAID") return { kind: "PAID", orderId };
  if (order.status === "WAITING_DEPOSIT") return { kind: "WAITING_DEPOSIT", orderId };
  if (order.status === "CANCEL_FAILED") return { kind: "FAILED", code: "ORDER_ERROR_REFUND_PENDING", orderId };
  const latest = await prisma.payment.findFirst({ where: { orderId }, orderBy: { attemptNo: "desc" } });
  if (latest && (latest.status === "IN_PROGRESS" || latest.status === "UNKNOWN")) return { kind: "PROCESSING", orderId };
  if (latest?.status === "CANCELED" && latest.approvedAt) return { kind: "FAILED", code: "ORDER_ERROR_REFUNDED", orderId };
  if (latest?.failCode) return { kind: "FAILED", code: latest.failCode, orderId };
  return { kind: "FAILED", code: "ORDER_CLOSED", orderId };
}

export async function confirmOrderPayment(input: ConfirmInput, deps: PaymentDeps = defaultPaymentDeps): Promise<ConfirmOutcome> {
  // ① 입력 검사 (주소창 값은 누구나 바꿀 수 있음)
  const { paymentKey, paymentOrderId } = input;
  const amountText = typeof input.amount === "number" ? String(input.amount) : input.amount;
  if (
    typeof paymentKey !== "string" || paymentKey.length < 1 || paymentKey.length > 200 ||
    typeof paymentOrderId !== "string" || !PG_ORDER_ID.test(paymentOrderId) ||
    typeof amountText !== "string" || !/^[1-9][0-9]{0,11}$/.test(amountText)
  ) {
    return { kind: "FAILED", code: "INVALID_REQUEST" };
  }
  const amount = Number(amountText);

  // ② 주문 확인 (내 주문만)
  const order = await prisma.order.findUnique({ where: { paymentOrderId } });
  if (!order || order.customerId !== input.customerId) return { kind: "FAILED", code: "ORDER_NOT_FOUND" };

  // 이미 이 결제 키로 처리한 적 있음 (새로고침·뒤로 가기) → 토스를 다시 부르지 않음
  const same = await prisma.payment.findUnique({ where: { paymentKey } });
  if (same) {
    if (same.orderId !== order.id) return { kind: "FAILED", code: "INVALID_REQUEST" };
    // 다른 요청(탭·연타)이 지금 승인 중이면 잠깐 기다렸다가 그 결과를 보여 줌 (바로 "확인 중" 화면으로 보내지 않음)
    if (same.status === "IN_PROGRESS") return waitForOther(order.id, deps);
    return outcomeFromState(order.id);
  }
  if (order.status !== "PENDING") return outcomeFromState(order.id);

  const now = deps.now();

  // 금액 위조: 토스를 부르지 않고 실패 기록 + 재고 해제 (결제 인증은 10분 뒤 자동 만료 → 돈이 나가지 않음)
  if (amount !== order.totalPrice) {
    await recordAbortedAttempt(order, { paymentKey, failCode: "AMOUNT_MISMATCH", failMessage: `요청 금액 ${amount}원 ≠ 주문 금액 ${order.totalPrice}원`, source: "CONFIRM" }, now);
    await closeOrderIfNoLivePayment(order.id, "CANCELED", "PAYMENT_FAILED", now);
    return { kind: "FAILED", code: "AMOUNT_MISMATCH", orderId: order.id };
  }

  // ③ 승인 권한 선점: Payment(IN_PROGRESS)를 먼저 만든 요청만 토스를 호출 (동시 요청은 트리거가 막음)
  let payment: Payment;
  try {
    payment = await withBusyRetry(() =>
      prisma.$transaction(async (tx) => {
        const last = await tx.payment.findFirst({ where: { orderId: order.id }, orderBy: { attemptNo: "desc" }, select: { attemptNo: true } });
        return tx.payment.create({
          data: {
            orderId: order.id,
            attemptNo: (last?.attemptNo ?? 0) + 1,
            pgOrderId: order.paymentOrderId,
            paymentKey,
            status: "IN_PROGRESS",
            amount: order.totalPrice,
            balanceAmount: order.totalPrice,
            confirmIdempotencyKey: `confirm-${randomUUID()}`,
            statusSource: "CONFIRM",
            statusChangedAt: now,
          },
        });
      }),
    );
  } catch (e) {
    if (isConstraintError(e, "Payment_one_active") || isConstraintError(e, "paymentKey") || isConstraintError(e, "Payment_order_pending") || isConstraintError(e, "Payment_insert_guard")) {
      // 다른 요청(탭·새로고침)이 이미 처리 중 → 잠깐 기다렸다가 그 결과를 보여 줌
      return waitForOther(order.id, deps);
    }
    throw e;
  }

  // ④ 재고 확인: 없으면 토스를 부르지 않음 (고객 돈이 나가지 않음)
  const reserved = await ensureOrderReserved(order.id, now);
  if (!reserved.ok) {
    await markAborted(payment.id, "OUT_OF_STOCK", reserved.message, "CONFIRM", now);
    await closeOrderIfNoLivePayment(order.id, "CANCELED", "PAYMENT_FAILED", now);
    return { kind: "FAILED", code: "OUT_OF_STOCK", orderId: order.id };
  }

  // ⑤ 토스 승인 → ⑥⑦
  const result = await deps.toss.confirm({ paymentKey, orderId: order.paymentOrderId, amount: order.totalPrice }, payment.confirmIdempotencyKey!, { paymentId: payment.id, orderId: order.id });
  return handleConfirmResult(payment.id, result, "CONFIRM", deps, true);
}

/** 승인 요청 결과 처리 (처음 승인·대사 재시도 공통) */
async function handleConfirmResult(paymentId: number, result: TossResult, source: PaymentStatusSource, deps: PaymentDeps, quickRecheck: boolean): Promise<ConfirmOutcome> {
  const now = deps.now();
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

  if (result.kind === "ok") return syncAndSettle(paymentId, result.data, source, deps);

  if (result.kind === "fail") {
    // 이미 처리된 결제: 다른 요청이 승인했을 수 있음 → 실패로 단정하지 말고 토스에 물어봄
    if (result.code === "ALREADY_PROCESSED_PAYMENT" || result.code === "ALREADY_PROCESSING_REQUEST") {
      return recheckWithToss(paymentId, source, deps, false);
    }
    await markAborted(paymentId, result.code, result.message, source, now);
    const settled = await settleOrder(paymentId, deps);
    return toOutcome(payment.orderId, settled);
  }

  // 결과 모름 (시간 초과·연결 실패·토스 5xx): 실패로 단정하지 않음
  await withBusyRetry(() =>
    prisma.payment.updateMany({ where: { id: paymentId, status: "IN_PROGRESS" }, data: { status: "UNKNOWN", statusSource: source, statusChangedAt: now } }),
  );
  if (quickRecheck) return recheckWithToss(paymentId, source, deps, true);
  return { kind: "PROCESSING", orderId: payment.orderId };
}

async function syncAndSettle(paymentId: number, tp: TossPayment, source: PaymentStatusSource, deps: PaymentDeps): Promise<ConfirmOutcome> {
  const now = deps.now();
  const payment = await withBusyRetry(() => prisma.$transaction((tx) => applyTossPayment(tx, paymentId, tp, source, now)));
  return toOutcome(payment.orderId, await settleOrder(paymentId, deps));
}

/**
 * 토스에 결제 상태를 물어서 확정 (응답을 못 받았거나 "이미 처리됨"일 때)
 * 토스에서 아직 승인 전(IN_PROGRESS)이고 10분 안이면 승인을 다시 요청 (멱등키는 confirmKeyFor 참고)
 */
/**
 * 승인 재요청에 쓸 멱등키.
 *  - 응답을 못 받은 경우(시간 초과·연결 실패): 같은 키 → 토스가 이미 처리했다면 그 결과를 그대로 받음
 *  - 토스가 5xx 오류로 "응답한" 경우: 토스는 오류 응답도 멱등키에 저장해 같은 키로는 계속 같은 오류만 돌려줌
 *    (실제 토스 테스트 서버에서 확인) → 새 키(기본키-r1, -r2 …). 직전에 토스 조회로 "승인 전"임을 확인했고,
 *    한 결제 키는 토스에서 한 번만 승인되므로 새 키로 다시 요청해도 두 번 승인되지 않음
 */
async function confirmKeyFor(payment: Payment) {
  const answered5xx = await prisma.paymentApiLog.count({ where: { paymentId: payment.id, operation: "CONFIRM", httpStatus: { gte: 500 } } });
  return answered5xx === 0 ? payment.confirmIdempotencyKey! : `${payment.confirmIdempotencyKey}-r${answered5xx}`;
}

async function recheckWithToss(paymentId: number, source: PaymentStatusSource, deps: PaymentDeps, allowRetryConfirm: boolean): Promise<ConfirmOutcome> {
  const now = deps.now();
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const got = await deps.toss.getPayment(payment.paymentKey!, { paymentId, orderId: payment.orderId });

  if (got.kind === "ok") {
    const tp = got.data;
    if ((tp.status === "IN_PROGRESS" || tp.status === "READY") && allowRetryConfirm && now.getTime() - payment.createdAt.getTime() < CONFIRM_WINDOW_MS) {
      await withBusyRetry(() =>
        prisma.payment.updateMany({ where: { id: paymentId, status: "UNKNOWN" }, data: { status: "IN_PROGRESS", statusSource: source, statusChangedAt: now } }),
      );
      const retried = await deps.toss.confirm({ paymentKey: payment.paymentKey!, orderId: payment.pgOrderId, amount: payment.amount }, await confirmKeyFor(payment), { paymentId, orderId: payment.orderId });
      return handleConfirmResult(paymentId, retried, source, deps, false);
    }
    if (tp.status === "IN_PROGRESS" || tp.status === "READY") {
      if (now.getTime() - payment.createdAt.getTime() >= CONFIRM_WINDOW_MS) {
        // 승인 가능 시간이 지남 → 토스에서 만료됨. 우리도 만료 처리하고 재고 해제
        await withBusyRetry(() =>
          prisma.payment.updateMany({ where: { id: paymentId, status: { in: ["IN_PROGRESS", "UNKNOWN"] } }, data: { status: "EXPIRED", expiredAt: now, statusSource: source, statusChangedAt: now } }),
        );
        return toOutcome(payment.orderId, await settleOrder(paymentId, deps));
      }
      return { kind: "PROCESSING", orderId: payment.orderId };
    }
    return syncAndSettle(paymentId, tp, source, deps);
  }
  if (got.kind === "fail" && got.code === "NOT_FOUND_PAYMENT") {
    await markAborted(paymentId, "NOT_FOUND_PAYMENT", got.message, source, now);
    return toOutcome(payment.orderId, await settleOrder(paymentId, deps));
  }
  // 조회도 실패 → 결과 모름 유지, 정기 작업이 다시 확인
  await withBusyRetry(() =>
    prisma.payment.updateMany({ where: { id: paymentId, status: "IN_PROGRESS" }, data: { status: "UNKNOWN", statusSource: source, statusChangedAt: now } }),
  );
  return { kind: "PROCESSING", orderId: payment.orderId };
}

async function markAborted(paymentId: number, failCode: string, failMessage: string | null, source: PaymentStatusSource, now: Date) {
  await withBusyRetry(() =>
    prisma.payment.updateMany({
      where: { id: paymentId, status: { in: ["IN_PROGRESS", "UNKNOWN"] } },
      data: { status: "ABORTED", failCode: failCode.slice(0, 100), failMessage: truncate(failMessage, 510), failedAt: now, statusSource: source, statusChangedAt: now },
    }),
  );
}

async function recordAbortedAttempt(order: Order, a: { paymentKey: string | null; failCode: string; failMessage: string | null; source: PaymentStatusSource }, now: Date) {
  try {
    await withBusyRetry(() =>
      prisma.$transaction(async (tx) => {
        const last = await tx.payment.findFirst({ where: { orderId: order.id }, orderBy: { attemptNo: "desc" }, select: { attemptNo: true } });
        await tx.payment.create({
          data: {
            orderId: order.id,
            attemptNo: (last?.attemptNo ?? 0) + 1,
            pgOrderId: order.paymentOrderId,
            paymentKey: a.paymentKey,
            status: "ABORTED",
            amount: order.totalPrice,
            balanceAmount: order.totalPrice,
            failCode: a.failCode.slice(0, 100),
            failMessage: truncate(a.failMessage, 510),
            failedAt: now,
            statusSource: a.source,
            statusChangedAt: now,
          },
        });
      }),
    );
  } catch (e) {
    // 같은 결제 키로 이미 기록됨(중복 요청) 등 → 기록은 부가 정보이므로 결제 흐름을 막지 않음
    console.error("[결제 실패 기록 실패]", e);
  }
}

/** 동시에 들어온 다른 요청의 결과를 잠깐 기다림 */
async function waitForOther(orderId: number, deps: PaymentDeps): Promise<ConfirmOutcome> {
  const until = Date.now() + deps.waitForOtherMs;
  for (;;) {
    const outcome = await outcomeFromState(orderId);
    if (outcome.kind !== "PROCESSING" || Date.now() >= until) return outcome;
    await new Promise((r) => setTimeout(r, 200));
  }
}

// ---------------------------------------------------------------
// 결제창 실패·취소 (failUrl), 결제 진행 안 함
// ---------------------------------------------------------------
const FAIL_CODE = /^[A-Z0-9_]{1,64}$/;

/**
 * 결제창에서 실패·취소: 시도 기록(ABORTED) + 재고 해제 + 주문 취소.
 * 토스는 결제창 취소(PAY_PROCESS_CANCELED·ABORTED)일 때 주문번호를 보내 주지 않으므로,
 * 그때는 이 고객의 "가장 최근 결제 대기 주문"(30분 이내, 진행 중 결제 없음)을 대상으로 합니다.
 */
export async function recordCheckoutFailure(
  customerId: number,
  input: { paymentOrderId?: unknown; code?: unknown; message?: unknown },
  now = new Date(),
): Promise<{ code: string; orderId: number | null }> {
  const code = typeof input.code === "string" && FAIL_CODE.test(input.code) ? input.code : "PAY_PROCESS_ABORTED";
  const message = typeof input.message === "string" ? input.message.slice(0, 510) : null;
  let order: Order | null = null;
  if (typeof input.paymentOrderId === "string" && PG_ORDER_ID.test(input.paymentOrderId)) {
    order = await prisma.order.findUnique({ where: { paymentOrderId: input.paymentOrderId } });
    if (order && order.customerId !== customerId) order = null;
  } else {
    order = await prisma.order.findFirst({
      where: {
        customerId,
        status: "PENDING",
        createdAt: { gte: new Date(now.getTime() - 30 * 60 * 1000) },
        payments: { none: { status: { in: ["IN_PROGRESS", "UNKNOWN", "WAITING_FOR_DEPOSIT", "DONE", "PARTIAL_CANCELED"] } } },
      },
      orderBy: { id: "desc" },
    });
  }
  if (!order || order.status !== "PENDING") return { code, orderId: order?.id ?? null };
  const live = await prisma.payment.count({ where: { orderId: order.id, status: { in: ["IN_PROGRESS", "UNKNOWN", "WAITING_FOR_DEPOSIT", "DONE", "PARTIAL_CANCELED"] } } });
  if (live > 0) return { code, orderId: order.id }; // 다른 탭에서 결제가 진행 중이면 건드리지 않음
  await recordAbortedAttempt(order, { paymentKey: null, failCode: code, failMessage: message, source: "WINDOW" }, now);
  await closeOrderIfNoLivePayment(order.id, "CANCELED", "PAYMENT_FAILED", now);
  return { code, orderId: order.id };
}

/** 결제를 진행하지 않기로 한 주문 정리 (가격 변경으로 중단, 결제창 띄우기 실패) */
export async function abandonOrder(customerId: number, paymentOrderId: string, reason: "PRICE_CHANGED" | "PAYMENT_FAILED", now = new Date(), windowCode?: string) {
  const order = await prisma.order.findUnique({ where: { paymentOrderId } });
  if (!order || order.customerId !== customerId || order.status !== "PENDING") return false;
  const live = await prisma.payment.count({ where: { orderId: order.id, status: { in: ["IN_PROGRESS", "UNKNOWN", "WAITING_FOR_DEPOSIT", "DONE", "PARTIAL_CANCELED"] } } });
  if (live > 0) return false;
  // 결제창을 닫음(PC 팝업은 failUrl 대신 브라우저에서 오류로 끝남) → failUrl 경우와 똑같이 시도를 기록 (이탈 통계·CS 확인용)
  if (reason === "PAYMENT_FAILED") {
    const code = windowCode && FAIL_CODE.test(windowCode) ? windowCode : "PAY_PROCESS_ABORTED";
    await recordAbortedAttempt(order, { paymentKey: null, failCode: code, failMessage: "결제창에서 결제를 마치지 않음", source: "WINDOW" }, now);
  }
  await closeOrderIfNoLivePayment(order.id, "CANCELED", reason, now);
  return true;
}

// ---------------------------------------------------------------
// 결제 취소 (부분·전체)
// ---------------------------------------------------------------
export type CancelRequest = {
  amount?: number; // 없으면 남은 금액 전부
  reasonCode: PaymentCancelReason;
  reasonText: string;
  requestedBy: PaymentActor;
  requestedByRef?: string;
  refundAccount?: { bankCode: string; accountNumber: string; holderName: string }; // 입금된 가상계좌 환불용
  existingRefundAccountId?: number;
};
export type CancelOutcome = { status: "DONE" | "FAILED" | "UNKNOWN"; cancelId?: number; code?: string; message?: string };

export async function requestPaymentCancel(paymentId: number, req: CancelRequest, deps: PaymentDeps = defaultPaymentDeps): Promise<CancelOutcome> {
  const now = deps.now();
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const amount = req.amount ?? payment.balanceAmount;
  const reasonText = req.reasonText.trim().slice(0, 200);
  if (!Number.isInteger(amount) || amount < 1) throw new PaymentError("취소 금액이 올바르지 않습니다");
  if (!reasonText) throw new PaymentError("취소 사유가 필요합니다");
  if (!payment.paymentKey) throw new PaymentError("결제 키가 없는 결제는 취소할 수 없습니다");

  let cancelId: number;
  try {
    cancelId = await withBusyRetry(() =>
      prisma.$transaction(async (tx) => {
        let refundAccountId = req.existingRefundAccountId ?? null;
        if (req.refundAccount) {
          refundAccountId = (await tx.paymentRefundAccount.create({ data: refundAccountData(paymentId, req.refundAccount) })).id;
        }
        const c = await tx.paymentCancel.create({
          data: {
            paymentId,
            cancelAmount: amount,
            reasonCode: req.reasonCode,
            reasonText,
            requestedBy: req.requestedBy,
            requestedByRef: req.requestedByRef ?? null,
            status: "REQUESTED",
            idempotencyKey: `cancel-${randomUUID()}`,
            refundAccountId,
            requestedAt: now,
          },
        });
        return c.id;
      }),
    );
  } catch (e) {
    for (const [name, message] of [
      ["PaymentCancel_exceeds", "취소 금액이 남은 결제 금액보다 많아요."],
      ["PaymentCancel_payment_state", "취소할 수 있는 결제 상태가 아니에요."],
      ["PaymentCancel_waiting_deposit", "입금 전 가상계좌는 전액 취소만 할 수 있어요."],
      ["PaymentCancel_refund_account", "입금된 가상계좌 결제는 환불 계좌가 필요해요."],
    ] as const) {
      if (isConstraintError(e, name)) throw new PaymentError(message);
    }
    throw e;
  }
  return sendCancel(cancelId, deps);
}

/** 취소 요청을 토스에 보냄 (처음·재시도 공통. 같은 멱등키라 두 번 취소되지 않음) */
/** 취소 멱등키: 토스가 5xx로 응답한 적이 있으면(그 오류가 키에 저장됨) 새 키. 재시도 전에 반드시 토스 조회로 미처리 확인 (retryOpenCancels) */
async function cancelKeyFor(baseKey: string) {
  const answered5xx = await prisma.paymentApiLog.count({ where: { operation: "CANCEL", httpStatus: { gte: 500 }, idempotencyKey: { startsWith: baseKey } } });
  return answered5xx === 0 ? baseKey : `${baseKey}-r${answered5xx}`;
}

async function sendCancel(cancelId: number, deps: PaymentDeps): Promise<CancelOutcome> {
  const now = deps.now();
  const c = await prisma.paymentCancel.findUniqueOrThrow({ where: { id: cancelId }, include: { payment: true, refundAccount: true } });
  const payment = c.payment;
  // 전액 취소면 금액을 보내지 않음 (토스 권장). 부분 취소면 금액 지정
  const doneSum = await prisma.paymentCancel.aggregate({ where: { paymentId: payment.id, status: "DONE", id: { not: c.id } }, _sum: { cancelAmount: true } });
  const remainingBefore = payment.amount - (doneSum._sum.cancelAmount ?? 0);
  const isFull = c.cancelAmount === remainingBefore;
  const ra = c.refundAccount;
  const result = await deps.toss.cancel(
    payment.paymentKey!,
    {
      cancelReason: c.reasonText,
      ...(isFull ? {} : { cancelAmount: c.cancelAmount }),
      ...(c.taxFreeAmount ? { taxFreeAmount: c.taxFreeAmount } : {}),
      ...(ra && ra.accountNumberEnc && ra.holderNameEnc
        ? { refundReceiveAccount: { bank: ra.bankCode, accountNumber: decrypt(ra.accountNumberEnc), holderName: decrypt(ra.holderNameEnc) } }
        : {}),
    },
    await cancelKeyFor(c.idempotencyKey),
    { paymentId: payment.id, orderId: payment.orderId },
  );

  if (result.kind === "ok") {
    const tp = result.data;
    await withBusyRetry(() =>
      prisma.$transaction(async (tx) => {
        const fresh = await tx.paymentCancel.findUniqueOrThrow({ where: { id: c.id } });
        if (fresh.status !== "DONE") {
          // 응답의 취소 목록에서 아직 우리 DB에 없는 같은 금액의 취소 = 이번 취소 (가장 최근 것)
          const known = new Set((await tx.paymentCancel.findMany({ where: { paymentId: payment.id, transactionKey: { not: null } }, select: { transactionKey: true } })).map((x) => x.transactionKey));
          const mine = [...(tp.cancels ?? [])].reverse().find((x) => !known.has(x.transactionKey) && x.cancelAmount === c.cancelAmount);
          if (!mine) throw new PaymentError(`토스 취소 응답에서 이번 취소를 찾지 못했습니다 (cancel ${c.id})`);
          await tx.paymentCancel.update({
            where: { id: c.id },
            data: { status: "DONE", transactionKey: mine.transactionKey, canceledAt: parseTossDate(mine.canceledAt) ?? now, refundableAmountAfter: mine.refundableAmount ?? null },
          });
        }
        await applyTossPayment(tx, payment.id, tp, "CANCEL", now);
      }),
    );
    await settleOrder(payment.id, deps);
    return { status: "DONE", cancelId: c.id };
  }
  if (result.kind === "fail") {
    if (result.code === "ALREADY_CANCELED_PAYMENT") {
      // 이미 토스에서 취소됨 → 조회해서 맞춤 (이번 요청 행은 그 취소로 채워짐)
      await syncFromToss(payment.id, "CANCEL", deps);
      const fresh = await prisma.paymentCancel.findUniqueOrThrow({ where: { id: c.id } });
      if (fresh.status === "DONE") return { status: "DONE", cancelId: c.id };
    }
    await withBusyRetry(() =>
      prisma.paymentCancel.updateMany({
        where: { id: c.id, status: { in: ["REQUESTED", "UNKNOWN"] } },
        data: { status: "FAILED", failCode: result.code.slice(0, 100), failMessage: truncate(result.message, 510) },
      }),
    );
    return { status: "FAILED", cancelId: c.id, code: result.code, message: result.message };
  }
  await withBusyRetry(() => prisma.paymentCancel.updateMany({ where: { id: c.id, status: "REQUESTED" }, data: { status: "UNKNOWN" } }));
  return { status: "UNKNOWN", cancelId: c.id, code: result.code, message: result.message };
}

/** 토스 조회 결과로 우리 결제를 맞추고 주문까지 반영 */
export async function syncFromToss(paymentId: number, source: PaymentStatusSource, deps: PaymentDeps = defaultPaymentDeps): Promise<SettleResult | null> {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (!payment.paymentKey) return null;
  const got = await deps.toss.getPayment(payment.paymentKey, { paymentId, orderId: payment.orderId });
  if (got.kind !== "ok") return null;
  const now = deps.now();
  await withBusyRetry(() => prisma.$transaction((tx) => applyTossPayment(tx, paymentId, got.data, source, now)));
  return settleOrder(paymentId, deps);
}

/** 고객: 입금 전 가상계좌 주문 취소. code는 화면 안내 문구를 고르는 데 씀 (lib/payment-labels.ts DEPOSIT_CANCEL_NOTICE) */
export type DepositCancelCode = "DONE" | "NOT_FOUND" | "NOT_WAITING" | "RESULT_PENDING" | "ALREADY_DEPOSITED" | "FAILED";
export async function cancelWaitingDepositOrder(customerId: number, orderId: number, deps: PaymentDeps = defaultPaymentDeps): Promise<DepositCancelCode> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.customerId !== customerId) return "NOT_FOUND";
  if (order.status !== "WAITING_DEPOSIT") return "NOT_WAITING";
  const payment = await prisma.payment.findFirst({ where: { orderId, status: "WAITING_FOR_DEPOSIT" } });
  if (!payment) return "NOT_WAITING";
  try {
    const r = await requestPaymentCancel(payment.id, { reasonCode: "CUSTOMER_REQUEST", reasonText: "고객 요청: 입금 전 주문 취소", requestedBy: "CUSTOMER", requestedByRef: String(customerId) }, deps);
    if (r.status === "DONE") return "DONE";
    if (r.status === "UNKNOWN") return "RESULT_PENDING";
    // 그 사이 입금됨 등 → 토스 상태로 맞춘 뒤 안내
    await syncFromToss(payment.id, "CANCEL", deps);
    const fresh = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    return fresh.status === "DONE" ? "ALREADY_DEPOSITED" : "FAILED";
  } catch (e) {
    if (e instanceof PaymentError) return "FAILED";
    throw e;
  }
}

// ---------------------------------------------------------------
// 웹훅
// ---------------------------------------------------------------
type WebhookBody = { eventType?: string; createdAt?: string; data?: TossPayment; secret?: string; status?: string; transactionKey?: string; orderId?: string };

/**
 * 받자마자 저장(중복이면 무시) → 처리. 처리 중 오류가 나도 저장은 됐으므로 정기 작업이 다시 시도합니다.
 * 반환값은 HTTP 상태 (형식이 틀린 요청만 400, 나머지는 200 — 토스가 불필요하게 재전송하지 않도록)
 */
export async function receiveWebhook(
  rawBody: string,
  headers: { transmissionId?: string | null; retriedCount?: string | null },
  deps: PaymentDeps = defaultPaymentDeps,
): Promise<{ httpStatus: number; eventId?: number; duplicate?: boolean }> {
  if (rawBody.length > 100_000) return { httpStatus: 413 };
  let body: WebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { httpStatus: 400 };
  }
  if (!body || typeof body !== "object") return { httpStatus: 400 };

  const isDeposit = !body.eventType && typeof body.secret === "string" && typeof body.orderId === "string" && typeof body.status === "string";
  const eventType = isDeposit ? "DEPOSIT_CALLBACK" : typeof body.eventType === "string" ? body.eventType.slice(0, 64) : "UNKNOWN";
  const data = body.data;
  const paymentKey = eventType === "PAYMENT_STATUS_CHANGED" && typeof data?.paymentKey === "string" ? data.paymentKey.slice(0, 200) : null;
  const pgOrderId = (eventType === "PAYMENT_STATUS_CHANGED" ? data?.orderId : body.orderId) ?? null;
  const dedupKey =
    eventType === "PAYMENT_STATUS_CHANGED" && paymentKey
      ? `PSC:${paymentKey}:${data?.status}:${data?.lastTransactionKey ?? data?.approvedAt ?? ""}`
      : eventType === "DEPOSIT_CALLBACK"
        ? `DEP:${body.transactionKey ?? ""}:${body.status}:${body.createdAt ?? ""}`
        : `${eventType}:${createHash("sha256").update(rawBody).digest("hex")}`;

  // 가상계좌 입금 알림은 secret이 맞는지 먼저 확인 (원문 secret은 저장하지 않음)
  let secretOk: boolean | null = null;
  if (eventType === "DEPOSIT_CALLBACK" && typeof pgOrderId === "string") {
    const target = await prisma.payment.findFirst({ where: { pgOrderId, paymentKey: { not: null } }, orderBy: { attemptNo: "desc" } });
    secretOk = target?.secretHash ? target.secretHash === secretHashOf(body.secret!) : null;
  }

  const now = deps.now();
  let eventId: number;
  try {
    const ev = await withBusyRetry(() =>
      prisma.paymentWebhookEvent.create({
        data: {
          eventType,
          dedupKey: dedupKey.slice(0, 500),
          transmissionId: headers.transmissionId?.slice(0, 200) ?? null,
          retriedCount: Math.max(0, Number.parseInt(headers.retriedCount ?? "0", 10) || 0),
          paymentKey,
          pgOrderId: typeof pgOrderId === "string" ? pgOrderId.slice(0, 64) : null,
          payload: JSON.stringify(maskForLog(body)).slice(0, 100_000),
          status: secretOk === false ? "IGNORED" : "RECEIVED",
          lastError: secretOk === false ? "secret 불일치 (위조 의심)" : null,
          processedAt: secretOk === false ? now : null,
          receivedAt: now,
        },
      }),
    );
    eventId = ev.id;
  } catch (e) {
    if (isConstraintError(e, "dedupKey")) return { httpStatus: 200, duplicate: true };
    throw e;
  }
  if (secretOk === false) return { httpStatus: 200, eventId };
  await processWebhookEvent(eventId, deps);
  return { httpStatus: 200, eventId };
}

/** 저장된 웹훅 1건 처리: 우리 결제를 찾아 토스 조회 결과로 맞춤 (웹훅 내용 자체는 믿지 않음) */
export async function processWebhookEvent(eventId: number, deps: PaymentDeps = defaultPaymentDeps) {
  const ev = await prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { id: eventId } });
  if (ev.status === "PROCESSED" || ev.status === "IGNORED") return ev.status;
  const now = deps.now();
  const payment = ev.paymentKey
    ? await prisma.payment.findUnique({ where: { paymentKey: ev.paymentKey } })
    : ev.pgOrderId
      ? await prisma.payment.findFirst({ where: { pgOrderId: ev.pgOrderId, paymentKey: { not: null } }, orderBy: { attemptNo: "desc" } })
      : null;
  if (!payment || !["PAYMENT_STATUS_CHANGED", "DEPOSIT_CALLBACK"].includes(ev.eventType)) {
    await prisma.paymentWebhookEvent.update({ where: { id: ev.id }, data: { status: "IGNORED", processedAt: now, attempts: { increment: 1 }, lastError: payment ? "처리하지 않는 이벤트 종류" : "우리 결제가 아님" } });
    return "IGNORED";
  }
  try {
    const got = await deps.toss.getPayment(payment.paymentKey!, { paymentId: payment.id, orderId: payment.orderId });
    if (got.kind !== "ok") throw new Error(`토스 조회 실패: ${got.code} ${got.message}`);
    await withBusyRetry(() => prisma.$transaction((tx) => applyTossPayment(tx, payment.id, got.data, "WEBHOOK", now)));
    await settleOrder(payment.id, deps);
    await prisma.paymentWebhookEvent.update({ where: { id: ev.id }, data: { status: "PROCESSED", processedAt: now, paymentId: payment.id, attempts: { increment: 1 }, lastError: null } });
    return "PROCESSED";
  } catch (e) {
    await prisma.paymentWebhookEvent.update({
      where: { id: ev.id },
      data: { status: "FAILED", paymentId: payment.id, attempts: { increment: 1 }, lastError: (e instanceof Error ? e.message : String(e)).slice(0, 1000) },
    });
    console.error(`[웹훅 처리 실패] event ${ev.id}`, e);
    return "FAILED";
  }
}

// ---------------------------------------------------------------
// 정기 작업 (대사)
// ---------------------------------------------------------------
/** 결과를 모르는 결제(UNKNOWN, 오래된 IN_PROGRESS)를 토스에 물어 확정 */
export async function reconcileOpenPayments(deps: PaymentDeps = defaultPaymentDeps) {
  const now = deps.now();
  const targets = await prisma.payment.findMany({
    where: {
      OR: [{ status: "UNKNOWN" }, { status: "IN_PROGRESS", statusChangedAt: { lte: new Date(now.getTime() - STALE_IN_PROGRESS_MS) } }],
    },
    orderBy: { id: "asc" },
    take: 100,
  });
  let done = 0;
  for (const p of targets) {
    try {
      await recheckWithToss(p.id, "RECONCILE", deps, true);
      done++;
    } catch (e) {
      console.error(`[대사 실패] payment ${p.id}`, e);
    }
  }
  return done;
}

/** 입금 기한이 지난 가상계좌: 토스에 확인 → 입금됐으면 완료, 아니면 만료 + 재고 해제 */
export async function expireOverdueDeposits(deps: PaymentDeps = defaultPaymentDeps) {
  const now = deps.now();
  const overdue = await prisma.payment.findMany({
    where: { status: "WAITING_FOR_DEPOSIT", virtualAccount: { dueDate: { lte: now } } },
    take: 100,
  });
  let expired = 0;
  for (const p of overdue) {
    try {
      const got = await deps.toss.getPayment(p.paymentKey!, { paymentId: p.id, orderId: p.orderId });
      if (got.kind !== "ok") continue; // 확인 못 하면 다음 실행 때 다시
      if (got.data.status !== "WAITING_FOR_DEPOSIT") {
        await withBusyRetry(() => prisma.$transaction((tx) => applyTossPayment(tx, p.id, got.data, "RECONCILE", now)));
        await settleOrder(p.id, deps);
        continue;
      }
      // 토스는 기한이 지나도 상태를 바꾸지 않고 웹훅도 보내지 않음 (기한 후 입금은 토스가 거절) → 우리가 만료 처리
      await withBusyRetry(() =>
        prisma.$transaction(async (tx) => {
          await tx.payment.update({ where: { id: p.id }, data: { status: "EXPIRED", expiredAt: now, statusSource: "RECONCILE", statusChangedAt: now, syncedAt: now } });
          await tx.paymentVirtualAccount.update({ where: { paymentId: p.id }, data: { expired: true } });
        }),
      );
      await settleOrder(p.id, deps);
      expired++;
    } catch (e) {
      console.error(`[입금 기한 처리 실패] payment ${p.id}`, e);
    }
  }
  return expired;
}

/** 응답을 못 받은 취소(REQUESTED 오래됨·UNKNOWN)를 같은 멱등키로 다시 요청 */
export async function retryOpenCancels(deps: PaymentDeps = defaultPaymentDeps) {
  const now = deps.now();
  const open = await prisma.paymentCancel.findMany({
    where: { status: { in: ["REQUESTED", "UNKNOWN"] }, requestedAt: { lte: new Date(now.getTime() - STALE_CANCEL_MS) } },
    take: 100,
  });
  let n = 0;
  for (const c of open) {
    try {
      // ① 먼저 토스 조회: 이미 취소가 처리됐으면 그 취소로 완료 처리 (다시 요청하면 두 번 환불될 수 있음)
      const synced = await syncFromToss(c.paymentId, "RECONCILE", deps);
      if (!synced) continue; // 조회 실패 → 처리 여부를 모르므로 이번에는 다시 요청하지 않음 (다음 실행 때)
      const fresh = await prisma.paymentCancel.findUniqueOrThrow({ where: { id: c.id } });
      // ② 토스에 없을 때만 다시 요청 (응답이 없었으면 같은 키, 5xx 응답이 있었으면 새 키)
      if (fresh.status === "REQUESTED" || fresh.status === "UNKNOWN") await sendCancel(c.id, deps);
      n++;
    } catch (e) {
      console.error(`[취소 재시도 실패] cancel ${c.id}`, e);
    }
  }
  return n;
}

/** 처리 못 한 웹훅 다시 처리 (최대 5번) */
export async function retryWebhooks(deps: PaymentDeps = defaultPaymentDeps) {
  const events = await prisma.paymentWebhookEvent.findMany({
    where: { status: { in: ["RECEIVED", "FAILED"] }, attempts: { lt: WEBHOOK_MAX_ATTEMPTS } },
    orderBy: { id: "asc" },
    take: 100,
  });
  for (const ev of events) await processWebhookEvent(ev.id, deps);
  return events.length;
}

/** 1년 지난 API 기록 삭제 */
export async function purgeOldApiLogs(now = new Date()) {
  const cutoff = new Date(now.getTime() - API_LOG_RETENTION_DAYS * DAY - 60 * 1000);
  return (await prisma.paymentApiLog.deleteMany({ where: { createdAt: { lt: cutoff } } })).count;
}

/** 결제 확인 중 화면에서: 내 주문이면 바로 한 번 확인 */
export async function refreshOrderPayment(customerId: number, orderId: number, deps: PaymentDeps = defaultPaymentDeps): Promise<ConfirmOutcome> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.customerId !== customerId) return { kind: "FAILED", code: "ORDER_NOT_FOUND" };
  const open = await prisma.payment.findFirst({ where: { orderId, status: { in: ["IN_PROGRESS", "UNKNOWN"] } }, orderBy: { attemptNo: "desc" } });
  // 방금 시작한 승인(IN_PROGRESS)은 처리 중인 요청이 있으므로 건드리지 않음
  // 같은 결제를 5초 안에 다시 토스에 묻지 않음 (확인 중 화면이 3초마다 부르므로, 토스 연속 조회 제한 방지)
  const lastCall = open ? await prisma.paymentApiLog.findFirst({ where: { paymentId: open.id }, orderBy: { id: "desc" }, select: { createdAt: true } }) : null;
  const recentlyAsked = lastCall !== null && deps.now().getTime() - lastCall.createdAt.getTime() < RECHECK_MIN_INTERVAL_MS;
  if (open && !recentlyAsked && (open.status === "UNKNOWN" || deps.now().getTime() - open.statusChangedAt.getTime() > STALE_IN_PROGRESS_MS)) {
    return recheckWithToss(open.id, "RECONCILE", deps, true);
  }
  return outcomeFromState(orderId);
}

/**
 * 결제창을 열지 않고 떠난 주문 정리: 1시간 넘게 결제 대기이고 진행 중인 결제가 없으면 취소
 * (브라우저를 그냥 닫으면 토스가 failUrl로도 보내지 않아 주문이 영원히 PENDING으로 남음. 재고 예약은 20분 뒤 이미 만료됨)
 */
export const STALE_PENDING_ORDER_MS = 60 * 60 * 1000;
export async function closeStalePendingOrders(now = new Date()) {
  const stale = await prisma.order.findMany({
    where: {
      status: "PENDING",
      createdAt: { lte: new Date(now.getTime() - STALE_PENDING_ORDER_MS) },
      payments: { none: { status: { in: ["IN_PROGRESS", "UNKNOWN", "WAITING_FOR_DEPOSIT", "DONE", "PARTIAL_CANCELED"] } } },
    },
    select: { id: true },
    take: 500,
  });
  for (const o of stale) await closeOrderIfNoLivePayment(o.id, "CANCELED", "PAYMENT_FAILED", now);
  return stale.length;
}
