-- >>> db-constraints: 영향받는 트리거 먼저 제거 (prisma/db-constraints.ts에서 생성, 직접 수정 금지)
DROP TRIGGER IF EXISTS "InventoryReservation_transition";
DROP TRIGGER IF EXISTS "Order_customer_active";
DROP TRIGGER IF EXISTS "Order_insert_pending";
DROP TRIGGER IF EXISTS "Order_total_fixed";
DROP TRIGGER IF EXISTS "Order_status_transition";
DROP TRIGGER IF EXISTS "Order_no_delete";
DROP TRIGGER IF EXISTS "InventoryReservation_order_open";
DROP TRIGGER IF EXISTS "Payment_insert_guard";
DROP TRIGGER IF EXISTS "Order_shipping_rule";
DROP TRIGGER IF EXISTS "Order_fulfillment_guard";
DROP TRIGGER IF EXISTS "Order_status_cascade";
DROP TRIGGER IF EXISTS "Order_status_history_ins";
DROP TRIGGER IF EXISTS "Order_status_history_upd";
DROP TRIGGER IF EXISTS "Order_orderer_fixed";
DROP TRIGGER IF EXISTS "OrderItem_insert_guard";
DROP TRIGGER IF EXISTS "OrderItem_status_transition";
DROP TRIGGER IF EXISTS "OrderItem_fulfillment";
DROP TRIGGER IF EXISTS "Order_link_guard";
DROP TRIGGER IF EXISTS "GuestOrderAccess_insert_guard";
DROP TRIGGER IF EXISTS "GuestOrderAccess_update_guard";
DROP TRIGGER IF EXISTS "GuestOrderAccess_no_delete";
DROP TRIGGER IF EXISTS "GuestOrderSession_insert_guard";
DROP TRIGGER IF EXISTS "GuestOrderSession_revoke_only";
DROP TRIGGER IF EXISTS "GuestOrderSession_delete_guard";
DROP TRIGGER IF EXISTS "GuestLookupAttempt_no_update";
DROP TRIGGER IF EXISTS "GuestLookupAttempt_retention";
DROP TRIGGER IF EXISTS "Payment_order_ready";
DROP TRIGGER IF EXISTS "OrderShippingAddress_insert_guard";
DROP TRIGGER IF EXISTS "OrderShippingAddress_update_guard";
DROP TRIGGER IF EXISTS "ShippingPolicy_used_fixed";
DROP TRIGGER IF EXISTS "ShippingSurchargeZone_no_overlap_ins";
DROP TRIGGER IF EXISTS "ShippingSurchargeZone_used_fixed";
DROP TRIGGER IF EXISTS "ShippingSurchargeZone_no_delete";
DROP TRIGGER IF EXISTS "Shipment_insert_guard";
DROP TRIGGER IF EXISTS "Shipment_transition";
-- <<< db-constraints-top

