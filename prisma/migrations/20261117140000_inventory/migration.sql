-- >>> db-constraints: 영향받는 트리거 먼저 제거 (prisma/db-constraints.ts에서 생성, 직접 수정 금지)
DROP TRIGGER IF EXISTS "InventoryBalance_insert_zero";
DROP TRIGGER IF EXISTS "InventoryBalance_onhand_guard";
DROP TRIGGER IF EXISTS "InventoryBalance_reserved_guard";
DROP TRIGGER IF EXISTS "InventoryBalance_key_fixed";
DROP TRIGGER IF EXISTS "InventoryBalance_no_delete";
DROP TRIGGER IF EXISTS "InventoryLedger_no_update";
DROP TRIGGER IF EXISTS "InventoryLedger_no_delete";
DROP TRIGGER IF EXISTS "InventoryLedger_check_balance";
DROP TRIGGER IF EXISTS "InventoryLedger_apply";
DROP TRIGGER IF EXISTS "InventoryReservation_reserve";
DROP TRIGGER IF EXISTS "InventoryReservation_sync_ins";
DROP TRIGGER IF EXISTS "InventoryReservation_transition";
DROP TRIGGER IF EXISTS "InventoryReservation_immutable";
DROP TRIGGER IF EXISTS "InventoryReservation_sync_upd";
DROP TRIGGER IF EXISTS "InventoryReservation_no_delete";
DROP TRIGGER IF EXISTS "InventoryLocation_deactivate_guard";
DROP TRIGGER IF EXISTS "Style_sale_ready_upd";
DROP TRIGGER IF EXISTS "Sku_code_match_ins";
DROP TRIGGER IF EXISTS "Sku_code_match_upd";
DROP TRIGGER IF EXISTS "Size_code_fixed";
DROP TRIGGER IF EXISTS "Sku_size_group_ins";
DROP TRIGGER IF EXISTS "Sku_size_group_upd";
DROP TRIGGER IF EXISTS "Style_size_group_change";
-- <<< db-constraints-top

-- 재고 도메인 (B안: 주문 시 예약 → 결제 시 확정 → 시간 초과 시 해제)
-- InventoryLocation / InventoryBalance / InventoryLedger / InventoryReservation, Sku.stock 제거

-- CreateTable
CREATE TABLE "InventoryLocation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isOnlineSellable" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "address" TEXT,
    "contactPhone" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InventoryLocation_type_enum_ck" CHECK ("type" IN ('WAREHOUSE', 'STORE', 'RETURN_CENTER', 'DEFECT')),
    CONSTRAINT "InventoryLocation_isOnlineSellable_bool_ck" CHECK ("isOnlineSellable" IN (0, 1)),
    CONSTRAINT "InventoryLocation_isActive_bool_ck" CHECK ("isActive" IN (0, 1)),
    CONSTRAINT "InventoryLocation_code_ck" CHECK ("code" <> '' AND "code" NOT GLOB '*[^A-Z0-9_]*'),
    CONSTRAINT "InventoryLocation_name_ck" CHECK (trim("name") <> ''),
    CONSTRAINT "InventoryLocation_priority_ck" CHECK (typeof("priority") = 'integer' AND "priority" >= 0),
    CONSTRAINT "InventoryLocation_online_ck" CHECK ("isOnlineSellable" = 0 OR ("isActive" = 1 AND "type" IN ('WAREHOUSE', 'STORE')))
);

