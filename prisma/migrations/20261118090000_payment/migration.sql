-- >>> db-constraints: 영향받는 트리거 먼저 제거 (prisma/db-constraints.ts에서 생성, 직접 수정 금지)
DROP TRIGGER IF EXISTS "InventoryBalance_reserved_guard";
DROP TRIGGER IF EXISTS "InventoryBalance_no_delete";
DROP TRIGGER IF EXISTS "InventoryReservation_reserve";
DROP TRIGGER IF EXISTS "InventoryReservation_sync_ins";
DROP TRIGGER IF EXISTS "InventoryReservation_transition";
DROP TRIGGER IF EXISTS "InventoryReservation_immutable";
DROP TRIGGER IF EXISTS "InventoryReservation_sync_upd";
DROP TRIGGER IF EXISTS "InventoryReservation_no_delete";
DROP TRIGGER IF EXISTS "InventoryLocation_deactivate_guard";
DROP TRIGGER IF EXISTS "Order_customer_active";
DROP TRIGGER IF EXISTS "Order_insert_pending";
DROP TRIGGER IF EXISTS "Order_total_fixed";
DROP TRIGGER IF EXISTS "Order_status_transition";
DROP TRIGGER IF EXISTS "Order_no_delete";
DROP TRIGGER IF EXISTS "InventoryReservation_order_open";
DROP TRIGGER IF EXISTS "Payment_insert_guard";
DROP TRIGGER IF EXISTS "Payment_immutable";
DROP TRIGGER IF EXISTS "Payment_key_fixed";
DROP TRIGGER IF EXISTS "Payment_status_transition";
DROP TRIGGER IF EXISTS "Payment_amount_guard";
DROP TRIGGER IF EXISTS "Payment_status_history_ins";
DROP TRIGGER IF EXISTS "Payment_status_history_upd";
DROP TRIGGER IF EXISTS "Payment_no_delete";
DROP TRIGGER IF EXISTS "PaymentCard_method";
DROP TRIGGER IF EXISTS "PaymentEasyPay_method";
DROP TRIGGER IF EXISTS "PaymentVirtualAccount_method";
DROP TRIGGER IF EXISTS "PaymentVirtualAccount_fixed";
DROP TRIGGER IF EXISTS "PaymentCard_no_delete";
DROP TRIGGER IF EXISTS "PaymentEasyPay_no_delete";
DROP TRIGGER IF EXISTS "PaymentVirtualAccount_no_delete";
DROP TRIGGER IF EXISTS "PaymentRefundAccount_fixed";
DROP TRIGGER IF EXISTS "PaymentRefundAccount_wipe_only";
DROP TRIGGER IF EXISTS "PaymentRefundAccount_no_delete";
DROP TRIGGER IF EXISTS "PaymentCancel_insert_guard";
DROP TRIGGER IF EXISTS "PaymentCancel_transition";
DROP TRIGGER IF EXISTS "PaymentCancel_immutable";
DROP TRIGGER IF EXISTS "PaymentCancel_apply_upd";
DROP TRIGGER IF EXISTS "PaymentCancel_apply_ins";
DROP TRIGGER IF EXISTS "PaymentCancel_no_delete";
DROP TRIGGER IF EXISTS "PaymentStatusHistory_no_update";
DROP TRIGGER IF EXISTS "PaymentStatusHistory_no_delete";
DROP TRIGGER IF EXISTS "PaymentApiLog_no_update";
DROP TRIGGER IF EXISTS "PaymentApiLog_retention";
DROP TRIGGER IF EXISTS "PaymentWebhookEvent_immutable";
DROP TRIGGER IF EXISTS "PaymentWebhookEvent_no_delete";
DROP TRIGGER IF EXISTS "CashReceipt_no_delete";
-- <<< db-constraints-top

