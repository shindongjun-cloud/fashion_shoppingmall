-- >>> db-constraints: 영향받는 트리거 먼저 제거 (prisma/db-constraints.ts에서 생성, 직접 수정 금지)
DROP TRIGGER IF EXISTS "Notification_update_guard";
DROP TRIGGER IF EXISTS "Notification_no_delete";
DROP TRIGGER IF EXISTS "CouponPolicy_insert_draft";
DROP TRIGGER IF EXISTS "CouponPolicy_transition";
DROP TRIGGER IF EXISTS "CouponPolicy_rules_fixed";
DROP TRIGGER IF EXISTS "CouponPolicy_issued_count";
DROP TRIGGER IF EXISTS "CouponPolicy_no_delete";
DROP TRIGGER IF EXISTS "CouponPolicyTarget_draft_only_ins";
DROP TRIGGER IF EXISTS "CouponPolicyTarget_draft_only_del";
DROP TRIGGER IF EXISTS "CouponPolicyTarget_no_update";
DROP TRIGGER IF EXISTS "CouponPolicyGrade_draft_only_ins";
DROP TRIGGER IF EXISTS "CouponPolicyGrade_draft_only_del";
DROP TRIGGER IF EXISTS "CouponPolicyGrade_no_update";
DROP TRIGGER IF EXISTS "CouponCode_insert_guard";
DROP TRIGGER IF EXISTS "CouponCode_fixed";
DROP TRIGGER IF EXISTS "CouponCode_no_delete";
DROP TRIGGER IF EXISTS "CouponCodeAttempt_no_update";
DROP TRIGGER IF EXISTS "CouponCodeAttempt_no_delete";
DROP TRIGGER IF EXISTS "CustomerCoupon_issue_guard";
DROP TRIGGER IF EXISTS "CustomerCoupon_after_issue";
DROP TRIGGER IF EXISTS "CustomerCoupon_fixed";
DROP TRIGGER IF EXISTS "CustomerCoupon_transition";
DROP TRIGGER IF EXISTS "CustomerCoupon_history_upd";
DROP TRIGGER IF EXISTS "CustomerCoupon_no_delete";
DROP TRIGGER IF EXISTS "CustomerCouponHistory_no_update";
DROP TRIGGER IF EXISTS "CustomerCouponHistory_no_delete";
DROP TRIGGER IF EXISTS "Customer_coupon_revoke";
DROP TRIGGER IF EXISTS "OrderCoupon_insert_guard";
DROP TRIGGER IF EXISTS "OrderCoupon_after_insert";
DROP TRIGGER IF EXISTS "OrderCoupon_transition";
DROP TRIGGER IF EXISTS "OrderCoupon_fixed";
DROP TRIGGER IF EXISTS "OrderCoupon_no_delete";
DROP TRIGGER IF EXISTS "OrderCoupon_after_status";
DROP TRIGGER IF EXISTS "Order_coupon_cascade";
DROP TRIGGER IF EXISTS "OrderItemCoupon_insert_guard";
DROP TRIGGER IF EXISTS "OrderItemCoupon_no_update";
DROP TRIGGER IF EXISTS "OrderItemCoupon_no_delete";
DROP TRIGGER IF EXISTS "Payment_coupon_ready";
-- <<< db-constraints-top

