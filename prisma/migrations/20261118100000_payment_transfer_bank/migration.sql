-- >>> db-constraints: 영향받는 트리거 먼저 제거 (prisma/db-constraints.ts에서 생성, 직접 수정 금지)
DROP TRIGGER IF EXISTS "Order_status_transition";
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
DROP TRIGGER IF EXISTS "PaymentCancel_insert_guard";
DROP TRIGGER IF EXISTS "PaymentCancel_apply_upd";
DROP TRIGGER IF EXISTS "PaymentCancel_apply_ins";
-- <<< db-constraints-top

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "transferBankCode" TEXT;

-- >>> db-constraints: 트리거 (prisma/db-constraints.ts에서 생성, 직접 수정 금지)

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

-- <<< db-constraints
