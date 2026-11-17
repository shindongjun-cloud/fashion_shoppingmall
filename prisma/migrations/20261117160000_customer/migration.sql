-- >>> db-constraints: 영향받는 트리거 먼저 제거 (prisma/db-constraints.ts에서 생성, 직접 수정 금지)
DROP TRIGGER IF EXISTS "Customer_status_insert";
DROP TRIGGER IF EXISTS "Customer_status_transition";
DROP TRIGGER IF EXISTS "Customer_status_history_ins";
DROP TRIGGER IF EXISTS "Customer_status_history_upd";
DROP TRIGGER IF EXISTS "Customer_grade_guard";
DROP TRIGGER IF EXISTS "Customer_no_delete";
DROP TRIGGER IF EXISTS "CustomerProfile_withdrawn_ins";
DROP TRIGGER IF EXISTS "CustomerProfile_withdrawn_upd";
DROP TRIGGER IF EXISTS "CustomerProfile_phone_unique_ins";
DROP TRIGGER IF EXISTS "CustomerProfile_phone_unique_upd";
DROP TRIGGER IF EXISTS "CustomerBodyProfile_withdrawn";
DROP TRIGGER IF EXISTS "CustomerAddress_insert_guard";
DROP TRIGGER IF EXISTS "CustomerAddress_default_one_upd";
DROP TRIGGER IF EXISTS "CustomerWithdrawal_open_one";
DROP TRIGGER IF EXISTS "CustomerWithdrawal_immutable";
DROP TRIGGER IF EXISTS "CustomerWithdrawal_no_delete";
DROP TRIGGER IF EXISTS "CustomerStatusHistory_no_update";
DROP TRIGGER IF EXISTS "CustomerStatusHistory_no_delete";
DROP TRIGGER IF EXISTS "CustomerGradeHistory_no_update";
DROP TRIGGER IF EXISTS "CustomerGradeHistory_no_delete";
DROP TRIGGER IF EXISTS "CustomerLoginHistory_no_update";
DROP TRIGGER IF EXISTS "CustomerLoginHistory_retention";
DROP TRIGGER IF EXISTS "Order_customer_active";
-- <<< db-constraints-top

-- 고객 도메인 (B안: 로그인 계정 User와 쇼핑몰 고객 Customer 분리)
-- Customer / Profile / BodyProfile / Address / StatusHistory / Withdrawal / Grade / GradeHistory / LoginHistory
-- Order.userId → Order.customerId (탈퇴해도 주문 기록이 남도록 로그인 계정이 아니라 고객을 가리킴)

