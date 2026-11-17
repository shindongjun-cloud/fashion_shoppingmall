// 토스페이먼츠 API (서버 전용 — 시크릿 키를 쓰므로 브라우저 코드에서 import 금지)
//
// - 모든 호출을 PaymentApiLog에 남깁니다 (민감정보는 가려서). 장애가 나면 "무슨 요청에 무슨 응답이 왔는지" 볼 수 있어야 하기 때문.
// - POST(승인·취소)에는 멱등키(Idempotency-Key)를 붙입니다. 같은 키로 다시 보내면 토스가 두 번 처리하지 않고
//   처음 응답을 그대로 돌려줍니다(15일 유효). → 응답을 못 받았을 때 "같은 키로 다시 요청"해서 결과를 안전하게 확인.
// - 결과는 3가지로 나눕니다.
//     ok      : 토스가 성공 응답 (Payment 객체)
//     fail    : 토스가 오류 코드로 응답 → 결과가 확실함 (예: 카드 거절)
//     unknown : 시간 초과·연결 실패·토스 서버 오류(5xx) → 실제로 처리됐는지 모름. 실패로 단정하면 안 됨
// - 네트워크는 transport로 분리했습니다. 테스트에서는 가짜 transport로 시간 초과·오류를 흉내 냅니다.
import { prisma } from "@/lib/prisma";
import { maskAccountNumber, maskEmail, maskName, maskPhone } from "@/lib/crypto";
import type { PaymentApiOperation, PaymentApiOutcome } from "@/generated/prisma/client";

export const TOSS_API_BASE = "https://api.tosspayments.com";
export const TOSS_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------
// 토스 결제 객체 (쓰는 필드만)
// ---------------------------------------------------------------
export type TossCancel = {
  cancelAmount: number;
  cancelReason: string;
  taxFreeAmount?: number;
  refundableAmount?: number;
  canceledAt: string;
  transactionKey: string;
  cancelStatus?: string;
};
export type TossPayment = {
  paymentKey: string;
  orderId: string;
  orderName?: string;
  status: "READY" | "IN_PROGRESS" | "WAITING_FOR_DEPOSIT" | "DONE" | "CANCELED" | "PARTIAL_CANCELED" | "ABORTED" | "EXPIRED";
  method?: string | null;
  totalAmount: number;
  balanceAmount: number;
  suppliedAmount?: number;
  vat?: number;
  taxFreeAmount?: number;
  currency?: string;
  requestedAt?: string;
  approvedAt?: string | null;
  lastTransactionKey?: string | null;
  isPartialCancelable?: boolean;
  secret?: string | null;
  receipt?: { url?: string } | null;
  card?: {
    issuerCode: string;
    acquirerCode?: string | null;
    number: string;
    installmentPlanMonths: number;
    isInterestFree: boolean;
    interestPayer?: string | null;
    approveNo: string;
    useCardPoint?: boolean;
    cardType?: string;
    ownerType?: string;
    acquireStatus?: string;
    amount: number;
  } | null;
  easyPay?: { provider: string; amount: number; discountAmount: number } | null;
  transfer?: { bankCode: string; settlementStatus?: string } | null;
  virtualAccount?: {
    accountType?: string;
    accountNumber: string;
    bankCode: string;
    customerName?: string;
    depositorName?: string;
    dueDate: string;
    refundStatus?: string;
    expired?: boolean;
    settlementStatus?: string;
    refundReceiveAccount?: { bankCode: string; accountNumber: string; holderName: string } | null;
  } | null;
  cashReceipt?: { type?: string; receiptKey?: string; issueNumber?: string; receiptUrl?: string; amount?: number; taxFreeAmount?: number } | null;
  cancels?: TossCancel[] | null;
  failure?: { code: string; message: string } | null;
};

export type TossResult<T = TossPayment> =
  | { kind: "ok"; data: T }
  | { kind: "fail"; httpStatus: number; code: string; message: string }
  | { kind: "unknown"; reason: "TIMEOUT" | "NETWORK_ERROR" | "SERVER_ERROR"; code: string; message: string };

// ---------------------------------------------------------------
// 네트워크 (테스트에서 바꿔 끼움)
// ---------------------------------------------------------------
export type TransportResponse = { status: number; body: unknown };
export type Transport = (req: { method: "GET" | "POST"; path: string; headers: Record<string, string>; body?: unknown; timeoutMs: number }) => Promise<TransportResponse>;

