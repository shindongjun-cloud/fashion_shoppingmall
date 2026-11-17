import { formatDateTimeLong, formatPrice } from "@/lib/format";
import { PAYMENT_STATUS_LABEL } from "@/lib/payment-labels";
import type { PaymentView } from "@/lib/payment-view";

// 결제 정보 요약 (완료 화면·주문 내역 공통). 가상계좌면 입금 계좌·기한을 크게 보여 줍니다.
export default function PaymentSummary({ view, orderStatus }: { view: PaymentView; orderStatus: string }) {
  const va = view.virtualAccount;
  const waiting = orderStatus === "WAITING_DEPOSIT" && va;
  return (
    <div className="text-left text-sm text-gray-700">
      {waiting && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="font-bold text-amber-900">아래 계좌로 입금해 주세요</p>
          <p className="mt-1 text-base font-bold text-gray-900">
            {va.bank} {va.accountNumber}
          </p>
          <p className="mt-1">
            입금액 <b>{formatPrice(view.amount)}</b> · 기한 <b>{formatDateTimeLong(va.dueDate)}</b>까지
          </p>
          <p className="mt-1 text-xs text-amber-800">기한이 지나면 주문이 자동으로 취소돼요. 금액이 다르면 입금되지 않아요.</p>
        </div>
      )}
      <p>
        결제수단: {view.methodLabel}
        {view.detail && ` · ${view.detail}`}
        {!waiting && ` · ${PAYMENT_STATUS_LABEL[view.status] ?? view.status}`}
      </p>
      {view.canceledAmount > 0 && <p className="text-red-600">취소된 금액 {formatPrice(view.canceledAmount)}</p>}
      {view.receiptUrl && (
        <a href={view.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-gray-500 underline">
          영수증 보기
        </a>
      )}
    </div>
  );
}