-- CreateTable
CREATE TABLE "GuestOrderAccess" (
    "orderId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "passwordHash" TEXT,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "lastFailedAt" DATETIME,
    "lastAccessAt" DATETIME,
    "privacyConsentAt" DATETIME NOT NULL,
    "privacyConsentVersion" TEXT NOT NULL,
    "claimedAt" DATETIME,
    "claimedByCustomerId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GuestOrderAccess_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GuestOrderAccess_claimedByCustomerId_fkey" FOREIGN KEY ("claimedByCustomerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GuestOrderAccess_values_ck" CHECK (("passwordHash" IS NULL OR ("passwordHash" GLOB 's1:?*:?*' AND length("passwordHash") BETWEEN 40 AND 300)) AND (typeof("failedCount") = 'integer' AND "failedCount" >= 0) AND trim("privacyConsentVersion") <> '' AND ("claimedAt" IS NULL) = ("claimedByCustomerId" IS NULL) AND ("lockedUntil" IS NULL OR "lockedUntil" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("lastFailedAt" IS NULL OR "lastFailedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("lastAccessAt" IS NULL OR "lastAccessAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("privacyConsentAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("claimedAt" IS NULL OR "claimedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("updatedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- CreateTable
CREATE TABLE "GuestOrderSession" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "ipMasked" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GuestOrderSession_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GuestOrderSession_purpose_enum_ck" CHECK ("purpose" IN ('CHECKOUT', 'LOOKUP')),
    CONSTRAINT "GuestOrderSession_values_ck" CHECK (length("tokenHash") = 64 AND "tokenHash" NOT GLOB '*[^0-9a-f]*' AND "expiresAt" > "createdAt" AND ("expiresAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("revokedAt" IS NULL OR "revokedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- CreateTable
CREATE TABLE "GuestLookupAttempt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "purpose" TEXT NOT NULL,
    "orderNoInput" TEXT NOT NULL,
    "orderId" INTEGER,
    "customerId" INTEGER,
    "result" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "ipMasked" TEXT,
    "attemptedAt" DATETIME NOT NULL,
    CONSTRAINT "GuestLookupAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GuestLookupAttempt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GuestLookupAttempt_purpose_enum_ck" CHECK ("purpose" IN ('LOOKUP', 'CLAIM')),
    CONSTRAINT "GuestLookupAttempt_result_enum_ck" CHECK ("result" IN ('SUCCESS', 'WRONG', 'LOCKED', 'RATE_LIMITED', 'CLAIMED_ALREADY')),
    CONSTRAINT "GuestLookupAttempt_values_ck" CHECK (length("ipHash") = 64 AND "ipHash" NOT GLOB '*[^0-9a-f]*' AND length("orderNoInput") BETWEEN 1 AND 20 AND ("purpose" = 'CLAIM') = ("customerId" IS NOT NULL) AND ("attemptedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Order" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderNo" TEXT NOT NULL,
    "paymentOrderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "customerId" INTEGER,
    "ordererType" TEXT NOT NULL,
    "linkedAt" DATETIME,
    "channel" TEXT NOT NULL DEFAULT 'WEB',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "statusChangedAt" DATETIME NOT NULL,
    "statusChangedBy" TEXT NOT NULL DEFAULT 'SYSTEM',
    "statusMemo" TEXT,
    "fulfillmentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "itemsListTotal" INTEGER NOT NULL,
    "itemsDiscountTotal" INTEGER NOT NULL,
    "itemsTotal" INTEGER NOT NULL,
    "couponDiscountTotal" INTEGER NOT NULL DEFAULT 0,
    "shippingBaseFee" INTEGER NOT NULL,
    "shippingExtraFee" INTEGER NOT NULL DEFAULT 0,
    "shippingFee" INTEGER NOT NULL,
    "shippingDiscount" INTEGER NOT NULL DEFAULT 0,
    "pointUsed" INTEGER NOT NULL DEFAULT 0,
    "totalPrice" INTEGER NOT NULL,
    "shippingPolicyId" INTEGER NOT NULL,
    "freeShippingThreshold" INTEGER,
    "ordererNameEnc" TEXT,
    "ordererPhoneEnc" TEXT,
    "ordererPhoneHash" TEXT,
    "ordererEmailEnc" TEXT,
    "paidAt" DATETIME,
    "canceledAt" DATETIME,
    "confirmedAt" DATETIME,
    "piiPurgedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_shippingPolicyId_fkey" FOREIGN KEY ("shippingPolicyId") REFERENCES "ShippingPolicy" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_ordererType_enum_ck" CHECK ("ordererType" IN ('MEMBER', 'GUEST')),
    CONSTRAINT "Order_channel_enum_ck" CHECK ("channel" IN ('WEB', 'MOBILE_WEB')),
    CONSTRAINT "Order_status_enum_ck" CHECK ("status" IN ('PENDING', 'WAITING_DEPOSIT', 'PAID', 'CANCELED', 'EXPIRED', 'CANCEL_FAILED')),
    CONSTRAINT "Order_statusChangedBy_enum_ck" CHECK ("statusChangedBy" IN ('CUSTOMER', 'ADMIN', 'SYSTEM')),
    CONSTRAINT "Order_fulfillmentStatus_enum_ck" CHECK ("fulfillmentStatus" IN ('UNPAID', 'PAID', 'PREPARING', 'PARTIALLY_SHIPPED', 'SHIPPED', 'DELIVERED', 'CONFIRMED', 'CANCELED')),
    CONSTRAINT "Order_total_ck" CHECK (typeof("totalPrice") = 'integer' AND "totalPrice" >= 1),
    CONSTRAINT "Order_payment_order_id_ck" CHECK (length("paymentOrderId") BETWEEN 6 AND 64 AND "paymentOrderId" NOT GLOB '*[^A-Za-z0-9_=-]*'),
    CONSTRAINT "Order_name_ck" CHECK (trim("orderName") <> '' AND length("orderName") <= 100),
    CONSTRAINT "Order_state_ck" CHECK (("status" IN ('PENDING', 'WAITING_DEPOSIT') AND "paidAt" IS NULL AND "canceledAt" IS NULL) OR ("status" = 'PAID' AND "paidAt" IS NOT NULL AND "canceledAt" IS NULL) OR ("status" IN ('CANCELED', 'EXPIRED') AND "canceledAt" IS NOT NULL) OR ("status" = 'CANCEL_FAILED')),
    CONSTRAINT "Order_dates_ck" CHECK (("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("paidAt" IS NULL OR "paidAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("canceledAt" IS NULL OR "canceledAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*')),
    CONSTRAINT "Order_no_ck" CHECK ("orderNo" GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
    CONSTRAINT "Order_amounts_ck" CHECK ((typeof("itemsListTotal") = 'integer' AND "itemsListTotal" >= 0) AND (typeof("itemsDiscountTotal") = 'integer' AND "itemsDiscountTotal" >= 0) AND (typeof("itemsTotal") = 'integer' AND "itemsTotal" >= 0) AND (typeof("couponDiscountTotal") = 'integer' AND "couponDiscountTotal" >= 0) AND (typeof("shippingBaseFee") = 'integer' AND "shippingBaseFee" >= 0) AND (typeof("shippingExtraFee") = 'integer' AND "shippingExtraFee" >= 0) AND (typeof("shippingFee") = 'integer' AND "shippingFee" >= 0) AND (typeof("shippingDiscount") = 'integer' AND "shippingDiscount" >= 0) AND (typeof("pointUsed") = 'integer' AND "pointUsed" >= 0) AND ("freeShippingThreshold" IS NULL OR (typeof("freeShippingThreshold") = 'integer' AND "freeShippingThreshold" > 0))),
    CONSTRAINT "Order_amount_math_ck" CHECK ("itemsTotal" = "itemsListTotal" - "itemsDiscountTotal" AND "shippingFee" = "shippingBaseFee" + "shippingExtraFee" AND "couponDiscountTotal" <= "itemsTotal" AND "shippingDiscount" <= "shippingFee" AND "totalPrice" = "itemsTotal" - "couponDiscountTotal" + "shippingFee" - "shippingDiscount" - "pointUsed"),
    CONSTRAINT "Order_status_meta_ck" CHECK (("statusMemo" IS NULL OR (trim("statusMemo") <> '' AND length("statusMemo") <= 200)) AND ("statusChangedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("confirmedAt" IS NULL OR "confirmedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("piiPurgedAt" IS NULL OR "piiPurgedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("updatedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*')),
    CONSTRAINT "Order_orderer_ck" CHECK (("ordererNameEnc" IS NULL OR "ordererNameEnc" GLOB 'v[0-9]*:?*:?*:?*') AND ("ordererPhoneEnc" IS NULL OR "ordererPhoneEnc" GLOB 'v[0-9]*:?*:?*:?*') AND ("ordererEmailEnc" IS NULL OR "ordererEmailEnc" GLOB 'v[0-9]*:?*:?*:?*') AND ("ordererPhoneHash" IS NULL OR (length("ordererPhoneHash") = 64 AND "ordererPhoneHash" NOT GLOB '*[^0-9a-f]*')) AND ("piiPurgedAt" IS NULL OR ("ordererNameEnc" IS NULL AND "ordererPhoneEnc" IS NULL AND "ordererPhoneHash" IS NULL AND "ordererEmailEnc" IS NULL))),
    CONSTRAINT "Order_confirmed_ck" CHECK (("fulfillmentStatus" = 'CONFIRMED') = ("confirmedAt" IS NOT NULL)),
    CONSTRAINT "Order_orderer_type_ck" CHECK (("ordererType" = 'MEMBER' AND "customerId" IS NOT NULL AND "linkedAt" IS NULL) OR ("ordererType" = 'GUEST' AND ("customerId" IS NULL) = ("linkedAt" IS NULL))),
    CONSTRAINT "Order_guest_benefit_ck" CHECK ("ordererType" <> 'GUEST' OR ("couponDiscountTotal" = 0 AND "pointUsed" = 0 AND "shippingDiscount" = 0)),
    CONSTRAINT "Order_guest_orderer_ck" CHECK ("ordererType" <> 'GUEST' OR "piiPurgedAt" IS NOT NULL OR ("ordererNameEnc" IS NOT NULL AND "ordererPhoneEnc" IS NOT NULL AND "ordererPhoneHash" IS NOT NULL AND "ordererEmailEnc" IS NOT NULL)),
    CONSTRAINT "Order_linked_date_ck" CHECK (("linkedAt" IS NULL OR "linkedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("linkedAt" IS NULL OR "linkedAt" >= "createdAt"))
);
-- 기존 주문은 모두 회원 주문 (비회원 주문은 이번에 생김)
INSERT INTO "new_Order" ("canceledAt", "channel", "confirmedAt", "couponDiscountTotal", "createdAt", "customerId", "freeShippingThreshold", "fulfillmentStatus", "id", "itemsDiscountTotal", "itemsListTotal", "itemsTotal", "orderName", "orderNo", "ordererEmailEnc", "ordererNameEnc", "ordererPhoneEnc", "ordererPhoneHash", "paidAt", "paymentOrderId", "piiPurgedAt", "pointUsed", "shippingBaseFee", "shippingDiscount", "shippingExtraFee", "shippingFee", "shippingPolicyId", "status", "statusChangedAt", "statusChangedBy", "statusMemo", "totalPrice", "updatedAt", "ordererType") SELECT "canceledAt", "channel", "confirmedAt", "couponDiscountTotal", "createdAt", "customerId", "freeShippingThreshold", "fulfillmentStatus", "id", "itemsDiscountTotal", "itemsListTotal", "itemsTotal", "orderName", "orderNo", "ordererEmailEnc", "ordererNameEnc", "ordererPhoneEnc", "ordererPhoneHash", "paidAt", "paymentOrderId", "piiPurgedAt", "pointUsed", "shippingBaseFee", "shippingDiscount", "shippingExtraFee", "shippingFee", "shippingPolicyId", "status", "statusChangedAt", "statusChangedBy", "statusMemo", "totalPrice", "updatedAt", 'MEMBER' FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_orderNo_key" ON "Order"("orderNo");
CREATE UNIQUE INDEX "Order_paymentOrderId_key" ON "Order"("paymentOrderId");
CREATE INDEX "Order_customerId_createdAt_idx" ON "Order"("customerId", "createdAt");
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");
CREATE INDEX "Order_fulfillmentStatus_createdAt_idx" ON "Order"("fulfillmentStatus", "createdAt");
CREATE INDEX "Order_ordererPhoneHash_idx" ON "Order"("ordererPhoneHash");
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "GuestOrderAccess_claimedByCustomerId_idx" ON "GuestOrderAccess"("claimedByCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "GuestOrderSession_tokenHash_key" ON "GuestOrderSession"("tokenHash");

-- CreateIndex
CREATE INDEX "GuestOrderSession_orderId_idx" ON "GuestOrderSession"("orderId");

-- CreateIndex
CREATE INDEX "GuestOrderSession_expiresAt_idx" ON "GuestOrderSession"("expiresAt");

-- CreateIndex
CREATE INDEX "GuestLookupAttempt_ipHash_attemptedAt_idx" ON "GuestLookupAttempt"("ipHash", "attemptedAt");

-- CreateIndex
CREATE INDEX "GuestLookupAttempt_orderId_attemptedAt_idx" ON "GuestLookupAttempt"("orderId", "attemptedAt");

-- CreateIndex
CREATE INDEX "GuestLookupAttempt_attemptedAt_idx" ON "GuestLookupAttempt"("attemptedAt");

-- >>> db-constraints: 트리거 (prisma/db-constraints.ts에서 생성, 직접 수정 금지)

-- 정해진 길로만: RESERVED → ALLOCATED(완료된 결제가 있을 때, 만료 전) / RELEASED / EXPIRED, ALLOCATED → CONFIRMED(출고 상자가 출고됐을 때) / RELEASED(환불이 끝나 돈이 걸린 결제가 없을 때만). 할당은 만료되지 않음
DROP TRIGGER IF EXISTS "InventoryReservation_transition";
CREATE TRIGGER "InventoryReservation_transition" BEFORE UPDATE OF "status" ON "InventoryReservation"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
SELECT CASE
  WHEN (OLD."status" || '>' || NEW."status") NOT IN ('RESERVED>ALLOCATED', 'RESERVED>RELEASED', 'RESERVED>EXPIRED', 'ALLOCATED>CONFIRMED', 'ALLOCATED>RELEASED')
    THEN RAISE(ABORT, 'InventoryReservation_transition: 허용되지 않은 예약 상태 변경입니다 (할당은 만료되지 않고, 확정·해제·만료된 예약은 되돌릴 수 없음)')
  WHEN NEW."status" = 'ALLOCATED' AND OLD."expiresAt" <= strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')
    THEN RAISE(ABORT, 'InventoryReservation_transition: 만료된 예약은 할당할 수 없습니다')
  WHEN NEW."status" = 'ALLOCATED' AND NOT EXISTS (SELECT 1 FROM "Payment" p JOIN "Order" o ON o."id" = p."orderId" WHERE p."orderId" = NEW."orderId" AND p."status" IN ('DONE', 'PARTIAL_CANCELED') AND p."amount" = o."totalPrice")
    THEN RAISE(ABORT, 'InventoryReservation_allocate_guard: 완료된 결제가 없어 재고를 할당할 수 없습니다')
  WHEN NEW."status" = 'CONFIRMED' AND NOT EXISTS (
      SELECT 1 FROM "Shipment" s JOIN "ShipmentItem" si ON si."shipmentId" = s."id"
      WHERE s."id" = NEW."shipmentId" AND s."type" = 'OUTBOUND' AND s."status" IN ('SHIPPED', 'DELIVERED') AND si."orderItemId" = NEW."orderItemId")
    THEN RAISE(ABORT, 'InventoryReservation_confirm_guard: 출고된 상자에 담긴 상품만 재고를 확정(차감)할 수 있습니다')
  WHEN OLD."status" = 'ALLOCATED' AND NEW."status" = 'RELEASED'
      AND EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = NEW."orderId" AND p."status" IN ('IN_PROGRESS', 'UNKNOWN', 'WAITING_FOR_DEPOSIT', 'DONE', 'PARTIAL_CANCELED'))
    THEN RAISE(ABORT, 'InventoryReservation_release_guard: 환불이 끝나기 전에는 할당된 재고를 풀 수 없습니다')
END;
END;

-- 탈퇴·탈퇴 신청·정지·휴면 고객은 새 주문 금지
DROP TRIGGER IF EXISTS "Order_customer_active";
CREATE TRIGGER "Order_customer_active" BEFORE INSERT ON "Order"
WHEN NEW."customerId" IS NOT NULL AND (SELECT c."status" FROM "Customer" c WHERE c."id" = NEW."customerId") IS NOT 'ACTIVE'
BEGIN SELECT RAISE(ABORT, 'Order_customer_active: 정상(ACTIVE) 상태의 고객만 주문할 수 있습니다'); END;

-- 주문은 결제 대기(PENDING)·미결제 요약(UNPAID)·확정 전으로만 생성. 결제 완료는 결제(Payment)를 거쳐야 함
DROP TRIGGER IF EXISTS "Order_insert_pending";
CREATE TRIGGER "Order_insert_pending" BEFORE INSERT ON "Order"
WHEN NEW."status" IS NOT 'PENDING' OR NEW."fulfillmentStatus" IS NOT 'UNPAID' OR NEW."confirmedAt" IS NOT NULL OR NEW."piiPurgedAt" IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Order_insert_pending: 주문은 PENDING 상태로만 만들 수 있습니다'); END;

-- 결제 금액 비교 기준·토스 주문번호·금액 구성이 바뀌면 결제·환불 계산과 어긋남
DROP TRIGGER IF EXISTS "Order_total_fixed";
CREATE TRIGGER "Order_total_fixed" BEFORE UPDATE OF "totalPrice", "paymentOrderId", "orderNo", "ordererType", "channel", "itemsListTotal", "itemsDiscountTotal", "itemsTotal", "couponDiscountTotal", "shippingBaseFee", "shippingExtraFee", "shippingFee", "shippingDiscount", "pointUsed", "shippingPolicyId", "freeShippingThreshold", "createdAt" ON "Order"
WHEN NEW."totalPrice" IS NOT OLD."totalPrice" OR NEW."paymentOrderId" IS NOT OLD."paymentOrderId" OR NEW."orderNo" IS NOT OLD."orderNo" OR NEW."ordererType" IS NOT OLD."ordererType" OR NEW."channel" IS NOT OLD."channel" OR NEW."itemsListTotal" IS NOT OLD."itemsListTotal" OR NEW."itemsDiscountTotal" IS NOT OLD."itemsDiscountTotal" OR NEW."itemsTotal" IS NOT OLD."itemsTotal" OR NEW."couponDiscountTotal" IS NOT OLD."couponDiscountTotal" OR NEW."shippingBaseFee" IS NOT OLD."shippingBaseFee" OR NEW."shippingExtraFee" IS NOT OLD."shippingExtraFee" OR NEW."shippingFee" IS NOT OLD."shippingFee" OR NEW."shippingDiscount" IS NOT OLD."shippingDiscount" OR NEW."pointUsed" IS NOT OLD."pointUsed" OR NEW."shippingPolicyId" IS NOT OLD."shippingPolicyId" OR NEW."freeShippingThreshold" IS NOT OLD."freeShippingThreshold" OR NEW."createdAt" IS NOT OLD."createdAt"
BEGIN SELECT RAISE(ABORT, 'Order_total_fixed: 주문 금액·주문번호·고객·배송비 규칙은 바꿀 수 없습니다'); END;

-- 허용된 주문 상태 변경만 + 결제·재고·배송과 맞아야 함 (결제 없이 결제 완료 금지, 돈이 걸린 결제·남은 재고 예약이 있는데 취소 금지, 출고된 상품이 있으면 전체 취소 금지), 바꿀 때 변경 시각도 새로
DROP TRIGGER IF EXISTS "Order_status_transition";
CREATE TRIGGER "Order_status_transition" BEFORE UPDATE OF "status" ON "Order"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
SELECT CASE
  WHEN (OLD."status" || '>' || NEW."status") NOT IN ('PENDING>WAITING_DEPOSIT', 'PENDING>PAID', 'PENDING>CANCELED', 'PENDING>CANCEL_FAILED', 'WAITING_DEPOSIT>PAID', 'WAITING_DEPOSIT>CANCELED', 'WAITING_DEPOSIT>EXPIRED', 'WAITING_DEPOSIT>CANCEL_FAILED', 'PAID>CANCELED', 'PAID>CANCEL_FAILED', 'CANCEL_FAILED>CANCELED', 'CANCEL_FAILED>PAID')
    THEN RAISE(ABORT, 'Order_status_transition: 허용되지 않은 주문 상태 변경입니다')
  WHEN NEW."statusChangedAt" < OLD."statusChangedAt"
    THEN RAISE(ABORT, 'Order_status_transition: 상태 변경 시각(statusChangedAt)이 이전 변경보다 앞설 수 없습니다')
  WHEN NEW."status" = 'PAID' AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = NEW."id" AND p."status" IN ('DONE', 'PARTIAL_CANCELED') AND p."amount" = NEW."totalPrice")
    THEN RAISE(ABORT, 'Order_paid_guard: 주문 금액과 같은 완료된 결제가 없어 결제 완료로 바꿀 수 없습니다')
  WHEN NEW."status" = 'PAID' AND EXISTS (SELECT 1 FROM "InventoryReservation" r WHERE r."orderId" = NEW."id" AND r."status" = 'RESERVED')
    THEN RAISE(ABORT, 'Order_paid_guard: 재고 예약을 먼저 할당해야 결제 완료로 바꿀 수 있습니다')
  WHEN NEW."status" = 'PAID' AND EXISTS (SELECT 1 FROM "OrderItem" i WHERE i."orderId" = NEW."id" AND i."status" = 'AWAITING_PAYMENT'
      AND NOT EXISTS (SELECT 1 FROM "InventoryReservation" r WHERE r."orderItemId" = i."id" AND r."status" = 'ALLOCATED'))
    THEN RAISE(ABORT, 'Order_paid_guard: 재고가 할당되지 않은 상품이 있어 결제 완료로 바꿀 수 없습니다')
  WHEN NEW."status" IN ('CANCELED', 'EXPIRED') AND EXISTS (SELECT 1 FROM "InventoryReservation" r WHERE r."orderId" = NEW."id" AND r."status" IN ('RESERVED', 'ALLOCATED'))
    THEN RAISE(ABORT, 'Order_cancel_guard: 남은 재고 예약·할당을 먼저 풀어야 주문을 닫을 수 있습니다')
  WHEN NEW."status" = 'CANCELED' AND EXISTS (SELECT 1 FROM "OrderItem" i WHERE i."orderId" = NEW."id" AND i."status" IN ('SHIPPED', 'DELIVERED', 'CONFIRMED'))
    THEN RAISE(ABORT, 'Order_shipped_guard: 출고된 상품이 있어 주문 전체를 취소할 수 없습니다 (반품으로 처리)')
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

-- 주문 시각에 적용 중인 배송비 규칙만, 기본 배송비·무료 기준은 규칙과 같아야 함 (무료 기준 이상이면 기본 배송비 0)
DROP TRIGGER IF EXISTS "Order_shipping_rule";
CREATE TRIGGER "Order_shipping_rule" BEFORE INSERT ON "Order"
BEGIN
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM "ShippingPolicy" sp WHERE sp."id" = NEW."shippingPolicyId" AND sp."validFrom" <= NEW."createdAt" AND NEW."createdAt" < COALESCE(sp."validTo", '9999-12-31T23:59:59.999+00:00'))
    THEN RAISE(ABORT, 'Order_shipping_rule: 주문 시각에 적용 중인 배송비 규칙이 아닙니다')
  WHEN NEW."freeShippingThreshold" IS NOT (SELECT sp."freeShippingThreshold" FROM "ShippingPolicy" sp WHERE sp."id" = NEW."shippingPolicyId")
    THEN RAISE(ABORT, 'Order_shipping_rule: 무료배송 기준이 배송비 규칙과 다릅니다')
  WHEN NEW."shippingBaseFee" IS NOT (SELECT CASE WHEN sp."freeShippingThreshold" IS NOT NULL AND NEW."itemsTotal" >= sp."freeShippingThreshold" THEN 0 ELSE sp."baseFee" END FROM "ShippingPolicy" sp WHERE sp."id" = NEW."shippingPolicyId")
    THEN RAISE(ABORT, 'Order_shipping_rule: 기본 배송비가 배송비 규칙과 다릅니다')
END;
END;

-- 진행 요약은 상품 상태들로 계산한 값만 (앱이 임의로 바꾸지 못함 — 상품 상태가 바뀌면 트리거가 맞춤)
DROP TRIGGER IF EXISTS "Order_fulfillment_guard";
CREATE TRIGGER "Order_fulfillment_guard" BEFORE UPDATE OF "fulfillmentStatus" ON "Order"
WHEN NEW."fulfillmentStatus" IS NOT (CASE
    WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."id" AND fi."status" <> 'CANCELED') THEN 'CANCELED'
    WHEN EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."id" AND fi."status" = 'AWAITING_PAYMENT') THEN 'UNPAID'
    WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."id" AND fi."status" NOT IN ('CONFIRMED', 'CANCELED')) THEN 'CONFIRMED'
    WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."id" AND fi."status" NOT IN ('DELIVERED', 'CONFIRMED', 'CANCELED')) THEN 'DELIVERED'
    WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."id" AND fi."status" IN ('PAID', 'PREPARING')) THEN 'SHIPPED'
    WHEN EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."id" AND fi."status" IN ('SHIPPED', 'DELIVERED', 'CONFIRMED')) THEN 'PARTIALLY_SHIPPED'
    WHEN EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."id" AND fi."status" = 'PREPARING') THEN 'PREPARING'
    ELSE 'PAID' END)
BEGIN SELECT RAISE(ABORT, 'Order_fulfillment_guard: 진행 요약(fulfillmentStatus)은 상품 상태로만 바뀝니다'); END;

-- 주문이 결제 완료되면 상품도 결제 완료, 주문이 취소·만료되면 출고 전 상품은 취소 (주문과 상품 상태가 어긋나지 않게)
DROP TRIGGER IF EXISTS "Order_status_cascade";
CREATE TRIGGER "Order_status_cascade" AFTER UPDATE OF "status" ON "Order"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
  UPDATE "OrderItem" SET "status" = 'PAID', "paidAt" = NEW."paidAt", "statusChangedAt" = NEW."statusChangedAt", "statusChangedBy" = NEW."statusChangedBy", "statusMemo" = NULL
  WHERE NEW."status" = 'PAID' AND "orderId" = NEW."id" AND "status" = 'AWAITING_PAYMENT';
  UPDATE "OrderItem" SET "status" = 'CANCELED', "canceledAt" = NEW."canceledAt", "statusChangedAt" = NEW."statusChangedAt", "statusChangedBy" = NEW."statusChangedBy", "statusMemo" = NEW."statusMemo"
  WHERE NEW."status" IN ('CANCELED', 'EXPIRED') AND "orderId" = NEW."id" AND "status" IN ('AWAITING_PAYMENT', 'PAID', 'PREPARING');
END;

-- 주문 생성을 상태 이력 첫 줄로 자동 기록
DROP TRIGGER IF EXISTS "Order_status_history_ins";
CREATE TRIGGER "Order_status_history_ins" AFTER INSERT ON "Order"
BEGIN
  INSERT INTO "OrderStatusHistory" ("orderId", "fromStatus", "toStatus", "changedBy", "memo", "changedAt") VALUES (NEW."id", NULL, NEW."status", NEW."statusChangedBy", NEW."statusMemo", NEW."statusChangedAt");
END;

-- 주문 상태가 바뀌면 이력 자동 기록 (누가·언제·왜)
DROP TRIGGER IF EXISTS "Order_status_history_upd";
CREATE TRIGGER "Order_status_history_upd" AFTER UPDATE OF "status" ON "Order"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
  INSERT INTO "OrderStatusHistory" ("orderId", "fromStatus", "toStatus", "changedBy", "memo", "changedAt") VALUES (NEW."id", OLD."status", NEW."status", NEW."statusChangedBy", NEW."statusMemo", NEW."statusChangedAt");
END;

-- 주문자 정보는 바꿀 수 없고, 5년 보관 뒤 파기(비우기)만 가능. 파기는 되돌릴 수 없음
DROP TRIGGER IF EXISTS "Order_orderer_fixed";
CREATE TRIGGER "Order_orderer_fixed" BEFORE UPDATE OF "ordererNameEnc", "ordererPhoneEnc", "ordererPhoneHash", "ordererEmailEnc", "piiPurgedAt" ON "Order"
WHEN (OLD."piiPurgedAt" IS NOT NULL AND NEW."piiPurgedAt" IS NOT OLD."piiPurgedAt")
  OR (NEW."ordererNameEnc" IS NOT OLD."ordererNameEnc" AND NEW."ordererNameEnc" IS NOT NULL) OR (NEW."ordererPhoneEnc" IS NOT OLD."ordererPhoneEnc" AND NEW."ordererPhoneEnc" IS NOT NULL) OR (NEW."ordererPhoneHash" IS NOT OLD."ordererPhoneHash" AND NEW."ordererPhoneHash" IS NOT NULL) OR (NEW."ordererEmailEnc" IS NOT OLD."ordererEmailEnc" AND NEW."ordererEmailEnc" IS NOT NULL)
  OR (NEW."piiPurgedAt" IS NOT NULL AND julianday(NEW."piiPurgedAt") - julianday(OLD."createdAt") < 1825)
BEGIN SELECT RAISE(ABORT, 'Order_orderer_fixed: 주문자 정보는 바꿀 수 없고, 주문 5년 뒤 파기만 할 수 있습니다'); END;

-- 결제 대기 주문에만 추가, 결제 대기 상태로, 순번은 1부터 차례로
DROP TRIGGER IF EXISTS "OrderItem_insert_guard";
CREATE TRIGGER "OrderItem_insert_guard" BEFORE INSERT ON "OrderItem"
BEGIN
SELECT CASE
  WHEN (SELECT o."status" FROM "Order" o WHERE o."id" = NEW."orderId") IS NOT 'PENDING'
    THEN RAISE(ABORT, 'OrderItem_insert_guard: 결제 대기 주문에만 상품을 추가할 수 있습니다')
  WHEN NEW."status" <> 'AWAITING_PAYMENT'
    THEN RAISE(ABORT, 'OrderItem_insert_guard: 주문 상품은 결제 대기 상태로만 만들 수 있습니다')
  WHEN NEW."lineNo" IS NOT (SELECT COALESCE(MAX(i."lineNo"), 0) + 1 FROM "OrderItem" i WHERE i."orderId" = NEW."orderId")
    THEN RAISE(ABORT, 'OrderItem_insert_guard: 순번은 1부터 차례로 붙입니다')
END;
END;

-- 정해진 길로만 (건너뛰기·되돌리기 금지). 준비중은 결제 완료 주문 + 재고 할당 + 진행 중인 결제 취소 없음, 배송중·배송완료는 출고 상자로만, 취소는 주문 취소로만
DROP TRIGGER IF EXISTS "OrderItem_status_transition";
CREATE TRIGGER "OrderItem_status_transition" BEFORE UPDATE OF "status" ON "OrderItem"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
SELECT CASE
  WHEN (OLD."status" || '>' || NEW."status") NOT IN ('AWAITING_PAYMENT>PAID', 'AWAITING_PAYMENT>CANCELED', 'PAID>PREPARING', 'PAID>CANCELED', 'PREPARING>SHIPPED', 'PREPARING>CANCELED', 'SHIPPED>DELIVERED', 'SHIPPED>CONFIRMED', 'DELIVERED>CONFIRMED')
    THEN RAISE(ABORT, 'OrderItem_status_transition: 허용되지 않은 상품 상태 변경입니다')
  WHEN NEW."statusChangedAt" < OLD."statusChangedAt"
    THEN RAISE(ABORT, 'OrderItem_status_transition: 상태 변경 시각이 이전 변경보다 앞설 수 없습니다')
  WHEN NEW."status" IN ('PAID', 'PREPARING', 'CONFIRMED') AND (SELECT o."status" FROM "Order" o WHERE o."id" = NEW."orderId") IS NOT 'PAID'
    THEN RAISE(ABORT, 'OrderItem_order_paid: 결제 완료된 주문의 상품만 처리할 수 있습니다')
  WHEN NEW."status" = 'PREPARING' AND EXISTS (SELECT 1 FROM "PaymentCancel" c JOIN "Payment" p ON p."id" = c."paymentId" WHERE p."orderId" = NEW."orderId" AND c."status" IN ('REQUESTED', 'UNKNOWN'))
    THEN RAISE(ABORT, 'OrderItem_prepare_guard: 결제 취소가 처리 중인 주문은 상품 준비를 시작할 수 없습니다')
  WHEN NEW."status" = 'PREPARING' AND NOT EXISTS (SELECT 1 FROM "InventoryReservation" r WHERE r."orderItemId" = NEW."id" AND r."status" = 'ALLOCATED')
    THEN RAISE(ABORT, 'OrderItem_prepare_guard: 재고가 할당되지 않은 상품은 준비할 수 없습니다')
  WHEN NEW."status" = 'SHIPPED' AND NOT EXISTS (SELECT 1 FROM "ShipmentItem" si JOIN "Shipment" s ON s."id" = si."shipmentId" WHERE si."orderItemId" = NEW."id" AND s."type" = 'OUTBOUND' AND s."status" IN ('SHIPPED', 'DELIVERED'))
    THEN RAISE(ABORT, 'OrderItem_shipment_only: 배송중은 출고 상자를 출고 처리해서만 바뀝니다')
  WHEN NEW."status" = 'DELIVERED' AND NOT EXISTS (SELECT 1 FROM "ShipmentItem" si JOIN "Shipment" s ON s."id" = si."shipmentId" WHERE si."orderItemId" = NEW."id" AND s."type" = 'OUTBOUND' AND s."status" = 'DELIVERED')
    THEN RAISE(ABORT, 'OrderItem_shipment_only: 배송 완료는 출고 상자를 배송 완료 처리해서만 바뀝니다')
  WHEN NEW."status" = 'CANCELED' AND (SELECT o."status" FROM "Order" o WHERE o."id" = NEW."orderId") NOT IN ('CANCELED', 'EXPIRED')
    THEN RAISE(ABORT, 'OrderItem_cancel_guard: 상품 단위 취소는 ⑩ 클레임에서 합니다 (지금은 주문 전체 취소로만)')
END;
END;

-- 상품 상태가 바뀌면 주문의 진행 요약·전체 구매확정 시각을 다시 계산
DROP TRIGGER IF EXISTS "OrderItem_fulfillment";
CREATE TRIGGER "OrderItem_fulfillment" AFTER UPDATE OF "status" ON "OrderItem"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
  UPDATE "Order" SET
    "fulfillmentStatus" = (CASE
    WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" <> 'CANCELED') THEN 'CANCELED'
    WHEN EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" = 'AWAITING_PAYMENT') THEN 'UNPAID'
    WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" NOT IN ('CONFIRMED', 'CANCELED')) THEN 'CONFIRMED'
    WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" NOT IN ('DELIVERED', 'CONFIRMED', 'CANCELED')) THEN 'DELIVERED'
    WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" IN ('PAID', 'PREPARING')) THEN 'SHIPPED'
    WHEN EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" IN ('SHIPPED', 'DELIVERED', 'CONFIRMED')) THEN 'PARTIALLY_SHIPPED'
    WHEN EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" = 'PREPARING') THEN 'PREPARING'
    ELSE 'PAID' END),
    "confirmedAt" = CASE WHEN (CASE
    WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" <> 'CANCELED') THEN 'CANCELED'
    WHEN EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" = 'AWAITING_PAYMENT') THEN 'UNPAID'
    WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" NOT IN ('CONFIRMED', 'CANCELED')) THEN 'CONFIRMED'
    WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" NOT IN ('DELIVERED', 'CONFIRMED', 'CANCELED')) THEN 'DELIVERED'
    WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" IN ('PAID', 'PREPARING')) THEN 'SHIPPED'
    WHEN EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" IN ('SHIPPED', 'DELIVERED', 'CONFIRMED')) THEN 'PARTIALLY_SHIPPED'
    WHEN EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" = 'PREPARING') THEN 'PREPARING'
    ELSE 'PAID' END) = 'CONFIRMED' THEN COALESCE("confirmedAt", NEW."confirmedAt") ELSE NULL END,
    "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')
  WHERE "id" = NEW."orderId";
END;

-- 주문자 신분은 바꿀 수 없음. 회원 지정은 비회원 주문에서 '비어 있음 → 회원' 한 번만, 결제 대기가 아닐 때, 정상 회원에게, 가져오기 기록(GuestOrderAccess)과 같은 회원으로
DROP TRIGGER IF EXISTS "Order_link_guard";
CREATE TRIGGER "Order_link_guard" BEFORE UPDATE OF "customerId", "linkedAt", "ordererType" ON "Order"
WHEN NEW."customerId" IS NOT OLD."customerId" OR NEW."linkedAt" IS NOT OLD."linkedAt" OR NEW."ordererType" IS NOT OLD."ordererType"
BEGIN
SELECT CASE
  WHEN NEW."ordererType" IS NOT OLD."ordererType"
    THEN RAISE(ABORT, 'Order_link_guard: 주문자 신분(회원·비회원)은 바꿀 수 없습니다')
  WHEN OLD."customerId" IS NOT NULL OR OLD."linkedAt" IS NOT NULL
    THEN RAISE(ABORT, 'Order_link_guard: 이미 회원 주문입니다 (주문의 회원은 바꿀 수 없습니다)')
  WHEN NEW."ordererType" <> 'GUEST' OR NEW."customerId" IS NULL OR NEW."linkedAt" IS NULL
    THEN RAISE(ABORT, 'Order_link_guard: 비회원 주문만 회원 계정으로 가져올 수 있습니다 (회원·가져온 시각 함께)')
  WHEN OLD."status" = 'PENDING'
    THEN RAISE(ABORT, 'Order_link_guard: 결제 대기 주문은 가져올 수 없습니다')
  WHEN (SELECT c."status" FROM "Customer" c WHERE c."id" = NEW."customerId") IS NOT 'ACTIVE'
    THEN RAISE(ABORT, 'Order_link_guard: 정상(ACTIVE) 회원만 주문을 가져올 수 있습니다')
  WHEN (SELECT g."claimedByCustomerId" FROM "GuestOrderAccess" g WHERE g."orderId" = NEW."id") IS NOT NEW."customerId"
    THEN RAISE(ABORT, 'Order_link_guard: 가져오기 기록(GuestOrderAccess)의 회원과 다릅니다')
END;
END;

-- 비회원 결제 대기 주문에만, 처음에는 실패·잠금·가져오기 기록 없이
DROP TRIGGER IF EXISTS "GuestOrderAccess_insert_guard";
CREATE TRIGGER "GuestOrderAccess_insert_guard" BEFORE INSERT ON "GuestOrderAccess"
WHEN (SELECT o."ordererType" || '/' || o."status" FROM "Order" o WHERE o."id" = NEW."orderId") IS NOT 'GUEST/PENDING'
  OR NEW."failedCount" <> 0 OR NEW."lockedUntil" IS NOT NULL OR NEW."claimedAt" IS NOT NULL OR NEW."passwordHash" IS NULL
BEGIN SELECT RAISE(ABORT, 'GuestOrderAccess_insert_guard: 비회원 결제 대기 주문에만 조회 비밀번호를 만들 수 있습니다'); END;

-- 동의 기록·주문은 고정, 비밀번호는 파기(비우기)만, 가져오기는 한 번만(결제 대기 아닌, 아직 회원이 없는 주문)
DROP TRIGGER IF EXISTS "GuestOrderAccess_update_guard";
CREATE TRIGGER "GuestOrderAccess_update_guard" BEFORE UPDATE ON "GuestOrderAccess"
BEGIN
SELECT CASE
  WHEN NEW."orderId" IS NOT OLD."orderId" OR NEW."privacyConsentAt" IS NOT OLD."privacyConsentAt" OR NEW."privacyConsentVersion" IS NOT OLD."privacyConsentVersion" OR NEW."createdAt" IS NOT OLD."createdAt"
    THEN RAISE(ABORT, 'GuestOrderAccess_fixed: 주문·동의 기록은 바꿀 수 없습니다')
  WHEN NEW."passwordHash" IS NOT OLD."passwordHash" AND NEW."passwordHash" IS NOT NULL
    THEN RAISE(ABORT, 'GuestOrderAccess_fixed: 조회 비밀번호는 바꿀 수 없습니다 (파기만 가능)')
  WHEN OLD."claimedAt" IS NOT NULL AND (NEW."claimedAt" IS NOT OLD."claimedAt" OR NEW."claimedByCustomerId" IS NOT OLD."claimedByCustomerId")
    THEN RAISE(ABORT, 'GuestOrderAccess_claim_once: 이미 회원 계정으로 옮겨진 주문입니다')
  WHEN OLD."claimedAt" IS NULL AND NEW."claimedAt" IS NOT NULL
      AND (SELECT o."customerId" IS NOT NULL OR o."status" = 'PENDING' FROM "Order" o WHERE o."id" = NEW."orderId")
    THEN RAISE(ABORT, 'GuestOrderAccess_claim_once: 결제 대기이거나 이미 회원이 있는 주문은 가져올 수 없습니다')
END;
END;

-- 동의·가져오기 기록 보관
DROP TRIGGER IF EXISTS "GuestOrderAccess_no_delete";
CREATE TRIGGER "GuestOrderAccess_no_delete" BEFORE DELETE ON "GuestOrderAccess"
BEGIN SELECT RAISE(ABORT, 'GuestOrderAccess_no_delete: 비회원 주문 조회 기록은 삭제할 수 없습니다 (파기는 비밀번호 비우기)'); END;

-- 아직 회원 계정으로 옮기지 않은 비회원 주문에만 출입증 발급
DROP TRIGGER IF EXISTS "GuestOrderSession_insert_guard";
CREATE TRIGGER "GuestOrderSession_insert_guard" BEFORE INSERT ON "GuestOrderSession"
WHEN (SELECT o."ordererType" = 'GUEST' AND o."customerId" IS NULL FROM "Order" o WHERE o."id" = NEW."orderId") IS NOT 1 OR NEW."revokedAt" IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'GuestOrderSession_insert_guard: 회원 계정으로 옮긴 주문이나 회원 주문에는 비회원 출입증을 만들 수 없습니다'); END;

-- 출입증은 무효로 만드는 것(revokedAt)만 가능 — 기간 연장·다른 주문으로 바꾸기 금지
DROP TRIGGER IF EXISTS "GuestOrderSession_revoke_only";
CREATE TRIGGER "GuestOrderSession_revoke_only" BEFORE UPDATE ON "GuestOrderSession"
WHEN NEW."orderId" IS NOT OLD."orderId" OR NEW."tokenHash" IS NOT OLD."tokenHash" OR NEW."purpose" IS NOT OLD."purpose" OR NEW."expiresAt" IS NOT OLD."expiresAt"
  OR NEW."createdAt" IS NOT OLD."createdAt" OR (OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS NOT OLD."revokedAt") OR NEW."revokedAt" IS NULL
BEGIN SELECT RAISE(ABORT, 'GuestOrderSession_revoke_only: 출입증은 무효 처리만 할 수 있습니다'); END;

-- 만료되거나 무효가 된 출입증만 삭제(정리) 가능
DROP TRIGGER IF EXISTS "GuestOrderSession_delete_guard";
CREATE TRIGGER "GuestOrderSession_delete_guard" BEFORE DELETE ON "GuestOrderSession"
WHEN OLD."revokedAt" IS NULL AND OLD."expiresAt" > strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')
BEGIN SELECT RAISE(ABORT, 'GuestOrderSession_delete_guard: 아직 유효한 출입증은 지울 수 없습니다'); END;

-- 시도 기록은 수정 금지
DROP TRIGGER IF EXISTS "GuestLookupAttempt_no_update";
CREATE TRIGGER "GuestLookupAttempt_no_update" BEFORE UPDATE ON "GuestLookupAttempt"
BEGIN SELECT RAISE(ABORT, 'GuestLookupAttempt_append_only: 시도 기록은 수정할 수 없습니다'); END;

-- 시도 기록은 90일이 지난 것만 삭제 가능
DROP TRIGGER IF EXISTS "GuestLookupAttempt_retention";
CREATE TRIGGER "GuestLookupAttempt_retention" BEFORE DELETE ON "GuestLookupAttempt"
WHEN julianday(strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')) - julianday(OLD."attemptedAt") < 90
BEGIN SELECT RAISE(ABORT, 'GuestLookupAttempt_retention: 90일이 지나지 않은 시도 기록은 지울 수 없습니다'); END;

-- 결제를 시작하려면 배송지가 있어야 하고, 상품별 금액 합계가 주문 금액 구성과 맞아야 함 (돈이 오가기 전 마지막 검사)
DROP TRIGGER IF EXISTS "Payment_order_ready";
CREATE TRIGGER "Payment_order_ready" BEFORE INSERT ON "Payment"
WHEN NEW."status" = 'IN_PROGRESS'
BEGIN
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM "OrderShippingAddress" a WHERE a."orderId" = NEW."orderId" AND a."piiPurgedAt" IS NULL)
    THEN RAISE(ABORT, 'Payment_order_ready: 배송지가 없는 주문은 결제할 수 없습니다')
  WHEN (SELECT o."ordererType" FROM "Order" o WHERE o."id" = NEW."orderId") = 'GUEST'
      AND NOT EXISTS (SELECT 1 FROM "GuestOrderAccess" g WHERE g."orderId" = NEW."orderId" AND g."passwordHash" IS NOT NULL)
    THEN RAISE(ABORT, 'Payment_order_ready: 비회원 주문은 조회 비밀번호·개인정보 동의 기록이 있어야 결제할 수 있습니다')
  WHEN EXISTS (SELECT 1 FROM "Order" o WHERE o."id" = NEW."orderId" AND (
      o."itemsListTotal" IS NOT (SELECT SUM(i."lineListTotal") FROM "OrderItem" i WHERE i."orderId" = o."id")
      OR o."itemsDiscountTotal" IS NOT (SELECT SUM(i."lineDiscountTotal") FROM "OrderItem" i WHERE i."orderId" = o."id")
      OR o."itemsTotal" IS NOT (SELECT SUM(i."lineTotal") FROM "OrderItem" i WHERE i."orderId" = o."id")
      OR o."couponDiscountTotal" IS NOT (SELECT SUM(i."couponAllocated") FROM "OrderItem" i WHERE i."orderId" = o."id")
      OR o."pointUsed" IS NOT (SELECT SUM(i."pointAllocated") FROM "OrderItem" i WHERE i."orderId" = o."id")))
    THEN RAISE(ABORT, 'Payment_order_ready: 상품별 금액 합계가 주문 금액과 다릅니다')
END;
END;

-- 결제 대기 주문에만, 처음 버전으로, 배송 지역·추가 배송비가 우편번호와 맞아야 함
DROP TRIGGER IF EXISTS "OrderShippingAddress_insert_guard";
CREATE TRIGGER "OrderShippingAddress_insert_guard" BEFORE INSERT ON "OrderShippingAddress"
BEGIN
SELECT CASE
  WHEN (SELECT o."status" FROM "Order" o WHERE o."id" = NEW."orderId") IS NOT 'PENDING'
    THEN RAISE(ABORT, 'OrderShippingAddress_insert_guard: 결제 대기 주문에만 배송지를 저장할 수 있습니다')
  WHEN NEW."version" <> 1 OR NEW."changedBy" IS NOT NULL OR NEW."piiPurgedAt" IS NOT NULL
    THEN RAISE(ABORT, 'OrderShippingAddress_insert_guard: 처음 저장은 1버전으로 합니다')
  WHEN NEW."region" IS NOT COALESCE((SELECT z."region" FROM "ShippingSurchargeZone" z WHERE z."policyId" = (SELECT o."shippingPolicyId" FROM "Order" o WHERE o."id" = NEW."orderId") AND NEW."zipCode" BETWEEN z."zipFrom" AND z."zipTo"), 'NORMAL')
    THEN RAISE(ABORT, 'OrderShippingAddress_region: 배송 지역이 우편번호와 맞지 않습니다')
  WHEN (SELECT o."shippingExtraFee" FROM "Order" o WHERE o."id" = NEW."orderId") IS NOT COALESCE((SELECT z."extraFee" FROM "ShippingSurchargeZone" z WHERE z."policyId" = (SELECT o."shippingPolicyId" FROM "Order" o WHERE o."id" = NEW."orderId") AND NEW."zipCode" BETWEEN z."zipFrom" AND z."zipTo"), 0)
    THEN RAISE(ABORT, 'OrderShippingAddress_fee: 주문의 추가 배송비가 배송지 지역과 맞지 않습니다')
END;
END;

-- 주소를 바꾸면 버전 +1, 모든 상품이 준비 전이고 주문이 살아 있을 때만, 추가 배송비가 달라지는 지역으로는 불가. 파기는 5년 뒤에만, 되돌릴 수 없음
DROP TRIGGER IF EXISTS "OrderShippingAddress_update_guard";
CREATE TRIGGER "OrderShippingAddress_update_guard" BEFORE UPDATE ON "OrderShippingAddress"
BEGIN
SELECT CASE
  WHEN NEW."orderId" IS NOT OLD."orderId" OR NEW."createdAt" IS NOT OLD."createdAt"
    THEN RAISE(ABORT, 'OrderShippingAddress_fixed: 주문 배송지의 주문은 바꿀 수 없습니다')
  WHEN OLD."piiPurgedAt" IS NOT NULL AND (NEW."piiPurgedAt" IS NOT OLD."piiPurgedAt" OR NEW."version" IS NOT OLD."version" OR NEW."recipientEnc" IS NOT OLD."recipientEnc" OR NEW."phoneEnc" IS NOT OLD."phoneEnc" OR NEW."phoneHash" IS NOT OLD."phoneHash" OR NEW."zipCode" IS NOT OLD."zipCode" OR NEW."address1Enc" IS NOT OLD."address1Enc" OR NEW."address2Enc" IS NOT OLD."address2Enc" OR NEW."deliveryMemoEnc" IS NOT OLD."deliveryMemoEnc" OR NEW."region" IS NOT OLD."region")
    THEN RAISE(ABORT, 'OrderShippingAddress_purged: 파기한 배송지는 바꿀 수 없습니다')
  WHEN OLD."piiPurgedAt" IS NULL AND NEW."piiPurgedAt" IS NOT NULL
      AND (NEW."zipCode" IS NOT OLD."zipCode" OR NEW."region" IS NOT OLD."region" OR NEW."version" IS NOT OLD."version" OR julianday(NEW."piiPurgedAt") - julianday(OLD."createdAt") < 1825)
    THEN RAISE(ABORT, 'OrderShippingAddress_purge: 배송지 개인정보는 주문 5년 뒤에 비우기만 할 수 있습니다')
  WHEN NEW."piiPurgedAt" IS NULL AND NEW."version" IS OLD."version" AND (NEW."recipientEnc" IS NOT OLD."recipientEnc" OR NEW."phoneEnc" IS NOT OLD."phoneEnc" OR NEW."phoneHash" IS NOT OLD."phoneHash" OR NEW."zipCode" IS NOT OLD."zipCode" OR NEW."address1Enc" IS NOT OLD."address1Enc" OR NEW."address2Enc" IS NOT OLD."address2Enc" OR NEW."deliveryMemoEnc" IS NOT OLD."deliveryMemoEnc" OR NEW."region" IS NOT OLD."region" OR (NEW."sourceAddressId" IS NOT OLD."sourceAddressId" AND NEW."sourceAddressId" IS NOT NULL))
    THEN RAISE(ABORT, 'OrderShippingAddress_version: 배송지를 바꾸면 version을 1 올려야 합니다 (이력 기록용)')
  WHEN NEW."piiPurgedAt" IS NULL AND NEW."version" IS NOT OLD."version" AND NEW."version" IS NOT OLD."version" + 1
    THEN RAISE(ABORT, 'OrderShippingAddress_version: version은 1씩 올립니다')
  WHEN NEW."piiPurgedAt" IS NULL AND NEW."version" IS NOT OLD."version" AND (SELECT o."status" FROM "Order" o WHERE o."id" = NEW."orderId") NOT IN ('PENDING', 'WAITING_DEPOSIT', 'PAID')
    THEN RAISE(ABORT, 'OrderShippingAddress_locked: 취소·만료된 주문의 배송지는 바꿀 수 없습니다')
  WHEN NEW."piiPurgedAt" IS NULL AND NEW."version" IS NOT OLD."version" AND EXISTS (SELECT 1 FROM "OrderItem" i WHERE i."orderId" = NEW."orderId" AND i."status" IN ('PREPARING', 'SHIPPED', 'DELIVERED', 'CONFIRMED'))
    THEN RAISE(ABORT, 'OrderShippingAddress_locked: 상품 준비가 시작되어 배송지를 바꿀 수 없습니다')
  WHEN NEW."piiPurgedAt" IS NULL AND NEW."version" IS NOT OLD."version" AND COALESCE((SELECT z."extraFee" FROM "ShippingSurchargeZone" z WHERE z."policyId" = (SELECT o."shippingPolicyId" FROM "Order" o WHERE o."id" = NEW."orderId") AND NEW."zipCode" BETWEEN z."zipFrom" AND z."zipTo"), 0) IS NOT (SELECT o."shippingExtraFee" FROM "Order" o WHERE o."id" = NEW."orderId")
    THEN RAISE(ABORT, 'OrderShippingAddress_fee_changed: 배송비가 달라지는 지역(제주·도서산간)으로는 바꿀 수 없습니다')
  WHEN NEW."piiPurgedAt" IS NULL AND NEW."region" IS NOT COALESCE((SELECT z."region" FROM "ShippingSurchargeZone" z WHERE z."policyId" = (SELECT o."shippingPolicyId" FROM "Order" o WHERE o."id" = NEW."orderId") AND NEW."zipCode" BETWEEN z."zipFrom" AND z."zipTo"), 'NORMAL')
    THEN RAISE(ABORT, 'OrderShippingAddress_region: 배송 지역이 우편번호와 맞지 않습니다')
END;
END;

-- 주문에 쓰인 규칙의 금액·시작일은 바꿀 수 없고, 종료일을 당겨 이미 받은 주문을 기간 밖으로 밀어낼 수 없음 (새 규칙은 새 행으로)
DROP TRIGGER IF EXISTS "ShippingPolicy_used_fixed";
CREATE TRIGGER "ShippingPolicy_used_fixed" BEFORE UPDATE ON "ShippingPolicy"
WHEN EXISTS (SELECT 1 FROM "Order" o WHERE o."shippingPolicyId" = OLD."id") AND (NEW."code" IS NOT OLD."code" OR NEW."baseFee" IS NOT OLD."baseFee" OR NEW."freeShippingThreshold" IS NOT OLD."freeShippingThreshold" OR NEW."validFrom" IS NOT OLD."validFrom"
  OR (NEW."validTo" IS NOT NULL AND EXISTS (SELECT 1 FROM "Order" o WHERE o."shippingPolicyId" = OLD."id" AND o."createdAt" >= NEW."validTo")))
BEGIN SELECT RAISE(ABORT, 'ShippingPolicy_used_fixed: 주문에 쓰인 배송비 규칙은 바꿀 수 없습니다. 종료일을 정하고 새 규칙을 추가하세요'); END;

-- 같은 규칙 안에서 우편번호 범위가 겹치면 추가 배송비가 모호함
DROP TRIGGER IF EXISTS "ShippingSurchargeZone_no_overlap_ins";
CREATE TRIGGER "ShippingSurchargeZone_no_overlap_ins" BEFORE INSERT ON "ShippingSurchargeZone"
WHEN EXISTS (SELECT 1 FROM "ShippingSurchargeZone" sz WHERE sz."policyId" = NEW."policyId" AND NEW."zipFrom" <= sz."zipTo" AND sz."zipFrom" <= NEW."zipTo") OR EXISTS (SELECT 1 FROM "Order" o WHERE o."shippingPolicyId" = NEW."policyId")
BEGIN SELECT RAISE(ABORT, 'ShippingSurchargeZone_guard: 우편번호 범위가 겹치거나, 이미 주문에 쓰인 규칙입니다'); END;

-- 주문에 쓰인 규칙의 추가 배송 지역은 수정 금지, 범위 겹침 금지
DROP TRIGGER IF EXISTS "ShippingSurchargeZone_used_fixed";
CREATE TRIGGER "ShippingSurchargeZone_used_fixed" BEFORE UPDATE ON "ShippingSurchargeZone"
WHEN EXISTS (SELECT 1 FROM "Order" o WHERE o."shippingPolicyId" = OLD."policyId") OR EXISTS (SELECT 1 FROM "Order" o WHERE o."shippingPolicyId" = NEW."policyId") OR EXISTS (SELECT 1 FROM "ShippingSurchargeZone" sz WHERE sz."policyId" = NEW."policyId" AND sz."id" <> NEW."id" AND NEW."zipFrom" <= sz."zipTo" AND sz."zipFrom" <= NEW."zipTo")
BEGIN SELECT RAISE(ABORT, 'ShippingSurchargeZone_guard: 우편번호 범위가 겹치거나, 이미 주문에 쓰인 규칙입니다'); END;

-- 주문에 쓰인 규칙의 추가 배송 지역은 삭제 금지
DROP TRIGGER IF EXISTS "ShippingSurchargeZone_no_delete";
CREATE TRIGGER "ShippingSurchargeZone_no_delete" BEFORE DELETE ON "ShippingSurchargeZone"
WHEN EXISTS (SELECT 1 FROM "Order" o WHERE o."shippingPolicyId" = OLD."policyId")
BEGIN SELECT RAISE(ABORT, 'ShippingSurchargeZone_guard: 이미 주문에 쓰인 규칙의 추가 배송 지역은 지울 수 없습니다'); END;

-- 주문 출고만(반품·교환은 ⑩), 송장 등록 상태로, 결제 완료 주문에, 사용 중인 택배사의 송장 자릿수로
DROP TRIGGER IF EXISTS "Shipment_insert_guard";
CREATE TRIGGER "Shipment_insert_guard" BEFORE INSERT ON "Shipment"
BEGIN
SELECT CASE
  WHEN NEW."type" <> 'OUTBOUND'
    THEN RAISE(ABORT, 'Shipment_insert_guard: 지금은 주문 출고(OUTBOUND)만 만들 수 있습니다 (반품·교환은 ⑩ 클레임)')
  WHEN NEW."status" <> 'READY'
    THEN RAISE(ABORT, 'Shipment_insert_guard: 출고는 송장 등록(READY) 상태로 만듭니다')
  WHEN (SELECT o."status" FROM "Order" o WHERE o."id" = NEW."orderId") IS NOT 'PAID'
    THEN RAISE(ABORT, 'Shipment_insert_guard: 결제 완료된 주문만 출고할 수 있습니다')
  WHEN NOT EXISTS (SELECT 1 FROM "Courier" c WHERE c."id" = NEW."courierId" AND c."isActive" = 1 AND length(NEW."trackingNo") BETWEEN c."trackingNoMinLength" AND c."trackingNoMaxLength")
    THEN RAISE(ABORT, 'Shipment_tracking_format: 사용 중인 택배사가 아니거나 송장번호 자릿수가 맞지 않습니다')
END;
END;

-- 송장 등록 → 출고 → 배송 완료, 취소는 출고 전에만. 출고하려면 상자에 상품이 있고, 모두 준비중이며 재고가 할당돼 있어야 함
DROP TRIGGER IF EXISTS "Shipment_transition";
CREATE TRIGGER "Shipment_transition" BEFORE UPDATE OF "status" ON "Shipment"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
SELECT CASE
  WHEN (OLD."status" || '>' || NEW."status") NOT IN ('READY>SHIPPED', 'READY>CANCELED', 'SHIPPED>DELIVERED')
    THEN RAISE(ABORT, 'Shipment_transition: 허용되지 않은 출고 상태 변경입니다')
  WHEN NEW."statusChangedAt" < OLD."statusChangedAt"
    THEN RAISE(ABORT, 'Shipment_transition: 상태 변경 시각이 이전 변경보다 앞설 수 없습니다')
  WHEN NEW."status" = 'SHIPPED' AND NOT EXISTS (SELECT 1 FROM "ShipmentItem" si WHERE si."shipmentId" = NEW."id")
    THEN RAISE(ABORT, 'Shipment_transition: 빈 상자는 출고할 수 없습니다')
  WHEN NEW."status" = 'SHIPPED' AND (SELECT o."status" FROM "Order" o WHERE o."id" = NEW."orderId") IS NOT 'PAID'
    THEN RAISE(ABORT, 'Shipment_transition: 결제 완료 상태가 아닌 주문(취소 등)은 출고할 수 없습니다')
  WHEN NEW."status" = 'SHIPPED' AND EXISTS (SELECT 1 FROM "ShipmentItem" si JOIN "OrderItem" i ON i."id" = si."orderItemId" WHERE si."shipmentId" = NEW."id"
      AND (i."status" <> 'PREPARING' OR NOT EXISTS (SELECT 1 FROM "InventoryReservation" r WHERE r."orderItemId" = i."id" AND r."status" = 'ALLOCATED')))
    THEN RAISE(ABORT, 'Shipment_transition: 상자 안 상품이 모두 상품 준비중이고 재고가 할당돼 있어야 출고할 수 있습니다')
END;
END;

-- <<< db-constraints
