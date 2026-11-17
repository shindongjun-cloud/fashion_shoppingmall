// 테스트용 가짜 토스 서버 (메모리)
// 실제 토스처럼: 결제 인증된 결제만 승인, 멱등키가 같으면 처음 응답 그대로, 이미 승인된 결제는 ALREADY_PROCESSED_PAYMENT,
// 부분 취소·가상계좌(입금 대기 → 입금)·환불 계좌 필요 규칙. 장애(응답 끊김·5xx·오류 코드)를 순서대로 끼워 넣을 수 있음.
import type { TossPayment, Transport, TransportResponse } from "../../src/lib/toss";
import { TransportTimeoutError } from "../../src/lib/toss";

type Fault =
  | { op: Op; type: "timeout-before" } // 토스에 도착하기 전에 끊김 (처리 안 됨)
  | { op: Op; type: "timeout-after" } // 토스는 처리했는데 응답이 끊김
  | { op: Op; type: "error"; status: number; code: string; message?: string };
type Op = "confirm" | "cancel" | "get";

const kst = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().replace(/\.\d+Z$/, "+09:00");
const kstNoZone = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().replace(/\.\d+Z$/, "");

export class FakeToss {
  payments = new Map<string, TossPayment>();
  idem = new Map<string, TransportResponse>();
  faults: Fault[] = [];
  calls: { op: Op; path: string; headers: Record<string, string>; body?: unknown }[] = [];
  applied = { confirm: 0, cancel: 0 };
  /** 승인 응답을 늦춤 (실제 토스 승인은 0.5~1초 걸림 → 그 사이 두 번째 요청이 오는 상황 재현) */
  confirmDelayMs = 0;
  private seq = 0;
  /** 인스턴스마다 다른 접두어: 실제 토스 키처럼 테스트 사이에서도 겹치지 않게 */
  private readonly prefix = Math.random().toString(36).slice(2, 8);
  private id(kind: string) {
    return `${kind}_${this.prefix}_${++this.seq}`;
  }

  count(op: Op) {
    return this.calls.filter((c) => c.op === op).length;
  }

  /** 구매자가 결제창에서 인증까지 마친 상태 (successUrl로 오기 직전) */
  authorize(o: { paymentKey?: string; orderId: string; amount: number; method?: "카드" | "가상계좌" | "간편결제" | "계좌이체"; dueDate?: Date; refundAccount?: boolean }) {
    const paymentKey = o.paymentKey ?? `tpk_${++this.seq}_${Math.random().toString(36).slice(2, 10)}`;
    this.payments.set(paymentKey, {
      paymentKey,
      orderId: o.orderId,
      status: "IN_PROGRESS",
      method: o.method ?? "카드",
      totalAmount: o.amount,
      balanceAmount: o.amount,
      requestedAt: kst(new Date()),
      approvedAt: null,
      cancels: null,
      // 테스트용 메모 (실제 토스 필드 아님 → 응답에서는 빠짐)
      ...({ _dueDate: o.dueDate, _refundAccount: o.refundAccount } as object),
    } as TossPayment);
    return paymentKey;
  }

  /** 가상계좌 입금 (토스 상점관리자에서 "입금처리"한 것과 같음) */
  deposit(paymentKey: string, at = new Date()) {
    const p = this.payments.get(paymentKey)!;
    p.status = "DONE";
    p.approvedAt = kst(at);
    p.lastTransactionKey = this.id("tx_dep");
    p.virtualAccount = { ...p.virtualAccount!, settlementStatus: "COMPLETED" };
  }

  /** 토스 상점관리자 화면에서 직접 취소한 것과 같음 */
  cancelOutside(paymentKey: string, amount: number, reason = "상점관리자 취소") {
    this.applyCancel(this.payments.get(paymentKey)!, amount, reason);
  }

  private applyCancel(p: TossPayment, amount: number, reason: string) {
    const tx = this.id("tx_cancel");
    p.cancels = [...(p.cancels ?? []), { cancelAmount: amount, cancelReason: reason, canceledAt: kst(new Date()), transactionKey: tx, refundableAmount: p.balanceAmount - amount, cancelStatus: "DONE" }];
    p.balanceAmount -= amount;
    p.status = p.balanceAmount === 0 ? "CANCELED" : "PARTIAL_CANCELED";
    p.lastTransactionKey = tx;
    this.applied.cancel++;
  }

  private view(p: TossPayment): TossPayment {
    // 내부 메모(_dueDate 등)는 빼고 복사
    const copy = JSON.parse(JSON.stringify(p));
    delete copy._dueDate;
    delete copy._refundAccount;
    return copy;
  }