export class TransportTimeoutError extends Error {}

export const fetchTransport: Transport = async ({ method, path, headers, body, timeoutMs }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${TOSS_API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text.slice(0, 500) };
    }
    return { status: res.status, body: parsed };
  } catch (e) {
    if (controller.signal.aborted) throw new TransportTimeoutError(`토스 응답 시간 초과 (${timeoutMs}ms)`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

// ---------------------------------------------------------------
// 설정 확인 (키가 비어 있거나 짝이 안 맞으면 결제 화면에서 바로 알림)
// ---------------------------------------------------------------
export function getTossConfigProblem(env: Record<string, string | undefined> = process.env): string | null {
  const client = env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? "";
  const secret = env.TOSS_SECRET_KEY ?? "";
  if (!client) return "NEXT_PUBLIC_TOSS_CLIENT_KEY(클라이언트 키)가 비어 있습니다";
  if (!secret) return "TOSS_SECRET_KEY(시크릿 키)가 비어 있습니다";
  const kind = (key: string) => key.match(/^(test|live)_(gck|ck|gsk|sk)_/)?.slice(1, 3);
  const c = kind(client);
  const s = kind(secret);
  if (!c) return "클라이언트 키 형식이 올바르지 않습니다 (test_gck_ / live_gck_ 로 시작)";
  if (!s) return "시크릿 키 형식이 올바르지 않습니다 (test_gsk_ / live_gsk_ 로 시작)";
  if (c[0] !== s[0]) return "클라이언트 키와 시크릿 키의 모드(test/live)가 다릅니다";
  if (c[1] !== "gck" || s[1] !== "gsk") return "결제위젯 키(gck/gsk)가 아닙니다. 위젯 연동에는 결제위젯 연동 키가 필요합니다";
  return null;
}

// ---------------------------------------------------------------
// 로그용 민감정보 가리기
// ---------------------------------------------------------------
const MASKERS: Record<string, (v: string) => string> = {
  secret: () => "[가림]",
  accountNumber: maskAccountNumber,
  customerName: maskName,
  depositorName: maskName,
  holderName: maskName,
  customerMobilePhone: (v) => maskPhone(v.replace(/[^0-9]/g, "")),
  customerEmail: maskEmail,
};
export function maskForLog(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskForLog);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        typeof v === "string" && MASKERS[k] ? (v ? MASKERS[k](v) : v) : maskForLog(v),
      ]),
    );
  }
  return value;
}
export const LOG_BODY_LIMIT = 20_000;
export function toLogJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const json = JSON.stringify(maskForLog(value));
  return json.length > LOG_BODY_LIMIT ? json.slice(0, LOG_BODY_LIMIT - 20) + "…(잘림)" : json;
}

// ---------------------------------------------------------------
// API 클라이언트
// ---------------------------------------------------------------
export type TossLogContext = { paymentId?: number | null; orderId?: number | null };

export type TossApi = {
  confirm(params: { paymentKey: string; orderId: string; amount: number }, idempotencyKey: string, ctx: TossLogContext): Promise<TossResult>;
  cancel(
    paymentKey: string,
    params: { cancelReason: string; cancelAmount?: number; taxFreeAmount?: number; refundReceiveAccount?: { bank: string; accountNumber: string; holderName: string } },
    idempotencyKey: string,
    ctx: TossLogContext,
  ): Promise<TossResult>;
  getPayment(paymentKey: string, ctx: TossLogContext): Promise<TossResult>;
};