-- CreateTable
CREATE TABLE "Payment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'TOSS',
    "pgOrderId" TEXT NOT NULL,
    "paymentKey" TEXT,
    "method" TEXT,
    "status" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "canceledAmount" INTEGER NOT NULL DEFAULT 0,
    "balanceAmount" INTEGER NOT NULL,
    "suppliedAmount" INTEGER,
    "vat" INTEGER,
    "taxFreeAmount" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "isPartialCancelable" BOOLEAN,
    "confirmIdempotencyKey" TEXT,
    "secretHash" TEXT,
    "receiptUrl" TEXT,
    "lastTransactionKey" TEXT,
    "failCode" TEXT,
    "failMessage" TEXT,
    "requestedAt" DATETIME,
    "approvedAt" DATETIME,
    "failedAt" DATETIME,
    "canceledAt" DATETIME,
    "expiredAt" DATETIME,
    "syncedAt" DATETIME,
    "statusSource" TEXT NOT NULL,
    "statusChangedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_provider_enum_ck" CHECK ("provider" IN ('TOSS')),
    CONSTRAINT "Payment_method_enum_ck" CHECK ("method" IN ('CARD', 'VIRTUAL_ACCOUNT', 'EASY_PAY', 'TRANSFER', 'MOBILE_PHONE', 'GIFT_CERTIFICATE')),
    CONSTRAINT "Payment_status_enum_ck" CHECK ("status" IN ('IN_PROGRESS', 'UNKNOWN', 'WAITING_FOR_DEPOSIT', 'DONE', 'PARTIAL_CANCELED', 'CANCELED', 'ABORTED', 'EXPIRED')),
    CONSTRAINT "Payment_isPartialCancelable_bool_ck" CHECK ("isPartialCancelable" IN (0, 1)),
    CONSTRAINT "Payment_statusSource_enum_ck" CHECK ("statusSource" IN ('CONFIRM', 'WINDOW', 'RECONCILE', 'WEBHOOK', 'CANCEL', 'SYSTEM', 'MIGRATION')),
    CONSTRAINT "Payment_amounts_ck" CHECK (typeof("amount") = 'integer' AND "amount" >= 1 AND typeof("canceledAmount") = 'integer' AND "canceledAmount" >= 0 AND "canceledAmount" <= "amount" AND typeof("balanceAmount") = 'integer' AND "balanceAmount" = "amount" - "canceledAmount" AND typeof("taxFreeAmount") = 'integer' AND "taxFreeAmount" >= 0 AND "taxFreeAmount" <= "amount" AND ("suppliedAmount" IS NULL OR (typeof("suppliedAmount") = 'integer' AND "suppliedAmount" >= 0)) AND ("vat" IS NULL OR (typeof("vat") = 'integer' AND "vat" >= 0))),
    CONSTRAINT "Payment_currency_ck" CHECK ("currency" = 'KRW'),
    CONSTRAINT "Payment_attempt_ck" CHECK (typeof("attemptNo") = 'integer' AND "attemptNo" >= 1),
    CONSTRAINT "Payment_keys_ck" CHECK (("paymentKey" IS NULL OR length("paymentKey") BETWEEN 1 AND 200) AND length("pgOrderId") BETWEEN 6 AND 64 AND "pgOrderId" NOT GLOB '*[^A-Za-z0-9_=-]*' AND ("confirmIdempotencyKey" IS NULL OR length("confirmIdempotencyKey") BETWEEN 1 AND 300) AND ("secretHash" IS NULL OR (length("secretHash") = 64 AND "secretHash" NOT GLOB '*[^0-9a-f]*')) AND ("receiptUrl" IS NULL OR "receiptUrl" GLOB 'https://?*') AND ("failMessage" IS NULL OR length("failMessage") <= 510)),
    CONSTRAINT "Payment_state_ck" CHECK (("status" IN ('IN_PROGRESS', 'UNKNOWN') AND "paymentKey" IS NOT NULL AND "confirmIdempotencyKey" IS NOT NULL AND "canceledAmount" = 0 AND "failCode" IS NULL AND "approvedAt" IS NULL) OR ("status" = 'WAITING_FOR_DEPOSIT' AND "paymentKey" IS NOT NULL AND "method" = 'VIRTUAL_ACCOUNT' AND "canceledAmount" = 0 AND "failCode" IS NULL AND "approvedAt" IS NULL) OR ("status" = 'DONE' AND "paymentKey" IS NOT NULL AND "approvedAt" IS NOT NULL AND "canceledAmount" = 0 AND "failCode" IS NULL) OR ("status" = 'PARTIAL_CANCELED' AND "paymentKey" IS NOT NULL AND "approvedAt" IS NOT NULL AND "canceledAmount" > 0 AND "canceledAmount" < "amount") OR ("status" = 'CANCELED' AND "paymentKey" IS NOT NULL AND "canceledAmount" = "amount" AND "canceledAt" IS NOT NULL) OR ("status" = 'ABORTED' AND "failCode" IS NOT NULL AND "failedAt" IS NOT NULL AND "canceledAmount" = 0 AND "approvedAt" IS NULL) OR ("status" = 'EXPIRED' AND "expiredAt" IS NOT NULL AND "canceledAmount" = 0 AND "approvedAt" IS NULL)),
    CONSTRAINT "Payment_dates_ck" CHECK (("requestedAt" IS NULL OR "requestedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("approvedAt" IS NULL OR "approvedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("failedAt" IS NULL OR "failedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("canceledAt" IS NULL OR "canceledAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("expiredAt" IS NULL OR "expiredAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("syncedAt" IS NULL OR "syncedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("statusChangedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- CreateTable
CREATE TABLE "PaymentCard" (
    "paymentId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "issuerCode" TEXT NOT NULL,
    "acquirerCode" TEXT,
    "numberMasked" TEXT NOT NULL,
    "installmentPlanMonths" INTEGER NOT NULL,
    "isInterestFree" BOOLEAN NOT NULL,
    "interestPayer" TEXT,
    "approveNo" TEXT NOT NULL,
    "cardType" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "acquireStatus" TEXT,
    "useCardPoint" BOOLEAN NOT NULL DEFAULT false,
    "amount" INTEGER NOT NULL,
    CONSTRAINT "PaymentCard_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentCard_isInterestFree_bool_ck" CHECK ("isInterestFree" IN (0, 1)),
    CONSTRAINT "PaymentCard_cardType_enum_ck" CHECK ("cardType" IN ('CREDIT', 'CHECK', 'GIFT', 'UNKNOWN')),
    CONSTRAINT "PaymentCard_ownerType_enum_ck" CHECK ("ownerType" IN ('PERSONAL', 'CORPORATE', 'UNKNOWN')),
    CONSTRAINT "PaymentCard_useCardPoint_bool_ck" CHECK ("useCardPoint" IN (0, 1)),
    CONSTRAINT "PaymentCard_values_ck" CHECK (trim("issuerCode") <> '' AND trim("approveNo") <> '' AND "numberMasked" GLOB '*[*]*' AND length("numberMasked") <= 20 AND typeof("installmentPlanMonths") = 'integer' AND "installmentPlanMonths" BETWEEN 0 AND 60 AND typeof("amount") = 'integer' AND "amount" >= 0)
);

-- CreateTable
CREATE TABLE "PaymentEasyPay" (
    "paymentId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "provider" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "discountAmount" INTEGER NOT NULL,
    CONSTRAINT "PaymentEasyPay_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentEasyPay_values_ck" CHECK (trim("provider") <> '' AND typeof("amount") = 'integer' AND "amount" >= 0 AND typeof("discountAmount") = 'integer' AND "discountAmount" >= 0)
);

-- CreateTable
CREATE TABLE "PaymentVirtualAccount" (
    "paymentId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "accountType" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "accountNumberEnc" TEXT NOT NULL,
    "customerNameEnc" TEXT,
    "dueDate" DATETIME NOT NULL,
    "expired" BOOLEAN NOT NULL DEFAULT false,
    "settlementStatus" TEXT,
    "refundStatus" TEXT,
    "depositedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaymentVirtualAccount_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentVirtualAccount_accountType_enum_ck" CHECK ("accountType" IN ('NORMAL', 'FIXED')),
    CONSTRAINT "PaymentVirtualAccount_expired_bool_ck" CHECK ("expired" IN (0, 1)),
    CONSTRAINT "PaymentVirtualAccount_values_ck" CHECK (trim("bankCode") <> '' AND "accountNumberEnc" GLOB 'v[0-9]*:?*:?*:?*' AND ("customerNameEnc" IS NULL OR "customerNameEnc" GLOB 'v[0-9]*:?*:?*:?*')),
    CONSTRAINT "PaymentVirtualAccount_dates_ck" CHECK (("dueDate" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("depositedAt" IS NULL OR "depositedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- CreateTable
CREATE TABLE "PaymentRefundAccount" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "paymentId" INTEGER NOT NULL,
    "bankCode" TEXT NOT NULL,
    "accountNumberEnc" TEXT,
    "accountNumberMasked" TEXT NOT NULL,
    "holderNameEnc" TEXT,
    "holderNameMasked" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "wipedAt" DATETIME,
    CONSTRAINT "PaymentRefundAccount_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentRefundAccount_values_ck" CHECK (trim("bankCode") <> '' AND "accountNumberMasked" GLOB '*[*]*' AND "holderNameMasked" GLOB '*[*]*' AND ("accountNumberEnc" IS NULL OR "accountNumberEnc" GLOB 'v[0-9]*:?*:?*:?*') AND ("holderNameEnc" IS NULL OR "holderNameEnc" GLOB 'v[0-9]*:?*:?*:?*') AND ("accountNumberEnc" IS NULL) = ("holderNameEnc" IS NULL) AND ("accountNumberEnc" IS NULL) = ("wipedAt" IS NOT NULL)),
    CONSTRAINT "PaymentRefundAccount_dates_ck" CHECK (("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("wipedAt" IS NULL OR "wipedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- CreateTable
CREATE TABLE "PaymentCancel" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "paymentId" INTEGER NOT NULL,
    "cancelAmount" INTEGER NOT NULL,
    "taxFreeAmount" INTEGER NOT NULL DEFAULT 0,
    "reasonCode" TEXT NOT NULL,
    "reasonText" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "requestedByRef" TEXT,
    "status" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "transactionKey" TEXT,
    "refundableAmountAfter" INTEGER,
    "refundAccountId" INTEGER,
    "failCode" TEXT,
    "failMessage" TEXT,
    "requestedAt" DATETIME NOT NULL,
    "canceledAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaymentCancel_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentCancel_refundAccountId_fkey" FOREIGN KEY ("refundAccountId") REFERENCES "PaymentRefundAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentCancel_reasonCode_enum_ck" CHECK ("reasonCode" IN ('CUSTOMER_REQUEST', 'ORDER_ERROR', 'OUT_OF_STOCK', 'ADMIN', 'PG_SYNC')),
    CONSTRAINT "PaymentCancel_requestedBy_enum_ck" CHECK ("requestedBy" IN ('CUSTOMER', 'ADMIN', 'SYSTEM')),
    CONSTRAINT "PaymentCancel_status_enum_ck" CHECK ("status" IN ('REQUESTED', 'DONE', 'FAILED', 'UNKNOWN')),
    CONSTRAINT "PaymentCancel_values_ck" CHECK (typeof("cancelAmount") = 'integer' AND "cancelAmount" >= 1 AND typeof("taxFreeAmount") = 'integer' AND "taxFreeAmount" >= 0 AND "taxFreeAmount" <= "cancelAmount" AND ("refundableAmountAfter" IS NULL OR (typeof("refundableAmountAfter") = 'integer' AND "refundableAmountAfter" >= 0)) AND trim("reasonText") <> '' AND length("reasonText") <= 200 AND length("idempotencyKey") BETWEEN 1 AND 300),
    CONSTRAINT "PaymentCancel_state_ck" CHECK (("status" IN ('REQUESTED', 'UNKNOWN') AND "transactionKey" IS NULL AND "canceledAt" IS NULL AND "failCode" IS NULL) OR ("status" = 'DONE' AND "transactionKey" IS NOT NULL AND "canceledAt" IS NOT NULL AND "failCode" IS NULL) OR ("status" = 'FAILED' AND "transactionKey" IS NULL AND "canceledAt" IS NULL AND "failCode" IS NOT NULL)),
    CONSTRAINT "PaymentCancel_dates_ck" CHECK (("requestedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("canceledAt" IS NULL OR "canceledAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- CreateTable
CREATE TABLE "PaymentStatusHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "paymentId" INTEGER NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "canceledAmount" INTEGER NOT NULL,
    "failCode" TEXT,
    "changedAt" DATETIME NOT NULL,
    CONSTRAINT "PaymentStatusHistory_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentStatusHistory_fromStatus_enum_ck" CHECK ("fromStatus" IN ('IN_PROGRESS', 'UNKNOWN', 'WAITING_FOR_DEPOSIT', 'DONE', 'PARTIAL_CANCELED', 'CANCELED', 'ABORTED', 'EXPIRED')),
    CONSTRAINT "PaymentStatusHistory_toStatus_enum_ck" CHECK ("toStatus" IN ('IN_PROGRESS', 'UNKNOWN', 'WAITING_FOR_DEPOSIT', 'DONE', 'PARTIAL_CANCELED', 'CANCELED', 'ABORTED', 'EXPIRED')),
    CONSTRAINT "PaymentStatusHistory_source_enum_ck" CHECK ("source" IN ('CONFIRM', 'WINDOW', 'RECONCILE', 'WEBHOOK', 'CANCEL', 'SYSTEM', 'MIGRATION')),
    CONSTRAINT "PaymentStatusHistory_values_ck" CHECK (typeof("canceledAmount") = 'integer' AND "canceledAmount" >= 0 AND "changedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*')
);

-- CreateTable
CREATE TABLE "PaymentApiLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "paymentId" INTEGER,
    "orderId" INTEGER,
    "operation" TEXT NOT NULL,
    "httpMethod" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "httpStatus" INTEGER,
    "outcome" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "requestBody" TEXT,
    "responseBody" TEXT,
    "durationMs" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentApiLog_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentApiLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentApiLog_operation_enum_ck" CHECK ("operation" IN ('CONFIRM', 'CANCEL', 'GET_PAYMENT')),
    CONSTRAINT "PaymentApiLog_outcome_enum_ck" CHECK ("outcome" IN ('SUCCESS', 'FAIL', 'TIMEOUT', 'NETWORK_ERROR')),
    CONSTRAINT "PaymentApiLog_values_ck" CHECK ("httpMethod" IN ('GET', 'POST') AND "path" GLOB '/v1/*' AND typeof("durationMs") = 'integer' AND "durationMs" >= 0 AND ("idempotencyKey" IS NULL OR length("idempotencyKey") <= 300) AND (("outcome" = 'SUCCESS' AND "httpStatus" BETWEEN 200 AND 299) OR ("outcome" = 'FAIL' AND "httpStatus" BETWEEN 300 AND 599) OR ("outcome" IN ('TIMEOUT', 'NETWORK_ERROR') AND "httpStatus" IS NULL)) AND ("requestBody" IS NULL OR length("requestBody") <= 20000) AND ("responseBody" IS NULL OR length("responseBody") <= 20000) AND "createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*')
);

-- CreateTable
CREATE TABLE "PaymentWebhookEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "eventType" TEXT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "transmissionId" TEXT,
    "retriedCount" INTEGER NOT NULL DEFAULT 0,
    "paymentKey" TEXT,
    "pgOrderId" TEXT,
    "paymentId" INTEGER,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "receivedAt" DATETIME NOT NULL,
    "processedAt" DATETIME,
    CONSTRAINT "PaymentWebhookEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentWebhookEvent_status_enum_ck" CHECK ("status" IN ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED')),
    CONSTRAINT "PaymentWebhookEvent_values_ck" CHECK (trim("eventType") <> '' AND trim("dedupKey") <> '' AND typeof("retriedCount") = 'integer' AND "retriedCount" >= 0 AND typeof("attempts") = 'integer' AND "attempts" >= 0 AND length("payload") <= 100000 AND ("status" NOT IN ('PROCESSED', 'IGNORED') OR "processedAt" IS NOT NULL) AND ("status" <> 'FAILED' OR "lastError" IS NOT NULL) AND ("receivedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("processedAt" IS NULL OR "processedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- CreateTable
CREATE TABLE "CashReceipt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "paymentId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "receiptKey" TEXT,
    "issueNumber" TEXT,
    "receiptUrl" TEXT,
    "amount" INTEGER NOT NULL,
    "taxFreeAmount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "issuedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CashReceipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CashReceipt_type_enum_ck" CHECK ("type" IN ('INCOME_DEDUCTION', 'EXPENSE_PROOF')),
    CONSTRAINT "CashReceipt_status_enum_ck" CHECK ("status" IN ('ISSUED', 'CANCELED')),
    CONSTRAINT "CashReceipt_values_ck" CHECK (typeof("amount") = 'integer' AND "amount" >= 0 AND typeof("taxFreeAmount") = 'integer' AND "taxFreeAmount" >= 0 AND "taxFreeAmount" <= "amount" AND ("receiptUrl" IS NULL OR "receiptUrl" GLOB 'https://?*') AND ("issuedAt" IS NULL OR "issuedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- [데이터 이전] 기존 주문의 결제 키 → Payment (1차 시도로 기록. 승인 시각은 알 수 없어 주문 시각으로)
INSERT INTO "Payment" ("orderId", "attemptNo", "provider", "pgOrderId", "paymentKey", "method", "status", "amount", "canceledAmount", "balanceAmount", "taxFreeAmount", "currency", "approvedAt", "canceledAt", "syncedAt", "statusSource", "statusChangedAt", "createdAt", "updatedAt")
SELECT o."id", 1, 'TOSS', o."paymentOrderId", o."paymentKey", NULL,
  CASE o."status" WHEN 'CANCELED' THEN 'CANCELED' ELSE 'DONE' END,
  o."totalPrice",
  CASE o."status" WHEN 'CANCELED' THEN o."totalPrice" ELSE 0 END,
  CASE o."status" WHEN 'CANCELED' THEN 0 ELSE o."totalPrice" END,
  0, 'KRW', o."createdAt",
  CASE o."status" WHEN 'CANCELED' THEN o."createdAt" ELSE NULL END,
  NULL, 'MIGRATION', strftime('%Y-%m-%dT%H:%M:%f+00:00','now'), o."createdAt", strftime('%Y-%m-%dT%H:%M:%f+00:00','now')
FROM "Order" o WHERE o."paymentKey" IS NOT NULL AND o."status" IN ('PAID', 'CANCELED', 'CANCEL_FAILED');
INSERT INTO "PaymentCancel" ("paymentId", "cancelAmount", "taxFreeAmount", "reasonCode", "reasonText", "requestedBy", "status", "idempotencyKey", "transactionKey", "failCode", "failMessage", "requestedAt", "canceledAt", "updatedAt")
SELECT p."id", p."amount", 0, 'ORDER_ERROR', '주문 처리 오류로 자동 취소 (이전 데이터)', 'SYSTEM',
  CASE o."status" WHEN 'CANCELED' THEN 'DONE' ELSE 'FAILED' END,
  'migration-cancel-' || p."id",
  CASE o."status" WHEN 'CANCELED' THEN 'migration-tx-' || p."id" ELSE NULL END,
  CASE o."status" WHEN 'CANCELED' THEN NULL ELSE 'MIGRATION_UNKNOWN' END,
  CASE o."status" WHEN 'CANCELED' THEN NULL ELSE '이전 데이터: 취소 실패 기록' END,
  o."createdAt",
  CASE o."status" WHEN 'CANCELED' THEN o."createdAt" ELSE NULL END,
  strftime('%Y-%m-%dT%H:%M:%f+00:00','now')
FROM "Payment" p JOIN "Order" o ON o."id" = p."orderId" WHERE o."status" IN ('CANCELED', 'CANCEL_FAILED');
INSERT INTO "PaymentStatusHistory" ("paymentId", "fromStatus", "toStatus", "source", "canceledAmount", "failCode", "changedAt")
SELECT p."id", NULL, p."status", 'MIGRATION', p."canceledAmount", NULL, p."statusChangedAt" FROM "Payment" p;
CREATE TABLE "new_Order" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "paymentOrderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "totalPrice" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paidAt" DATETIME,
    "canceledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerId" INTEGER NOT NULL,
    CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_status_enum_ck" CHECK ("status" IN ('PENDING', 'WAITING_DEPOSIT', 'PAID', 'CANCELED', 'EXPIRED', 'CANCEL_FAILED')),
    CONSTRAINT "Order_total_ck" CHECK (typeof("totalPrice") = 'integer' AND "totalPrice" >= 1),
    CONSTRAINT "Order_payment_order_id_ck" CHECK (length("paymentOrderId") BETWEEN 6 AND 64 AND "paymentOrderId" NOT GLOB '*[^A-Za-z0-9_=-]*'),
    CONSTRAINT "Order_name_ck" CHECK (trim("orderName") <> '' AND length("orderName") <= 100),
    CONSTRAINT "Order_state_ck" CHECK (("status" IN ('PENDING', 'WAITING_DEPOSIT') AND "paidAt" IS NULL AND "canceledAt" IS NULL) OR ("status" = 'PAID' AND "paidAt" IS NOT NULL AND "canceledAt" IS NULL) OR ("status" IN ('CANCELED', 'EXPIRED') AND "canceledAt" IS NOT NULL) OR ("status" = 'CANCEL_FAILED')),
    CONSTRAINT "Order_dates_ck" CHECK (("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("paidAt" IS NULL OR "paidAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("canceledAt" IS NULL OR "canceledAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);
INSERT INTO "new_Order" ("createdAt", "customerId", "id", "orderName", "paymentOrderId", "status", "totalPrice", "paidAt", "canceledAt") SELECT "createdAt", "customerId", "id", "orderName", "paymentOrderId", "status", "totalPrice", CASE WHEN "status" IN ('PAID', 'CANCEL_FAILED') THEN "createdAt" END, CASE WHEN "status" = 'CANCELED' THEN "createdAt" END FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_paymentOrderId_key" ON "Order"("paymentOrderId");
CREATE INDEX "Order_customerId_createdAt_idx" ON "Order"("customerId", "createdAt");
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");
CREATE TABLE "new_InventoryReservation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "skuId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "expiresAt" DATETIME NOT NULL,
    "confirmedAt" DATETIME,
    "releasedAt" DATETIME,
    "releaseReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryReservation_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryReservation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryReservation_status_enum_ck" CHECK ("status" IN ('RESERVED', 'CONFIRMED', 'RELEASED', 'EXPIRED')),
    CONSTRAINT "InventoryReservation_releaseReason_enum_ck" CHECK ("releaseReason" IN ('PAYMENT_FAILED', 'SUPERSEDED', 'PRICE_CHANGED', 'COMPENSATED', 'RENEWED', 'ORDER_CANCELED', 'DEPOSIT_EXPIRED', 'ADMIN')),
    CONSTRAINT "InventoryReservation_qty_ck" CHECK (typeof("qty") = 'integer' AND "qty" >= 1),
    CONSTRAINT "InventoryReservation_expiry_ck" CHECK ("expiresAt" > "createdAt"),
    CONSTRAINT "InventoryReservation_state_ck" CHECK (("status" = 'RESERVED'  AND "confirmedAt" IS NULL     AND "releasedAt" IS NULL     AND "releaseReason" IS NULL) OR ("status" = 'CONFIRMED' AND "confirmedAt" IS NOT NULL AND "releasedAt" IS NULL     AND "releaseReason" IS NULL) OR ("status" = 'RELEASED'  AND "confirmedAt" IS NULL     AND "releasedAt" IS NOT NULL AND "releaseReason" IS NOT NULL) OR ("status" = 'EXPIRED'   AND "confirmedAt" IS NULL     AND "releasedAt" IS NOT NULL AND "releaseReason" IS NULL)),
    CONSTRAINT "InventoryReservation_dates_ck" CHECK (("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("expiresAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("confirmedAt" IS NULL OR "confirmedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("releasedAt" IS NULL OR "releasedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);
INSERT INTO "new_InventoryReservation" ("id", "orderId", "skuId", "locationId", "qty", "status", "expiresAt", "confirmedAt", "releasedAt", "releaseReason", "createdAt") SELECT "id", "orderId", "skuId", "locationId", "qty", "status", "expiresAt", "confirmedAt", "releasedAt", "releaseReason", "createdAt" FROM "InventoryReservation";
DROP TABLE "InventoryReservation";
ALTER TABLE "new_InventoryReservation" RENAME TO "InventoryReservation";
CREATE INDEX "InventoryReservation_skuId_locationId_status_idx" ON "InventoryReservation"("skuId", "locationId", "status");
CREATE INDEX "InventoryReservation_orderId_idx" ON "InventoryReservation"("orderId");
CREATE INDEX "InventoryReservation_status_expiresAt_idx" ON "InventoryReservation"("status", "expiresAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentKey_key" ON "Payment"("paymentKey");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_confirmIdempotencyKey_key" ON "Payment"("confirmIdempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_status_statusChangedAt_idx" ON "Payment"("status", "statusChangedAt");

-- CreateIndex
CREATE INDEX "Payment_pgOrderId_idx" ON "Payment"("pgOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_orderId_attemptNo_key" ON "Payment"("orderId", "attemptNo");

-- CreateIndex
CREATE INDEX "PaymentVirtualAccount_dueDate_idx" ON "PaymentVirtualAccount"("dueDate");

-- CreateIndex
CREATE INDEX "PaymentRefundAccount_paymentId_idx" ON "PaymentRefundAccount"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCancel_idempotencyKey_key" ON "PaymentCancel"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCancel_transactionKey_key" ON "PaymentCancel"("transactionKey");

-- CreateIndex
CREATE INDEX "PaymentCancel_paymentId_idx" ON "PaymentCancel"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentCancel_status_requestedAt_idx" ON "PaymentCancel"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "PaymentStatusHistory_paymentId_id_idx" ON "PaymentStatusHistory"("paymentId", "id");

-- CreateIndex
CREATE INDEX "PaymentApiLog_paymentId_idx" ON "PaymentApiLog"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentApiLog_createdAt_idx" ON "PaymentApiLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookEvent_dedupKey_key" ON "PaymentWebhookEvent"("dedupKey");

-- CreateIndex
CREATE INDEX "PaymentWebhookEvent_status_receivedAt_idx" ON "PaymentWebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CashReceipt_receiptKey_key" ON "CashReceipt"("receiptKey");

-- CreateIndex
CREATE INDEX "CashReceipt_paymentId_idx" ON "CashReceipt"("paymentId");

-- >>> db-constraints: 트리거 (prisma/db-constraints.ts에서 생성, 직접 수정 금지)

-- 예약 수량은 항상 RESERVED 예약 합계와 같아야 함
DROP TRIGGER IF EXISTS "InventoryBalance_reserved_guard";
CREATE TRIGGER "InventoryBalance_reserved_guard" BEFORE UPDATE OF "reserved" ON "InventoryBalance"
WHEN NEW."reserved" IS NOT (SELECT COALESCE(SUM(r."qty"), 0) FROM "InventoryReservation" r WHERE r."skuId" = NEW."skuId" AND r."locationId" = NEW."locationId" AND r."status" = 'RESERVED')
BEGIN SELECT RAISE(ABORT, 'InventoryBalance_reserved_guard: 예약 수량은 예약(InventoryReservation)으로만 바꿀 수 있습니다'); END;

-- 원장 기록이 있는 잔고 행 삭제 금지
DROP TRIGGER IF EXISTS "InventoryBalance_no_delete";
CREATE TRIGGER "InventoryBalance_no_delete" BEFORE DELETE ON "InventoryBalance"
WHEN EXISTS (SELECT 1 FROM "InventoryLedger" l WHERE l."skuId" = OLD."skuId" AND l."locationId" = OLD."locationId")
  OR EXISTS (SELECT 1 FROM "InventoryReservation" r WHERE r."skuId" = OLD."skuId" AND r."locationId" = OLD."locationId")
BEGIN SELECT RAISE(ABORT, 'InventoryBalance_no_delete: 원장·예약 기록이 있는 잔고는 지울 수 없습니다'); END;

-- 판매 가능 수량(실재고−예약−안전재고)보다 많이 예약 금지. DB가 한 번에 검사하므로 동시 주문에도 초과 판매 불가
DROP TRIGGER IF EXISTS "InventoryReservation_reserve";
CREATE TRIGGER "InventoryReservation_reserve" BEFORE INSERT ON "InventoryReservation"
BEGIN
SELECT CASE
  WHEN NEW."status" <> 'RESERVED'
    THEN RAISE(ABORT, 'InventoryReservation_reserve: 예약은 RESERVED 상태로만 만들 수 있습니다')
  WHEN NOT EXISTS (SELECT 1 FROM "InventoryLocation" loc WHERE loc."id" = NEW."locationId" AND loc."isOnlineSellable" = 1 AND loc."isActive" = 1)
    THEN RAISE(ABORT, 'InventoryReservation_reserve: 온라인 판매 위치가 아닙니다')
  WHEN EXISTS (SELECT 1 FROM "InventoryReservation" r WHERE r."orderId" = NEW."orderId" AND r."skuId" = NEW."skuId" AND r."status" = 'RESERVED')
    THEN RAISE(ABORT, 'InventoryReservation_reserve: 같은 주문에 이 SKU의 예약이 이미 있습니다')
  WHEN COALESCE((SELECT b."onHand" - b."reserved" - b."safetyStock" FROM "InventoryBalance" b WHERE b."skuId" = NEW."skuId" AND b."locationId" = NEW."locationId"), 0) < NEW."qty"
    THEN RAISE(ABORT, 'InventoryReservation_insufficient: 판매 가능 재고가 부족합니다')
END;
END;

-- 예약을 만들면 잔고의 예약 수량 자동 반영
DROP TRIGGER IF EXISTS "InventoryReservation_sync_ins";
CREATE TRIGGER "InventoryReservation_sync_ins" AFTER INSERT ON "InventoryReservation"
BEGIN
  UPDATE "InventoryBalance" SET "reserved" = (SELECT COALESCE(SUM(r."qty"), 0) FROM "InventoryReservation" r WHERE r."skuId" = NEW."skuId" AND r."locationId" = NEW."locationId" AND r."status" = 'RESERVED'), "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now') WHERE "skuId" = NEW."skuId" AND "locationId" = NEW."locationId";
END;

-- RESERVED에서만 상태 변경 가능 (확정된 예약을 되돌리기 금지), 만료 시각이 지난 예약은 확정 금지
DROP TRIGGER IF EXISTS "InventoryReservation_transition";
CREATE TRIGGER "InventoryReservation_transition" BEFORE UPDATE OF "status" ON "InventoryReservation"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
SELECT CASE
  WHEN OLD."status" <> 'RESERVED'
    THEN RAISE(ABORT, 'InventoryReservation_transition: 이미 처리된 예약은 상태를 바꿀 수 없습니다')
  WHEN NEW."status" = 'CONFIRMED' AND OLD."expiresAt" <= strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')
    THEN RAISE(ABORT, 'InventoryReservation_transition: 만료된 예약은 확정할 수 없습니다')
END;
END;

-- 예약의 주문·SKU·위치·수량·만료 시각은 바꿀 수 없음 (바꾸려면 해제 후 새로 예약)
DROP TRIGGER IF EXISTS "InventoryReservation_immutable";
CREATE TRIGGER "InventoryReservation_immutable" BEFORE UPDATE OF "orderId", "skuId", "locationId", "qty", "expiresAt", "createdAt" ON "InventoryReservation"
WHEN NEW."orderId" IS NOT OLD."orderId" OR NEW."skuId" IS NOT OLD."skuId" OR NEW."locationId" IS NOT OLD."locationId"
  OR NEW."qty" IS NOT OLD."qty" OR NEW."expiresAt" IS NOT OLD."expiresAt" OR NEW."createdAt" IS NOT OLD."createdAt"
BEGIN SELECT RAISE(ABORT, 'InventoryReservation_immutable: 예약 내용은 바꿀 수 없습니다. 해제 후 새로 예약하세요'); END;

-- 상태가 바뀌면 예약 수량을 다시 맞추고, 확정(CONFIRMED)이면 판매 원장(SALE)을 자동 생성 → 실재고 감소
DROP TRIGGER IF EXISTS "InventoryReservation_sync_upd";
CREATE TRIGGER "InventoryReservation_sync_upd" AFTER UPDATE OF "status" ON "InventoryReservation"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
  UPDATE "InventoryBalance" SET "reserved" = (SELECT COALESCE(SUM(r."qty"), 0) FROM "InventoryReservation" r WHERE r."skuId" = NEW."skuId" AND r."locationId" = NEW."locationId" AND r."status" = 'RESERVED'), "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now') WHERE "skuId" = NEW."skuId" AND "locationId" = NEW."locationId";
  INSERT INTO "InventoryLedger" ("skuId", "locationId", "type", "qty", "balanceAfter", "refType", "refId", "reservationId", "createdBy", "occurredAt", "createdAt")
  SELECT NEW."skuId", NEW."locationId", 'SALE', -NEW."qty", b."onHand" - NEW."qty", 'ORDER', CAST(NEW."orderId" AS TEXT), NEW."id", 'SYSTEM', strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'), strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')
  FROM "InventoryBalance" b
  WHERE NEW."status" = 'CONFIRMED' AND b."skuId" = NEW."skuId" AND b."locationId" = NEW."locationId";
END;

-- 예약 기록 삭제 금지 (해제·만료 상태로 남김)
DROP TRIGGER IF EXISTS "InventoryReservation_no_delete";
CREATE TRIGGER "InventoryReservation_no_delete" BEFORE DELETE ON "InventoryReservation"
BEGIN SELECT RAISE(ABORT, 'InventoryReservation_no_delete: 예약 기록은 지울 수 없습니다. 해제(RELEASED)하세요'); END;

-- 결제 대기 예약이 남아 있는 위치를 판매 중지·비활성화하면 확정할 재고가 사라짐
DROP TRIGGER IF EXISTS "InventoryLocation_deactivate_guard";
CREATE TRIGGER "InventoryLocation_deactivate_guard" BEFORE UPDATE OF "isActive", "isOnlineSellable" ON "InventoryLocation"
WHEN (NEW."isActive" = 0 OR NEW."isOnlineSellable" = 0)
  AND EXISTS (SELECT 1 FROM "InventoryReservation" r WHERE r."locationId" = NEW."id" AND r."status" = 'RESERVED')
BEGIN SELECT RAISE(ABORT, 'InventoryLocation_deactivate_guard: 결제 대기 예약이 있는 위치는 판매 중지할 수 없습니다'); END;

-- 탈퇴·탈퇴 신청·정지·휴면 고객은 새 주문 금지
DROP TRIGGER IF EXISTS "Order_customer_active";
CREATE TRIGGER "Order_customer_active" BEFORE INSERT ON "Order"
WHEN (SELECT c."status" FROM "Customer" c WHERE c."id" = NEW."customerId") IS NOT 'ACTIVE'
BEGIN SELECT RAISE(ABORT, 'Order_customer_active: 정상(ACTIVE) 상태의 고객만 주문할 수 있습니다'); END;

-- 주문은 결제 대기(PENDING)로만 생성. 결제 완료는 결제(Payment)를 거쳐야 함
DROP TRIGGER IF EXISTS "Order_insert_pending";
CREATE TRIGGER "Order_insert_pending" BEFORE INSERT ON "Order"
WHEN NEW."status" IS NOT 'PENDING'
BEGIN SELECT RAISE(ABORT, 'Order_insert_pending: 주문은 PENDING 상태로만 만들 수 있습니다'); END;

-- 결제 금액 비교 기준과 토스 주문번호가 바뀌면 결제와 어긋남
DROP TRIGGER IF EXISTS "Order_total_fixed";
CREATE TRIGGER "Order_total_fixed" BEFORE UPDATE OF "totalPrice", "paymentOrderId", "customerId" ON "Order"
WHEN NEW."totalPrice" IS NOT OLD."totalPrice" OR NEW."paymentOrderId" IS NOT OLD."paymentOrderId" OR NEW."customerId" IS NOT OLD."customerId"
BEGIN SELECT RAISE(ABORT, 'Order_total_fixed: 주문 금액·주문번호·고객은 바꿀 수 없습니다'); END;

-- 허용된 주문 상태 변경만 + 결제 상태와 맞아야 함 (결제 없이 결제 완료 금지, 돈이 걸린 결제가 있는데 취소 금지)
DROP TRIGGER IF EXISTS "Order_status_transition";
CREATE TRIGGER "Order_status_transition" BEFORE UPDATE OF "status" ON "Order"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
SELECT CASE
  WHEN (OLD."status" || '>' || NEW."status") NOT IN ('PENDING>WAITING_DEPOSIT', 'PENDING>PAID', 'PENDING>CANCELED', 'PENDING>CANCEL_FAILED', 'WAITING_DEPOSIT>PAID', 'WAITING_DEPOSIT>CANCELED', 'WAITING_DEPOSIT>EXPIRED', 'WAITING_DEPOSIT>CANCEL_FAILED', 'PAID>CANCELED', 'PAID>CANCEL_FAILED', 'CANCEL_FAILED>CANCELED', 'CANCEL_FAILED>PAID')
    THEN RAISE(ABORT, 'Order_status_transition: 허용되지 않은 주문 상태 변경입니다')
  WHEN NEW."status" = 'PAID' AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = NEW."id" AND p."status" IN ('DONE', 'PARTIAL_CANCELED') AND p."amount" = NEW."totalPrice")
    THEN RAISE(ABORT, 'Order_paid_guard: 주문 금액과 같은 완료된 결제가 없어 결제 완료로 바꿀 수 없습니다')
  WHEN NEW."status" = 'PAID' AND EXISTS (SELECT 1 FROM "InventoryReservation" r WHERE r."orderId" = NEW."id" AND r."status" = 'RESERVED')
    THEN RAISE(ABORT, 'Order_paid_guard: 재고 예약을 먼저 확정해야 결제 완료로 바꿀 수 있습니다')
  WHEN NEW."status" = 'WAITING_DEPOSIT' AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = NEW."id" AND p."status" = 'WAITING_FOR_DEPOSIT')
    THEN RAISE(ABORT, 'Order_status_transition: 입금 대기 결제(가상계좌)가 없습니다')
  WHEN NEW."status" IN ('CANCELED', 'EXPIRED') AND EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = NEW."id" AND p."status" IN ('IN_PROGRESS', 'UNKNOWN', 'WAITING_FOR_DEPOSIT', 'DONE', 'PARTIAL_CANCELED'))
    THEN RAISE(ABORT, 'Order_cancel_guard: 진행 중이거나 결제된 결제가 있어 취소할 수 없습니다. 결제를 먼저 취소하세요')
  WHEN NEW."status" = 'CANCEL_FAILED' AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = NEW."id" AND p."status" IN ('DONE', 'PARTIAL_CANCELED', 'WAITING_FOR_DEPOSIT'))
    THEN RAISE(ABORT, 'Order_status_transition: 취소 실패는 돈이 걸린 결제가 남아 있을 때만 기록합니다')
END;
END;

-- 주문·결제 기록은 5년 보관
DROP TRIGGER IF EXISTS "Order_no_delete";
CREATE TRIGGER "Order_no_delete" BEFORE DELETE ON "Order"
BEGIN SELECT RAISE(ABORT, 'Order_no_delete: 주문은 삭제할 수 없습니다 (전자상거래법 5년 보관)'); END;

-- 결제 대기·입금 대기 주문만 재고를 예약할 수 있음 (취소·완료된 주문이 재고를 다시 잡는 것 방지)
DROP TRIGGER IF EXISTS "InventoryReservation_order_open";
CREATE TRIGGER "InventoryReservation_order_open" BEFORE INSERT ON "InventoryReservation"
WHEN (SELECT o."status" FROM "Order" o WHERE o."id" = NEW."orderId") NOT IN ('PENDING', 'WAITING_DEPOSIT')
BEGIN SELECT RAISE(ABORT, 'InventoryReservation_order_open: 결제 대기·입금 대기 주문만 재고를 예약할 수 있습니다'); END;

-- 결제는 승인 시작(IN_PROGRESS) 또는 결제창 실패(ABORTED)로만 생성, 금액·주문번호는 주문과 같아야 함, 시도 번호는 순서대로, 한 주문에 진행 중·완료 결제는 1개만 (동시 승인 방지)
DROP TRIGGER IF EXISTS "Payment_insert_guard";
CREATE TRIGGER "Payment_insert_guard" BEFORE INSERT ON "Payment"
BEGIN
SELECT CASE
  WHEN NEW."status" NOT IN ('IN_PROGRESS', 'ABORTED')
    THEN RAISE(ABORT, 'Payment_insert_guard: 결제는 IN_PROGRESS(승인 시작) 또는 ABORTED(실패 기록)로만 만들 수 있습니다')
  WHEN NEW."amount" IS NOT (SELECT o."totalPrice" FROM "Order" o WHERE o."id" = NEW."orderId")
    THEN RAISE(ABORT, 'Payment_amount_match: 결제 금액이 주문 금액과 다릅니다')
  WHEN NEW."pgOrderId" IS NOT (SELECT o."paymentOrderId" FROM "Order" o WHERE o."id" = NEW."orderId")
    THEN RAISE(ABORT, 'Payment_insert_guard: 토스 주문번호가 주문과 다릅니다')
  WHEN NEW."attemptNo" IS NOT (SELECT COALESCE(MAX(p."attemptNo"), 0) + 1 FROM "Payment" p WHERE p."orderId" = NEW."orderId")
    THEN RAISE(ABORT, 'Payment_insert_guard: 시도 번호는 이전 시도 + 1이어야 합니다')
  WHEN NEW."status" = 'IN_PROGRESS' AND (SELECT o."status" FROM "Order" o WHERE o."id" = NEW."orderId") IS NOT 'PENDING'
    THEN RAISE(ABORT, 'Payment_order_pending: 결제 대기 주문만 결제를 시작할 수 있습니다')
  WHEN NEW."status" = 'IN_PROGRESS' AND EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = NEW."orderId" AND p."status" IN ('IN_PROGRESS', 'UNKNOWN', 'WAITING_FOR_DEPOSIT', 'DONE', 'PARTIAL_CANCELED'))
    THEN RAISE(ABORT, 'Payment_one_active: 이 주문은 이미 결제가 진행 중이거나 완료되었습니다')
END;
END;

-- 결제 기본 정보 변경 금지
DROP TRIGGER IF EXISTS "Payment_immutable";
CREATE TRIGGER "Payment_immutable" BEFORE UPDATE OF "orderId", "attemptNo", "provider", "pgOrderId", "amount", "confirmIdempotencyKey", "createdAt" ON "Payment"
WHEN NEW."orderId" IS NOT OLD."orderId" OR NEW."attemptNo" IS NOT OLD."attemptNo" OR NEW."provider" IS NOT OLD."provider" OR NEW."pgOrderId" IS NOT OLD."pgOrderId" OR NEW."amount" IS NOT OLD."amount" OR NEW."confirmIdempotencyKey" IS NOT OLD."confirmIdempotencyKey" OR NEW."createdAt" IS NOT OLD."createdAt"
BEGIN SELECT RAISE(ABORT, 'Payment_immutable: 결제의 주문·금액·시도 번호·멱등키는 바꿀 수 없습니다'); END;

-- 결제 키는 한 번 정해지면 변경 금지 (다른 결제로 바꿔치기 방지)
DROP TRIGGER IF EXISTS "Payment_key_fixed";
CREATE TRIGGER "Payment_key_fixed" BEFORE UPDATE OF "paymentKey" ON "Payment"
WHEN OLD."paymentKey" IS NOT NULL AND NEW."paymentKey" IS NOT OLD."paymentKey"
BEGIN SELECT RAISE(ABORT, 'Payment_key_fixed: 결제 키는 바꿀 수 없습니다'); END;

-- 허용된 결제 상태 변경만 (실패·만료·전액취소는 되돌릴 수 없음)
DROP TRIGGER IF EXISTS "Payment_status_transition";
CREATE TRIGGER "Payment_status_transition" BEFORE UPDATE OF "status" ON "Payment"
WHEN NEW."status" IS NOT OLD."status" AND (OLD."status" || '>' || NEW."status") NOT IN ('IN_PROGRESS>UNKNOWN', 'IN_PROGRESS>DONE', 'IN_PROGRESS>WAITING_FOR_DEPOSIT', 'IN_PROGRESS>ABORTED', 'IN_PROGRESS>EXPIRED', 'UNKNOWN>IN_PROGRESS', 'UNKNOWN>DONE', 'UNKNOWN>WAITING_FOR_DEPOSIT', 'UNKNOWN>ABORTED', 'UNKNOWN>EXPIRED', 'WAITING_FOR_DEPOSIT>DONE', 'WAITING_FOR_DEPOSIT>CANCELED', 'WAITING_FOR_DEPOSIT>EXPIRED', 'DONE>PARTIAL_CANCELED', 'DONE>CANCELED', 'PARTIAL_CANCELED>CANCELED')
BEGIN SELECT RAISE(ABORT, 'Payment_status_transition: 허용되지 않은 결제 상태 변경입니다'); END;

-- 취소 금액은 완료된 취소(PaymentCancel DONE)의 합계와 항상 같음 → 앱이 숫자를 직접 못 바꿈
DROP TRIGGER IF EXISTS "Payment_amount_guard";
CREATE TRIGGER "Payment_amount_guard" BEFORE UPDATE OF "canceledAmount", "balanceAmount" ON "Payment"
WHEN NEW."canceledAmount" IS NOT (SELECT COALESCE(SUM(c."cancelAmount"), 0) FROM "PaymentCancel" c WHERE c."paymentId" = NEW."id" AND c."status" = 'DONE')
BEGIN SELECT RAISE(ABORT, 'Payment_amount_guard: 취소 금액은 결제 취소(PaymentCancel)로만 바꿀 수 있습니다'); END;

-- 결제가 생기면 상태 이력 첫 줄 자동 기록
DROP TRIGGER IF EXISTS "Payment_status_history_ins";
CREATE TRIGGER "Payment_status_history_ins" AFTER INSERT ON "Payment"
BEGIN
  INSERT INTO "PaymentStatusHistory" ("paymentId", "fromStatus", "toStatus", "source", "canceledAmount", "failCode", "changedAt")
  VALUES (NEW."id", NULL, NEW."status", NEW."statusSource", NEW."canceledAmount", NEW."failCode", NEW."statusChangedAt");
END;

-- 상태나 취소 금액이 바뀌면 이력 자동 기록 (부분 취소를 여러 번 해도 매번 남음)
DROP TRIGGER IF EXISTS "Payment_status_history_upd";
CREATE TRIGGER "Payment_status_history_upd" AFTER UPDATE OF "status", "canceledAmount" ON "Payment"
WHEN NEW."status" IS NOT OLD."status" OR NEW."canceledAmount" IS NOT OLD."canceledAmount"
BEGIN
  INSERT INTO "PaymentStatusHistory" ("paymentId", "fromStatus", "toStatus", "source", "canceledAmount", "failCode", "changedAt")
  VALUES (NEW."id", OLD."status", NEW."status", NEW."statusSource", NEW."canceledAmount", NEW."failCode", NEW."statusChangedAt");
END;

-- 결제 기록 보관
DROP TRIGGER IF EXISTS "Payment_no_delete";
CREATE TRIGGER "Payment_no_delete" BEFORE DELETE ON "Payment"
BEGIN SELECT RAISE(ABORT, 'Payment_no_delete: 결제 기록은 삭제할 수 없습니다 (5년 보관)'); END;

-- 카드 상세는 해당 결제수단의 결제에만
DROP TRIGGER IF EXISTS "PaymentCard_method";
CREATE TRIGGER "PaymentCard_method" BEFORE INSERT ON "PaymentCard"
WHEN (SELECT p."method" FROM "Payment" p WHERE p."id" = NEW."paymentId") IS NULL
  OR (SELECT p."method" FROM "Payment" p WHERE p."id" = NEW."paymentId") NOT IN ('CARD', 'EASY_PAY')
BEGIN SELECT RAISE(ABORT, 'PaymentCard_method: 카드 상세는 결제수단이 CARD/EASY_PAY인 결제에만 추가할 수 있습니다'); END;

-- 간편결제 상세는 해당 결제수단의 결제에만
DROP TRIGGER IF EXISTS "PaymentEasyPay_method";
CREATE TRIGGER "PaymentEasyPay_method" BEFORE INSERT ON "PaymentEasyPay"
WHEN (SELECT p."method" FROM "Payment" p WHERE p."id" = NEW."paymentId") IS NULL
  OR (SELECT p."method" FROM "Payment" p WHERE p."id" = NEW."paymentId") NOT IN ('EASY_PAY')
BEGIN SELECT RAISE(ABORT, 'PaymentEasyPay_method: 간편결제 상세는 결제수단이 EASY_PAY인 결제에만 추가할 수 있습니다'); END;

-- 가상계좌 상세는 해당 결제수단의 결제에만
DROP TRIGGER IF EXISTS "PaymentVirtualAccount_method";
CREATE TRIGGER "PaymentVirtualAccount_method" BEFORE INSERT ON "PaymentVirtualAccount"
WHEN (SELECT p."method" FROM "Payment" p WHERE p."id" = NEW."paymentId") IS NULL
  OR (SELECT p."method" FROM "Payment" p WHERE p."id" = NEW."paymentId") NOT IN ('VIRTUAL_ACCOUNT')
BEGIN SELECT RAISE(ABORT, 'PaymentVirtualAccount_method: 가상계좌 상세는 결제수단이 VIRTUAL_ACCOUNT인 결제에만 추가할 수 있습니다'); END;

-- 발급된 계좌번호를 바꾸면 고객이 엉뚱한 계좌로 입금
DROP TRIGGER IF EXISTS "PaymentVirtualAccount_fixed";
CREATE TRIGGER "PaymentVirtualAccount_fixed" BEFORE UPDATE OF "bankCode", "accountNumberEnc", "paymentId" ON "PaymentVirtualAccount"
WHEN NEW."bankCode" IS NOT OLD."bankCode" OR NEW."accountNumberEnc" IS NOT OLD."accountNumberEnc" OR NEW."paymentId" IS NOT OLD."paymentId"
BEGIN SELECT RAISE(ABORT, 'PaymentVirtualAccount_fixed: 발급된 가상계좌 정보는 바꿀 수 없습니다'); END;

-- 결제 기록 보관
DROP TRIGGER IF EXISTS "PaymentCard_no_delete";
CREATE TRIGGER "PaymentCard_no_delete" BEFORE DELETE ON "PaymentCard"
BEGIN SELECT RAISE(ABORT, 'PaymentCard_no_delete: 결제 상세는 삭제할 수 없습니다'); END;

-- 결제 기록 보관
DROP TRIGGER IF EXISTS "PaymentEasyPay_no_delete";
CREATE TRIGGER "PaymentEasyPay_no_delete" BEFORE DELETE ON "PaymentEasyPay"
BEGIN SELECT RAISE(ABORT, 'PaymentEasyPay_no_delete: 결제 상세는 삭제할 수 없습니다'); END;

-- 결제 기록 보관
DROP TRIGGER IF EXISTS "PaymentVirtualAccount_no_delete";
CREATE TRIGGER "PaymentVirtualAccount_no_delete" BEFORE DELETE ON "PaymentVirtualAccount"
BEGIN SELECT RAISE(ABORT, 'PaymentVirtualAccount_no_delete: 결제 상세는 삭제할 수 없습니다'); END;

-- 환불 계좌 변경 금지 (어느 계좌로 환불했는지 남겨야 함)
DROP TRIGGER IF EXISTS "PaymentRefundAccount_fixed";
CREATE TRIGGER "PaymentRefundAccount_fixed" BEFORE UPDATE OF "paymentId", "bankCode", "accountNumberMasked", "holderNameMasked", "createdAt" ON "PaymentRefundAccount"
WHEN NEW."paymentId" IS NOT OLD."paymentId" OR NEW."bankCode" IS NOT OLD."bankCode" OR NEW."accountNumberMasked" IS NOT OLD."accountNumberMasked" OR NEW."holderNameMasked" IS NOT OLD."holderNameMasked" OR NEW."createdAt" IS NOT OLD."createdAt"
BEGIN SELECT RAISE(ABORT, 'PaymentRefundAccount_fixed: 환불 계좌는 바꿀 수 없습니다. 새로 등록하세요'); END;

-- 암호문은 지우는 것(파기)만 가능, 다른 값으로 바꿀 수 없음
DROP TRIGGER IF EXISTS "PaymentRefundAccount_wipe_only";
CREATE TRIGGER "PaymentRefundAccount_wipe_only" BEFORE UPDATE OF "accountNumberEnc", "holderNameEnc" ON "PaymentRefundAccount"
WHEN (NEW."accountNumberEnc" IS NOT NULL AND NEW."accountNumberEnc" IS NOT OLD."accountNumberEnc")
  OR (NEW."holderNameEnc" IS NOT NULL AND NEW."holderNameEnc" IS NOT OLD."holderNameEnc")
BEGIN SELECT RAISE(ABORT, 'PaymentRefundAccount_wipe_only: 환불 계좌 암호문은 파기(NULL)만 할 수 있습니다'); END;

-- 환불 기록 보관
DROP TRIGGER IF EXISTS "PaymentRefundAccount_no_delete";
CREATE TRIGGER "PaymentRefundAccount_no_delete" BEFORE DELETE ON "PaymentRefundAccount"
BEGIN SELECT RAISE(ABORT, 'PaymentRefundAccount_no_delete: 환불 계좌 기록은 삭제할 수 없습니다 (가린 값은 남김)'); END;

-- 완료된 결제만 취소, 남은 금액을 넘는 취소 금지(진행 중인 취소 포함 → 동시에 두 번 취소해도 초과 불가), 입금 전 가상계좌는 전액만, 입금된 가상계좌는 환불 계좌 필수
DROP TRIGGER IF EXISTS "PaymentCancel_insert_guard";
CREATE TRIGGER "PaymentCancel_insert_guard" BEFORE INSERT ON "PaymentCancel"
BEGIN
SELECT CASE
  WHEN NEW."status" <> 'REQUESTED' AND NOT (NEW."status" = 'DONE' AND NEW."reasonCode" = 'PG_SYNC')
    THEN RAISE(ABORT, 'PaymentCancel_insert_guard: 취소는 REQUESTED로 만들고 결과를 반영합니다 (토스에서 이미 취소된 것을 반영하는 PG_SYNC만 DONE으로 기록)')
  WHEN (SELECT p."status" FROM "Payment" p WHERE p."id" = NEW."paymentId") NOT IN ('DONE', 'PARTIAL_CANCELED', 'WAITING_FOR_DEPOSIT')
    THEN RAISE(ABORT, 'PaymentCancel_payment_state: 완료되었거나 입금 대기 중인 결제만 취소할 수 있습니다')
  WHEN (SELECT p."status" FROM "Payment" p WHERE p."id" = NEW."paymentId") = 'WAITING_FOR_DEPOSIT'
      AND (NEW."cancelAmount" IS NOT (SELECT p."amount" FROM "Payment" p WHERE p."id" = NEW."paymentId") OR NEW."refundAccountId" IS NOT NULL)
    THEN RAISE(ABORT, 'PaymentCancel_waiting_deposit: 입금 전 가상계좌는 전액 취소만 가능합니다 (환불 계좌 불필요)')
  WHEN (SELECT COALESCE(SUM(c."cancelAmount"), 0) FROM "PaymentCancel" c WHERE c."paymentId" = NEW."paymentId" AND c."status" IN ('REQUESTED', 'UNKNOWN', 'DONE')) + NEW."cancelAmount"
      > (SELECT p."amount" FROM "Payment" p WHERE p."id" = NEW."paymentId")
    THEN RAISE(ABORT, 'PaymentCancel_exceeds: 취소 금액이 남은 결제 금액을 넘습니다')
  WHEN NEW."refundAccountId" IS NOT NULL AND (SELECT a."paymentId" FROM "PaymentRefundAccount" a WHERE a."id" = NEW."refundAccountId") IS NOT NEW."paymentId"
    THEN RAISE(ABORT, 'PaymentCancel_insert_guard: 다른 결제의 환불 계좌입니다')
  WHEN NEW."reasonCode" <> 'PG_SYNC' AND NEW."refundAccountId" IS NULL
      AND (SELECT p."method" || '/' || p."status" FROM "Payment" p WHERE p."id" = NEW."paymentId") IN ('VIRTUAL_ACCOUNT/DONE', 'VIRTUAL_ACCOUNT/PARTIAL_CANCELED')
    THEN RAISE(ABORT, 'PaymentCancel_refund_account: 입금된 가상계좌 결제를 취소하려면 환불 계좌가 필요합니다')
END;
END;

-- 취소 상태는 정해진 길로만 (완료·실패는 되돌릴 수 없음)
DROP TRIGGER IF EXISTS "PaymentCancel_transition";
CREATE TRIGGER "PaymentCancel_transition" BEFORE UPDATE OF "status" ON "PaymentCancel"
WHEN NEW."status" IS NOT OLD."status" AND (OLD."status" || '>' || NEW."status") NOT IN ('REQUESTED>DONE', 'REQUESTED>FAILED', 'REQUESTED>UNKNOWN', 'UNKNOWN>DONE', 'UNKNOWN>FAILED')
BEGIN SELECT RAISE(ABORT, 'PaymentCancel_transition: 허용되지 않은 취소 상태 변경입니다'); END;

-- 취소 요청 내용 변경 금지 (멱등키와 내용이 어긋나면 위험)
DROP TRIGGER IF EXISTS "PaymentCancel_immutable";
CREATE TRIGGER "PaymentCancel_immutable" BEFORE UPDATE OF "paymentId", "cancelAmount", "taxFreeAmount", "reasonCode", "idempotencyKey", "refundAccountId", "requestedAt" ON "PaymentCancel"
WHEN NEW."paymentId" IS NOT OLD."paymentId" OR NEW."cancelAmount" IS NOT OLD."cancelAmount" OR NEW."taxFreeAmount" IS NOT OLD."taxFreeAmount" OR NEW."reasonCode" IS NOT OLD."reasonCode" OR NEW."idempotencyKey" IS NOT OLD."idempotencyKey" OR NEW."refundAccountId" IS NOT OLD."refundAccountId" OR NEW."requestedAt" IS NOT OLD."requestedAt"
BEGIN SELECT RAISE(ABORT, 'PaymentCancel_immutable: 취소 요청 내용은 바꿀 수 없습니다. 새로 요청하세요'); END;

-- 취소가 완료되면 결제의 취소 금액·잔액·상태(부분/전액 취소)를 자동 계산
DROP TRIGGER IF EXISTS "PaymentCancel_apply_upd";
CREATE TRIGGER "PaymentCancel_apply_upd" AFTER UPDATE OF "status" ON "PaymentCancel"
WHEN NEW."status" = 'DONE' AND OLD."status" IS NOT 'DONE'
BEGIN
  UPDATE "Payment" SET
    "canceledAmount" = (SELECT COALESCE(SUM(c."cancelAmount"), 0) FROM "PaymentCancel" c WHERE c."paymentId" = NEW."paymentId" AND c."status" = 'DONE'),
    "balanceAmount" = "amount" - (SELECT COALESCE(SUM(c."cancelAmount"), 0) FROM "PaymentCancel" c WHERE c."paymentId" = NEW."paymentId" AND c."status" = 'DONE'),
    "status" = CASE WHEN (SELECT COALESCE(SUM(c."cancelAmount"), 0) FROM "PaymentCancel" c WHERE c."paymentId" = NEW."paymentId" AND c."status" = 'DONE') >= "amount" THEN 'CANCELED' ELSE 'PARTIAL_CANCELED' END,
    "canceledAt" = CASE WHEN (SELECT COALESCE(SUM(c."cancelAmount"), 0) FROM "PaymentCancel" c WHERE c."paymentId" = NEW."paymentId" AND c."status" = 'DONE') >= "amount" THEN NEW."canceledAt" ELSE "canceledAt" END,
    "statusSource" = 'CANCEL',
    "statusChangedAt" = NEW."canceledAt",
    "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')
  WHERE "id" = NEW."paymentId";
END;

-- 토스 쪽 취소를 반영(PG_SYNC, 처음부터 DONE)할 때도 같은 계산
DROP TRIGGER IF EXISTS "PaymentCancel_apply_ins";
CREATE TRIGGER "PaymentCancel_apply_ins" AFTER INSERT ON "PaymentCancel"
WHEN NEW."status" = 'DONE'
BEGIN
  UPDATE "Payment" SET
    "canceledAmount" = (SELECT COALESCE(SUM(c."cancelAmount"), 0) FROM "PaymentCancel" c WHERE c."paymentId" = NEW."paymentId" AND c."status" = 'DONE'),
    "balanceAmount" = "amount" - (SELECT COALESCE(SUM(c."cancelAmount"), 0) FROM "PaymentCancel" c WHERE c."paymentId" = NEW."paymentId" AND c."status" = 'DONE'),
    "status" = CASE WHEN (SELECT COALESCE(SUM(c."cancelAmount"), 0) FROM "PaymentCancel" c WHERE c."paymentId" = NEW."paymentId" AND c."status" = 'DONE') >= "amount" THEN 'CANCELED' ELSE 'PARTIAL_CANCELED' END,
    "canceledAt" = CASE WHEN (SELECT COALESCE(SUM(c."cancelAmount"), 0) FROM "PaymentCancel" c WHERE c."paymentId" = NEW."paymentId" AND c."status" = 'DONE') >= "amount" THEN NEW."canceledAt" ELSE "canceledAt" END,
    "statusSource" = 'CANCEL',
    "statusChangedAt" = NEW."canceledAt",
    "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')
  WHERE "id" = NEW."paymentId";
END;

-- 취소·환불 기록 보관
DROP TRIGGER IF EXISTS "PaymentCancel_no_delete";
CREATE TRIGGER "PaymentCancel_no_delete" BEFORE DELETE ON "PaymentCancel"
BEGIN SELECT RAISE(ABORT, 'PaymentCancel_no_delete: 취소 기록은 삭제할 수 없습니다'); END;

-- 이력은 수정 금지
DROP TRIGGER IF EXISTS "PaymentStatusHistory_no_update";
CREATE TRIGGER "PaymentStatusHistory_no_update" BEFORE UPDATE ON "PaymentStatusHistory"
BEGIN SELECT RAISE(ABORT, 'PaymentStatusHistory_append_only: 이력은 수정할 수 없습니다'); END;

-- 이력은 삭제 금지
DROP TRIGGER IF EXISTS "PaymentStatusHistory_no_delete";
CREATE TRIGGER "PaymentStatusHistory_no_delete" BEFORE DELETE ON "PaymentStatusHistory"
BEGIN SELECT RAISE(ABORT, 'PaymentStatusHistory_append_only: 이력은 삭제할 수 없습니다'); END;

-- API 기록은 수정 금지
DROP TRIGGER IF EXISTS "PaymentApiLog_no_update";
CREATE TRIGGER "PaymentApiLog_no_update" BEFORE UPDATE ON "PaymentApiLog"
BEGIN SELECT RAISE(ABORT, 'PaymentApiLog_append_only: API 기록은 수정할 수 없습니다'); END;

-- API 기록은 1년(365일)이 지난 것만 삭제 가능 (내부 보관 정책)
DROP TRIGGER IF EXISTS "PaymentApiLog_retention";
CREATE TRIGGER "PaymentApiLog_retention" BEFORE DELETE ON "PaymentApiLog"
WHEN julianday(strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')) - julianday(OLD."createdAt") < 365
BEGIN SELECT RAISE(ABORT, 'PaymentApiLog_retention: 1년이 지나지 않은 API 기록은 지울 수 없습니다'); END;

-- 받은 알림 원문 보존
DROP TRIGGER IF EXISTS "PaymentWebhookEvent_immutable";
CREATE TRIGGER "PaymentWebhookEvent_immutable" BEFORE UPDATE OF "eventType", "dedupKey", "payload", "receivedAt" ON "PaymentWebhookEvent"
WHEN NEW."eventType" IS NOT OLD."eventType" OR NEW."dedupKey" IS NOT OLD."dedupKey" OR NEW."payload" IS NOT OLD."payload" OR NEW."receivedAt" IS NOT OLD."receivedAt"
BEGIN SELECT RAISE(ABORT, 'PaymentWebhookEvent_immutable: 받은 웹훅 원문은 바꿀 수 없습니다'); END;

-- 받은 알림 기록 보관
DROP TRIGGER IF EXISTS "PaymentWebhookEvent_no_delete";
CREATE TRIGGER "PaymentWebhookEvent_no_delete" BEFORE DELETE ON "PaymentWebhookEvent"
BEGIN SELECT RAISE(ABORT, 'PaymentWebhookEvent_no_delete: 웹훅 기록은 삭제할 수 없습니다'); END;

-- 세무 기록 보관
DROP TRIGGER IF EXISTS "CashReceipt_no_delete";
CREATE TRIGGER "CashReceipt_no_delete" BEFORE DELETE ON "CashReceipt"
BEGIN SELECT RAISE(ABORT, 'CashReceipt_no_delete: 현금영수증 기록은 삭제할 수 없습니다'); END;

-- <<< db-constraints