  private handle(op: Op, path: string, body: Record<string, unknown> | undefined): TransportResponse {
    const err = (status: number, code: string, message = code) => ({ status, body: { code, message } });
    if (op === "get") {
      const key = decodeURIComponent(path.split("/")[3]);
      const p = this.payments.get(key);
      return p ? { status: 200, body: this.view(p) } : err(404, "NOT_FOUND_PAYMENT", "존재하지 않는 결제 정보 입니다.");
    }
    if (op === "confirm") {
      const p = this.payments.get(String(body!.paymentKey));
      if (!p || p.orderId !== body!.orderId) return err(404, "NOT_FOUND_PAYMENT_SESSION", "결제 시간이 만료되었습니다.");
      if (p.totalAmount !== body!.amount) return err(400, "INVALID_REQUEST", "금액 불일치");
      if (p.status !== "IN_PROGRESS") return err(400, "ALREADY_PROCESSED_PAYMENT", "이미 처리된 결제 입니다.");
      this.applied.confirm++;
      const now = new Date();
      if (p.method === "가상계좌") {
        const due = (p as unknown as { _dueDate?: Date })._dueDate ?? new Date(now.getTime() + 3 * 86400_000);
        p.status = "WAITING_FOR_DEPOSIT";
        p.secret = this.id("ps_secret");
        p.virtualAccount = {
          accountType: "일반",
          accountNumber: "X6516" + String(10000000 + this.seq),
          bankCode: "20",
          customerName: "홍길동",
          dueDate: kstNoZone(due),
          expired: false,
          settlementStatus: "INCOMPLETED",
          refundStatus: "NONE",
          refundReceiveAccount: (p as unknown as { _refundAccount?: boolean })._refundAccount ? { bankCode: "88", accountNumber: "110123456789", holderName: "홍길동" } : null,
        };
      } else {
        p.status = "DONE";
        p.approvedAt = kst(now);
        p.card = { issuerCode: "41", acquirerCode: "41", number: "43301234****123*", installmentPlanMonths: 0, isInterestFree: false, approveNo: "00000000", cardType: "신용", ownerType: "개인", acquireStatus: "READY", amount: p.totalAmount };
        if (p.method === "간편결제") p.easyPay = { provider: "토스페이", amount: 0, discountAmount: 0 };
        if (p.method === "계좌이체") {
          p.card = null;
          p.transfer = { bankCode: "92", settlementStatus: "INCOMPLETED" }; // 실제 토스 테스트(퀵계좌이체) 응답과 같은 모양
        }
      }
      p.lastTransactionKey = this.id("tx");
      p.receipt = { url: `https://dashboard.tosspayments.com/receipt/${p.paymentKey}` };
      p.suppliedAmount = Math.round(p.totalAmount / 1.1);
      p.vat = p.totalAmount - p.suppliedAmount;
      p.isPartialCancelable = true;
      return { status: 200, body: this.view(p) };
    }
    // cancel
    const key = decodeURIComponent(path.split("/")[3]);
    const p = this.payments.get(key);
    if (!p) return err(404, "NOT_FOUND_PAYMENT");
    if (p.status === "CANCELED") return err(400, "ALREADY_CANCELED_PAYMENT", "이미 취소된 결제 입니다.");
    const amount = body!.cancelAmount === undefined ? p.balanceAmount : Number(body!.cancelAmount);
    if (p.status === "WAITING_FOR_DEPOSIT") {
      if (amount !== p.balanceAmount) return err(403, "NOT_ALLOWED_PARTIAL_REFUND_WAITING_DEPOSIT");
    } else if (p.status !== "DONE" && p.status !== "PARTIAL_CANCELED") {
      return err(403, "NOT_CANCELABLE_PAYMENT");
    }
    if (amount > p.balanceAmount) return err(403, "NOT_CANCELABLE_AMOUNT");
    if (p.method === "가상계좌" && p.status !== "WAITING_FOR_DEPOSIT" && !body!.refundReceiveAccount) return err(400, "INVALID_REFUND_ACCOUNT_INFO");
    this.applyCancel(p, amount, String(body!.cancelReason));
    return { status: 200, body: this.view(p) };
  }

  transport: Transport = async ({ method, path, headers, body }) => {
    const op: Op = method === "GET" ? "get" : path.endsWith("/confirm") ? "confirm" : "cancel";
    this.calls.push({ op, path, headers, body });
    if (op === "confirm" && this.confirmDelayMs) await new Promise((res) => setTimeout(res, this.confirmDelayMs));
    const fault = this.faults.findIndex((f) => f.op === op);
    const f = fault >= 0 ? this.faults.splice(fault, 1)[0] : null;
    if (f?.type === "timeout-before") throw new TransportTimeoutError("가짜 시간 초과 (도착 전)");
    // 멱등키: 같은 키면 처음 응답 그대로 (처리 안 함)
    const key = headers["Idempotency-Key"];
    const idemKey = key ? `${path}|${key}` : null;
    if (f?.type === "error") {
      // 실제 토스처럼 오류 응답도 멱등키에 저장됨 → 같은 키로 다시 보내면 같은 오류 (E2E에서 확인한 동작)
      const res = { status: f.status, body: { code: f.code, message: f.message ?? f.code } };
      if (idemKey && !this.idem.has(idemKey)) this.idem.set(idemKey, res);
      return JSON.parse(JSON.stringify(this.idem.get(idemKey ?? "") ?? res));
    }
    let res: TransportResponse;
    if (idemKey && this.idem.has(idemKey)) res = this.idem.get(idemKey)!;
    else {
      res = this.handle(op, path, body as Record<string, unknown> | undefined);
      if (idemKey) this.idem.set(idemKey, res);
    }
    if (f?.type === "timeout-after") throw new TransportTimeoutError("가짜 시간 초과 (처리 후)");
    return JSON.parse(JSON.stringify(res));
  };
}