export function createTossApi(options: { transport?: Transport; secretKey?: () => string; timeoutMs?: number; log?: boolean } = {}): TossApi {
  const transport = options.transport ?? fetchTransport;
  const secretKey = options.secretKey ?? (() => process.env.TOSS_SECRET_KEY ?? "");
  const timeoutMs = options.timeoutMs ?? TOSS_TIMEOUT_MS;
  const shouldLog = options.log ?? true;
  const testCodeFor = (op: PaymentApiOperation) => {
    const value = process.env[op === "CONFIRM" ? "TOSS_TEST_CODE_CONFIRM" : op === "CANCEL" ? "TOSS_TEST_CODE_CANCEL" : "TOSS_TEST_CODE_GET"];
    return value && /^[A-Z0-9_]{1,64}$/.test(value) ? value : null;
  };

  async function call(
    operation: PaymentApiOperation,
    method: "GET" | "POST",
    path: string,
    logPath: string,
    body: unknown,
    idempotencyKey: string | null,
    ctx: TossLogContext,
  ): Promise<TossResult> {
    // 인증: "시크릿키:"를 base64로 (콜론 포함)
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${secretKey()}:`).toString("base64")}`,
      "Content-Type": "application/json",
    };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    // 테스트 전용: 토스가 지정한 오류를 일부러 돌려주게 함 (카드 거절 등 실패 화면 확인용).
    // 테스트 키(test_)일 때만 붙이고, 토스도 라이브 환경에서는 이 헤더를 무시함. 예) TOSS_TEST_CODE_CONFIRM=INVALID_REJECT_CARD
    const testCode = testCodeFor(operation);
    if (testCode && secretKey().startsWith("test_")) headers["TossPayments-Test-Code"] = testCode;

    const started = Date.now();
    let result: TossResult;
    let httpStatus: number | null = null;
    let responseBody: unknown = null;
    let outcome: PaymentApiOutcome;
    try {
      const res = await transport({ method, path, headers, body, timeoutMs });
      httpStatus = res.status;
      responseBody = res.body;
      const err = (res.body ?? {}) as { code?: string; message?: string };
      if (res.status >= 200 && res.status < 300) {
        result = { kind: "ok", data: res.body as TossPayment };
        outcome = "SUCCESS";
      } else if (res.status >= 500) {
        // 토스 내부 오류: 처리됐는지 확실하지 않음 → 결과 모름으로 취급
        result = { kind: "unknown", reason: "SERVER_ERROR", code: err.code ?? `HTTP_${res.status}`, message: err.message ?? "토스 서버 오류" };
        outcome = "FAIL";
      } else if (res.status === 409 && err.code === "IDEMPOTENT_REQUEST_PROCESSING") {
        // 같은 멱등키의 첫 요청이 아직 처리 중 → 결과 모름 (잠시 뒤 다시 확인)
        result = { kind: "unknown", reason: "SERVER_ERROR", code: err.code, message: err.message ?? "이전 요청 처리 중" };
        outcome = "FAIL";
      } else {
        result = { kind: "fail", httpStatus: res.status, code: err.code ?? `HTTP_${res.status}`, message: err.message ?? "결제 처리 중 오류가 발생했어요." };
        outcome = "FAIL";
      }
    } catch (e) {
      const timeout = e instanceof TransportTimeoutError;
      outcome = timeout ? "TIMEOUT" : "NETWORK_ERROR";
      result = {
        kind: "unknown",
        reason: timeout ? "TIMEOUT" : "NETWORK_ERROR",
        code: timeout ? "TIMEOUT" : "NETWORK_ERROR",
        message: e instanceof Error ? e.message : String(e),
      };
    }

    if (shouldLog) {
      try {
        await prisma.paymentApiLog.create({
          data: {
            paymentId: ctx.paymentId ?? null,
            orderId: ctx.orderId ?? null,
            operation,
            httpMethod: method,
            path: logPath,
            idempotencyKey,
            httpStatus,
            outcome,
            errorCode: result.kind === "ok" ? null : result.code,
            errorMessage: result.kind === "ok" ? null : result.message.slice(0, 500),
            requestBody: toLogJson(body),
            responseBody: toLogJson(responseBody),
            durationMs: Math.max(0, Date.now() - started),
          },
        });
      } catch (e) {
        // 기록 실패가 결제를 망치면 안 됨 → 서버 로그에만 남김
        console.error("[결제 API 기록 실패]", e);
      }
    }
    return result;
  }

  return {
    confirm: (params, idempotencyKey, ctx) =>
      call("CONFIRM", "POST", "/v1/payments/confirm", "/v1/payments/confirm", params, idempotencyKey, ctx),
    cancel: (paymentKey, params, idempotencyKey, ctx) =>
      call("CANCEL", "POST", `/v1/payments/${encodeURIComponent(paymentKey)}/cancel`, "/v1/payments/{paymentKey}/cancel", params, idempotencyKey, ctx),
    getPayment: (paymentKey, ctx) =>
      call("GET_PAYMENT", "GET", `/v1/payments/${encodeURIComponent(paymentKey)}`, "/v1/payments/{paymentKey}", undefined, null, ctx),
  };
}

/** 실제 토스 API (앱에서 사용) */
export const tossApi = createTossApi();