-- CreateTable
CREATE TABLE "Customer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerNo" TEXT NOT NULL,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "gradeId" INTEGER NOT NULL,
    "joinChannel" TEXT NOT NULL DEFAULT 'WEB',
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" DATETIME,
    "lastOrderAt" DATETIME,
    "statusReason" TEXT NOT NULL,
    "statusMemo" TEXT,
    "statusChangedBy" TEXT,
    "statusChangedAt" DATETIME NOT NULL,
    "dormantAt" DATETIME,
    "suspendedAt" DATETIME,
    "suspendedReason" TEXT,
    "withdrawnAt" DATETIME,
    "anonymizedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Customer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Customer_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "CustomerGrade" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Customer_status_enum_ck" CHECK ("status" IN ('ACTIVE', 'DORMANT', 'SUSPENDED', 'WITHDRAW_PENDING', 'WITHDRAWN')),
    CONSTRAINT "Customer_joinChannel_enum_ck" CHECK ("joinChannel" IN ('WEB', 'APP', 'STORE', 'IMPORT')),
    CONSTRAINT "Customer_statusReason_enum_ck" CHECK ("statusReason" IN ('SIGNUP', 'LOGIN', 'INACTIVITY', 'ABUSE', 'APPEAL', 'WITHDRAW_REQUEST', 'WITHDRAW_CANCEL', 'WITHDRAW_COMPLETE', 'ADMIN')),
    CONSTRAINT "Customer_no_ck" CHECK ("customerNo" GLOB 'C[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
    CONSTRAINT "Customer_withdrawn_ck" CHECK (("status" = 'WITHDRAWN' AND "userId" IS NULL AND "withdrawnAt" IS NOT NULL AND "anonymizedAt" IS NOT NULL) OR ("status" <> 'WITHDRAWN' AND "withdrawnAt" IS NULL AND "anonymizedAt" IS NULL)),
    CONSTRAINT "Customer_suspended_ck" CHECK (("status" = 'SUSPENDED') = ("suspendedAt" IS NOT NULL AND "suspendedReason" IS NOT NULL)),
    CONSTRAINT "Customer_dormant_ck" CHECK (("status" = 'DORMANT') = ("dormantAt" IS NOT NULL)),
    CONSTRAINT "Customer_dates_ck" CHECK (("joinedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("statusChangedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("lastLoginAt" IS NULL OR "lastLoginAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("lastOrderAt" IS NULL OR "lastOrderAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("dormantAt" IS NULL OR "dormantAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("suspendedAt" IS NULL OR "suspendedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("withdrawnAt" IS NULL OR "withdrawnAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("anonymizedAt" IS NULL OR "anonymizedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- CreateTable
CREATE TABLE "CustomerProfile" (
    "customerId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nameEnc" TEXT,
    "phoneEnc" TEXT,
    "phoneHash" TEXT,
    "birthDateEnc" TEXT,
    "birthMonth" INTEGER,
    "gender" TEXT NOT NULL DEFAULT 'UNDISCLOSED',
    "contactEmailEnc" TEXT,
    "emailHash" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomerProfile_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CustomerProfile_gender_enum_ck" CHECK ("gender" IN ('FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED')),
    CONSTRAINT "CustomerProfile_enc_ck" CHECK (("nameEnc" IS NULL OR "nameEnc" GLOB 'v[0-9]*:?*:?*:?*') AND ("phoneEnc" IS NULL OR "phoneEnc" GLOB 'v[0-9]*:?*:?*:?*') AND ("birthDateEnc" IS NULL OR "birthDateEnc" GLOB 'v[0-9]*:?*:?*:?*') AND ("contactEmailEnc" IS NULL OR "contactEmailEnc" GLOB 'v[0-9]*:?*:?*:?*')),
    CONSTRAINT "CustomerProfile_hash_ck" CHECK (("phoneHash" IS NULL OR (length("phoneHash") = 64 AND "phoneHash" NOT GLOB '*[^0-9a-f]*')) AND ("emailHash" IS NULL OR (length("emailHash") = 64 AND "emailHash" NOT GLOB '*[^0-9a-f]*'))),
    CONSTRAINT "CustomerProfile_pairs_ck" CHECK (("phoneEnc" IS NULL) = ("phoneHash" IS NULL) AND ("contactEmailEnc" IS NULL) = ("emailHash" IS NULL) AND ("birthDateEnc" IS NULL) = ("birthMonth" IS NULL)),
    CONSTRAINT "CustomerProfile_birth_month_ck" CHECK ("birthMonth" IS NULL OR (typeof("birthMonth") = 'integer' AND "birthMonth" BETWEEN 1 AND 12))
);

-- CreateTable
CREATE TABLE "CustomerBodyProfile" (
    "customerId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "heightCm" INTEGER,
    "weightKg" INTEGER,
    "topSize" TEXT,
    "bottomSize" TEXT,
    "shoeSizeMm" INTEGER,
    "preferredFit" TEXT,
    "showInReviews" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomerBodyProfile_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CustomerBodyProfile_preferredFit_enum_ck" CHECK ("preferredFit" IN ('SLIM', 'REGULAR', 'RELAXED', 'OVERSIZED')),
    CONSTRAINT "CustomerBodyProfile_showInReviews_bool_ck" CHECK ("showInReviews" IN (0, 1)),
    CONSTRAINT "CustomerBodyProfile_range_ck" CHECK (("heightCm" IS NULL OR (typeof("heightCm") = 'integer' AND "heightCm" BETWEEN 100 AND 230)) AND ("weightKg" IS NULL OR (typeof("weightKg") = 'integer' AND "weightKg" BETWEEN 25 AND 200)) AND ("shoeSizeMm" IS NULL OR (typeof("shoeSizeMm") = 'integer' AND "shoeSizeMm" BETWEEN 200 AND 330))),
    CONSTRAINT "CustomerBodyProfile_size_ck" CHECK (("topSize" IS NULL OR trim("topSize") <> '') AND ("bottomSize" IS NULL OR trim("bottomSize") <> ''))
);

-- CreateTable
CREATE TABLE "CustomerAddress" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "recipientEnc" TEXT NOT NULL,
    "phoneEnc" TEXT NOT NULL,
    "zipCode" TEXT NOT NULL,
    "address1Enc" TEXT NOT NULL,
    "address2Enc" TEXT,
    "deliveryMemo" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CustomerAddress_isDefault_bool_ck" CHECK ("isDefault" IN (0, 1)),
    CONSTRAINT "CustomerAddress_label_ck" CHECK (trim("label") <> '' AND length("label") <= 20),
    CONSTRAINT "CustomerAddress_zip_ck" CHECK (length("zipCode") = 5 AND "zipCode" NOT GLOB '*[^0-9]*'),
    CONSTRAINT "CustomerAddress_enc_ck" CHECK (("recipientEnc" IS NULL OR "recipientEnc" GLOB 'v[0-9]*:?*:?*:?*') AND ("phoneEnc" IS NULL OR "phoneEnc" GLOB 'v[0-9]*:?*:?*:?*') AND ("address1Enc" IS NULL OR "address1Enc" GLOB 'v[0-9]*:?*:?*:?*') AND ("address2Enc" IS NULL OR "address2Enc" GLOB 'v[0-9]*:?*:?*:?*')),
    CONSTRAINT "CustomerAddress_memo_ck" CHECK ("deliveryMemo" IS NULL OR length("deliveryMemo") <= 100)
);

-- CreateTable
CREATE TABLE "CustomerStatusHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "memo" TEXT,
    "changedBy" TEXT,
    "changedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomerStatusHistory_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CustomerStatusHistory_fromStatus_enum_ck" CHECK ("fromStatus" IN ('ACTIVE', 'DORMANT', 'SUSPENDED', 'WITHDRAW_PENDING', 'WITHDRAWN')),
    CONSTRAINT "CustomerStatusHistory_toStatus_enum_ck" CHECK ("toStatus" IN ('ACTIVE', 'DORMANT', 'SUSPENDED', 'WITHDRAW_PENDING', 'WITHDRAWN')),
    CONSTRAINT "CustomerStatusHistory_reason_enum_ck" CHECK ("reason" IN ('SIGNUP', 'LOGIN', 'INACTIVITY', 'ABUSE', 'APPEAL', 'WITHDRAW_REQUEST', 'WITHDRAW_CANCEL', 'WITHDRAW_COMPLETE', 'ADMIN')),
    CONSTRAINT "CustomerStatusHistory_change_ck" CHECK ("fromStatus" IS NULL OR "fromStatus" <> "toStatus"),
    CONSTRAINT "CustomerStatusHistory_dates_ck" CHECK ("changedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*')
);

-- CreateTable
CREATE TABLE "CustomerWithdrawal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "reasonText" TEXT,
    "requestedAt" DATETIME NOT NULL,
    "scheduledAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "canceledAt" DATETIME,
    "rejoinBlockHash" TEXT,
    "rejoinBlockUntil" DATETIME,
    CONSTRAINT "CustomerWithdrawal_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CustomerWithdrawal_reasonCode_enum_ck" CHECK ("reasonCode" IN ('LOW_USAGE', 'PRIVACY', 'PRODUCT', 'DELIVERY', 'SERVICE', 'REJOIN', 'OTHER')),
    CONSTRAINT "CustomerWithdrawal_outcome_ck" CHECK ("completedAt" IS NULL OR "canceledAt" IS NULL),
    CONSTRAINT "CustomerWithdrawal_grace_ck" CHECK (julianday("scheduledAt") - julianday("requestedAt") >= 7),
    CONSTRAINT "CustomerWithdrawal_order_ck" CHECK (("completedAt" IS NULL OR "completedAt" >= "scheduledAt") AND ("canceledAt" IS NULL OR "canceledAt" >= "requestedAt")),
    CONSTRAINT "CustomerWithdrawal_rejoin_ck" CHECK (("rejoinBlockHash" IS NULL) = ("rejoinBlockUntil" IS NULL) AND ("rejoinBlockHash" IS NULL OR "completedAt" IS NOT NULL) AND ("rejoinBlockHash" IS NULL OR (length("rejoinBlockHash") = 64 AND "rejoinBlockHash" NOT GLOB '*[^0-9a-f]*'))),
    CONSTRAINT "CustomerWithdrawal_text_ck" CHECK ("reasonText" IS NULL OR length("reasonText") <= 500),
    CONSTRAINT "CustomerWithdrawal_dates_ck" CHECK (("requestedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("scheduledAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("completedAt" IS NULL OR "completedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("canceledAt" IS NULL OR "canceledAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("rejoinBlockUntil" IS NULL OR "rejoinBlockUntil" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- CreateTable
CREATE TABLE "CustomerGrade" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minAmount" INTEGER NOT NULL,
    "pointRateBp" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomerGrade_isActive_bool_ck" CHECK ("isActive" IN (0, 1)),
    CONSTRAINT "CustomerGrade_code_ck" CHECK ("code" <> '' AND "code" NOT GLOB '*[^A-Z0-9_]*'),
    CONSTRAINT "CustomerGrade_name_ck" CHECK (trim("name") <> ''),
    CONSTRAINT "CustomerGrade_values_ck" CHECK (typeof("minAmount") = 'integer' AND "minAmount" >= 0 AND typeof("pointRateBp") = 'integer' AND "pointRateBp" BETWEEN 0 AND 10000 AND typeof("sortOrder") = 'integer' AND "sortOrder" >= 0)
);

-- CreateTable
CREATE TABLE "CustomerGradeHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER NOT NULL,
    "fromGradeId" INTEGER,
    "toGradeId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "purchaseAmount" INTEGER,
    "periodFrom" DATETIME,
    "periodTo" DATETIME,
    "changedBy" TEXT,
    "changedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomerGradeHistory_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CustomerGradeHistory_fromGradeId_fkey" FOREIGN KEY ("fromGradeId") REFERENCES "CustomerGrade" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CustomerGradeHistory_toGradeId_fkey" FOREIGN KEY ("toGradeId") REFERENCES "CustomerGrade" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CustomerGradeHistory_reason_enum_ck" CHECK ("reason" IN ('SIGNUP', 'PERIODIC', 'ADMIN')),
    CONSTRAINT "CustomerGradeHistory_change_ck" CHECK ("fromGradeId" IS NULL OR "fromGradeId" <> "toGradeId"),
    CONSTRAINT "CustomerGradeHistory_values_ck" CHECK (("purchaseAmount" IS NULL OR (typeof("purchaseAmount") = 'integer' AND "purchaseAmount" >= 0)) AND ("periodFrom" IS NULL OR "periodTo" IS NULL OR "periodTo" > "periodFrom")),
    CONSTRAINT "CustomerGradeHistory_dates_ck" CHECK (("changedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("periodFrom" IS NULL OR "periodFrom" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("periodTo" IS NULL OR "periodTo" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- CreateTable
CREATE TABLE "CustomerLoginHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "ipMasked" TEXT,
    "userAgent" TEXT,
    "loggedInAt" DATETIME NOT NULL,
    CONSTRAINT "CustomerLoginHistory_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CustomerLoginHistory_result_enum_ck" CHECK ("result" IN ('SUCCESS', 'BLOCKED_SUSPENDED')),
    CONSTRAINT "CustomerLoginHistory_values_ck" CHECK (trim("provider") <> '' AND ("userAgent" IS NULL OR length("userAgent") <= 500) AND ("ipMasked" IS NULL OR "ipMasked" GLOB '*[*]*')),
    CONSTRAINT "CustomerLoginHistory_dates_ck" CHECK ("loggedInAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*')
);

-- ================================================================
-- 데이터 이전 (아래 RedefineTables에서 Order.userId가 사라지기 전에 실행)
-- ① 등급 마스터  ② 기존 User마다 Customer + 빈 프로필 + 상태·등급 이력  ③ Order.userId → customerId
-- 이 시점에는 고객 트리거가 아직 없으므로(파일 끝에서 생성) 이력도 직접 넣습니다.
-- 날짜는 Prisma 형식으로 (CURRENT_TIMESTAMP 금지)
-- ================================================================
INSERT INTO "CustomerGrade" ("code", "name", "minAmount", "pointRateBp", "sortOrder", "description", "isActive", "createdAt", "updatedAt") VALUES
  ('WELCOME', '웰컴', 0, 100, 0, '가입 기본 등급', 1, strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'), strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  ('SILVER', '실버', 300000, 200, 1, '최근 12개월 30만원 이상', 1, strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'), strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  ('GOLD', '골드', 1000000, 300, 2, '최근 12개월 100만원 이상', 1, strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'), strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  ('VIP', 'VIP', 3000000, 500, 3, '최근 12개월 300만원 이상', 1, strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'), strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'));

-- 고객번호: C + 무작위 숫자 10자리 (겹치면 UNIQUE에 걸려 마이그레이션이 멈춤 → 다시 실행)
INSERT INTO "Customer" ("customerNo", "userId", "status", "gradeId", "joinChannel", "joinedAt", "statusReason", "statusChangedBy", "statusChangedAt", "createdAt", "updatedAt")
SELECT 'C' || substr('0000000000' || (abs(random()) % 10000000000), -10), u."id", 'ACTIVE',
       (SELECT "id" FROM "CustomerGrade" WHERE "code" = 'WELCOME'), 'IMPORT', u."createdAt", 'SIGNUP', 'MIGRATION', strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'), strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'), strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')
FROM "User" u;

INSERT INTO "CustomerProfile" ("customerId", "gender", "updatedAt")
SELECT c."id", 'UNDISCLOSED', strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now') FROM "Customer" c;

INSERT INTO "CustomerStatusHistory" ("customerId", "fromStatus", "toStatus", "reason", "memo", "changedBy", "changedAt")
SELECT c."id", NULL, 'ACTIVE', 'SIGNUP', '고객 도메인 도입 시 기존 회원 이전', 'MIGRATION', strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now') FROM "Customer" c;

INSERT INTO "CustomerGradeHistory" ("customerId", "fromGradeId", "toGradeId", "reason", "changedBy", "changedAt")
SELECT c."id", NULL, c."gradeId", 'SIGNUP', 'MIGRATION', strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now') FROM "Customer" c;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Order" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "paymentOrderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "totalPrice" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paymentKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerId" INTEGER NOT NULL,
    CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- ③ 주문의 userId를 그 User의 Customer id로 바꿔 옮깁니다.
INSERT INTO "new_Order" ("createdAt", "id", "orderName", "paymentKey", "paymentOrderId", "status", "totalPrice", "customerId")
SELECT o."createdAt", o."id", o."orderName", o."paymentKey", o."paymentOrderId", o."status", o."totalPrice",
       (SELECT c."id" FROM "Customer" c WHERE c."userId" = o."userId")
FROM "Order" o;
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_paymentOrderId_key" ON "Order"("paymentOrderId");
CREATE INDEX "Order_customerId_createdAt_idx" ON "Order"("customerId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Customer_customerNo_key" ON "Customer"("customerNo");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_userId_key" ON "Customer"("userId");

-- CreateIndex
CREATE INDEX "Customer_status_idx" ON "Customer"("status");

-- CreateIndex
CREATE INDEX "Customer_gradeId_idx" ON "Customer"("gradeId");

-- CreateIndex
CREATE INDEX "Customer_lastLoginAt_idx" ON "Customer"("lastLoginAt");

-- CreateIndex
CREATE INDEX "CustomerProfile_phoneHash_idx" ON "CustomerProfile"("phoneHash");

-- CreateIndex
CREATE INDEX "CustomerProfile_emailHash_idx" ON "CustomerProfile"("emailHash");

-- CreateIndex
CREATE INDEX "CustomerAddress_customerId_idx" ON "CustomerAddress"("customerId");

-- CreateIndex
CREATE INDEX "CustomerStatusHistory_customerId_id_idx" ON "CustomerStatusHistory"("customerId", "id");

-- CreateIndex
CREATE INDEX "CustomerWithdrawal_customerId_idx" ON "CustomerWithdrawal"("customerId");

-- CreateIndex
CREATE INDEX "CustomerWithdrawal_rejoinBlockHash_idx" ON "CustomerWithdrawal"("rejoinBlockHash");

-- CreateIndex
CREATE INDEX "CustomerWithdrawal_scheduledAt_idx" ON "CustomerWithdrawal"("scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerGrade_code_key" ON "CustomerGrade"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerGrade_minAmount_key" ON "CustomerGrade"("minAmount");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerGrade_sortOrder_key" ON "CustomerGrade"("sortOrder");

-- CreateIndex
CREATE INDEX "CustomerGradeHistory_customerId_id_idx" ON "CustomerGradeHistory"("customerId", "id");

-- CreateIndex
CREATE INDEX "CustomerLoginHistory_customerId_loggedInAt_idx" ON "CustomerLoginHistory"("customerId", "loggedInAt");

-- CreateIndex
CREATE INDEX "CustomerLoginHistory_loggedInAt_idx" ON "CustomerLoginHistory"("loggedInAt");

-- >>> db-constraints: 트리거 (prisma/db-constraints.ts에서 생성, 직접 수정 금지)

-- 가입은 ACTIVE 상태로만
DROP TRIGGER IF EXISTS "Customer_status_insert";
CREATE TRIGGER "Customer_status_insert" BEFORE INSERT ON "Customer"
WHEN NEW."status" <> 'ACTIVE'
BEGIN SELECT RAISE(ABORT, 'Customer_status_insert: 고객은 ACTIVE 상태로만 만들 수 있습니다'); END;

-- 허용된 상태 변경만 (탈퇴 완료는 되돌릴 수 없음, 탈퇴는 반드시 유예를 거침), 사유·시각 함께 기록, 탈퇴 완료 전 개인정보 파기 확인
DROP TRIGGER IF EXISTS "Customer_status_transition";
CREATE TRIGGER "Customer_status_transition" BEFORE UPDATE OF "status" ON "Customer"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
SELECT CASE
  WHEN OLD."status" = 'WITHDRAWN'
    THEN RAISE(ABORT, 'Customer_status_transition: 탈퇴 완료된 고객은 상태를 바꿀 수 없습니다')
  WHEN (OLD."status" || '>' || NEW."status") NOT IN ('ACTIVE>DORMANT', 'ACTIVE>SUSPENDED', 'ACTIVE>WITHDRAW_PENDING', 'DORMANT>ACTIVE', 'DORMANT>SUSPENDED', 'DORMANT>WITHDRAW_PENDING', 'SUSPENDED>ACTIVE', 'SUSPENDED>WITHDRAW_PENDING', 'WITHDRAW_PENDING>ACTIVE', 'WITHDRAW_PENDING>WITHDRAWN')
    THEN RAISE(ABORT, 'Customer_status_transition: 허용되지 않은 상태 변경입니다')
  WHEN NEW."statusChangedAt" IS OLD."statusChangedAt"
    THEN RAISE(ABORT, 'Customer_status_transition: 상태를 바꿀 때 statusReason·statusChangedAt도 함께 바꿔야 합니다')
  WHEN NEW."status" = 'WITHDRAWN' AND NOT EXISTS (SELECT 1 FROM "CustomerWithdrawal" w WHERE w."customerId" = NEW."id" AND w."completedAt" IS NOT NULL)
    THEN RAISE(ABORT, 'Customer_status_transition: 완료된 탈퇴 신청 없이 탈퇴 상태로 바꿀 수 없습니다')
  WHEN NEW."status" = 'WITHDRAWN' AND (
      EXISTS (SELECT 1 FROM "CustomerProfile" p WHERE p."customerId" = NEW."id" AND (p."nameEnc" IS NOT NULL OR p."phoneEnc" IS NOT NULL OR p."phoneHash" IS NOT NULL OR p."birthDateEnc" IS NOT NULL OR p."birthMonth" IS NOT NULL OR p."contactEmailEnc" IS NOT NULL OR p."emailHash" IS NOT NULL))
      OR EXISTS (SELECT 1 FROM "CustomerAddress" a WHERE a."customerId" = NEW."id")
      OR EXISTS (SELECT 1 FROM "CustomerBodyProfile" b WHERE b."customerId" = NEW."id"))
    THEN RAISE(ABORT, 'Customer_status_transition: 개인정보(프로필·배송지·체형)를 먼저 파기해야 탈퇴 완료할 수 있습니다')
END;
END;

-- 가입하면 상태 이력 첫 줄 자동 기록
DROP TRIGGER IF EXISTS "Customer_status_history_ins";
CREATE TRIGGER "Customer_status_history_ins" AFTER INSERT ON "Customer"
BEGIN
  INSERT INTO "CustomerStatusHistory" ("customerId", "fromStatus", "toStatus", "reason", "memo", "changedBy", "changedAt")
  VALUES (NEW."id", NULL, NEW."status", NEW."statusReason", NEW."statusMemo", NEW."statusChangedBy", NEW."statusChangedAt");
END;

-- 상태가 바뀌면 이력 자동 기록 (앱이 깜빡해도 빠지지 않음)
DROP TRIGGER IF EXISTS "Customer_status_history_upd";
CREATE TRIGGER "Customer_status_history_upd" AFTER UPDATE OF "status" ON "Customer"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
  INSERT INTO "CustomerStatusHistory" ("customerId", "fromStatus", "toStatus", "reason", "memo", "changedBy", "changedAt")
  VALUES (NEW."id", OLD."status", NEW."status", NEW."statusReason", NEW."statusMemo", NEW."statusChangedBy", NEW."statusChangedAt");
END;

-- 등급은 등급 이력을 먼저 남긴 뒤에만 바꿀 수 있음 (가장 최근 이력의 등급 = 새 등급)
DROP TRIGGER IF EXISTS "Customer_grade_guard";
CREATE TRIGGER "Customer_grade_guard" BEFORE UPDATE OF "gradeId" ON "Customer"
WHEN NEW."gradeId" IS NOT OLD."gradeId"
  AND (SELECT h."toGradeId" FROM "CustomerGradeHistory" h WHERE h."customerId" = NEW."id" ORDER BY h."id" DESC LIMIT 1) IS NOT NEW."gradeId"
BEGIN SELECT RAISE(ABORT, 'Customer_grade_guard: 등급 이력(CustomerGradeHistory)을 먼저 추가해야 등급을 바꿀 수 있습니다'); END;

-- 고객 행은 삭제 금지 (탈퇴는 익명화, 주문 5년 보관)
DROP TRIGGER IF EXISTS "Customer_no_delete";
CREATE TRIGGER "Customer_no_delete" BEFORE DELETE ON "Customer"
BEGIN SELECT RAISE(ABORT, 'Customer_no_delete: 고객은 삭제하지 않고 탈퇴(익명화) 처리합니다'); END;

-- 탈퇴 고객의 개인정보 다시 저장 금지
DROP TRIGGER IF EXISTS "CustomerProfile_withdrawn_ins";
CREATE TRIGGER "CustomerProfile_withdrawn_ins" BEFORE INSERT ON "CustomerProfile"
WHEN (SELECT c."status" FROM "Customer" c WHERE c."id" = NEW."customerId") = 'WITHDRAWN' AND (NEW."nameEnc" IS NOT NULL OR NEW."phoneEnc" IS NOT NULL OR NEW."phoneHash" IS NOT NULL OR NEW."birthDateEnc" IS NOT NULL OR NEW."birthMonth" IS NOT NULL OR NEW."contactEmailEnc" IS NOT NULL OR NEW."emailHash" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'CustomerProfile_withdrawn: 탈퇴한 고객의 개인정보는 저장할 수 없습니다'); END;

-- 위와 같음 (수정 시)
DROP TRIGGER IF EXISTS "CustomerProfile_withdrawn_upd";
CREATE TRIGGER "CustomerProfile_withdrawn_upd" BEFORE UPDATE ON "CustomerProfile"
WHEN (SELECT c."status" FROM "Customer" c WHERE c."id" = NEW."customerId") = 'WITHDRAWN' AND (NEW."nameEnc" IS NOT NULL OR NEW."phoneEnc" IS NOT NULL OR NEW."phoneHash" IS NOT NULL OR NEW."birthDateEnc" IS NOT NULL OR NEW."birthMonth" IS NOT NULL OR NEW."contactEmailEnc" IS NOT NULL OR NEW."emailHash" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'CustomerProfile_withdrawn: 탈퇴한 고객의 개인정보는 저장할 수 없습니다'); END;

-- 같은 휴대폰 번호로 중복 가입 금지 (검색용 해시로 비교, 본인 제외)
DROP TRIGGER IF EXISTS "CustomerProfile_phone_unique_ins";
CREATE TRIGGER "CustomerProfile_phone_unique_ins" BEFORE INSERT ON "CustomerProfile"
WHEN NEW."phoneHash" IS NOT NULL AND EXISTS (SELECT 1 FROM "CustomerProfile" p WHERE p."phoneHash" = NEW."phoneHash" AND p."customerId" <> NEW."customerId")
BEGIN SELECT RAISE(ABORT, 'CustomerProfile_phone_unique: 이미 다른 회원이 사용 중인 휴대폰 번호입니다'); END;

-- 위와 같음 (수정 시)
DROP TRIGGER IF EXISTS "CustomerProfile_phone_unique_upd";
CREATE TRIGGER "CustomerProfile_phone_unique_upd" BEFORE UPDATE OF "phoneHash" ON "CustomerProfile"
WHEN NEW."phoneHash" IS NOT NULL AND EXISTS (SELECT 1 FROM "CustomerProfile" p WHERE p."phoneHash" = NEW."phoneHash" AND p."customerId" <> NEW."customerId")
BEGIN SELECT RAISE(ABORT, 'CustomerProfile_phone_unique: 이미 다른 회원이 사용 중인 휴대폰 번호입니다'); END;

-- 탈퇴 고객의 체형 정보 저장 금지
DROP TRIGGER IF EXISTS "CustomerBodyProfile_withdrawn";
CREATE TRIGGER "CustomerBodyProfile_withdrawn" BEFORE INSERT ON "CustomerBodyProfile"
WHEN (SELECT c."status" FROM "Customer" c WHERE c."id" = NEW."customerId") = 'WITHDRAWN'
BEGIN SELECT RAISE(ABORT, 'CustomerBodyProfile_withdrawn: 탈퇴한 고객의 체형 정보는 저장할 수 없습니다'); END;

-- 탈퇴 고객 금지, 배송지 최대 20개, 기본 배송지는 1개
DROP TRIGGER IF EXISTS "CustomerAddress_insert_guard";
CREATE TRIGGER "CustomerAddress_insert_guard" BEFORE INSERT ON "CustomerAddress"
BEGIN
SELECT CASE
  WHEN (SELECT c."status" FROM "Customer" c WHERE c."id" = NEW."customerId") = 'WITHDRAWN'
    THEN RAISE(ABORT, 'CustomerAddress_guard: 탈퇴한 고객의 배송지는 저장할 수 없습니다')
  WHEN (SELECT count(*) FROM "CustomerAddress" a WHERE a."customerId" = NEW."customerId") >= 20
    THEN RAISE(ABORT, 'CustomerAddress_guard: 배송지는 최대 20개까지 저장할 수 있습니다')
  WHEN NEW."isDefault" = 1 AND EXISTS (SELECT 1 FROM "CustomerAddress" a WHERE a."customerId" = NEW."customerId" AND a."isDefault" = 1)
    THEN RAISE(ABORT, 'CustomerAddress_default_one: 기본 배송지는 1개만 지정할 수 있습니다')
END;
END;

-- 기본 배송지는 고객당 1개 (새 기본을 지정하려면 기존 기본을 먼저 해제)
DROP TRIGGER IF EXISTS "CustomerAddress_default_one_upd";
CREATE TRIGGER "CustomerAddress_default_one_upd" BEFORE UPDATE OF "isDefault", "customerId" ON "CustomerAddress"
WHEN NEW."isDefault" = 1 AND EXISTS (SELECT 1 FROM "CustomerAddress" a WHERE a."customerId" = NEW."customerId" AND a."isDefault" = 1 AND a."id" <> NEW."id")
BEGIN SELECT RAISE(ABORT, 'CustomerAddress_default_one: 기본 배송지는 1개만 지정할 수 있습니다'); END;

-- 진행 중인 탈퇴 신청은 고객당 1개
DROP TRIGGER IF EXISTS "CustomerWithdrawal_open_one";
CREATE TRIGGER "CustomerWithdrawal_open_one" BEFORE INSERT ON "CustomerWithdrawal"
WHEN EXISTS (SELECT 1 FROM "CustomerWithdrawal" w WHERE w."customerId" = NEW."customerId" AND w."completedAt" IS NULL AND w."canceledAt" IS NULL)
BEGIN SELECT RAISE(ABORT, 'CustomerWithdrawal_open_one: 이미 진행 중인 탈퇴 신청이 있습니다'); END;

-- 신청 내용은 바꿀 수 없고, 완료·철회된 신청은 더 이상 바꿀 수 없음
DROP TRIGGER IF EXISTS "CustomerWithdrawal_immutable";
CREATE TRIGGER "CustomerWithdrawal_immutable" BEFORE UPDATE ON "CustomerWithdrawal"
WHEN OLD."completedAt" IS NOT NULL OR OLD."canceledAt" IS NOT NULL
  OR NEW."customerId" IS NOT OLD."customerId" OR NEW."requestedAt" IS NOT OLD."requestedAt"
  OR NEW."scheduledAt" IS NOT OLD."scheduledAt" OR NEW."reasonCode" IS NOT OLD."reasonCode"
BEGIN SELECT RAISE(ABORT, 'CustomerWithdrawal_immutable: 탈퇴 신청 내용·처리 결과는 바꿀 수 없습니다'); END;

-- 탈퇴 신청 기록 삭제 금지
DROP TRIGGER IF EXISTS "CustomerWithdrawal_no_delete";
CREATE TRIGGER "CustomerWithdrawal_no_delete" BEFORE DELETE ON "CustomerWithdrawal"
BEGIN SELECT RAISE(ABORT, 'CustomerWithdrawal_no_delete: 탈퇴 신청 기록은 지울 수 없습니다'); END;

-- 이력은 수정 금지
DROP TRIGGER IF EXISTS "CustomerStatusHistory_no_update";
CREATE TRIGGER "CustomerStatusHistory_no_update" BEFORE UPDATE ON "CustomerStatusHistory"
BEGIN SELECT RAISE(ABORT, 'CustomerStatusHistory_append_only: 이력은 수정할 수 없습니다'); END;

-- 이력은 삭제 금지
DROP TRIGGER IF EXISTS "CustomerStatusHistory_no_delete";
CREATE TRIGGER "CustomerStatusHistory_no_delete" BEFORE DELETE ON "CustomerStatusHistory"
BEGIN SELECT RAISE(ABORT, 'CustomerStatusHistory_append_only: 이력은 삭제할 수 없습니다'); END;

-- 이력은 수정 금지
DROP TRIGGER IF EXISTS "CustomerGradeHistory_no_update";
CREATE TRIGGER "CustomerGradeHistory_no_update" BEFORE UPDATE ON "CustomerGradeHistory"
BEGIN SELECT RAISE(ABORT, 'CustomerGradeHistory_append_only: 이력은 수정할 수 없습니다'); END;

-- 이력은 삭제 금지
DROP TRIGGER IF EXISTS "CustomerGradeHistory_no_delete";
CREATE TRIGGER "CustomerGradeHistory_no_delete" BEFORE DELETE ON "CustomerGradeHistory"
BEGIN SELECT RAISE(ABORT, 'CustomerGradeHistory_append_only: 이력은 삭제할 수 없습니다'); END;

-- 로그인 기록은 수정 금지
DROP TRIGGER IF EXISTS "CustomerLoginHistory_no_update";
CREATE TRIGGER "CustomerLoginHistory_no_update" BEFORE UPDATE ON "CustomerLoginHistory"
BEGIN SELECT RAISE(ABORT, 'CustomerLoginHistory_append_only: 로그인 기록은 수정할 수 없습니다'); END;

-- 로그인 기록은 3개월(90일)이 지난 것만 삭제 가능 (통신비밀보호법 접속기록 보관)
DROP TRIGGER IF EXISTS "CustomerLoginHistory_retention";
CREATE TRIGGER "CustomerLoginHistory_retention" BEFORE DELETE ON "CustomerLoginHistory"
WHEN julianday(strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')) - julianday(OLD."loggedInAt") < 90
BEGIN SELECT RAISE(ABORT, 'CustomerLoginHistory_retention: 3개월이 지나지 않은 로그인 기록은 지울 수 없습니다'); END;

-- 탈퇴·탈퇴 신청·정지·휴면 고객은 새 주문 금지
DROP TRIGGER IF EXISTS "Order_customer_active";
CREATE TRIGGER "Order_customer_active" BEFORE INSERT ON "Order"
WHEN (SELECT c."status" FROM "Customer" c WHERE c."id" = NEW."customerId") IS NOT 'ACTIVE'
BEGIN SELECT RAISE(ABORT, 'Order_customer_active: 정상(ACTIVE) 상태의 고객만 주문할 수 있습니다'); END;

-- <<< db-constraints