-- CreateTable
CREATE TABLE "InventoryBalance" (
    "skuId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "safetyStock" INTEGER NOT NULL DEFAULT 0,
    "lastCountedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("skuId", "locationId"),
    CONSTRAINT "InventoryBalance_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryBalance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryBalance_qty_ck" CHECK (typeof("onHand") = 'integer' AND "onHand" >= 0 AND typeof("reserved") = 'integer' AND "reserved" >= 0 AND typeof("safetyStock") = 'integer' AND "safetyStock" >= 0),
    CONSTRAINT "InventoryBalance_reserved_ck" CHECK ("reserved" <= "onHand"),
    CONSTRAINT "InventoryBalance_dates_ck" CHECK (("updatedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("lastCountedAt" IS NULL OR "lastCountedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- CreateTable
CREATE TABLE "InventoryLedger" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "skuId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" TEXT,
    "reservationId" INTEGER,
    "reason" TEXT,
    "memo" TEXT,
    "createdBy" TEXT,
    "occurredAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryLedger_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryLedger_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryLedger_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "InventoryReservation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryLedger_type_enum_ck" CHECK ("type" IN ('INITIAL', 'INBOUND', 'RETURN_IN', 'ADJUST_IN', 'TRANSFER_IN', 'SALE', 'ADJUST_OUT', 'DEFECT_OUT', 'TRANSFER_OUT')),
    CONSTRAINT "InventoryLedger_refType_enum_ck" CHECK ("refType" IN ('ORDER', 'RETURN', 'INBOUND_ORDER', 'STOCK_COUNT', 'TRANSFER', 'MANUAL', 'MIGRATION')),
    CONSTRAINT "InventoryLedger_qty_ck" CHECK (typeof("qty") = 'integer' AND "qty" <> 0),
    CONSTRAINT "InventoryLedger_sign_ck" CHECK (("type" IN ('INITIAL', 'INBOUND', 'RETURN_IN', 'ADJUST_IN', 'TRANSFER_IN') AND "qty" > 0) OR ("type" IN ('SALE', 'ADJUST_OUT', 'DEFECT_OUT', 'TRANSFER_OUT') AND "qty" < 0)),
    CONSTRAINT "InventoryLedger_balance_after_ck" CHECK (typeof("balanceAfter") = 'integer' AND "balanceAfter" >= 0),
    CONSTRAINT "InventoryLedger_sale_ck" CHECK (("type" = 'SALE') = ("reservationId" IS NOT NULL) AND ("type" <> 'SALE' OR "refType" = 'ORDER')),
    CONSTRAINT "InventoryLedger_ref_ck" CHECK ("refType" IN ('MANUAL', 'MIGRATION') OR ("refId" IS NOT NULL AND trim("refId") <> '')),
    CONSTRAINT "InventoryLedger_reason_ck" CHECK (("type" NOT IN ('ADJUST_IN', 'ADJUST_OUT', 'DEFECT_OUT') AND "refType" <> 'MANUAL') OR ("reason" IS NOT NULL AND trim("reason") <> '')),
    CONSTRAINT "InventoryLedger_dates_ck" CHECK (("occurredAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- CreateTable
CREATE TABLE "InventoryReservation" (
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
    CONSTRAINT "InventoryReservation_releaseReason_enum_ck" CHECK ("releaseReason" IN ('PAYMENT_FAILED', 'SUPERSEDED', 'PRICE_CHANGED', 'COMPENSATED', 'RENEWED', 'ADMIN')),
    CONSTRAINT "InventoryReservation_qty_ck" CHECK (typeof("qty") = 'integer' AND "qty" >= 1),
    CONSTRAINT "InventoryReservation_expiry_ck" CHECK ("expiresAt" > "createdAt"),
    CONSTRAINT "InventoryReservation_state_ck" CHECK (("status" = 'RESERVED'  AND "confirmedAt" IS NULL     AND "releasedAt" IS NULL     AND "releaseReason" IS NULL) OR ("status" = 'CONFIRMED' AND "confirmedAt" IS NOT NULL AND "releasedAt" IS NULL     AND "releaseReason" IS NULL) OR ("status" = 'RELEASED'  AND "confirmedAt" IS NULL     AND "releasedAt" IS NOT NULL AND "releaseReason" IS NOT NULL) OR ("status" = 'EXPIRED'   AND "confirmedAt" IS NULL     AND "releasedAt" IS NOT NULL AND "releaseReason" IS NULL)),
    CONSTRAINT "InventoryReservation_dates_ck" CHECK (("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("expiresAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("confirmedAt" IS NULL OR "confirmedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("releasedAt" IS NULL OR "releasedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- ================================================================
-- 데이터 이전: Sku.stock → 재고 위치·잔고·원장
-- (아래 RedefineTables에서 Sku.stock 컬럼이 사라지기 전에 실행해야 합니다)
-- 날짜는 Prisma와 같은 형식으로 넣습니다 (CURRENT_TIMESTAMP는 형식이 달라 CHECK에 걸림)
-- 이 시점에는 재고 트리거가 아직 없어서(파일 끝에서 생성) 잔고를 기존 재고 수량으로 바로 만듭니다.
-- 대신 같은 수량의 INITIAL 원장을 함께 넣어 "원장 합계 = 실재고"를 맞추고, db:verify가 이를 검사합니다.
-- ================================================================
INSERT INTO "InventoryLocation" ("code", "name", "type", "isOnlineSellable", "isActive", "priority", "createdAt", "updatedAt")
VALUES ('ONLINE_DC', '온라인 물류센터', 'WAREHOUSE', 1, 1, 0, strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'), strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'));

INSERT INTO "InventoryBalance" ("skuId", "locationId", "onHand", "reserved", "safetyStock", "createdAt", "updatedAt")
SELECT s."id", (SELECT "id" FROM "InventoryLocation" WHERE "code" = 'ONLINE_DC'), s."stock", 0, 0, strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'), strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')
FROM "Sku" s;

INSERT INTO "InventoryLedger" ("skuId", "locationId", "type", "qty", "balanceAfter", "refType", "refId", "memo", "createdBy", "occurredAt", "createdAt")
SELECT s."id", (SELECT "id" FROM "InventoryLocation" WHERE "code" = 'ONLINE_DC'), 'INITIAL', s."stock", s."stock", 'MIGRATION', NULL,
       'Sku.stock에서 이전한 기초 재고', 'SYSTEM', strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'), strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')
FROM "Sku" s WHERE s."stock" > 0;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Sku" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "styleColorId" INTEGER NOT NULL,
    "sizeId" INTEGER NOT NULL,
    "skuCode" TEXT NOT NULL,
    "barcode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ON_SALE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Sku_styleColorId_fkey" FOREIGN KEY ("styleColorId") REFERENCES "StyleColor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Sku_sizeId_fkey" FOREIGN KEY ("sizeId") REFERENCES "Size" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Sku_status_enum_ck" CHECK ("status" IN ('ON_SALE', 'SUSPENDED', 'DISCONTINUED')),
    CONSTRAINT "Sku_code_ck" CHECK ("skuCode" GLOB '*-*-*' AND "skuCode" NOT GLOB '*[^A-Z0-9-]*'),
    CONSTRAINT "Sku_barcode_ck" CHECK ("barcode" IS NULL OR (length("barcode") BETWEEN 8 AND 14 AND "barcode" NOT GLOB '*[^0-9]*'))
);
INSERT INTO "new_Sku" ("barcode", "createdAt", "id", "sizeId", "skuCode", "status", "styleColorId", "updatedAt") SELECT "barcode", "createdAt", "id", "sizeId", "skuCode", "status", "styleColorId", "updatedAt" FROM "Sku";
DROP TABLE "Sku";
ALTER TABLE "new_Sku" RENAME TO "Sku";
CREATE UNIQUE INDEX "Sku_skuCode_key" ON "Sku"("skuCode");
CREATE UNIQUE INDEX "Sku_barcode_key" ON "Sku"("barcode");
CREATE UNIQUE INDEX "Sku_styleColorId_sizeId_key" ON "Sku"("styleColorId", "sizeId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLocation_code_key" ON "InventoryLocation"("code");

-- CreateIndex
CREATE INDEX "InventoryBalance_locationId_idx" ON "InventoryBalance"("locationId");

-- CreateIndex
CREATE INDEX "InventoryLedger_skuId_locationId_id_idx" ON "InventoryLedger"("skuId", "locationId", "id");

-- CreateIndex
CREATE INDEX "InventoryLedger_refType_refId_idx" ON "InventoryLedger"("refType", "refId");

-- CreateIndex
CREATE INDEX "InventoryLedger_reservationId_idx" ON "InventoryLedger"("reservationId");

-- CreateIndex
CREATE INDEX "InventoryReservation_skuId_locationId_status_idx" ON "InventoryReservation"("skuId", "locationId", "status");

-- CreateIndex
CREATE INDEX "InventoryReservation_orderId_idx" ON "InventoryReservation"("orderId");

-- CreateIndex
CREATE INDEX "InventoryReservation_status_expiresAt_idx" ON "InventoryReservation"("status", "expiresAt");

-- >>> db-constraints: 트리거 (prisma/db-constraints.ts에서 생성, 직접 수정 금지)

-- 잔고 행은 0으로만 생성 (재고는 원장 입고로만 늘어남)
DROP TRIGGER IF EXISTS "InventoryBalance_insert_zero";
CREATE TRIGGER "InventoryBalance_insert_zero" BEFORE INSERT ON "InventoryBalance"
WHEN NEW."onHand" <> 0 OR NEW."reserved" <> 0
BEGIN SELECT RAISE(ABORT, 'InventoryBalance_insert_zero: 잔고는 0으로 만들고 원장(InventoryLedger)으로 입고해야 합니다'); END;

-- 실재고는 항상 원장 합계와 같아야 함 → 원장 없이 숫자만 고치는 것 금지
DROP TRIGGER IF EXISTS "InventoryBalance_onhand_guard";
CREATE TRIGGER "InventoryBalance_onhand_guard" BEFORE UPDATE OF "onHand" ON "InventoryBalance"
WHEN NEW."onHand" IS NOT (SELECT COALESCE(SUM(l."qty"), 0) FROM "InventoryLedger" l WHERE l."skuId" = NEW."skuId" AND l."locationId" = NEW."locationId")
BEGIN SELECT RAISE(ABORT, 'InventoryBalance_onhand_guard: 실재고는 원장(InventoryLedger)으로만 바꿀 수 있습니다'); END;

-- 예약 수량은 항상 RESERVED 예약 합계와 같아야 함
DROP TRIGGER IF EXISTS "InventoryBalance_reserved_guard";
CREATE TRIGGER "InventoryBalance_reserved_guard" BEFORE UPDATE OF "reserved" ON "InventoryBalance"
WHEN NEW."reserved" IS NOT (SELECT COALESCE(SUM(r."qty"), 0) FROM "InventoryReservation" r WHERE r."skuId" = NEW."skuId" AND r."locationId" = NEW."locationId" AND r."status" = 'RESERVED')
BEGIN SELECT RAISE(ABORT, 'InventoryBalance_reserved_guard: 예약 수량은 예약(InventoryReservation)으로만 바꿀 수 있습니다'); END;

-- 잔고 행의 SKU·위치를 바꾸면 원장과 어긋남
DROP TRIGGER IF EXISTS "InventoryBalance_key_fixed";
CREATE TRIGGER "InventoryBalance_key_fixed" BEFORE UPDATE OF "skuId", "locationId" ON "InventoryBalance"
WHEN NEW."skuId" IS NOT OLD."skuId" OR NEW."locationId" IS NOT OLD."locationId"
BEGIN SELECT RAISE(ABORT, 'InventoryBalance_key_fixed: 잔고 행의 SKU·위치는 바꿀 수 없습니다'); END;

-- 원장 기록이 있는 잔고 행 삭제 금지
DROP TRIGGER IF EXISTS "InventoryBalance_no_delete";
CREATE TRIGGER "InventoryBalance_no_delete" BEFORE DELETE ON "InventoryBalance"
WHEN EXISTS (SELECT 1 FROM "InventoryLedger" l WHERE l."skuId" = OLD."skuId" AND l."locationId" = OLD."locationId")
  OR EXISTS (SELECT 1 FROM "InventoryReservation" r WHERE r."skuId" = OLD."skuId" AND r."locationId" = OLD."locationId")
BEGIN SELECT RAISE(ABORT, 'InventoryBalance_no_delete: 원장·예약 기록이 있는 잔고는 지울 수 없습니다'); END;

-- 원장은 수정 금지 (잘못 넣었으면 반대 방향 행을 추가)
DROP TRIGGER IF EXISTS "InventoryLedger_no_update";
CREATE TRIGGER "InventoryLedger_no_update" BEFORE UPDATE ON "InventoryLedger"
BEGIN SELECT RAISE(ABORT, 'InventoryLedger_append_only: 원장은 수정할 수 없습니다. 반대 방향 행을 추가하세요'); END;

-- 원장은 삭제 금지
DROP TRIGGER IF EXISTS "InventoryLedger_no_delete";
CREATE TRIGGER "InventoryLedger_no_delete" BEFORE DELETE ON "InventoryLedger"
BEGIN SELECT RAISE(ABORT, 'InventoryLedger_append_only: 원장은 삭제할 수 없습니다'); END;

-- 잔고 행이 있어야 하고, balanceAfter = 직전 실재고 + qty, 결과가 예약 수량보다 작아지면 거부
DROP TRIGGER IF EXISTS "InventoryLedger_check_balance";
CREATE TRIGGER "InventoryLedger_check_balance" BEFORE INSERT ON "InventoryLedger"
BEGIN
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM "InventoryBalance" b WHERE b."skuId" = NEW."skuId" AND b."locationId" = NEW."locationId")
    THEN RAISE(ABORT, 'InventoryLedger_check_balance: 잔고 행(InventoryBalance)이 없습니다. 먼저 0으로 만드세요')
  WHEN NEW."balanceAfter" IS NOT ((SELECT b."onHand" FROM "InventoryBalance" b WHERE b."skuId" = NEW."skuId" AND b."locationId" = NEW."locationId") + NEW."qty")
    THEN RAISE(ABORT, 'InventoryLedger_check_balance: balanceAfter가 직전 실재고 + qty와 다릅니다')
  WHEN NEW."balanceAfter" < (SELECT b."reserved" FROM "InventoryBalance" b WHERE b."skuId" = NEW."skuId" AND b."locationId" = NEW."locationId")
    THEN RAISE(ABORT, 'InventoryLedger_check_balance: 결제 대기 예약보다 실재고가 적어집니다')
END;
END;

-- 원장을 추가하면 잔고 실재고에 자동 반영 (앱이 따로 고치지 않음)
DROP TRIGGER IF EXISTS "InventoryLedger_apply";
CREATE TRIGGER "InventoryLedger_apply" AFTER INSERT ON "InventoryLedger"
BEGIN
  UPDATE "InventoryBalance" SET "onHand" = "onHand" + NEW."qty", "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')
  WHERE "skuId" = NEW."skuId" AND "locationId" = NEW."locationId";
END;

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

-- ON_SALE로 바꾸는 순간 정가·고시(법적 의무)·판매 컬러·SKU·대표 이미지·혼용률 합계 100%를 검사
DROP TRIGGER IF EXISTS "Style_sale_ready_upd";
CREATE TRIGGER "Style_sale_ready_upd" BEFORE UPDATE OF "status" ON "Style"
WHEN NEW."status" = 'ON_SALE' AND OLD."status" IS NOT 'ON_SALE'
BEGIN
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM "StylePrice" p WHERE p."styleId" = NEW."id" AND p."validFrom" <= strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now') AND (p."validTo" IS NULL OR p."validTo" > strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')))
    THEN RAISE(ABORT, 'Style_sale_ready: 지금 유효한 정가(StylePrice)가 없어 판매를 시작할 수 없습니다')
  WHEN NOT EXISTS (SELECT 1 FROM "StyleNotice" n WHERE n."styleId" = NEW."id")
    THEN RAISE(ABORT, 'Style_sale_ready: 상품정보제공고시(StyleNotice)가 없어 판매를 시작할 수 없습니다')
  WHEN NOT EXISTS (SELECT 1 FROM "StyleColor" c WHERE c."styleId" = NEW."id" AND c."status" = 'ON_SALE' AND c."isDisplayed" = 1)
    THEN RAISE(ABORT, 'Style_sale_ready: 판매 중인 컬러가 없어 판매를 시작할 수 없습니다')
  WHEN EXISTS (SELECT 1 FROM "StyleColor" c WHERE c."styleId" = NEW."id" AND c."status" = 'ON_SALE' AND c."isDisplayed" = 1
      AND (NOT EXISTS (SELECT 1 FROM "Sku" k WHERE k."styleColorId" = c."id")
        OR NOT EXISTS (SELECT 1 FROM "StyleColorImage" i WHERE i."styleColorId" = c."id" AND i."type" = 'MAIN')))
    THEN RAISE(ABORT, 'Style_sale_ready: SKU나 대표(MAIN) 이미지가 없는 판매 컬러가 있습니다')
  WHEN NOT EXISTS (SELECT 1 FROM "StyleMaterial" m WHERE m."styleId" = NEW."id")
    THEN RAISE(ABORT, 'Style_sale_ready: 혼용률(StyleMaterial)이 없어 판매를 시작할 수 없습니다')
  WHEN EXISTS (SELECT 1 FROM "StyleMaterial" m WHERE m."styleId" = NEW."id" GROUP BY m."part" HAVING sum(m."percent") <> 100)
    THEN RAISE(ABORT, 'Style_sale_ready: 혼용률 합계가 100%가 아닌 부위가 있습니다')
END;
END;

-- SKU 코드는 반드시 '컬러품번-사이즈코드' (JK26F001-BK-100)
DROP TRIGGER IF EXISTS "Sku_code_match_ins";
CREATE TRIGGER "Sku_code_match_ins" BEFORE INSERT ON "Sku"
WHEN NEW."skuCode" IS NOT ((SELECT sc."code" FROM "StyleColor" sc WHERE sc."id" = NEW."styleColorId") || '-' || (SELECT z."code" FROM "Size" z WHERE z."id" = NEW."sizeId"))
BEGIN SELECT RAISE(ABORT, 'Sku_code_match: SKU 코드는 컬러품번-사이즈코드여야 합니다'); END;

-- 위와 같음 (수정 시)
DROP TRIGGER IF EXISTS "Sku_code_match_upd";
CREATE TRIGGER "Sku_code_match_upd" BEFORE UPDATE OF "skuCode", "sizeId", "styleColorId" ON "Sku"
WHEN NEW."skuCode" IS NOT ((SELECT sc."code" FROM "StyleColor" sc WHERE sc."id" = NEW."styleColorId") || '-' || (SELECT z."code" FROM "Size" z WHERE z."id" = NEW."sizeId"))
BEGIN SELECT RAISE(ABORT, 'Sku_code_match: SKU 코드는 컬러품번-사이즈코드여야 합니다'); END;

-- SKU에 쓰인 사이즈 코드 변경 금지
DROP TRIGGER IF EXISTS "Size_code_fixed";
CREATE TRIGGER "Size_code_fixed" BEFORE UPDATE OF "code" ON "Size"
WHEN NEW."code" IS NOT OLD."code" AND EXISTS (SELECT 1 FROM "Sku" k WHERE k."sizeId" = NEW."id")
BEGIN SELECT RAISE(ABORT, 'Size_code_fixed: SKU에 쓰인 사이즈 코드는 바꿀 수 없습니다'); END;

-- SKU의 사이즈는 스타일의 사이즈 체계에 속해야 함 (상의 자켓에 신발 270 금지)
DROP TRIGGER IF EXISTS "Sku_size_group_ins";
CREATE TRIGGER "Sku_size_group_ins" BEFORE INSERT ON "Sku"
WHEN (SELECT z."sizeGroupId" FROM "Size" z WHERE z."id" = NEW."sizeId") IS NOT (SELECT st."sizeGroupId" FROM "StyleColor" sc JOIN "Style" st ON st."id" = sc."styleId" WHERE sc."id" = NEW."styleColorId")
BEGIN SELECT RAISE(ABORT, 'Sku_size_group: SKU 사이즈가 스타일의 사이즈 체계에 속하지 않습니다'); END;

-- 위와 같음 (수정 시)
DROP TRIGGER IF EXISTS "Sku_size_group_upd";
CREATE TRIGGER "Sku_size_group_upd" BEFORE UPDATE OF "sizeId", "styleColorId" ON "Sku"
WHEN (SELECT z."sizeGroupId" FROM "Size" z WHERE z."id" = NEW."sizeId") IS NOT (SELECT st."sizeGroupId" FROM "StyleColor" sc JOIN "Style" st ON st."id" = sc."styleId" WHERE sc."id" = NEW."styleColorId")
BEGIN SELECT RAISE(ABORT, 'Sku_size_group: SKU 사이즈가 스타일의 사이즈 체계에 속하지 않습니다'); END;

-- SKU·실측·모델 정보가 있는 스타일의 사이즈 체계를 바꾸면 기존 사이즈와 어긋남 → 거부
DROP TRIGGER IF EXISTS "Style_size_group_change";
CREATE TRIGGER "Style_size_group_change" BEFORE UPDATE OF "sizeGroupId" ON "Style"
WHEN NEW."sizeGroupId" <> OLD."sizeGroupId" AND (
  EXISTS (SELECT 1 FROM "Sku" k JOIN "StyleColor" sc ON sc."id" = k."styleColorId" WHERE sc."styleId" = NEW."id")
  OR EXISTS (SELECT 1 FROM "SizeMeasurement" m WHERE m."styleId" = NEW."id")
  OR EXISTS (SELECT 1 FROM "ModelWear" w WHERE w."styleId" = NEW."id"))
BEGIN SELECT RAISE(ABORT, 'Style_size_group_change: SKU·실측·모델 정보가 있는 스타일은 사이즈 체계를 바꿀 수 없습니다'); END;

-- <<< db-constraints
