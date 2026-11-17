// 화면 표시용 결제 요약 (서버 전용: 가상계좌 번호를 복호화하므로)
import type { Payment, PaymentCard, PaymentEasyPay, PaymentVirtualAccount } from "@/generated/prisma/client";
import { decrypt } from "@/lib/crypto";
import { bankName, cardCompanyName, PAYMENT_METHOD_LABEL } from "@/lib/payment-labels";

export type PaymentView = {
  status: Payment["status"];
  methodLabel: string;
  detail: string | null; // 신한카드 · 일시불 / 토스페이 / 신한은행
  amount: number;
  canceledAmount: number;
  approvedAt: Date | null;
  receiptUrl: string | null;
  virtualAccount: { bank: string; accountNumber: string; dueDate: Date; expired: boolean } | null;
};

type WithDetails = Payment & { card: PaymentCard | null; easyPay: PaymentEasyPay | null; virtualAccount: PaymentVirtualAccount | null };

export function toPaymentView(p: WithDetails): PaymentView {
  let detail: string | null = null;
  if (p.card) {
    detail = `${cardCompanyName(p.card.issuerCode)} · ${p.card.installmentPlanMonths > 0 ? `${p.card.installmentPlanMonths}개월${p.card.isInterestFree ? "(무이자)" : ""}` : "일시불"}`;
  }
  if (p.easyPay) detail = detail ? `${p.easyPay.provider} (${detail})` : p.easyPay.provider;
  if (p.virtualAccount) detail = bankName(p.virtualAccount.bankCode);
  if (p.method === "TRANSFER" && p.transferBankCode) detail = bankName(p.transferBankCode);
  return {
    status: p.status,
    methodLabel: p.method ? (PAYMENT_METHOD_LABEL[p.method] ?? p.method) : "결제",
    detail,
    amount: p.amount,
    canceledAmount: p.canceledAmount,
    approvedAt: p.approvedAt,
    receiptUrl: p.receiptUrl,
    virtualAccount: p.virtualAccount
      ? {
          bank: bankName(p.virtualAccount.bankCode),
          accountNumber: decrypt(p.virtualAccount.accountNumberEnc),
          dueDate: p.virtualAccount.dueDate,
          expired: p.virtualAccount.expired,
        }
      : null,
  };
}

/** 주문의 "대표" 결제: 결제창까지 간 시도(결제 키 있음) 중 실패가 아닌 가장 최근 것 */
export const paymentInclude = { card: true, easyPay: true, virtualAccount: true } as const;
export function mainPayment<T extends Payment>(payments: T[]): T | null {
  const ranked = payments.filter((p) => p.paymentKey !== null && p.status !== "ABORTED");
  return [...ranked].sort((a, b) => b.attemptNo - a.attemptNo)[0] ?? null;
}