-- CreateTable
CREATE TABLE "CouponPolicy" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL,
    "discountType" TEXT NOT NULL,
    "discountValue" INTEGER NOT NULL,
    "maxDiscountAmount" INTEGER,
    "minOrderAmount" INTEGER NOT NULL DEFAULT 0,
    "applyToSaleItems" BOOLEAN NOT NULL DEFAULT true,
    "issueMethod" TEXT NOT NULL,
    "autoTrigger" TEXT,
    "issueStartAt" DATETIME NOT NULL,
    "issueEndAt" DATETIME NOT NULL,
    "totalQuantity" INTEGER,
    "issuedCount" INTEGER NOT NULL DEFAULT 0,
    "perCustomerLimit" INTEGER,
    "useStartAt" DATETIME,
    "useEndAt" DATETIME,
    "validDays" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "statusChangedAt" DATETIME NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CouponPolicy_kind_enum_ck" CHECK ("kind" IN ('PRODUCT', 'ORDER', 'SHIPPING')),
    CONSTRAINT "CouponPolicy_discountType_enum_ck" CHECK ("discountType" IN ('RATE', 'AMOUNT', 'FREE_SHIPPING')),
    CONSTRAINT "CouponPolicy_applyToSaleItems_bool_ck" CHECK ("applyToSaleItems" IN (0, 1)),
    CONSTRAINT "CouponPolicy_issueMethod_enum_ck" CHECK ("issueMethod" IN ('DOWNLOAD', 'AUTO', 'CODE', 'ADMIN')),
    CONSTRAINT "CouponPolicy_autoTrigger_enum_ck" CHECK ("autoTrigger" IN ('SIGNUP', 'BIRTHDAY', 'GRADE_MONTHLY')),
    CONSTRAINT "CouponPolicy_status_enum_ck" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED')),
    CONSTRAINT "CouponPolicy_values_ck" CHECK ("code" <> '' AND "code" NOT GLOB '*[^A-Z0-9_]*' AND trim("name") <> '' AND trim("displayName") <> '' AND length("displayName") <= 40 AND ("description" IS NULL OR (trim("description") <> '' AND length("description") <= 500)) AND trim("createdBy") <> ''
      AND (typeof("discountValue") = 'integer' AND "discountValue" >= 0) AND (typeof("minOrderAmount") = 'integer' AND "minOrderAmount" >= 0) AND ("maxDiscountAmount" IS NULL OR (typeof("maxDiscountAmount") = 'integer' AND "maxDiscountAmount" > 0))
      AND (("discountType" = 'RATE' AND "discountValue" BETWEEN 1 AND 90) OR ("discountType" = 'AMOUNT' AND "discountValue" > 0) OR ("discountType" = 'FREE_SHIPPING' AND "discountValue" = 0 AND "kind" = 'SHIPPING'))
      AND ("kind" <> 'SHIPPING' OR "discountType" IN ('FREE_SHIPPING', 'AMOUNT'))
      AND ("maxDiscountAmount" IS NULL OR "discountType" = 'RATE')),
    CONSTRAINT "CouponPolicy_issue_ck" CHECK (("issueMethod" = 'AUTO') = ("autoTrigger" IS NOT NULL) AND "issueEndAt" > "issueStartAt"
      AND ("totalQuantity" IS NULL OR (typeof("totalQuantity") = 'integer' AND "totalQuantity" > 0)) AND (typeof("issuedCount") = 'integer' AND "issuedCount" >= 0) AND ("totalQuantity" IS NULL OR "issuedCount" <= "totalQuantity")
      AND ("perCustomerLimit" IS NULL OR (typeof("perCustomerLimit") = 'integer' AND "perCustomerLimit" >= 1))
      AND ("autoTrigger" IS NOT 'SIGNUP' OR "perCustomerLimit" = 1)
      AND ("autoTrigger" NOT IN ('BIRTHDAY', 'GRADE_MONTHLY') OR "perCustomerLimit" IS NULL)
      AND (("validDays" IS NOT NULL AND "useStartAt" IS NULL AND "useEndAt" IS NULL AND "validDays" BETWEEN 1 AND 365)
        OR ("validDays" IS NULL AND "useStartAt" IS NOT NULL AND "useEndAt" > "useStartAt" AND "issueEndAt" <= "useEndAt"))
      AND ("issueStartAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("issueEndAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("useStartAt" IS NULL OR "useStartAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("useEndAt" IS NULL OR "useEndAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("statusChangedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("updatedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- CreateTable
CREATE TABLE "CouponPolicyTarget" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "policyId" INTEGER NOT NULL,
    "targetType" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'INCLUDE',
    "categoryId" INTEGER,
    "seasonId" INTEGER,
    "gender" TEXT,
    "styleId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CouponPolicyTarget_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "CouponPolicy" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CouponPolicyTarget_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CouponPolicyTarget_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CouponPolicyTarget_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CouponPolicyTarget_targetType_enum_ck" CHECK ("targetType" IN ('ALL', 'CATEGORY', 'SEASON', 'GENDER', 'STYLE')),
    CONSTRAINT "CouponPolicyTarget_mode_enum_ck" CHECK ("mode" IN ('INCLUDE', 'EXCLUDE')),
    CONSTRAINT "CouponPolicyTarget_gender_enum_ck" CHECK ("gender" IN ('MEN', 'WOMEN', 'UNISEX')),
    CONSTRAINT "CouponPolicyTarget_shape_ck" CHECK (("targetType" = 'ALL'      AND "categoryId" IS NULL     AND "seasonId" IS NULL     AND "gender" IS NULL     AND "styleId" IS NULL) OR ("targetType" = 'CATEGORY' AND "categoryId" IS NOT NULL AND "seasonId" IS NULL     AND "gender" IS NULL     AND "styleId" IS NULL) OR ("targetType" = 'SEASON'   AND "categoryId" IS NULL     AND "seasonId" IS NOT NULL AND "gender" IS NULL     AND "styleId" IS NULL) OR ("targetType" = 'GENDER'   AND "categoryId" IS NULL     AND "seasonId" IS NULL     AND "gender" IS NOT NULL AND "styleId" IS NULL) OR ("targetType" = 'STYLE'    AND "categoryId" IS NULL     AND "seasonId" IS NULL     AND "gender" IS NULL     AND "styleId" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "CouponPolicyGrade" (
    "policyId" INTEGER NOT NULL,
    "gradeId" INTEGER NOT NULL,

    PRIMARY KEY ("policyId", "gradeId"),
    CONSTRAINT "CouponPolicyGrade_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "CouponPolicy" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CouponPolicyGrade_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "CustomerGrade" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CouponCode" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "policyId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CouponCode_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "CouponPolicy" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CouponCode_isActive_bool_ck" CHECK ("isActive" IN (0, 1)),
    CONSTRAINT "CouponCode_ck" CHECK (length("code") BETWEEN 4 AND 20 AND "code" NOT GLOB '*[^A-Z0-9]*')
);

-- CreateTable
CREATE TABLE "CouponCodeAttempt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CouponCodeAttempt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CouponCodeAttempt_success_bool_ck" CHECK ("success" IN (0, 1)),
    CONSTRAINT "CouponCodeAttempt_ck" CHECK (("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- CreateTable
CREATE TABLE "CustomerCoupon" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "couponNo" TEXT NOT NULL,
    "policyId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "issueMethod" TEXT NOT NULL,
    "couponCodeId" INTEGER,
    "issueKey" TEXT,
    "issuedBy" TEXT NOT NULL,
    "issuedAt" DATETIME NOT NULL,
    "validFrom" DATETIME NOT NULL,
    "validTo" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "statusChangedAt" DATETIME NOT NULL,
    "statusReason" TEXT,
    "expiryNotifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomerCoupon_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "CouponPolicy" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CustomerCoupon_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CustomerCoupon_couponCodeId_fkey" FOREIGN KEY ("couponCodeId") REFERENCES "CouponCode" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CustomerCoupon_issueMethod_enum_ck" CHECK ("issueMethod" IN ('DOWNLOAD', 'AUTO', 'CODE', 'ADMIN')),
    CONSTRAINT "CustomerCoupon_status_enum_ck" CHECK ("status" IN ('AVAILABLE', 'IN_USE', 'USED', 'EXPIRED', 'REVOKED')),
    CONSTRAINT "CustomerCoupon_values_ck" CHECK (length("couponNo") = 12 AND "couponNo" GLOB 'CP*' AND "couponNo" NOT GLOB '*[^A-Z0-9]*' AND "validTo" > "validFrom" AND trim("issuedBy") <> ''
      AND ("issueMethod" = 'CODE') = ("couponCodeId" IS NOT NULL) AND ("issueKey" IS NULL OR length("issueKey") BETWEEN 1 AND 40) AND ("statusReason" IS NULL OR (trim("statusReason") <> '' AND length("statusReason") <= 200))
      AND ("issuedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("validFrom" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("validTo" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("statusChangedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("expiryNotifiedAt" IS NULL OR "expiryNotifiedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("updatedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- CreateTable
CREATE TABLE "CustomerCouponHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerCouponId" INTEGER NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "orderId" INTEGER,
    "reason" TEXT,
    "changedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomerCouponHistory_customerCouponId_fkey" FOREIGN KEY ("customerCouponId") REFERENCES "CustomerCoupon" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CustomerCouponHistory_fromStatus_enum_ck" CHECK ("fromStatus" IN ('AVAILABLE', 'IN_USE', 'USED', 'EXPIRED', 'REVOKED')),
    CONSTRAINT "CustomerCouponHistory_toStatus_enum_ck" CHECK ("toStatus" IN ('AVAILABLE', 'IN_USE', 'USED', 'EXPIRED', 'REVOKED')),
    CONSTRAINT "CustomerCouponHistory_ck" CHECK (("changedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("reason" IS NULL OR (trim("reason") <> '' AND length("reason") <= 200)))
);

-- CreateTable
CREATE TABLE "OrderCoupon" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "customerCouponId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "couponName" TEXT NOT NULL,
    "discountAmount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "appliedAt" DATETIME,
    "releasedAt" DATETIME,
    "canceledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrderCoupon_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderCoupon_customerCouponId_fkey" FOREIGN KEY ("customerCouponId") REFERENCES "CustomerCoupon" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderCoupon_kind_enum_ck" CHECK ("kind" IN ('PRODUCT', 'ORDER', 'SHIPPING')),
    CONSTRAINT "OrderCoupon_status_enum_ck" CHECK ("status" IN ('RESERVED', 'APPLIED', 'RELEASED', 'CANCELED')),
    CONSTRAINT "OrderCoupon_values_ck" CHECK ((typeof("discountAmount") = 'integer' AND "discountAmount" > 0) AND trim("couponName") <> '' AND ("appliedAt" IS NULL OR "appliedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("releasedAt" IS NULL OR "releasedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("canceledAt" IS NULL OR "canceledAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("updatedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*')
      AND (("status" = 'RESERVED' AND "appliedAt" IS NULL AND "releasedAt" IS NULL AND "canceledAt" IS NULL)
        OR ("status" = 'APPLIED' AND "appliedAt" IS NOT NULL AND "releasedAt" IS NULL AND "canceledAt" IS NULL)
        OR ("status" = 'RELEASED' AND "appliedAt" IS NULL AND "releasedAt" IS NOT NULL AND "canceledAt" IS NULL)
        OR ("status" = 'CANCELED' AND "appliedAt" IS NOT NULL AND "releasedAt" IS NULL AND "canceledAt" IS NOT NULL)))
);

-- CreateTable
CREATE TABLE "OrderItemCoupon" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderCouponId" INTEGER NOT NULL,
    "orderItemId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    CONSTRAINT "OrderItemCoupon_orderCouponId_fkey" FOREIGN KEY ("orderCouponId") REFERENCES "OrderCoupon" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderItemCoupon_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderItemCoupon_amount_ck" CHECK (typeof("amount") = 'integer' AND "amount" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "CouponPolicy_code_key" ON "CouponPolicy"("code");

-- CreateIndex
CREATE INDEX "CouponPolicy_status_issueMethod_idx" ON "CouponPolicy"("status", "issueMethod");

-- CreateIndex
CREATE INDEX "CouponPolicyTarget_policyId_idx" ON "CouponPolicyTarget"("policyId");

-- CreateIndex
CREATE UNIQUE INDEX "CouponCode_code_key" ON "CouponCode"("code");

-- CreateIndex
CREATE INDEX "CouponCodeAttempt_customerId_createdAt_idx" ON "CouponCodeAttempt"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCoupon_couponNo_key" ON "CustomerCoupon"("couponNo");

-- CreateIndex
CREATE INDEX "CustomerCoupon_customerId_status_validTo_idx" ON "CustomerCoupon"("customerId", "status", "validTo");

-- CreateIndex
CREATE INDEX "CustomerCoupon_status_validTo_idx" ON "CustomerCoupon"("status", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCoupon_policyId_customerId_issueKey_key" ON "CustomerCoupon"("policyId", "customerId", "issueKey");

-- CreateIndex
CREATE INDEX "CustomerCouponHistory_customerCouponId_idx" ON "CustomerCouponHistory"("customerCouponId");

-- CreateIndex
CREATE INDEX "OrderCoupon_orderId_idx" ON "OrderCoupon"("orderId");

-- CreateIndex
CREATE INDEX "OrderCoupon_customerCouponId_idx" ON "OrderCoupon"("customerCouponId");

-- CreateIndex
CREATE INDEX "OrderItemCoupon_orderItemId_idx" ON "OrderItemCoupon"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItemCoupon_orderCouponId_orderItemId_key" ON "OrderItemCoupon"("orderCouponId", "orderItemId");


-- 알림 종류(enum)에 쿠폰 발급·만료 임박 추가 → CHECK를 새로 만들기 위해 테이블 재생성
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
-- Notification: 새 컬럼 + 상태 값 목록(enum CHECK)을 새로 만들기 위해 테이블을 다시 만듦 (ALTER ADD COLUMN은 옛 CHECK를 그대로 둠)
CREATE TABLE "new_Notification" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER,
    "audience" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'IN_APP',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "linkUrl" TEXT,
    "dedupKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" DATETIME,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "Notification_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
,
    CONSTRAINT "Notification_type_enum_ck" CHECK ("type" IN ('RESTOCK_SCHEDULED', 'RESTOCK_RESCHEDULED', 'RESTOCK_CANCELED', 'RESTOCK_ARRIVED', 'RETURN_UPDATE', 'REORDER_NEEDED', 'COUPON_ISSUED', 'COUPON_EXPIRING')),
    CONSTRAINT "Notification_channel_enum_ck" CHECK ("channel" IN ('IN_APP', 'EMAIL', 'KAKAO')),
    CONSTRAINT "Notification_status_enum_ck" CHECK ("status" IN ('PENDING', 'SENT', 'FAILED')),
    CONSTRAINT "Notification_values_ck" CHECK ("audience" IN ('CUSTOMER', 'ADMIN') AND ("audience" = 'CUSTOMER') = ("customerId" IS NOT NULL) AND trim("title") <> '' AND length("title") <= 100 AND trim("body") <> '' AND length("body") <= 1000
      AND ("linkUrl" IS NULL OR ("linkUrl" GLOB '/*' AND "linkUrl" NOT GLOB '//*')) AND length("dedupKey") BETWEEN 3 AND 200 AND (typeof("attempts") = 'integer' AND "attempts" >= 0)
      AND ("status" <> 'SENT' OR "sentAt" IS NOT NULL) AND ("channel" <> 'IN_APP' OR "status" = 'SENT') AND ("sentAt" IS NULL OR "sentAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("readAt" IS NULL OR "readAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);
INSERT INTO "new_Notification" ("id", "customerId", "audience", "type", "channel", "title", "body", "linkUrl", "dedupKey", "status", "attempts", "sentAt", "readAt", "createdAt") SELECT "id", "customerId", "audience", "type", "channel", "title", "body", "linkUrl", "dedupKey", "status", "attempts", "sentAt", "readAt", "createdAt" FROM "Notification";
DROP TABLE "Notification";
ALTER TABLE "new_Notification" RENAME TO "Notification";
CREATE UNIQUE INDEX "Notification_dedupKey_key" ON "Notification"("dedupKey");
CREATE INDEX "Notification_customerId_readAt_id_idx" ON "Notification"("customerId", "readAt", "id");
CREATE INDEX "Notification_audience_createdAt_idx" ON "Notification"("audience", "createdAt");
CREATE INDEX "Notification_status_channel_idx" ON "Notification"("status", "channel");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- >>> db-constraints: 트리거 (prisma/db-constraints.ts에서 생성, 직접 수정 금지)

-- 알림 내용은 고정. 발송 상태·횟수·읽은 시각만 바뀌고, 읽은 시각은 한 번만
DROP TRIGGER IF EXISTS "Notification_update_guard";
CREATE TRIGGER "Notification_update_guard" BEFORE UPDATE ON "Notification"
WHEN NEW."customerId" IS NOT OLD."customerId" OR NEW."audience" IS NOT OLD."audience" OR NEW."type" IS NOT OLD."type" OR NEW."channel" IS NOT OLD."channel"
  OR NEW."title" IS NOT OLD."title" OR NEW."body" IS NOT OLD."body" OR NEW."linkUrl" IS NOT OLD."linkUrl" OR NEW."dedupKey" IS NOT OLD."dedupKey" OR NEW."createdAt" IS NOT OLD."createdAt"
  OR (OLD."readAt" IS NOT NULL AND NEW."readAt" IS NOT OLD."readAt")
BEGIN SELECT RAISE(ABORT, 'Notification_update_guard: 알림 내용은 바꿀 수 없습니다 (읽음 표시·발송 상태만)'); END;

-- 발송 근거 보관
DROP TRIGGER IF EXISTS "Notification_no_delete";
CREATE TRIGGER "Notification_no_delete" BEFORE DELETE ON "Notification"
BEGIN SELECT RAISE(ABORT, 'Notification_no_delete: 알림은 삭제할 수 없습니다'); END;

-- 쿠폰은 작성 중으로 만들고 대상·등급을 채운 뒤 활성화
DROP TRIGGER IF EXISTS "CouponPolicy_insert_draft";
CREATE TRIGGER "CouponPolicy_insert_draft" BEFORE INSERT ON "CouponPolicy"
WHEN NEW."status" <> 'DRAFT' OR NEW."issuedCount" <> 0
BEGIN SELECT RAISE(ABORT, 'CouponPolicy_insert_draft: 쿠폰은 작성 중(DRAFT)·발급 0장으로만 만들 수 있습니다'); END;

-- 정해진 길로만. 상품·장바구니 쿠폰은 포함 대상이 있어야, 코드 쿠폰은 코드가 있어야 활성화
DROP TRIGGER IF EXISTS "CouponPolicy_transition";
CREATE TRIGGER "CouponPolicy_transition" BEFORE UPDATE OF "status" ON "CouponPolicy"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
SELECT CASE
  WHEN (OLD."status" || '>' || NEW."status") NOT IN ('DRAFT>ACTIVE', 'DRAFT>ENDED', 'ACTIVE>PAUSED', 'PAUSED>ACTIVE', 'ACTIVE>ENDED', 'PAUSED>ENDED')
    THEN RAISE(ABORT, 'CouponPolicy_transition: 허용되지 않은 쿠폰 상태 변경입니다')
  WHEN NEW."statusChangedAt" < OLD."statusChangedAt"
    THEN RAISE(ABORT, 'CouponPolicy_transition: 상태 변경 시각이 이전보다 앞설 수 없습니다')
  WHEN NEW."status" = 'ACTIVE' AND NEW."kind" <> 'SHIPPING' AND NOT EXISTS (SELECT 1 FROM "CouponPolicyTarget" t WHERE t."policyId" = NEW."id" AND t."mode" = 'INCLUDE')
    THEN RAISE(ABORT, 'CouponPolicy_transition: 상품·장바구니 쿠폰은 적용 대상(포함)이 있어야 활성화할 수 있습니다')
  WHEN NEW."status" = 'ACTIVE' AND NEW."issueMethod" = 'CODE' AND NOT EXISTS (SELECT 1 FROM "CouponCode" c WHERE c."policyId" = NEW."id" AND c."isActive" = 1)
    THEN RAISE(ABORT, 'CouponPolicy_transition: 코드 쿠폰은 코드가 있어야 활성화할 수 있습니다')
END;
END;

-- 활성화 후에는 할인·조건·발급 방식·사용 기간을 바꿀 수 없음 (이름·설명·상태·발급 종료·총수량만)
DROP TRIGGER IF EXISTS "CouponPolicy_rules_fixed";
CREATE TRIGGER "CouponPolicy_rules_fixed" BEFORE UPDATE OF "code", "kind", "discountType", "discountValue", "maxDiscountAmount", "minOrderAmount", "applyToSaleItems", "issueMethod", "autoTrigger", "issueStartAt", "perCustomerLimit", "useStartAt", "useEndAt", "validDays", "createdBy", "createdAt" ON "CouponPolicy"
WHEN OLD."status" <> 'DRAFT' AND (NEW."code" IS NOT OLD."code" OR NEW."kind" IS NOT OLD."kind" OR NEW."discountType" IS NOT OLD."discountType" OR NEW."discountValue" IS NOT OLD."discountValue" OR NEW."maxDiscountAmount" IS NOT OLD."maxDiscountAmount" OR NEW."minOrderAmount" IS NOT OLD."minOrderAmount" OR NEW."applyToSaleItems" IS NOT OLD."applyToSaleItems" OR NEW."issueMethod" IS NOT OLD."issueMethod" OR NEW."autoTrigger" IS NOT OLD."autoTrigger" OR NEW."issueStartAt" IS NOT OLD."issueStartAt" OR NEW."perCustomerLimit" IS NOT OLD."perCustomerLimit" OR NEW."useStartAt" IS NOT OLD."useStartAt" OR NEW."useEndAt" IS NOT OLD."useEndAt" OR NEW."validDays" IS NOT OLD."validDays" OR NEW."createdBy" IS NOT OLD."createdBy" OR NEW."createdAt" IS NOT OLD."createdAt")
BEGIN SELECT RAISE(ABORT, 'CouponPolicy_rules_fixed: 활성화한 쿠폰은 할인 규칙·조건·사용 기간을 바꿀 수 없습니다 (새 쿠폰으로 만드세요)'); END;

-- 발급 수는 실제 발급된 쿠폰 수와 같아야 함 (트리거만 바꿈)
DROP TRIGGER IF EXISTS "CouponPolicy_issued_count";
CREATE TRIGGER "CouponPolicy_issued_count" BEFORE UPDATE OF "issuedCount" ON "CouponPolicy"
WHEN NEW."issuedCount" IS NOT (SELECT COUNT(*) FROM "CustomerCoupon" cc WHERE cc."policyId" = NEW."id")
BEGIN SELECT RAISE(ABORT, 'CouponPolicy_issued_count: 발급 수는 발급된 쿠폰으로만 바뀝니다'); END;

-- 발급·사용 기록 보관
DROP TRIGGER IF EXISTS "CouponPolicy_no_delete";
CREATE TRIGGER "CouponPolicy_no_delete" BEFORE DELETE ON "CouponPolicy"
BEGIN SELECT RAISE(ABORT, 'CouponPolicy_no_delete: 쿠폰 정책은 삭제할 수 없습니다 (종료로 처리)'); END;

-- 활성화한 쿠폰은 대상·등급을 바꿀 수 없음 (이미 받은 고객과 약속이 달라짐)
DROP TRIGGER IF EXISTS "CouponPolicyTarget_draft_only_ins";
CREATE TRIGGER "CouponPolicyTarget_draft_only_ins" BEFORE INSERT ON "CouponPolicyTarget"
WHEN (SELECT p."status" FROM "CouponPolicy" p WHERE p."id" = NEW."policyId") IS NOT 'DRAFT'
BEGIN SELECT RAISE(ABORT, 'CouponPolicyTarget_draft_only: 작성 중(DRAFT)인 쿠폰만 대상·등급을 바꿀 수 있습니다'); END;

-- 활성화한 쿠폰은 대상·등급을 바꿀 수 없음 (이미 받은 고객과 약속이 달라짐)
DROP TRIGGER IF EXISTS "CouponPolicyTarget_draft_only_del";
CREATE TRIGGER "CouponPolicyTarget_draft_only_del" BEFORE DELETE ON "CouponPolicyTarget"
WHEN (SELECT p."status" FROM "CouponPolicy" p WHERE p."id" = OLD."policyId") IS NOT 'DRAFT'
BEGIN SELECT RAISE(ABORT, 'CouponPolicyTarget_draft_only: 작성 중(DRAFT)인 쿠폰만 대상·등급을 바꿀 수 있습니다'); END;

-- 만든 뒤 수정 금지
DROP TRIGGER IF EXISTS "CouponPolicyTarget_no_update";
CREATE TRIGGER "CouponPolicyTarget_no_update" BEFORE UPDATE ON "CouponPolicyTarget"
BEGIN SELECT RAISE(ABORT, 'CouponPolicyTarget_no_update: 쿠폰 대상은 수정할 수 없습니다 (작성 중에 지우고 다시 추가)'); END;

-- 활성화한 쿠폰은 대상·등급을 바꿀 수 없음 (이미 받은 고객과 약속이 달라짐)
DROP TRIGGER IF EXISTS "CouponPolicyGrade_draft_only_ins";
CREATE TRIGGER "CouponPolicyGrade_draft_only_ins" BEFORE INSERT ON "CouponPolicyGrade"
WHEN (SELECT p."status" FROM "CouponPolicy" p WHERE p."id" = NEW."policyId") IS NOT 'DRAFT'
BEGIN SELECT RAISE(ABORT, 'CouponPolicyGrade_draft_only: 작성 중(DRAFT)인 쿠폰만 대상·등급을 바꿀 수 있습니다'); END;

-- 활성화한 쿠폰은 대상·등급을 바꿀 수 없음 (이미 받은 고객과 약속이 달라짐)
DROP TRIGGER IF EXISTS "CouponPolicyGrade_draft_only_del";
CREATE TRIGGER "CouponPolicyGrade_draft_only_del" BEFORE DELETE ON "CouponPolicyGrade"
WHEN (SELECT p."status" FROM "CouponPolicy" p WHERE p."id" = OLD."policyId") IS NOT 'DRAFT'
BEGIN SELECT RAISE(ABORT, 'CouponPolicyGrade_draft_only: 작성 중(DRAFT)인 쿠폰만 대상·등급을 바꿀 수 있습니다'); END;

-- 만든 뒤 수정 금지
DROP TRIGGER IF EXISTS "CouponPolicyGrade_no_update";
CREATE TRIGGER "CouponPolicyGrade_no_update" BEFORE UPDATE ON "CouponPolicyGrade"
BEGIN SELECT RAISE(ABORT, 'CouponPolicyGrade_no_update: 쿠폰 등급은 수정할 수 없습니다 (작성 중에 지우고 다시 추가)'); END;

-- 코드는 코드 발급 쿠폰에만, 종료된 쿠폰에는 추가 불가
DROP TRIGGER IF EXISTS "CouponCode_insert_guard";
CREATE TRIGGER "CouponCode_insert_guard" BEFORE INSERT ON "CouponCode"
WHEN (SELECT p."issueMethod" FROM "CouponPolicy" p WHERE p."id" = NEW."policyId") IS NOT 'CODE' OR (SELECT p."status" FROM "CouponPolicy" p WHERE p."id" = NEW."policyId") = 'ENDED'
BEGIN SELECT RAISE(ABORT, 'CouponCode_insert_guard: 코드는 진행 중인 코드 발급 쿠폰에만 추가할 수 있습니다'); END;

-- 코드 고정
DROP TRIGGER IF EXISTS "CouponCode_fixed";
CREATE TRIGGER "CouponCode_fixed" BEFORE UPDATE OF "policyId", "code", "createdAt" ON "CouponCode"
WHEN NEW."policyId" IS NOT OLD."policyId" OR NEW."code" IS NOT OLD."code" OR NEW."createdAt" IS NOT OLD."createdAt"
BEGIN SELECT RAISE(ABORT, 'CouponCode_fixed: 쿠폰 코드는 바꿀 수 없습니다 (사용 중지만 가능)'); END;

-- 발급 기록 보관
DROP TRIGGER IF EXISTS "CouponCode_no_delete";
CREATE TRIGGER "CouponCode_no_delete" BEFORE DELETE ON "CouponCode"
BEGIN SELECT RAISE(ABORT, 'CouponCode_no_delete: 쿠폰 코드는 삭제할 수 없습니다 (사용 중지로 처리)'); END;

-- 이력은 수정 금지
DROP TRIGGER IF EXISTS "CouponCodeAttempt_no_update";
CREATE TRIGGER "CouponCodeAttempt_no_update" BEFORE UPDATE ON "CouponCodeAttempt"
BEGIN SELECT RAISE(ABORT, 'CouponCodeAttempt_append_only: 이력은 수정할 수 없습니다'); END;

-- 이력은 삭제 금지
DROP TRIGGER IF EXISTS "CouponCodeAttempt_no_delete";
CREATE TRIGGER "CouponCodeAttempt_no_delete" BEFORE DELETE ON "CouponCodeAttempt"
BEGIN SELECT RAISE(ABORT, 'CouponCodeAttempt_append_only: 이력은 삭제할 수 없습니다'); END;

-- 선착순 수량·1인 한도·발급 기간·정상 회원·대상 등급·발급 방식·코드·사용 기간을 DB가 최종 판정 (동시에 받아도 정확)
DROP TRIGGER IF EXISTS "CustomerCoupon_issue_guard";
CREATE TRIGGER "CustomerCoupon_issue_guard" BEFORE INSERT ON "CustomerCoupon"
BEGIN
SELECT CASE
  WHEN NEW."status" <> 'AVAILABLE'
    THEN RAISE(ABORT, 'CustomerCoupon_issue_guard: 쿠폰은 사용 가능 상태로 발급합니다')
  WHEN (SELECT p."status" FROM "CouponPolicy" p WHERE p."id" = NEW."policyId") IS NOT 'ACTIVE'
    THEN RAISE(ABORT, 'CustomerCoupon_not_active: 지금 발급할 수 없는 쿠폰입니다 (작성 중·중지·종료)')
  WHEN NEW."issuedAt" < (SELECT p."issueStartAt" FROM "CouponPolicy" p WHERE p."id" = NEW."policyId") OR NEW."issuedAt" >= (SELECT p."issueEndAt" FROM "CouponPolicy" p WHERE p."id" = NEW."policyId")
    THEN RAISE(ABORT, 'CustomerCoupon_issue_period: 발급 기간이 아닙니다')
  WHEN (SELECT p."totalQuantity" FROM "CouponPolicy" p WHERE p."id" = NEW."policyId") IS NOT NULL AND (SELECT p."issuedCount" FROM "CouponPolicy" p WHERE p."id" = NEW."policyId") >= (SELECT p."totalQuantity" FROM "CouponPolicy" p WHERE p."id" = NEW."policyId")
    THEN RAISE(ABORT, 'CustomerCoupon_sold_out: 선착순 수량이 모두 발급되었습니다')
  WHEN (SELECT p."perCustomerLimit" FROM "CouponPolicy" p WHERE p."id" = NEW."policyId") IS NOT NULL
      AND (SELECT COUNT(*) FROM "CustomerCoupon" cc WHERE cc."policyId" = NEW."policyId" AND cc."customerId" = NEW."customerId") >= (SELECT p."perCustomerLimit" FROM "CouponPolicy" p WHERE p."id" = NEW."policyId")
    THEN RAISE(ABORT, 'CustomerCoupon_limit: 이미 받은 쿠폰입니다 (1인 발급 한도)')
  WHEN (SELECT c."status" FROM "Customer" c WHERE c."id" = NEW."customerId") IS NOT 'ACTIVE'
    THEN RAISE(ABORT, 'CustomerCoupon_customer: 정상 회원만 쿠폰을 받을 수 있습니다')
  WHEN EXISTS (SELECT 1 FROM "CouponPolicyGrade" g WHERE g."policyId" = NEW."policyId")
      AND NOT EXISTS (SELECT 1 FROM "CouponPolicyGrade" g WHERE g."policyId" = NEW."policyId" AND g."gradeId" = (SELECT c."gradeId" FROM "Customer" c WHERE c."id" = NEW."customerId"))
    THEN RAISE(ABORT, 'CustomerCoupon_grade: 받을 수 있는 등급이 아닙니다')
  WHEN NEW."issueMethod" <> 'ADMIN' AND NEW."issueMethod" IS NOT (SELECT p."issueMethod" FROM "CouponPolicy" p WHERE p."id" = NEW."policyId")
    THEN RAISE(ABORT, 'CustomerCoupon_issue_guard: 쿠폰의 발급 방식과 다릅니다')
  WHEN NEW."couponCodeId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "CouponCode" k WHERE k."id" = NEW."couponCodeId" AND k."policyId" = NEW."policyId" AND k."isActive" = 1)
    THEN RAISE(ABORT, 'CustomerCoupon_issue_guard: 사용할 수 없는 쿠폰 코드입니다')
  WHEN NEW."issueMethod" = 'AUTO' AND (SELECT p."autoTrigger" FROM "CouponPolicy" p WHERE p."id" = NEW."policyId") IN ('BIRTHDAY', 'GRADE_MONTHLY') AND NEW."issueKey" IS NULL
    THEN RAISE(ABORT, 'CustomerCoupon_issue_guard: 주기 발급 쿠폰은 주기 키(issueKey)가 필요합니다')
  WHEN (SELECT p."validDays" FROM "CouponPolicy" p WHERE p."id" = NEW."policyId") IS NULL
      AND (NEW."validFrom" IS NOT (SELECT p."useStartAt" FROM "CouponPolicy" p WHERE p."id" = NEW."policyId") OR NEW."validTo" IS NOT (SELECT p."useEndAt" FROM "CouponPolicy" p WHERE p."id" = NEW."policyId"))
    THEN RAISE(ABORT, 'CustomerCoupon_validity: 사용 기간이 쿠폰 정책(고정 기간)과 다릅니다')
  WHEN (SELECT p."validDays" FROM "CouponPolicy" p WHERE p."id" = NEW."policyId") IS NOT NULL
      AND (NEW."validFrom" IS NOT NEW."issuedAt" OR NEW."validTo" IS NOT strftime('%Y-%m-%dT%H:%M:%f+00:00', date(NEW."issuedAt", '+9 hours', '+' || (SELECT p."validDays" FROM "CouponPolicy" p WHERE p."id" = NEW."policyId") || ' days'), '-9 hours'))
    THEN RAISE(ABORT, 'CustomerCoupon_validity: 사용 기간이 발급일 기준 N일과 다릅니다')
END;
END;

-- 발급 수 +1, 이력 첫 줄
DROP TRIGGER IF EXISTS "CustomerCoupon_after_issue";
CREATE TRIGGER "CustomerCoupon_after_issue" AFTER INSERT ON "CustomerCoupon"
BEGIN
  UPDATE "CouponPolicy" SET "issuedCount" = (SELECT COUNT(*) FROM "CustomerCoupon" cc WHERE cc."policyId" = NEW."policyId") WHERE "id" = NEW."policyId";
  INSERT INTO "CustomerCouponHistory" ("customerCouponId", "fromStatus", "toStatus", "orderId", "reason", "changedAt")
  VALUES (NEW."id", NULL, NEW."status", NULL, 'ISSUED:' || NEW."issueMethod", NEW."issuedAt");
END;

-- 발급 정보 고정
DROP TRIGGER IF EXISTS "CustomerCoupon_fixed";
CREATE TRIGGER "CustomerCoupon_fixed" BEFORE UPDATE OF "couponNo", "policyId", "customerId", "issueMethod", "couponCodeId", "issueKey", "issuedBy", "issuedAt", "validFrom", "validTo", "createdAt" ON "CustomerCoupon"
WHEN NEW."couponNo" IS NOT OLD."couponNo" OR NEW."policyId" IS NOT OLD."policyId" OR NEW."customerId" IS NOT OLD."customerId" OR NEW."issueMethod" IS NOT OLD."issueMethod" OR NEW."couponCodeId" IS NOT OLD."couponCodeId" OR NEW."issueKey" IS NOT OLD."issueKey" OR NEW."issuedBy" IS NOT OLD."issuedBy" OR NEW."issuedAt" IS NOT OLD."issuedAt" OR NEW."validFrom" IS NOT OLD."validFrom" OR NEW."validTo" IS NOT OLD."validTo" OR NEW."createdAt" IS NOT OLD."createdAt"
BEGIN SELECT RAISE(ABORT, 'CustomerCoupon_fixed: 발급된 쿠폰의 주인·사용 기간은 바꿀 수 없습니다'); END;

-- 정해진 길로만. 사용 중·사용됨은 주문 쿠폰 기록과 반드시 맞아야 하고(앱이 직접 못 바꿈), 만료는 기간이 지난 뒤에만, 회수는 사유 필수
DROP TRIGGER IF EXISTS "CustomerCoupon_transition";
CREATE TRIGGER "CustomerCoupon_transition" BEFORE UPDATE OF "status" ON "CustomerCoupon"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
SELECT CASE
  WHEN (OLD."status" || '>' || NEW."status") NOT IN ('AVAILABLE>IN_USE', 'IN_USE>USED', 'IN_USE>AVAILABLE', 'IN_USE>EXPIRED', 'USED>AVAILABLE', 'USED>EXPIRED', 'AVAILABLE>EXPIRED', 'AVAILABLE>REVOKED')
    THEN RAISE(ABORT, 'CustomerCoupon_transition: 허용되지 않은 쿠폰 상태 변경입니다')
  WHEN NEW."statusChangedAt" < OLD."statusChangedAt"
    THEN RAISE(ABORT, 'CustomerCoupon_transition: 상태 변경 시각이 이전보다 앞설 수 없습니다')
  WHEN NEW."status" = 'IN_USE' AND NOT EXISTS (SELECT 1 FROM "OrderCoupon" oc WHERE oc."customerCouponId" = NEW."id" AND oc."status" = 'RESERVED')
    THEN RAISE(ABORT, 'CustomerCoupon_order_sync: 사용 중 상태는 주문 쿠폰 예약으로만 바뀝니다')
  WHEN NEW."status" = 'USED' AND NOT EXISTS (SELECT 1 FROM "OrderCoupon" oc WHERE oc."customerCouponId" = NEW."id" AND oc."status" = 'APPLIED')
    THEN RAISE(ABORT, 'CustomerCoupon_order_sync: 사용됨 상태는 결제 완료로만 바뀝니다')
  WHEN NEW."status" NOT IN ('IN_USE', 'USED') AND EXISTS (SELECT 1 FROM "OrderCoupon" oc WHERE oc."customerCouponId" = NEW."id" AND oc."status" IN ('RESERVED', 'APPLIED'))
    THEN RAISE(ABORT, 'CustomerCoupon_order_sync: 주문에 쓰인 쿠폰은 주문이 끝나야 돌려받거나 만료됩니다')
  WHEN OLD."status" = 'AVAILABLE' AND NEW."status" = 'EXPIRED' AND NEW."validTo" > NEW."statusChangedAt"
    THEN RAISE(ABORT, 'CustomerCoupon_transition: 사용 기간이 남은 쿠폰은 만료 처리할 수 없습니다')
  WHEN NEW."status" = 'REVOKED' AND NEW."statusReason" IS NULL
    THEN RAISE(ABORT, 'CustomerCoupon_transition: 회수 사유가 필요합니다')
END;
END;

-- 상태가 바뀔 때마다 이력 (주문 때문이면 주문 번호도)
DROP TRIGGER IF EXISTS "CustomerCoupon_history_upd";
CREATE TRIGGER "CustomerCoupon_history_upd" AFTER UPDATE OF "status" ON "CustomerCoupon"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
  INSERT INTO "CustomerCouponHistory" ("customerCouponId", "fromStatus", "toStatus", "orderId", "reason", "changedAt")
  VALUES (NEW."id", OLD."status", NEW."status",
    CASE WHEN NEW."status" IN ('IN_USE', 'USED') OR OLD."status" IN ('IN_USE', 'USED')
      THEN (SELECT oc."orderId" FROM "OrderCoupon" oc WHERE oc."customerCouponId" = NEW."id" ORDER BY oc."id" DESC LIMIT 1) END,
    NEW."statusReason", NEW."statusChangedAt");
END;

-- 발급·사용 기록 보관
DROP TRIGGER IF EXISTS "CustomerCoupon_no_delete";
CREATE TRIGGER "CustomerCoupon_no_delete" BEFORE DELETE ON "CustomerCoupon"
BEGIN SELECT RAISE(ABORT, 'CustomerCoupon_no_delete: 발급된 쿠폰은 삭제할 수 없습니다 (회수로 처리)'); END;

-- 이력은 수정 금지
DROP TRIGGER IF EXISTS "CustomerCouponHistory_no_update";
CREATE TRIGGER "CustomerCouponHistory_no_update" BEFORE UPDATE ON "CustomerCouponHistory"
BEGIN SELECT RAISE(ABORT, 'CustomerCouponHistory_append_only: 이력은 수정할 수 없습니다'); END;

-- 이력은 삭제 금지
DROP TRIGGER IF EXISTS "CustomerCouponHistory_no_delete";
CREATE TRIGGER "CustomerCouponHistory_no_delete" BEFORE DELETE ON "CustomerCouponHistory"
BEGIN SELECT RAISE(ABORT, 'CustomerCouponHistory_append_only: 이력은 삭제할 수 없습니다'); END;

-- 탈퇴하면 남은 쿠폰 소멸 (사용한 쿠폰 기록은 그대로)
DROP TRIGGER IF EXISTS "Customer_coupon_revoke";
CREATE TRIGGER "Customer_coupon_revoke" AFTER UPDATE OF "status" ON "Customer"
WHEN NEW."status" = 'WITHDRAWN' AND OLD."status" IS NOT 'WITHDRAWN'
BEGIN
  UPDATE "CustomerCoupon" SET "status" = 'REVOKED', "statusReason" = 'WITHDRAWN', "statusChangedAt" = MAX("statusChangedAt", NEW."statusChangedAt"), "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')
  WHERE "customerId" = NEW."id" AND "status" = 'AVAILABLE';
END;

-- 결제 대기 회원 주문에, 본인의 사용 가능한 쿠폰만, 주문 시각이 사용 기간 안, 중지된 쿠폰 불가, 쿠폰은 종류와 관계없이 주문당 1장(중복 사용 불가), 할인액이 규칙을 넘지 않음
DROP TRIGGER IF EXISTS "OrderCoupon_insert_guard";
CREATE TRIGGER "OrderCoupon_insert_guard" BEFORE INSERT ON "OrderCoupon"
BEGIN
SELECT CASE
  WHEN NEW."status" <> 'RESERVED'
    THEN RAISE(ABORT, 'OrderCoupon_insert_guard: 주문 쿠폰은 예약 상태로 만듭니다')
  WHEN (SELECT o."status" FROM "Order" o WHERE o."id" = NEW."orderId") IS NOT 'PENDING'
    THEN RAISE(ABORT, 'OrderCoupon_insert_guard: 결제 대기 주문에만 쿠폰을 쓸 수 있습니다')
  WHEN (SELECT o."customerId" FROM "Order" o WHERE o."id" = NEW."orderId") IS NOT (SELECT cc."customerId" FROM "CustomerCoupon" cc WHERE cc."id" = NEW."customerCouponId")
    THEN RAISE(ABORT, 'OrderCoupon_owner: 본인 쿠폰만 쓸 수 있습니다')
  WHEN (SELECT cc."status" FROM "CustomerCoupon" cc WHERE cc."id" = NEW."customerCouponId") IS NOT 'AVAILABLE'
      OR EXISTS (SELECT 1 FROM "OrderCoupon" oc WHERE oc."customerCouponId" = NEW."customerCouponId" AND oc."status" IN ('RESERVED', 'APPLIED'))
    THEN RAISE(ABORT, 'OrderCoupon_coupon_unavailable: 사용할 수 없는 쿠폰입니다 (다른 주문에서 사용 중·사용됨·만료)')
  WHEN (SELECT o."createdAt" FROM "Order" o WHERE o."id" = NEW."orderId") < (SELECT cc."validFrom" FROM "CustomerCoupon" cc WHERE cc."id" = NEW."customerCouponId")
      OR (SELECT o."createdAt" FROM "Order" o WHERE o."id" = NEW."orderId") >= (SELECT cc."validTo" FROM "CustomerCoupon" cc WHERE cc."id" = NEW."customerCouponId")
    THEN RAISE(ABORT, 'OrderCoupon_period: 쿠폰 사용 기간이 아닙니다')
  WHEN (SELECT p."status" FROM "CouponPolicy" p JOIN "CustomerCoupon" cc ON cc."policyId" = p."id" WHERE cc."id" = NEW."customerCouponId") NOT IN ('ACTIVE', 'ENDED')
    THEN RAISE(ABORT, 'OrderCoupon_paused: 사용이 중지된 쿠폰입니다')
  WHEN NEW."kind" IS NOT (SELECT p."kind" FROM "CouponPolicy" p JOIN "CustomerCoupon" cc ON cc."policyId" = p."id" WHERE cc."id" = NEW."customerCouponId")
    THEN RAISE(ABORT, 'OrderCoupon_insert_guard: 쿠폰 종류가 정책과 다릅니다')
  WHEN EXISTS (SELECT 1 FROM "OrderCoupon" oc WHERE oc."orderId" = NEW."orderId")
    THEN RAISE(ABORT, 'OrderCoupon_one_per_order: 쿠폰은 주문당 1장만 쓸 수 있습니다 (중복 사용 불가)')
  WHEN (SELECT p."discountType" FROM "CouponPolicy" p JOIN "CustomerCoupon" cc ON cc."policyId" = p."id" WHERE cc."id" = NEW."customerCouponId") = 'AMOUNT'
      AND NEW."discountAmount" > (SELECT p."discountValue" FROM "CouponPolicy" p JOIN "CustomerCoupon" cc ON cc."policyId" = p."id" WHERE cc."id" = NEW."customerCouponId")
    THEN RAISE(ABORT, 'OrderCoupon_amount: 정액 쿠폰 금액보다 많이 할인할 수 없습니다')
  WHEN NEW."discountAmount" > COALESCE((SELECT p."maxDiscountAmount" FROM "CouponPolicy" p JOIN "CustomerCoupon" cc ON cc."policyId" = p."id" WHERE cc."id" = NEW."customerCouponId"), NEW."discountAmount")
    THEN RAISE(ABORT, 'OrderCoupon_amount: 최대 할인 금액을 넘었습니다')
  WHEN NEW."kind" = 'SHIPPING' AND (
      NEW."discountAmount" > (SELECT o."shippingBaseFee" FROM "Order" o WHERE o."id" = NEW."orderId")
      OR ((SELECT p."discountType" FROM "CouponPolicy" p JOIN "CustomerCoupon" cc ON cc."policyId" = p."id" WHERE cc."id" = NEW."customerCouponId") = 'FREE_SHIPPING'
        AND NEW."discountAmount" IS NOT (SELECT o."shippingBaseFee" FROM "Order" o WHERE o."id" = NEW."orderId")))
    THEN RAISE(ABORT, 'OrderCoupon_shipping: 배송비 쿠폰은 기본 배송비만큼만 할인합니다 (제주·도서산간 추가 배송비 제외)')
  WHEN NEW."kind" = 'SHIPPING' AND (SELECT o."itemsTotal" FROM "Order" o WHERE o."id" = NEW."orderId")
      < (SELECT p."minOrderAmount" FROM "CouponPolicy" p JOIN "CustomerCoupon" cc ON cc."policyId" = p."id" WHERE cc."id" = NEW."customerCouponId")
    THEN RAISE(ABORT, 'OrderCoupon_min_order: 최소 구매 금액이 모자랍니다')
END;
END;

-- 예약하면 쿠폰은 '사용 중' (같은 쿠폰을 다른 주문에 못 씀)
DROP TRIGGER IF EXISTS "OrderCoupon_after_insert";
CREATE TRIGGER "OrderCoupon_after_insert" AFTER INSERT ON "OrderCoupon"
BEGIN
  UPDATE "CustomerCoupon" SET "status" = 'IN_USE', "statusReason" = 'ORDER_RESERVED', "statusChangedAt" = MAX("statusChangedAt", NEW."createdAt"), "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')
  WHERE "id" = NEW."customerCouponId";
END;

-- 주문 상태와 맞게만: 사용 = 결제 완료, 해제 = 결제 안 되고 끝남, 결제 후 취소 = 주문 취소 (트리거가 주문을 따라 바꿈)
DROP TRIGGER IF EXISTS "OrderCoupon_transition";
CREATE TRIGGER "OrderCoupon_transition" BEFORE UPDATE OF "status" ON "OrderCoupon"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
SELECT CASE
  WHEN (OLD."status" || '>' || NEW."status") NOT IN ('RESERVED>APPLIED', 'RESERVED>RELEASED', 'APPLIED>CANCELED')
    THEN RAISE(ABORT, 'OrderCoupon_transition: 허용되지 않은 주문 쿠폰 상태 변경입니다')
  WHEN NEW."status" = 'APPLIED' AND (SELECT o."status" FROM "Order" o WHERE o."id" = NEW."orderId") IS NOT 'PAID'
    THEN RAISE(ABORT, 'OrderCoupon_order_sync: 결제 완료된 주문의 쿠폰만 사용 처리됩니다')
  WHEN NEW."status" = 'RELEASED' AND (SELECT o."status" FROM "Order" o WHERE o."id" = NEW."orderId") NOT IN ('CANCELED', 'EXPIRED')
    THEN RAISE(ABORT, 'OrderCoupon_order_sync: 끝난 주문의 쿠폰만 돌려줍니다')
  WHEN NEW."status" = 'CANCELED' AND (SELECT o."status" FROM "Order" o WHERE o."id" = NEW."orderId") IS NOT 'CANCELED'
    THEN RAISE(ABORT, 'OrderCoupon_order_sync: 취소된 주문의 쿠폰만 취소 처리됩니다')
END;
END;

-- 주문 금액 근거 고정
DROP TRIGGER IF EXISTS "OrderCoupon_fixed";
CREATE TRIGGER "OrderCoupon_fixed" BEFORE UPDATE OF "orderId", "customerCouponId", "kind", "couponName", "discountAmount", "createdAt" ON "OrderCoupon"
WHEN NEW."orderId" IS NOT OLD."orderId" OR NEW."customerCouponId" IS NOT OLD."customerCouponId" OR NEW."kind" IS NOT OLD."kind" OR NEW."couponName" IS NOT OLD."couponName" OR NEW."discountAmount" IS NOT OLD."discountAmount" OR NEW."createdAt" IS NOT OLD."createdAt"
BEGIN SELECT RAISE(ABORT, 'OrderCoupon_fixed: 주문에 쓴 쿠폰 기록은 바꿀 수 없습니다'); END;

-- 주문 금액 근거 보관
DROP TRIGGER IF EXISTS "OrderCoupon_no_delete";
CREATE TRIGGER "OrderCoupon_no_delete" BEFORE DELETE ON "OrderCoupon"
BEGIN SELECT RAISE(ABORT, 'OrderCoupon_no_delete: 주문 쿠폰 기록은 삭제할 수 없습니다'); END;

-- 주문 쿠폰이 사용·해제·취소되면 고객 쿠폰을 따라 바꿈 (돌려줄 때 기간이 지났으면 만료)
DROP TRIGGER IF EXISTS "OrderCoupon_after_status";
CREATE TRIGGER "OrderCoupon_after_status" AFTER UPDATE OF "status" ON "OrderCoupon"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
  UPDATE "CustomerCoupon" SET "status" = 'USED', "statusReason" = 'ORDER_PAID', "statusChangedAt" = MAX("statusChangedAt", NEW."appliedAt"), "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')
  WHERE "id" = NEW."customerCouponId" AND NEW."status" = 'APPLIED';
  UPDATE "CustomerCoupon" SET
    "status" = CASE WHEN "validTo" > NEW."releasedAt" THEN 'AVAILABLE' ELSE 'EXPIRED' END,
    "statusReason" = 'ORDER_NOT_PAID', "statusChangedAt" = MAX("statusChangedAt", NEW."releasedAt"), "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')
  WHERE "id" = NEW."customerCouponId" AND NEW."status" = 'RELEASED';
  UPDATE "CustomerCoupon" SET
    "status" = CASE WHEN "validTo" > NEW."canceledAt" THEN 'AVAILABLE' ELSE 'EXPIRED' END,
    "statusReason" = 'ORDER_CANCELED', "statusChangedAt" = MAX("statusChangedAt", NEW."canceledAt"), "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')
  WHERE "id" = NEW."customerCouponId" AND NEW."status" = 'CANCELED';
END;

-- 주문 결제 → 쿠폰 사용, 결제 없이 끝남(이탈·만료·대체) → 쿠폰 돌려줌, 결제 후 전체 취소 → 기간이 남았으면 돌려줌
DROP TRIGGER IF EXISTS "Order_coupon_cascade";
CREATE TRIGGER "Order_coupon_cascade" AFTER UPDATE OF "status" ON "Order"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
  UPDATE "OrderCoupon" SET "status" = 'APPLIED', "appliedAt" = NEW."statusChangedAt", "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')
  WHERE "orderId" = NEW."id" AND "status" = 'RESERVED' AND NEW."status" = 'PAID';
  UPDATE "OrderCoupon" SET "status" = 'RELEASED', "releasedAt" = NEW."statusChangedAt", "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')
  WHERE "orderId" = NEW."id" AND "status" = 'RESERVED' AND NEW."status" IN ('CANCELED', 'EXPIRED');
  UPDATE "OrderCoupon" SET "status" = 'CANCELED', "canceledAt" = NEW."statusChangedAt", "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')
  WHERE "orderId" = NEW."id" AND "status" = 'APPLIED' AND NEW."status" = 'CANCELED';
END;

-- 같은 주문의 줄에만, 결제 대기 중에만, 배송비 쿠폰은 배분 없음, 줄 금액 이하, 상품 쿠폰은 줄 1개·줄당 1장·최소 금액, 적용 대상(제외 우선·하위 카테고리·행사 상품 제외 옵션)
DROP TRIGGER IF EXISTS "OrderItemCoupon_insert_guard";
CREATE TRIGGER "OrderItemCoupon_insert_guard" BEFORE INSERT ON "OrderItemCoupon"
BEGIN
SELECT CASE
  WHEN (SELECT oi."orderId" FROM "OrderItem" oi WHERE oi."id" = NEW."orderItemId") IS NOT (SELECT oc."orderId" FROM "OrderCoupon" oc WHERE oc."id" = NEW."orderCouponId")
    THEN RAISE(ABORT, 'OrderItemCoupon_insert_guard: 같은 주문의 상품에만 배분할 수 있습니다')
  WHEN (SELECT oc."status" FROM "OrderCoupon" oc WHERE oc."id" = NEW."orderCouponId") IS NOT 'RESERVED'
      OR (SELECT o."status" FROM "Order" o WHERE o."id" = (SELECT oc."orderId" FROM "OrderCoupon" oc WHERE oc."id" = NEW."orderCouponId")) IS NOT 'PENDING'
    THEN RAISE(ABORT, 'OrderItemCoupon_insert_guard: 결제 대기 주문의 예약 쿠폰만 배분할 수 있습니다')
  WHEN (SELECT oc."kind" FROM "OrderCoupon" oc WHERE oc."id" = NEW."orderCouponId") = 'SHIPPING'
    THEN RAISE(ABORT, 'OrderItemCoupon_insert_guard: 배송비 쿠폰은 상품에 배분하지 않습니다')
  WHEN NEW."amount" > (SELECT oi."lineTotal" FROM "OrderItem" oi WHERE oi."id" = NEW."orderItemId")
    THEN RAISE(ABORT, 'OrderItemCoupon_insert_guard: 상품 금액보다 많이 할인할 수 없습니다')
  WHEN (SELECT oc."kind" FROM "OrderCoupon" oc WHERE oc."id" = NEW."orderCouponId") = 'PRODUCT' AND (
      EXISTS (SELECT 1 FROM "OrderItemCoupon" x WHERE x."orderCouponId" = NEW."orderCouponId")
      OR EXISTS (SELECT 1 FROM "OrderItemCoupon" x JOIN "OrderCoupon" oc ON oc."id" = x."orderCouponId" WHERE x."orderItemId" = NEW."orderItemId" AND oc."kind" = 'PRODUCT' AND oc."status" IN ('RESERVED', 'APPLIED')))
    THEN RAISE(ABORT, 'OrderItemCoupon_product_one: 상품 쿠폰은 상품 1개에 1장만 씁니다')
  WHEN (SELECT oc."kind" FROM "OrderCoupon" oc WHERE oc."id" = NEW."orderCouponId") = 'PRODUCT'
      AND (SELECT oi."lineTotal" FROM "OrderItem" oi WHERE oi."id" = NEW."orderItemId") < (SELECT p."minOrderAmount" FROM "CouponPolicy" p WHERE p."id" = (SELECT cc."policyId" FROM "CustomerCoupon" cc JOIN "OrderCoupon" oc ON oc."customerCouponId" = cc."id" WHERE oc."id" = NEW."orderCouponId"))
    THEN RAISE(ABORT, 'OrderCoupon_min_order: 상품 금액이 쿠폰의 최소 구매 금액보다 적습니다')
  WHEN NOT (EXISTS (SELECT 1 FROM "CouponPolicyTarget" t WHERE t."policyId" = (SELECT cc."policyId" FROM "CustomerCoupon" cc JOIN "OrderCoupon" oc ON oc."customerCouponId" = cc."id" WHERE oc."id" = NEW."orderCouponId") AND t."mode" = 'INCLUDE' AND (t."targetType" = 'ALL'
      OR (t."targetType" = 'CATEGORY' AND (SELECT c."path" FROM "Category" c WHERE c."id" = (SELECT st2."categoryId" FROM "Style" st2 WHERE st2."id" = (SELECT st."id" FROM "Sku" k JOIN "StyleColor" sc ON sc."id" = k."styleColorId" JOIN "Style" st ON st."id" = sc."styleId" WHERE k."id" = (SELECT oi."skuId" FROM "OrderItem" oi WHERE oi."id" = NEW."orderItemId")))) LIKE '%/' || t."categoryId" || '/%')
      OR (t."targetType" = 'SEASON' AND t."seasonId" = (SELECT st2."seasonId" FROM "Style" st2 WHERE st2."id" = (SELECT st."id" FROM "Sku" k JOIN "StyleColor" sc ON sc."id" = k."styleColorId" JOIN "Style" st ON st."id" = sc."styleId" WHERE k."id" = (SELECT oi."skuId" FROM "OrderItem" oi WHERE oi."id" = NEW."orderItemId"))))
      OR (t."targetType" = 'GENDER' AND t."gender" = (SELECT st2."gender" FROM "Style" st2 WHERE st2."id" = (SELECT st."id" FROM "Sku" k JOIN "StyleColor" sc ON sc."id" = k."styleColorId" JOIN "Style" st ON st."id" = sc."styleId" WHERE k."id" = (SELECT oi."skuId" FROM "OrderItem" oi WHERE oi."id" = NEW."orderItemId"))))
      OR (t."targetType" = 'STYLE' AND t."styleId" = (SELECT st."id" FROM "Sku" k JOIN "StyleColor" sc ON sc."id" = k."styleColorId" JOIN "Style" st ON st."id" = sc."styleId" WHERE k."id" = (SELECT oi."skuId" FROM "OrderItem" oi WHERE oi."id" = NEW."orderItemId")))))
    AND NOT EXISTS (SELECT 1 FROM "CouponPolicyTarget" t WHERE t."policyId" = (SELECT cc."policyId" FROM "CustomerCoupon" cc JOIN "OrderCoupon" oc ON oc."customerCouponId" = cc."id" WHERE oc."id" = NEW."orderCouponId") AND t."mode" = 'EXCLUDE' AND (t."targetType" = 'ALL'
      OR (t."targetType" = 'CATEGORY' AND (SELECT c."path" FROM "Category" c WHERE c."id" = (SELECT st2."categoryId" FROM "Style" st2 WHERE st2."id" = (SELECT st."id" FROM "Sku" k JOIN "StyleColor" sc ON sc."id" = k."styleColorId" JOIN "Style" st ON st."id" = sc."styleId" WHERE k."id" = (SELECT oi."skuId" FROM "OrderItem" oi WHERE oi."id" = NEW."orderItemId")))) LIKE '%/' || t."categoryId" || '/%')
      OR (t."targetType" = 'SEASON' AND t."seasonId" = (SELECT st2."seasonId" FROM "Style" st2 WHERE st2."id" = (SELECT st."id" FROM "Sku" k JOIN "StyleColor" sc ON sc."id" = k."styleColorId" JOIN "Style" st ON st."id" = sc."styleId" WHERE k."id" = (SELECT oi."skuId" FROM "OrderItem" oi WHERE oi."id" = NEW."orderItemId"))))
      OR (t."targetType" = 'GENDER' AND t."gender" = (SELECT st2."gender" FROM "Style" st2 WHERE st2."id" = (SELECT st."id" FROM "Sku" k JOIN "StyleColor" sc ON sc."id" = k."styleColorId" JOIN "Style" st ON st."id" = sc."styleId" WHERE k."id" = (SELECT oi."skuId" FROM "OrderItem" oi WHERE oi."id" = NEW."orderItemId"))))
      OR (t."targetType" = 'STYLE' AND t."styleId" = (SELECT st."id" FROM "Sku" k JOIN "StyleColor" sc ON sc."id" = k."styleColorId" JOIN "Style" st ON st."id" = sc."styleId" WHERE k."id" = (SELECT oi."skuId" FROM "OrderItem" oi WHERE oi."id" = NEW."orderItemId")))))
    AND ((SELECT p."applyToSaleItems" FROM "CouponPolicy" p WHERE p."id" = (SELECT cc."policyId" FROM "CustomerCoupon" cc JOIN "OrderCoupon" oc ON oc."customerCouponId" = cc."id" WHERE oc."id" = NEW."orderCouponId")) = 1 OR (SELECT oi."discountAmount" FROM "OrderItem" oi WHERE oi."id" = NEW."orderItemId") = 0))
    THEN RAISE(ABORT, 'OrderItemCoupon_target: 쿠폰 적용 대상이 아닌 상품입니다')
END;
END;

-- 만든 뒤 수정 금지
DROP TRIGGER IF EXISTS "OrderItemCoupon_no_update";
CREATE TRIGGER "OrderItemCoupon_no_update" BEFORE UPDATE ON "OrderItemCoupon"
BEGIN SELECT RAISE(ABORT, 'OrderItemCoupon_no_update: 쿠폰 배분은 바꿀 수 없습니다'); END;

-- 환불 기준 보관
DROP TRIGGER IF EXISTS "OrderItemCoupon_no_delete";
CREATE TRIGGER "OrderItemCoupon_no_delete" BEFORE DELETE ON "OrderItemCoupon"
BEGIN SELECT RAISE(ABORT, 'OrderItemCoupon_no_delete: 쿠폰 배분은 삭제할 수 없습니다'); END;

-- 결제 시작 전 마지막 검사: 쿠폰 할인 합계 = 주문 금액 구성, 줄 배분 합계 = 줄의 쿠폰 할인, 상품 쿠폰은 줄 1개, 장바구니 쿠폰은 최소 금액·정률 한도
DROP TRIGGER IF EXISTS "Payment_coupon_ready";
CREATE TRIGGER "Payment_coupon_ready" BEFORE INSERT ON "Payment"
WHEN NEW."status" = 'IN_PROGRESS'
BEGIN
SELECT CASE
  WHEN (SELECT o."couponDiscountTotal" FROM "Order" o WHERE o."id" = NEW."orderId")
      IS NOT (SELECT COALESCE(SUM(oc."discountAmount"), 0) FROM "OrderCoupon" oc WHERE oc."orderId" = NEW."orderId" AND oc."kind" <> 'SHIPPING' AND oc."status" IN ('RESERVED', 'APPLIED'))
    OR (SELECT o."shippingDiscount" FROM "Order" o WHERE o."id" = NEW."orderId")
      IS NOT (SELECT COALESCE(SUM(oc."discountAmount"), 0) FROM "OrderCoupon" oc WHERE oc."orderId" = NEW."orderId" AND oc."kind" = 'SHIPPING' AND oc."status" IN ('RESERVED', 'APPLIED'))
    THEN RAISE(ABORT, 'Payment_coupon_ready: 쿠폰 할인 합계가 주문 금액과 다릅니다')
  WHEN EXISTS (SELECT 1 FROM "OrderItem" i WHERE i."orderId" = NEW."orderId"
      AND i."couponAllocated" IS NOT (SELECT COALESCE(SUM(x."amount"), 0) FROM "OrderItemCoupon" x JOIN "OrderCoupon" oc ON oc."id" = x."orderCouponId" WHERE x."orderItemId" = i."id" AND oc."status" IN ('RESERVED', 'APPLIED')))
    THEN RAISE(ABORT, 'Payment_coupon_ready: 상품별 쿠폰 배분 합계가 상품의 쿠폰 할인과 다릅니다')
  WHEN EXISTS (SELECT 1 FROM "OrderCoupon" oc WHERE oc."orderId" = NEW."orderId" AND oc."kind" <> 'SHIPPING' AND oc."status" IN ('RESERVED', 'APPLIED')
      AND (oc."discountAmount" IS NOT (SELECT SUM(x."amount") FROM "OrderItemCoupon" x WHERE x."orderCouponId" = oc."id")
        OR (oc."kind" = 'PRODUCT' AND (SELECT COUNT(*) FROM "OrderItemCoupon" x WHERE x."orderCouponId" = oc."id") <> 1)))
    THEN RAISE(ABORT, 'Payment_coupon_ready: 쿠폰 할인액과 상품 배분이 맞지 않습니다 (상품 쿠폰은 상품 1개)')
  WHEN EXISTS (SELECT 1 FROM "OrderCoupon" oc JOIN "CustomerCoupon" cc ON cc."id" = oc."customerCouponId" JOIN "CouponPolicy" p ON p."id" = cc."policyId"
      WHERE oc."orderId" = NEW."orderId" AND oc."status" IN ('RESERVED', 'APPLIED') AND oc."kind" IN ('PRODUCT', 'ORDER') AND (
        (SELECT SUM(i."lineTotal" - CASE WHEN oc."kind" = 'ORDER' THEN COALESCE((SELECT SUM(y."amount") FROM "OrderItemCoupon" y JOIN "OrderCoupon" pc ON pc."id" = y."orderCouponId" WHERE y."orderItemId" = i."id" AND pc."kind" = 'PRODUCT' AND pc."status" IN ('RESERVED', 'APPLIED')), 0) ELSE 0 END)
           FROM "OrderItem" i WHERE i."id" IN (SELECT x."orderItemId" FROM "OrderItemCoupon" x WHERE x."orderCouponId" = oc."id")) < p."minOrderAmount"
        OR (p."discountType" = 'RATE' AND oc."discountAmount" * 100 >
          (SELECT SUM(i."lineTotal" - CASE WHEN oc."kind" = 'ORDER' THEN COALESCE((SELECT SUM(y."amount") FROM "OrderItemCoupon" y JOIN "OrderCoupon" pc ON pc."id" = y."orderCouponId" WHERE y."orderItemId" = i."id" AND pc."kind" = 'PRODUCT' AND pc."status" IN ('RESERVED', 'APPLIED')), 0) ELSE 0 END)
             FROM "OrderItem" i WHERE i."id" IN (SELECT x."orderItemId" FROM "OrderItemCoupon" x WHERE x."orderCouponId" = oc."id")) * p."discountValue")))
    THEN RAISE(ABORT, 'Payment_coupon_ready: 쿠폰 최소 구매 금액이 모자라거나 정률 할인이 한도를 넘었습니다')
END;
END;

-- <<< db-constraints
