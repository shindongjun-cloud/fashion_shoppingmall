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
DROP TRIGGER IF EXISTS "Customer_status_transition";
DROP TRIGGER IF EXISTS "CustomerAddress_insert_guard";
DROP TRIGGER IF EXISTS "CustomerAddress_default_one_upd";
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
DROP TRIGGER IF EXISTS "OrderItem_immutable";
DROP TRIGGER IF EXISTS "OrderItem_status_transition";
DROP TRIGGER IF EXISTS "OrderItem_status_history_ins";
DROP TRIGGER IF EXISTS "OrderItem_status_history_upd";
DROP TRIGGER IF EXISTS "OrderItem_fulfillment";
DROP TRIGGER IF EXISTS "OrderItem_no_delete";
DROP TRIGGER IF EXISTS "OrderStatusHistory_no_update";
DROP TRIGGER IF EXISTS "OrderStatusHistory_no_delete";
DROP TRIGGER IF EXISTS "OrderItemStatusHistory_no_update";
DROP TRIGGER IF EXISTS "OrderItemStatusHistory_no_delete";
DROP TRIGGER IF EXISTS "Payment_order_ready";
DROP TRIGGER IF EXISTS "PaymentCancel_fulfillment_guard";
DROP TRIGGER IF EXISTS "OrderShippingAddress_insert_guard";
DROP TRIGGER IF EXISTS "OrderShippingAddress_update_guard";
DROP TRIGGER IF EXISTS "OrderShippingAddress_history";
DROP TRIGGER IF EXISTS "OrderShippingAddress_no_delete";
DROP TRIGGER IF EXISTS "OrderShippingAddressHistory_wipe_only";
DROP TRIGGER IF EXISTS "OrderShippingAddressHistory_no_delete";
DROP TRIGGER IF EXISTS "ShippingPolicy_no_overlap_ins";
DROP TRIGGER IF EXISTS "ShippingPolicy_no_overlap_upd";
DROP TRIGGER IF EXISTS "ShippingPolicy_used_fixed";
DROP TRIGGER IF EXISTS "ShippingSurchargeZone_no_overlap_ins";
DROP TRIGGER IF EXISTS "ShippingSurchargeZone_used_fixed";
DROP TRIGGER IF EXISTS "ShippingSurchargeZone_no_delete";
DROP TRIGGER IF EXISTS "Shipment_insert_guard";
DROP TRIGGER IF EXISTS "Shipment_fixed";
DROP TRIGGER IF EXISTS "Shipment_transition";
DROP TRIGGER IF EXISTS "Shipment_cascade";
DROP TRIGGER IF EXISTS "Shipment_no_delete";
DROP TRIGGER IF EXISTS "ShipmentItem_insert_guard";
DROP TRIGGER IF EXISTS "ShipmentItem_no_update";
DROP TRIGGER IF EXISTS "ShipmentItem_no_delete";
-- <<< db-constraints-top

-- CreateTable
CREATE TABLE "OrderShippingAddress" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "sourceAddressId" INTEGER,
    "recipientEnc" TEXT,
    "phoneEnc" TEXT,
    "phoneHash" TEXT,
    "zipCode" TEXT NOT NULL,
    "address1Enc" TEXT,
    "address2Enc" TEXT,
    "deliveryMemoEnc" TEXT,
    "region" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "changedBy" TEXT,
    "changeReason" TEXT,
    "piiPurgedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrderShippingAddress_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderShippingAddress_sourceAddressId_fkey" FOREIGN KEY ("sourceAddressId") REFERENCES "CustomerAddress" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OrderShippingAddress_region_enum_ck" CHECK ("region" IN ('NORMAL', 'JEJU', 'REMOTE')),
    CONSTRAINT "OrderShippingAddress_changedBy_enum_ck" CHECK ("changedBy" IN ('CUSTOMER', 'ADMIN', 'SYSTEM')),
    CONSTRAINT "OrderShippingAddress_values_ck" CHECK ((length("zipCode") = 5 AND "zipCode" NOT GLOB '*[^0-9]*') AND ("recipientEnc" IS NULL OR "recipientEnc" GLOB 'v[0-9]*:?*:?*:?*') AND ("phoneEnc" IS NULL OR "phoneEnc" GLOB 'v[0-9]*:?*:?*:?*') AND ("address1Enc" IS NULL OR "address1Enc" GLOB 'v[0-9]*:?*:?*:?*') AND ("address2Enc" IS NULL OR "address2Enc" GLOB 'v[0-9]*:?*:?*:?*') AND ("deliveryMemoEnc" IS NULL OR "deliveryMemoEnc" GLOB 'v[0-9]*:?*:?*:?*') AND ("phoneHash" IS NULL OR (length("phoneHash") = 64 AND "phoneHash" NOT GLOB '*[^0-9a-f]*')) AND (typeof("version") = 'integer' AND "version" >= 1) AND ("changeReason" IS NULL OR (trim("changeReason") <> '' AND length("changeReason") <= 200))),
    CONSTRAINT "OrderShippingAddress_purge_ck" CHECK (("piiPurgedAt" IS NULL AND "recipientEnc" IS NOT NULL AND "phoneEnc" IS NOT NULL AND "address1Enc" IS NOT NULL) OR ("piiPurgedAt" IS NOT NULL AND "recipientEnc" IS NULL AND "phoneEnc" IS NULL AND "address1Enc" IS NULL AND "address2Enc" IS NULL AND "deliveryMemoEnc" IS NULL AND "phoneHash" IS NULL)),
    CONSTRAINT "OrderShippingAddress_change_ck" CHECK (("version" = 1) = ("changedBy" IS NULL)),
    CONSTRAINT "OrderShippingAddress_dates_ck" CHECK (("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("updatedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("piiPurgedAt" IS NULL OR "piiPurgedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- CreateTable
CREATE TABLE "OrderShippingAddressHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderShippingAddressId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "recipientEnc" TEXT,
    "phoneEnc" TEXT,
    "zipCode" TEXT NOT NULL,
    "address1Enc" TEXT,
    "address2Enc" TEXT,
    "deliveryMemoEnc" TEXT,
    "region" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changeReason" TEXT,
    "changedAt" DATETIME NOT NULL,
    CONSTRAINT "OrderShippingAddressHistory_orderShippingAddressId_fkey" FOREIGN KEY ("orderShippingAddressId") REFERENCES "OrderShippingAddress" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderShippingAddressHistory_region_enum_ck" CHECK ("region" IN ('NORMAL', 'JEJU', 'REMOTE')),
    CONSTRAINT "OrderShippingAddressHistory_changedBy_enum_ck" CHECK ("changedBy" IN ('CUSTOMER', 'ADMIN', 'SYSTEM')),
    CONSTRAINT "OrderShippingAddressHistory_values_ck" CHECK ((length("zipCode") = 5 AND "zipCode" NOT GLOB '*[^0-9]*') AND ("recipientEnc" IS NULL OR "recipientEnc" GLOB 'v[0-9]*:?*:?*:?*') AND ("phoneEnc" IS NULL OR "phoneEnc" GLOB 'v[0-9]*:?*:?*:?*') AND ("address1Enc" IS NULL OR "address1Enc" GLOB 'v[0-9]*:?*:?*:?*') AND ("address2Enc" IS NULL OR "address2Enc" GLOB 'v[0-9]*:?*:?*:?*') AND ("deliveryMemoEnc" IS NULL OR "deliveryMemoEnc" GLOB 'v[0-9]*:?*:?*:?*') AND (typeof("version") = 'integer' AND "version" >= 1) AND ("changeReason" IS NULL OR (trim("changeReason") <> '' AND length("changeReason") <= 200)) AND ("changedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- CreateTable
CREATE TABLE "OrderStatusHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "memo" TEXT,
    "changedAt" DATETIME NOT NULL,
    CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderStatusHistory_fromStatus_enum_ck" CHECK ("fromStatus" IN ('PENDING', 'WAITING_DEPOSIT', 'PAID', 'CANCELED', 'EXPIRED', 'CANCEL_FAILED')),
    CONSTRAINT "OrderStatusHistory_toStatus_enum_ck" CHECK ("toStatus" IN ('PENDING', 'WAITING_DEPOSIT', 'PAID', 'CANCELED', 'EXPIRED', 'CANCEL_FAILED')),
    CONSTRAINT "OrderStatusHistory_changedBy_enum_ck" CHECK ("changedBy" IN ('CUSTOMER', 'ADMIN', 'SYSTEM')),
    CONSTRAINT "OrderStatusHistory_ck" CHECK (("fromStatus" IS NULL OR "fromStatus" <> "toStatus") AND ("memo" IS NULL OR (trim("memo") <> '' AND length("memo") <= 200)) AND ("changedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- CreateTable
CREATE TABLE "OrderItemStatusHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderItemId" INTEGER NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "memo" TEXT,
    "changedAt" DATETIME NOT NULL,
    CONSTRAINT "OrderItemStatusHistory_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderItemStatusHistory_fromStatus_enum_ck" CHECK ("fromStatus" IN ('AWAITING_PAYMENT', 'PAID', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CONFIRMED', 'CANCELED')),
    CONSTRAINT "OrderItemStatusHistory_toStatus_enum_ck" CHECK ("toStatus" IN ('AWAITING_PAYMENT', 'PAID', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CONFIRMED', 'CANCELED')),
    CONSTRAINT "OrderItemStatusHistory_changedBy_enum_ck" CHECK ("changedBy" IN ('CUSTOMER', 'ADMIN', 'SYSTEM')),
    CONSTRAINT "OrderItemStatusHistory_ck" CHECK (("fromStatus" IS NULL OR "fromStatus" <> "toStatus") AND ("memo" IS NULL OR (trim("memo") <> '' AND length("memo") <= 200)) AND ("changedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- CreateTable
CREATE TABLE "ShippingPolicy" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseFee" INTEGER NOT NULL,
    "freeShippingThreshold" INTEGER,
    "validFrom" DATETIME NOT NULL,
    "validTo" DATETIME,
    "memo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShippingPolicy_values_ck" CHECK ("code" <> '' AND "code" NOT GLOB '*[^A-Z0-9_-]*' AND trim("name") <> '' AND (typeof("baseFee") = 'integer' AND "baseFee" >= 0) AND ("freeShippingThreshold" IS NULL OR (typeof("freeShippingThreshold") = 'integer' AND "freeShippingThreshold" > 0)) AND ("memo" IS NULL OR (trim("memo") <> '' AND length("memo") <= 200))),
    CONSTRAINT "ShippingPolicy_period_ck" CHECK (("validFrom" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("validTo" IS NULL OR "validTo" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("validTo" IS NULL OR "validTo" > "validFrom"))
);

-- CreateTable
CREATE TABLE "ShippingSurchargeZone" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "policyId" INTEGER NOT NULL,
    "region" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "zipFrom" TEXT NOT NULL,
    "zipTo" TEXT NOT NULL,
    "extraFee" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShippingSurchargeZone_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "ShippingPolicy" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ShippingSurchargeZone_region_enum_ck" CHECK ("region" IN ('NORMAL', 'JEJU', 'REMOTE')),
    CONSTRAINT "ShippingSurchargeZone_values_ck" CHECK ("region" <> 'NORMAL' AND trim("name") <> '' AND (length("zipFrom") = 5 AND "zipFrom" NOT GLOB '*[^0-9]*') AND (length("zipTo") = 5 AND "zipTo" NOT GLOB '*[^0-9]*') AND "zipFrom" <= "zipTo" AND (typeof("extraFee") = 'integer' AND "extraFee" > 0))
);

-- CreateTable
CREATE TABLE "Courier" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trackingUrlTemplate" TEXT NOT NULL,
    "trackingNoMinLength" INTEGER NOT NULL,
    "trackingNoMaxLength" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Courier_isActive_bool_ck" CHECK ("isActive" IN (0, 1)),
    CONSTRAINT "Courier_values_ck" CHECK ("code" <> '' AND "code" NOT GLOB '*[^A-Z0-9_]*' AND trim("name") <> '' AND "trackingUrlTemplate" GLOB 'https://?*{no}*' AND (typeof("trackingNoMinLength") = 'integer' AND "trackingNoMinLength" BETWEEN 6 AND 30) AND (typeof("trackingNoMaxLength") = 'integer' AND "trackingNoMaxLength" BETWEEN 6 AND 30) AND "trackingNoMinLength" <= "trackingNoMaxLength" AND (typeof("sortOrder") = 'integer' AND "sortOrder" >= 0))
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'OUTBOUND',
    "status" TEXT NOT NULL DEFAULT 'READY',
    "locationId" INTEGER NOT NULL,
    "courierId" INTEGER NOT NULL,
    "trackingNo" TEXT NOT NULL,
    "statusChangedAt" DATETIME NOT NULL,
    "shippedAt" DATETIME,
    "deliveredAt" DATETIME,
    "canceledAt" DATETIME,
    "createdBy" TEXT NOT NULL,
    "memo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Shipment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Shipment_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Shipment_type_enum_ck" CHECK ("type" IN ('OUTBOUND', 'RETURN_PICKUP', 'EXCHANGE_OUTBOUND')),
    CONSTRAINT "Shipment_status_enum_ck" CHECK ("status" IN ('READY', 'SHIPPED', 'DELIVERED', 'CANCELED')),
    CONSTRAINT "Shipment_tracking_ck" CHECK (length("trackingNo") BETWEEN 6 AND 30 AND "trackingNo" NOT GLOB '*[^0-9]*'),
    CONSTRAINT "Shipment_state_ck" CHECK (("status" = 'READY' AND "shippedAt" IS NULL AND "deliveredAt" IS NULL AND "canceledAt" IS NULL) OR ("status" = 'SHIPPED' AND "shippedAt" IS NOT NULL AND "deliveredAt" IS NULL AND "canceledAt" IS NULL) OR ("status" = 'DELIVERED' AND "shippedAt" IS NOT NULL AND "deliveredAt" IS NOT NULL AND "deliveredAt" >= "shippedAt" AND "canceledAt" IS NULL) OR ("status" = 'CANCELED' AND "shippedAt" IS NULL AND "deliveredAt" IS NULL AND "canceledAt" IS NOT NULL)),
    CONSTRAINT "Shipment_meta_ck" CHECK (trim("createdBy") <> '' AND ("memo" IS NULL OR (trim("memo") <> '' AND length("memo") <= 200)) AND ("statusChangedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("shippedAt" IS NULL OR "shippedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("deliveredAt" IS NULL OR "deliveredAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("canceledAt" IS NULL OR "canceledAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("updatedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- CreateTable
CREATE TABLE "ShipmentItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shipmentId" INTEGER NOT NULL,
    "orderItemId" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    CONSTRAINT "ShipmentItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ShipmentItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ShipmentItem_qty_ck" CHECK (typeof("qty") = 'integer' AND "qty" >= 1)
);

-- RedefineTables
-- >>> ⑦ 기준 데이터 (손으로 추가)
-- 배송비 규칙: 도입 전 주문용(배송비 없음) → 기본 3,000원 / 5만원 이상 무료 (쿠폰 적용 전 판매가 합계 기준)
INSERT INTO "ShippingPolicy" ("id", "code", "name", "baseFee", "freeShippingThreshold", "validFrom", "validTo", "memo", "createdAt") VALUES
  (1, 'LEGACY-FREE', '배송비 도입 전 주문 (배송비 없음)', 0, NULL, '2000-01-01T00:00:00.000+00:00', '2026-11-18T00:00:00.000+00:00', '⑦ 주문 도메인 전환 전에 만든 주문은 실제로 배송비를 받지 않았음', strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'STD-2611', '기본 배송비 3,000원 / 5만원 이상 무료', 3000, 50000, '2026-11-18T00:00:00.000+00:00', NULL, NULL, strftime('%Y-%m-%dT%H:%M:%f+00:00','now'));
-- 제주·도서산간 추가 배송비 (쇼핑몰 솔루션에서 널리 쓰는 우편번호 범위. 실제 계약 택배사 목록과 대조 필요)
INSERT INTO "ShippingSurchargeZone" ("policyId", "region", "name", "zipFrom", "zipTo", "extraFee", "createdAt") VALUES
  (2, 'JEJU', '제주특별자치도 전역', '63000', '63644', 3000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'REMOTE', '인천 강화군 섬 지역', '23004', '23010', 5000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'REMOTE', '인천 옹진군', '23100', '23116', 5000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'REMOTE', '인천 옹진군', '23124', '23136', 5000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'REMOTE', '충남 보령시 섬 지역', '33411', '33411', 5000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'REMOTE', '경북 울릉군', '40200', '40240', 5000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'REMOTE', '경남 사천시 섬 지역', '52570', '52571', 5000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'REMOTE', '경남 통영시 섬 지역', '53031', '53033', 5000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'REMOTE', '경남 통영시 섬 지역', '53089', '53104', 5000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'REMOTE', '전북 군산시 섬 지역', '54000', '54000', 5000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'REMOTE', '전북 부안군 섬 지역', '56347', '56349', 5000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'REMOTE', '전남 영광군 섬 지역', '57068', '57069', 5000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'REMOTE', '전남 목포시 섬 지역', '58760', '58762', 5000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'REMOTE', '전남 신안군', '58800', '58810', 5000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'REMOTE', '전남 신안군', '58816', '58818', 5000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'REMOTE', '전남 신안군', '58828', '58866', 5000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'REMOTE', '전남 진도군 섬 지역', '58953', '58958', 5000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'REMOTE', '전남 완도군 섬 지역', '59102', '59103', 5000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'REMOTE', '전남 완도군 섬 지역', '59106', '59106', 5000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'REMOTE', '전남 완도군 섬 지역', '59127', '59127', 5000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'REMOTE', '전남 완도군 섬 지역', '59129', '59129', 5000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'REMOTE', '전남 완도군 섬 지역', '59137', '59166', 5000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'REMOTE', '전남 보성군 섬 지역', '59421', '59421', 5000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'REMOTE', '전남 고흥군 섬 지역', '59531', '59531', 5000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'REMOTE', '전남 고흥군 섬 지역', '59551', '59551', 5000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'REMOTE', '전남 여수시 섬 지역', '59650', '59650', 5000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'REMOTE', '전남 여수시 섬 지역', '59766', '59766', 5000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  (2, 'REMOTE', '전남 여수시 섬 지역', '59781', '59790', 5000, strftime('%Y-%m-%dT%H:%M:%f+00:00','now'));
-- 택배사 (배송조회 주소의 {no} 자리에 송장번호)
INSERT INTO "Courier" ("code", "name", "trackingUrlTemplate", "trackingNoMinLength", "trackingNoMaxLength", "isActive", "sortOrder", "createdAt", "updatedAt") VALUES
  ('CJ', 'CJ대한통운', 'https://trace.cjlogistics.com/next/tracking.html?wblNo={no}', 10, 12, 1, 0, strftime('%Y-%m-%dT%H:%M:%f+00:00','now'), strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  ('LOTTE', '롯데택배', 'https://www.lotteglogis.com/home/reservation/tracking/linkView?InvNo={no}', 10, 13, 1, 1, strftime('%Y-%m-%dT%H:%M:%f+00:00','now'), strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  ('HANJIN', '한진택배', 'https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038&schLang=KR&wblnumText2={no}', 10, 12, 1, 2, strftime('%Y-%m-%dT%H:%M:%f+00:00','now'), strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  ('EPOST', '우체국택배', 'https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1={no}', 13, 13, 1, 3, strftime('%Y-%m-%dT%H:%M:%f+00:00','now'), strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
  ('LOGEN', '로젠택배', 'https://www.ilogen.com/web/personal/trace/{no}', 11, 11, 1, 4, strftime('%Y-%m-%dT%H:%M:%f+00:00','now'), strftime('%Y-%m-%dT%H:%M:%f+00:00','now'));
-- <<< ⑦ 기준 데이터

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CustomerAddress" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "recipientEnc" TEXT NOT NULL,
    "phoneEnc" TEXT NOT NULL,
    "zipCode" TEXT NOT NULL,
    "address1Enc" TEXT NOT NULL,
    "address2Enc" TEXT,
    "deliveryMemoEnc" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CustomerAddress_isDefault_bool_ck" CHECK ("isDefault" IN (0, 1)),
    CONSTRAINT "CustomerAddress_label_ck" CHECK (trim("label") <> '' AND length("label") <= 20),
    CONSTRAINT "CustomerAddress_zip_ck" CHECK (length("zipCode") = 5 AND "zipCode" NOT GLOB '*[^0-9]*'),
    CONSTRAINT "CustomerAddress_enc_ck" CHECK (("recipientEnc" IS NULL OR "recipientEnc" GLOB 'v[0-9]*:?*:?*:?*') AND ("phoneEnc" IS NULL OR "phoneEnc" GLOB 'v[0-9]*:?*:?*:?*') AND ("address1Enc" IS NULL OR "address1Enc" GLOB 'v[0-9]*:?*:?*:?*') AND ("address2Enc" IS NULL OR "address2Enc" GLOB 'v[0-9]*:?*:?*:?*')),
    CONSTRAINT "CustomerAddress_memo_ck" CHECK ("deliveryMemoEnc" IS NULL OR "deliveryMemoEnc" GLOB 'v[0-9]*:?*:?*:?*')
);
-- 배송 메모 → 암호문 칸. 평문 메모가 남아 있으면 CustomerAddress_memo_ck가 막아서 여기서 멈춤 (조용히 버리지 않음. 현재 DB 0건)
INSERT INTO "new_CustomerAddress" ("address1Enc", "address2Enc", "createdAt", "customerId", "deliveryMemoEnc", "id", "isDefault", "label", "lastUsedAt", "phoneEnc", "recipientEnc", "updatedAt", "zipCode") SELECT "address1Enc", "address2Enc", "createdAt", "customerId", "deliveryMemo", "id", "isDefault", "label", "lastUsedAt", "phoneEnc", "recipientEnc", "updatedAt", "zipCode" FROM "CustomerAddress";
DROP TABLE "CustomerAddress";
ALTER TABLE "new_CustomerAddress" RENAME TO "CustomerAddress";
CREATE INDEX "CustomerAddress_customerId_idx" ON "CustomerAddress"("customerId");
CREATE TABLE "new_InventoryReservation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "orderItemId" INTEGER NOT NULL,
    "skuId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "expiresAt" DATETIME NOT NULL,
    "allocatedAt" DATETIME,
    "confirmedAt" DATETIME,
    "shipmentId" INTEGER,
    "releasedAt" DATETIME,
    "releaseReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryReservation_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryReservation_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryReservation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryReservation_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryReservation_status_enum_ck" CHECK ("status" IN ('RESERVED', 'ALLOCATED', 'CONFIRMED', 'RELEASED', 'EXPIRED')),
    CONSTRAINT "InventoryReservation_releaseReason_enum_ck" CHECK ("releaseReason" IN ('PAYMENT_FAILED', 'SUPERSEDED', 'PRICE_CHANGED', 'COMPENSATED', 'RENEWED', 'ORDER_CANCELED', 'DEPOSIT_EXPIRED', 'ADMIN')),
    CONSTRAINT "InventoryReservation_qty_ck" CHECK (typeof("qty") = 'integer' AND "qty" >= 1),
    CONSTRAINT "InventoryReservation_expiry_ck" CHECK ("expiresAt" > "createdAt"),
    CONSTRAINT "InventoryReservation_state_ck" CHECK (("status" = 'RESERVED'  AND "allocatedAt" IS NULL     AND "confirmedAt" IS NULL     AND "shipmentId" IS NULL     AND "releasedAt" IS NULL     AND "releaseReason" IS NULL) OR ("status" = 'ALLOCATED' AND "allocatedAt" IS NOT NULL AND "confirmedAt" IS NULL     AND "shipmentId" IS NULL     AND "releasedAt" IS NULL     AND "releaseReason" IS NULL) OR ("status" = 'CONFIRMED' AND "allocatedAt" IS NOT NULL AND "confirmedAt" IS NOT NULL AND "shipmentId" IS NOT NULL AND "releasedAt" IS NULL     AND "releaseReason" IS NULL) OR ("status" = 'RELEASED'  AND "confirmedAt" IS NULL     AND "shipmentId" IS NULL     AND "releasedAt" IS NOT NULL AND "releaseReason" IS NOT NULL) OR ("status" = 'EXPIRED'   AND "allocatedAt" IS NULL     AND "confirmedAt" IS NULL     AND "shipmentId" IS NULL     AND "releasedAt" IS NOT NULL AND "releaseReason" IS NULL)),
    CONSTRAINT "InventoryReservation_dates_ck" CHECK (("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("expiresAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("allocatedAt" IS NULL OR "allocatedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("confirmedAt" IS NULL OR "confirmedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("releasedAt" IS NULL OR "releasedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);
-- 예약 ↔ 주문 상품 줄 연결 (주문 + SKU로 짝). 결제 시 확정(CONFIRMED)된 예약이 있으면 출고 상자가 없어 InventoryReservation_state_ck가 막음 (현재 DB 0건)
INSERT INTO "new_InventoryReservation" ("confirmedAt", "createdAt", "expiresAt", "id", "locationId", "orderId", "orderItemId", "qty", "releaseReason", "releasedAt", "skuId", "status")
SELECT r."confirmedAt", r."createdAt", r."expiresAt", r."id", r."locationId", r."orderId",
  (SELECT i."id" FROM "OrderItem" i WHERE i."orderId" = r."orderId" AND i."skuId" = r."skuId"),
  r."qty", r."releaseReason", r."releasedAt", r."skuId", r."status" FROM "InventoryReservation" r;
DROP TABLE "InventoryReservation";
ALTER TABLE "new_InventoryReservation" RENAME TO "InventoryReservation";
CREATE INDEX "InventoryReservation_skuId_locationId_status_idx" ON "InventoryReservation"("skuId", "locationId", "status");
CREATE INDEX "InventoryReservation_orderId_idx" ON "InventoryReservation"("orderId");
CREATE INDEX "InventoryReservation_orderItemId_idx" ON "InventoryReservation"("orderItemId");
CREATE INDEX "InventoryReservation_shipmentId_idx" ON "InventoryReservation"("shipmentId");
CREATE INDEX "InventoryReservation_status_expiresAt_idx" ON "InventoryReservation"("status", "expiresAt");
CREATE TABLE "new_Order" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderNo" TEXT NOT NULL,
    "paymentOrderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
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
    CONSTRAINT "Order_confirmed_ck" CHECK (("fulfillmentStatus" = 'CONFIRMED') = ("confirmedAt" IS NOT NULL))
);
-- 주문번호(주문일 KST + 무작위 8자리)·금액 구성(배송비 0 = 실제로 받지 않음)·상태 메타 채우기
INSERT INTO "new_Order" ("canceledAt", "createdAt", "customerId", "id", "orderName", "paidAt", "paymentOrderId", "status", "totalPrice",
  "orderNo", "channel", "statusChangedAt", "statusChangedBy", "fulfillmentStatus",
  "itemsListTotal", "itemsDiscountTotal", "itemsTotal", "couponDiscountTotal", "shippingBaseFee", "shippingExtraFee", "shippingFee", "shippingDiscount", "pointUsed",
  "shippingPolicyId", "freeShippingThreshold", "updatedAt")
SELECT o."canceledAt", o."createdAt", o."customerId", o."id", o."orderName", o."paidAt", o."paymentOrderId", o."status", o."totalPrice",
  strftime('%Y%m%d', o."createdAt", '+9 hours') || '-' || printf('%08d', abs(random()) % 100000000),
  'WEB', COALESCE(o."canceledAt", o."paidAt", o."createdAt"), 'SYSTEM',
  CASE WHEN o."status" = 'PAID' OR (o."status" = 'CANCEL_FAILED' AND o."paidAt" IS NOT NULL) THEN 'PAID' WHEN o."status" IN ('CANCELED', 'EXPIRED') THEN 'CANCELED' ELSE 'UNPAID' END,
  (SELECT COALESCE(SUM(i."listPrice" * i."quantity"), 0) FROM "OrderItem" i WHERE i."orderId" = o."id"),
  (SELECT COALESCE(SUM(i."discountAmount" * i."quantity"), 0) FROM "OrderItem" i WHERE i."orderId" = o."id"),
  (SELECT COALESCE(SUM(i."price" * i."quantity"), 0) FROM "OrderItem" i WHERE i."orderId" = o."id"),
  0, 0, 0, 0, 0, 0,
  1, NULL, COALESCE(o."canceledAt", o."paidAt", o."createdAt")
FROM "Order" o;
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_orderNo_key" ON "Order"("orderNo");
CREATE UNIQUE INDEX "Order_paymentOrderId_key" ON "Order"("paymentOrderId");
CREATE INDEX "Order_customerId_createdAt_idx" ON "Order"("customerId", "createdAt");
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");
CREATE INDEX "Order_fulfillmentStatus_createdAt_idx" ON "Order"("fulfillmentStatus", "createdAt");
CREATE INDEX "Order_ordererPhoneHash_idx" ON "Order"("ordererPhoneHash");
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");
CREATE TABLE "new_OrderItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "skuId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "listPrice" INTEGER NOT NULL,
    "discountAmount" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "promotionId" INTEGER,
    "promotionName" TEXT,
    "lineListTotal" INTEGER NOT NULL,
    "lineDiscountTotal" INTEGER NOT NULL,
    "lineTotal" INTEGER NOT NULL,
    "couponAllocated" INTEGER NOT NULL DEFAULT 0,
    "pointAllocated" INTEGER NOT NULL DEFAULT 0,
    "payAmount" INTEGER NOT NULL,
    "styleCode" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "styleName" TEXT NOT NULL,
    "colorName" TEXT NOT NULL,
    "sizeName" TEXT NOT NULL,
    "imageUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "statusChangedAt" DATETIME NOT NULL,
    "statusChangedBy" TEXT NOT NULL DEFAULT 'SYSTEM',
    "statusMemo" TEXT,
    "paidAt" DATETIME,
    "preparingAt" DATETIME,
    "shippedAt" DATETIME,
    "deliveredAt" DATETIME,
    "confirmedAt" DATETIME,
    "canceledAt" DATETIME,
    "confirmType" TEXT,
    "autoConfirmAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "PricePromotion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_status_enum_ck" CHECK ("status" IN ('AWAITING_PAYMENT', 'PAID', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CONFIRMED', 'CANCELED')),
    CONSTRAINT "OrderItem_statusChangedBy_enum_ck" CHECK ("statusChangedBy" IN ('CUSTOMER', 'ADMIN', 'SYSTEM')),
    CONSTRAINT "OrderItem_confirmType_enum_ck" CHECK ("confirmType" IN ('MANUAL', 'AUTO')),
    CONSTRAINT "OrderItem_quantity_ck" CHECK (typeof("quantity") = 'integer' AND "quantity" >= 1),
    CONSTRAINT "OrderItem_amounts_ck" CHECK (typeof("listPrice") = 'integer' AND "listPrice" >= 0 AND typeof("discountAmount") = 'integer' AND "discountAmount" >= 0 AND typeof("price") = 'integer' AND "price" >= 0),
    CONSTRAINT "OrderItem_price_math_ck" CHECK ("price" = "listPrice" - "discountAmount"),
    CONSTRAINT "OrderItem_promotion_ck" CHECK ("discountAmount" = 0 OR "promotionName" IS NOT NULL),
    CONSTRAINT "OrderItem_line_no_ck" CHECK (typeof("lineNo") = 'integer' AND "lineNo" >= 1),
    CONSTRAINT "OrderItem_line_math_ck" CHECK ((typeof("lineListTotal") = 'integer' AND "lineListTotal" >= 0) AND (typeof("lineDiscountTotal") = 'integer' AND "lineDiscountTotal" >= 0) AND (typeof("lineTotal") = 'integer' AND "lineTotal" >= 0) AND (typeof("couponAllocated") = 'integer' AND "couponAllocated" >= 0) AND (typeof("pointAllocated") = 'integer' AND "pointAllocated" >= 0) AND (typeof("payAmount") = 'integer' AND "payAmount" >= 0) AND "lineListTotal" = "listPrice" * "quantity" AND "lineDiscountTotal" = "discountAmount" * "quantity" AND "lineTotal" = "price" * "quantity" AND "payAmount" = "lineTotal" - "couponAllocated" - "pointAllocated"),
    CONSTRAINT "OrderItem_state_ck" CHECK ((("status" = 'AWAITING_PAYMENT' AND "paidAt" IS NULL AND "preparingAt" IS NULL AND "shippedAt" IS NULL AND "deliveredAt" IS NULL AND "confirmedAt" IS NULL AND "canceledAt" IS NULL) OR ("status" = 'PAID' AND "paidAt" IS NOT NULL AND "preparingAt" IS NULL AND "shippedAt" IS NULL AND "deliveredAt" IS NULL AND "confirmedAt" IS NULL AND "canceledAt" IS NULL) OR ("status" = 'PREPARING' AND "paidAt" IS NOT NULL AND "preparingAt" IS NOT NULL AND "shippedAt" IS NULL AND "deliveredAt" IS NULL AND "confirmedAt" IS NULL AND "canceledAt" IS NULL) OR ("status" = 'SHIPPED' AND "paidAt" IS NOT NULL AND "preparingAt" IS NOT NULL AND "shippedAt" IS NOT NULL AND "deliveredAt" IS NULL AND "confirmedAt" IS NULL AND "canceledAt" IS NULL) OR ("status" = 'DELIVERED' AND "paidAt" IS NOT NULL AND "preparingAt" IS NOT NULL AND "shippedAt" IS NOT NULL AND "deliveredAt" IS NOT NULL AND "confirmedAt" IS NULL AND "canceledAt" IS NULL) OR ("status" = 'CONFIRMED' AND "paidAt" IS NOT NULL AND "preparingAt" IS NOT NULL AND "shippedAt" IS NOT NULL AND "confirmedAt" IS NOT NULL AND "canceledAt" IS NULL) OR ("status" = 'CANCELED' AND "shippedAt" IS NULL AND "deliveredAt" IS NULL AND "confirmedAt" IS NULL AND "canceledAt" IS NOT NULL)) AND (("status" = 'CONFIRMED') = ("confirmType" IS NOT NULL)) AND ("autoConfirmAt" IS NULL OR "status" IN ('DELIVERED', 'CONFIRMED')) AND ("status" <> 'DELIVERED' OR "autoConfirmAt" IS NOT NULL)),
    CONSTRAINT "OrderItem_dates_ck" CHECK (("statusMemo" IS NULL OR (trim("statusMemo") <> '' AND length("statusMemo") <= 200)) AND ("statusChangedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("paidAt" IS NULL OR "paidAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("preparingAt" IS NULL OR "preparingAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("shippedAt" IS NULL OR "shippedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("deliveredAt" IS NULL OR "deliveredAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("confirmedAt" IS NULL OR "confirmedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("canceledAt" IS NULL OR "canceledAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("autoConfirmAt" IS NULL OR "autoConfirmAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);
-- 순번·줄 금액·상태 채우기 (주문 상태를 따라감)
INSERT INTO "new_OrderItem" ("colorName", "discountAmount", "id", "imageUrl", "listPrice", "orderId", "price", "promotionId", "promotionName", "quantity", "sizeName", "skuCode", "skuId", "styleCode", "styleName",
  "lineNo", "lineListTotal", "lineDiscountTotal", "lineTotal", "couponAllocated", "pointAllocated", "payAmount",
  "status", "statusChangedAt", "statusChangedBy", "paidAt", "canceledAt", "createdAt")
SELECT i."colorName", i."discountAmount", i."id", i."imageUrl", i."listPrice", i."orderId", i."price", i."promotionId", i."promotionName", i."quantity", i."sizeName", i."skuCode", i."skuId", i."styleCode", i."styleName",
  ROW_NUMBER() OVER (PARTITION BY i."orderId" ORDER BY i."id"),
  i."listPrice" * i."quantity", i."discountAmount" * i."quantity", i."price" * i."quantity", 0, 0, i."price" * i."quantity",
  CASE WHEN o."status" = 'PAID' OR (o."status" = 'CANCEL_FAILED' AND o."paidAt" IS NOT NULL) THEN 'PAID' WHEN o."status" IN ('CANCELED', 'EXPIRED') THEN 'CANCELED' ELSE 'AWAITING_PAYMENT' END,
  o."statusChangedAt", 'SYSTEM',
  CASE WHEN o."status" = 'PAID' OR (o."status" = 'CANCEL_FAILED' AND o."paidAt" IS NOT NULL) THEN o."paidAt" END,
  CASE WHEN o."status" IN ('CANCELED', 'EXPIRED') THEN o."canceledAt" END,
  o."createdAt"
FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId";
-- 전환 시점 상태를 이력 첫 줄로
INSERT INTO "OrderStatusHistory" ("orderId", "fromStatus", "toStatus", "changedBy", "memo", "changedAt")
SELECT "id", NULL, "status", 'SYSTEM', '⑦ 주문 도메인 전환 시점 상태', "statusChangedAt" FROM "Order";
INSERT INTO "OrderItemStatusHistory" ("orderItemId", "fromStatus", "toStatus", "changedBy", "memo", "changedAt")
SELECT "id", NULL, "status", 'SYSTEM', '⑦ 주문 도메인 전환 시점 상태', "statusChangedAt" FROM "new_OrderItem";
DROP TABLE "OrderItem";
ALTER TABLE "new_OrderItem" RENAME TO "OrderItem";
CREATE INDEX "OrderItem_skuId_idx" ON "OrderItem"("skuId");
CREATE INDEX "OrderItem_status_autoConfirmAt_idx" ON "OrderItem"("status", "autoConfirmAt");
CREATE UNIQUE INDEX "OrderItem_orderId_lineNo_key" ON "OrderItem"("orderId", "lineNo");
CREATE UNIQUE INDEX "OrderItem_orderId_skuId_key" ON "OrderItem"("orderId", "skuId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "OrderShippingAddress_orderId_key" ON "OrderShippingAddress"("orderId");

-- CreateIndex
CREATE INDEX "OrderShippingAddress_sourceAddressId_idx" ON "OrderShippingAddress"("sourceAddressId");

-- CreateIndex
CREATE INDEX "OrderShippingAddress_phoneHash_idx" ON "OrderShippingAddress"("phoneHash");

-- CreateIndex
CREATE UNIQUE INDEX "OrderShippingAddressHistory_orderShippingAddressId_version_key" ON "OrderShippingAddressHistory"("orderShippingAddressId", "version");

-- CreateIndex
CREATE INDEX "OrderStatusHistory_orderId_id_idx" ON "OrderStatusHistory"("orderId", "id");

-- CreateIndex
CREATE INDEX "OrderItemStatusHistory_orderItemId_id_idx" ON "OrderItemStatusHistory"("orderItemId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingPolicy_code_key" ON "ShippingPolicy"("code");

-- CreateIndex
CREATE INDEX "ShippingPolicy_validFrom_idx" ON "ShippingPolicy"("validFrom");

-- CreateIndex
CREATE INDEX "ShippingSurchargeZone_policyId_zipFrom_idx" ON "ShippingSurchargeZone"("policyId", "zipFrom");

-- CreateIndex
CREATE UNIQUE INDEX "Courier_code_key" ON "Courier"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Courier_sortOrder_key" ON "Courier"("sortOrder");

-- CreateIndex
CREATE INDEX "Shipment_orderId_idx" ON "Shipment"("orderId");

-- CreateIndex
CREATE INDEX "Shipment_status_shippedAt_idx" ON "Shipment"("status", "shippedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_courierId_trackingNo_key" ON "Shipment"("courierId", "trackingNo");

-- CreateIndex
CREATE INDEX "ShipmentItem_orderItemId_idx" ON "ShipmentItem"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentItem_shipmentId_orderItemId_key" ON "ShipmentItem"("shipmentId", "orderItemId");

-- >>> db-constraints: 트리거 (prisma/db-constraints.ts에서 생성, 직접 수정 금지)

-- 예약 수량은 항상 RESERVED 예약 합계와 같아야 함
DROP TRIGGER IF EXISTS "InventoryBalance_reserved_guard";
CREATE TRIGGER "InventoryBalance_reserved_guard" BEFORE UPDATE OF "reserved" ON "InventoryBalance"
WHEN NEW."reserved" IS NOT (SELECT COALESCE(SUM(r."qty"), 0) FROM "InventoryReservation" r WHERE r."skuId" = NEW."skuId" AND r."locationId" = NEW."locationId" AND r."status" IN ('RESERVED', 'ALLOCATED'))
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
  WHEN EXISTS (SELECT 1 FROM "InventoryReservation" r WHERE r."orderId" = NEW."orderId" AND r."skuId" = NEW."skuId" AND r."status" IN ('RESERVED', 'ALLOCATED'))
    THEN RAISE(ABORT, 'InventoryReservation_reserve: 같은 주문에 이 SKU의 예약이 이미 있습니다')
  WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" i WHERE i."id" = NEW."orderItemId" AND i."orderId" = NEW."orderId" AND i."skuId" = NEW."skuId" AND i."quantity" = NEW."qty")
    THEN RAISE(ABORT, 'InventoryReservation_item_match: 예약의 주문·SKU·수량이 주문 상품 줄과 다릅니다')
  WHEN COALESCE((SELECT b."onHand" - b."reserved" - b."safetyStock" FROM "InventoryBalance" b WHERE b."skuId" = NEW."skuId" AND b."locationId" = NEW."locationId"), 0) < NEW."qty"
    THEN RAISE(ABORT, 'InventoryReservation_insufficient: 판매 가능 재고가 부족합니다')
END;
END;

-- 예약을 만들면 잔고의 예약 수량 자동 반영
DROP TRIGGER IF EXISTS "InventoryReservation_sync_ins";
CREATE TRIGGER "InventoryReservation_sync_ins" AFTER INSERT ON "InventoryReservation"
BEGIN
  UPDATE "InventoryBalance" SET "reserved" = (SELECT COALESCE(SUM(r."qty"), 0) FROM "InventoryReservation" r WHERE r."skuId" = NEW."skuId" AND r."locationId" = NEW."locationId" AND r."status" IN ('RESERVED', 'ALLOCATED')), "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now') WHERE "skuId" = NEW."skuId" AND "locationId" = NEW."locationId";
END;

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

-- 예약의 주문·상품 줄·SKU·위치·수량·만료 시각은 바꿀 수 없음 (바꾸려면 해제 후 새로 예약). 출고 상자는 한 번 정하면 고정
DROP TRIGGER IF EXISTS "InventoryReservation_immutable";
CREATE TRIGGER "InventoryReservation_immutable" BEFORE UPDATE OF "orderId", "orderItemId", "skuId", "locationId", "qty", "expiresAt", "createdAt", "shipmentId" ON "InventoryReservation"
WHEN NEW."orderId" IS NOT OLD."orderId" OR NEW."orderItemId" IS NOT OLD."orderItemId" OR NEW."skuId" IS NOT OLD."skuId" OR NEW."locationId" IS NOT OLD."locationId"
  OR NEW."qty" IS NOT OLD."qty" OR NEW."expiresAt" IS NOT OLD."expiresAt" OR NEW."createdAt" IS NOT OLD."createdAt"
  OR (OLD."shipmentId" IS NOT NULL AND NEW."shipmentId" IS NOT OLD."shipmentId")
BEGIN SELECT RAISE(ABORT, 'InventoryReservation_immutable: 예약 내용은 바꿀 수 없습니다. 해제 후 새로 예약하세요'); END;

-- 상태가 바뀌면 예약 수량을 다시 맞추고, 확정(CONFIRMED = 출고)이면 판매 원장(SALE)을 자동 생성 → 실재고 감소 (일어난 시각 = 출고 시각)
DROP TRIGGER IF EXISTS "InventoryReservation_sync_upd";
CREATE TRIGGER "InventoryReservation_sync_upd" AFTER UPDATE OF "status" ON "InventoryReservation"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
  UPDATE "InventoryBalance" SET "reserved" = (SELECT COALESCE(SUM(r."qty"), 0) FROM "InventoryReservation" r WHERE r."skuId" = NEW."skuId" AND r."locationId" = NEW."locationId" AND r."status" IN ('RESERVED', 'ALLOCATED')), "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now') WHERE "skuId" = NEW."skuId" AND "locationId" = NEW."locationId";
  INSERT INTO "InventoryLedger" ("skuId", "locationId", "type", "qty", "balanceAfter", "refType", "refId", "reservationId", "createdBy", "occurredAt", "createdAt")
  SELECT NEW."skuId", NEW."locationId", 'SALE', -NEW."qty", b."onHand" - NEW."qty", 'ORDER', CAST(NEW."orderId" AS TEXT), NEW."id", 'SYSTEM', NEW."confirmedAt", strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')
  FROM "InventoryBalance" b
  WHERE NEW."status" = 'CONFIRMED' AND b."skuId" = NEW."skuId" AND b."locationId" = NEW."locationId";
END;

-- 예약 기록 삭제 금지 (해제·만료 상태로 남김)
DROP TRIGGER IF EXISTS "InventoryReservation_no_delete";
CREATE TRIGGER "InventoryReservation_no_delete" BEFORE DELETE ON "InventoryReservation"
BEGIN SELECT RAISE(ABORT, 'InventoryReservation_no_delete: 예약 기록은 지울 수 없습니다. 해제(RELEASED)하세요'); END;

-- 결제 대기·출고 대기 예약이 남아 있는 위치를 판매 중지·비활성화하면 출고할 재고가 사라짐
DROP TRIGGER IF EXISTS "InventoryLocation_deactivate_guard";
CREATE TRIGGER "InventoryLocation_deactivate_guard" BEFORE UPDATE OF "isActive", "isOnlineSellable" ON "InventoryLocation"
WHEN (NEW."isActive" = 0 OR NEW."isOnlineSellable" = 0)
  AND EXISTS (SELECT 1 FROM "InventoryReservation" r WHERE r."locationId" = NEW."id" AND r."status" IN ('RESERVED', 'ALLOCATED'))
BEGIN SELECT RAISE(ABORT, 'InventoryLocation_deactivate_guard: 결제 대기·출고 대기 예약이 있는 위치는 판매 중지할 수 없습니다'); END;

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

-- 탈퇴·탈퇴 신청·정지·휴면 고객은 새 주문 금지
DROP TRIGGER IF EXISTS "Order_customer_active";
CREATE TRIGGER "Order_customer_active" BEFORE INSERT ON "Order"
WHEN (SELECT c."status" FROM "Customer" c WHERE c."id" = NEW."customerId") IS NOT 'ACTIVE'
BEGIN SELECT RAISE(ABORT, 'Order_customer_active: 정상(ACTIVE) 상태의 고객만 주문할 수 있습니다'); END;

-- 주문은 결제 대기(PENDING)·미결제 요약(UNPAID)·확정 전으로만 생성. 결제 완료는 결제(Payment)를 거쳐야 함
DROP TRIGGER IF EXISTS "Order_insert_pending";
CREATE TRIGGER "Order_insert_pending" BEFORE INSERT ON "Order"
WHEN NEW."status" IS NOT 'PENDING' OR NEW."fulfillmentStatus" IS NOT 'UNPAID' OR NEW."confirmedAt" IS NOT NULL OR NEW."piiPurgedAt" IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Order_insert_pending: 주문은 PENDING 상태로만 만들 수 있습니다'); END;

-- 결제 금액 비교 기준·토스 주문번호·금액 구성이 바뀌면 결제·환불 계산과 어긋남
DROP TRIGGER IF EXISTS "Order_total_fixed";
CREATE TRIGGER "Order_total_fixed" BEFORE UPDATE OF "totalPrice", "paymentOrderId", "customerId", "orderNo", "channel", "itemsListTotal", "itemsDiscountTotal", "itemsTotal", "couponDiscountTotal", "shippingBaseFee", "shippingExtraFee", "shippingFee", "shippingDiscount", "pointUsed", "shippingPolicyId", "freeShippingThreshold", "createdAt" ON "Order"
WHEN NEW."totalPrice" IS NOT OLD."totalPrice" OR NEW."paymentOrderId" IS NOT OLD."paymentOrderId" OR NEW."customerId" IS NOT OLD."customerId" OR NEW."orderNo" IS NOT OLD."orderNo" OR NEW."channel" IS NOT OLD."channel" OR NEW."itemsListTotal" IS NOT OLD."itemsListTotal" OR NEW."itemsDiscountTotal" IS NOT OLD."itemsDiscountTotal" OR NEW."itemsTotal" IS NOT OLD."itemsTotal" OR NEW."couponDiscountTotal" IS NOT OLD."couponDiscountTotal" OR NEW."shippingBaseFee" IS NOT OLD."shippingBaseFee" OR NEW."shippingExtraFee" IS NOT OLD."shippingExtraFee" OR NEW."shippingFee" IS NOT OLD."shippingFee" OR NEW."shippingDiscount" IS NOT OLD."shippingDiscount" OR NEW."pointUsed" IS NOT OLD."pointUsed" OR NEW."shippingPolicyId" IS NOT OLD."shippingPolicyId" OR NEW."freeShippingThreshold" IS NOT OLD."freeShippingThreshold" OR NEW."createdAt" IS NOT OLD."createdAt"
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

-- 주문 당시 기록·환불 기준이 바뀌면 안 됨
DROP TRIGGER IF EXISTS "OrderItem_immutable";
CREATE TRIGGER "OrderItem_immutable" BEFORE UPDATE OF "orderId", "lineNo", "skuId", "quantity", "listPrice", "discountAmount", "price", "promotionName", "lineListTotal", "lineDiscountTotal", "lineTotal", "couponAllocated", "pointAllocated", "payAmount", "styleCode", "skuCode", "styleName", "colorName", "sizeName", "imageUrl", "createdAt" ON "OrderItem"
WHEN NEW."orderId" IS NOT OLD."orderId" OR NEW."lineNo" IS NOT OLD."lineNo" OR NEW."skuId" IS NOT OLD."skuId" OR NEW."quantity" IS NOT OLD."quantity" OR NEW."listPrice" IS NOT OLD."listPrice" OR NEW."discountAmount" IS NOT OLD."discountAmount" OR NEW."price" IS NOT OLD."price" OR NEW."promotionName" IS NOT OLD."promotionName" OR NEW."lineListTotal" IS NOT OLD."lineListTotal" OR NEW."lineDiscountTotal" IS NOT OLD."lineDiscountTotal" OR NEW."lineTotal" IS NOT OLD."lineTotal" OR NEW."couponAllocated" IS NOT OLD."couponAllocated" OR NEW."pointAllocated" IS NOT OLD."pointAllocated" OR NEW."payAmount" IS NOT OLD."payAmount" OR NEW."styleCode" IS NOT OLD."styleCode" OR NEW."skuCode" IS NOT OLD."skuCode" OR NEW."styleName" IS NOT OLD."styleName" OR NEW."colorName" IS NOT OLD."colorName" OR NEW."sizeName" IS NOT OLD."sizeName" OR NEW."imageUrl" IS NOT OLD."imageUrl" OR NEW."createdAt" IS NOT OLD."createdAt"
BEGIN SELECT RAISE(ABORT, 'OrderItem_immutable: 주문 상품의 수량·가격·금액 배분·스냅샷은 바꿀 수 없습니다'); END;

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

-- 주문 상품 생성을 상태 이력 첫 줄로 자동 기록
DROP TRIGGER IF EXISTS "OrderItem_status_history_ins";
CREATE TRIGGER "OrderItem_status_history_ins" AFTER INSERT ON "OrderItem"
BEGIN
  INSERT INTO "OrderItemStatusHistory" ("orderItemId", "fromStatus", "toStatus", "changedBy", "memo", "changedAt") VALUES (NEW."id", NULL, NEW."status", NEW."statusChangedBy", NEW."statusMemo", NEW."statusChangedAt");
END;

-- 상품 상태가 바뀌면 이력 자동 기록
DROP TRIGGER IF EXISTS "OrderItem_status_history_upd";
CREATE TRIGGER "OrderItem_status_history_upd" AFTER UPDATE OF "status" ON "OrderItem"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
  INSERT INTO "OrderItemStatusHistory" ("orderItemId", "fromStatus", "toStatus", "changedBy", "memo", "changedAt") VALUES (NEW."id", OLD."status", NEW."status", NEW."statusChangedBy", NEW."statusMemo", NEW."statusChangedAt");
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

-- 주문 기록 보관
DROP TRIGGER IF EXISTS "OrderItem_no_delete";
CREATE TRIGGER "OrderItem_no_delete" BEFORE DELETE ON "OrderItem"
BEGIN SELECT RAISE(ABORT, 'OrderItem_no_delete: 주문 상품은 삭제할 수 없습니다'); END;

-- 이력은 수정 금지
DROP TRIGGER IF EXISTS "OrderStatusHistory_no_update";
CREATE TRIGGER "OrderStatusHistory_no_update" BEFORE UPDATE ON "OrderStatusHistory"
BEGIN SELECT RAISE(ABORT, 'OrderStatusHistory_append_only: 이력은 수정할 수 없습니다'); END;

-- 이력은 삭제 금지
DROP TRIGGER IF EXISTS "OrderStatusHistory_no_delete";
CREATE TRIGGER "OrderStatusHistory_no_delete" BEFORE DELETE ON "OrderStatusHistory"
BEGIN SELECT RAISE(ABORT, 'OrderStatusHistory_append_only: 이력은 삭제할 수 없습니다'); END;

-- 이력은 수정 금지
DROP TRIGGER IF EXISTS "OrderItemStatusHistory_no_update";
CREATE TRIGGER "OrderItemStatusHistory_no_update" BEFORE UPDATE ON "OrderItemStatusHistory"
BEGIN SELECT RAISE(ABORT, 'OrderItemStatusHistory_append_only: 이력은 수정할 수 없습니다'); END;

-- 이력은 삭제 금지
DROP TRIGGER IF EXISTS "OrderItemStatusHistory_no_delete";
CREATE TRIGGER "OrderItemStatusHistory_no_delete" BEFORE DELETE ON "OrderItemStatusHistory"
BEGIN SELECT RAISE(ABORT, 'OrderItemStatusHistory_append_only: 이력은 삭제할 수 없습니다'); END;

-- 결제를 시작하려면 배송지가 있어야 하고, 상품별 금액 합계가 주문 금액 구성과 맞아야 함 (돈이 오가기 전 마지막 검사)
DROP TRIGGER IF EXISTS "Payment_order_ready";
CREATE TRIGGER "Payment_order_ready" BEFORE INSERT ON "Payment"
WHEN NEW."status" = 'IN_PROGRESS'
BEGIN
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM "OrderShippingAddress" a WHERE a."orderId" = NEW."orderId" AND a."piiPurgedAt" IS NULL)
    THEN RAISE(ABORT, 'Payment_order_ready: 배송지가 없는 주문은 결제할 수 없습니다')
  WHEN EXISTS (SELECT 1 FROM "Order" o WHERE o."id" = NEW."orderId" AND (
      o."itemsListTotal" IS NOT (SELECT SUM(i."lineListTotal") FROM "OrderItem" i WHERE i."orderId" = o."id")
      OR o."itemsDiscountTotal" IS NOT (SELECT SUM(i."lineDiscountTotal") FROM "OrderItem" i WHERE i."orderId" = o."id")
      OR o."itemsTotal" IS NOT (SELECT SUM(i."lineTotal") FROM "OrderItem" i WHERE i."orderId" = o."id")
      OR o."couponDiscountTotal" IS NOT (SELECT SUM(i."couponAllocated") FROM "OrderItem" i WHERE i."orderId" = o."id")
      OR o."pointUsed" IS NOT (SELECT SUM(i."pointAllocated") FROM "OrderItem" i WHERE i."orderId" = o."id")))
    THEN RAISE(ABORT, 'Payment_order_ready: 상품별 금액 합계가 주문 금액과 다릅니다')
END;
END;

-- 고객은 상품 준비가 시작되면 직접 취소 불가, 출고된 상품이 있으면 전액 취소 불가(반품으로). 토스에서 이미 일어난 취소를 반영(PG_SYNC)하는 것은 사실 기록이라 막지 않음
DROP TRIGGER IF EXISTS "PaymentCancel_fulfillment_guard";
CREATE TRIGGER "PaymentCancel_fulfillment_guard" BEFORE INSERT ON "PaymentCancel"
WHEN NEW."reasonCode" <> 'PG_SYNC'
BEGIN
SELECT CASE
  WHEN NEW."requestedBy" = 'CUSTOMER' AND EXISTS (SELECT 1 FROM "OrderItem" i WHERE i."orderId" = (SELECT p."orderId" FROM "Payment" p WHERE p."id" = NEW."paymentId") AND i."status" IN ('PREPARING', 'SHIPPED', 'DELIVERED', 'CONFIRMED'))
    THEN RAISE(ABORT, 'PaymentCancel_customer_preparing: 상품 준비가 시작되어 직접 취소할 수 없습니다')
  WHEN EXISTS (SELECT 1 FROM "OrderItem" i WHERE i."orderId" = (SELECT p."orderId" FROM "Payment" p WHERE p."id" = NEW."paymentId") AND i."status" IN ('SHIPPED', 'DELIVERED', 'CONFIRMED'))
      AND NEW."cancelAmount" >= (SELECT p."balanceAmount" FROM "Payment" p WHERE p."id" = NEW."paymentId")
    THEN RAISE(ABORT, 'PaymentCancel_shipped: 출고된 상품이 있어 전액 취소할 수 없습니다 (반품으로 처리)')
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

-- 배송지를 바꾸면 바뀌기 전 주소를 이력에 자동 저장
DROP TRIGGER IF EXISTS "OrderShippingAddress_history";
CREATE TRIGGER "OrderShippingAddress_history" AFTER UPDATE OF "version" ON "OrderShippingAddress"
WHEN NEW."version" IS NOT OLD."version"
BEGIN
  INSERT INTO "OrderShippingAddressHistory" ("orderShippingAddressId", "version", "recipientEnc", "phoneEnc", "zipCode", "address1Enc", "address2Enc", "deliveryMemoEnc", "region", "changedBy", "changeReason", "changedAt")
  VALUES (OLD."id", OLD."version", OLD."recipientEnc", OLD."phoneEnc", OLD."zipCode", OLD."address1Enc", OLD."address2Enc", OLD."deliveryMemoEnc", OLD."region", NEW."changedBy", NEW."changeReason", NEW."updatedAt");
END;

-- 주문 기록 보관
DROP TRIGGER IF EXISTS "OrderShippingAddress_no_delete";
CREATE TRIGGER "OrderShippingAddress_no_delete" BEFORE DELETE ON "OrderShippingAddress"
BEGIN SELECT RAISE(ABORT, 'OrderShippingAddress_no_delete: 주문 배송지는 삭제할 수 없습니다 (파기는 암호문 비우기)'); END;

-- 배송지 이력은 수정 금지. 5년 뒤 개인정보 파기(암호문 비우기)만 가능
DROP TRIGGER IF EXISTS "OrderShippingAddressHistory_wipe_only";
CREATE TRIGGER "OrderShippingAddressHistory_wipe_only" BEFORE UPDATE ON "OrderShippingAddressHistory"
WHEN NEW."orderShippingAddressId" IS NOT OLD."orderShippingAddressId" OR NEW."version" IS NOT OLD."version" OR NEW."zipCode" IS NOT OLD."zipCode"
  OR NEW."region" IS NOT OLD."region" OR NEW."changedBy" IS NOT OLD."changedBy" OR NEW."changeReason" IS NOT OLD."changeReason" OR NEW."changedAt" IS NOT OLD."changedAt"
  OR (NEW."recipientEnc" IS NOT OLD."recipientEnc" AND NEW."recipientEnc" IS NOT NULL) OR (NEW."phoneEnc" IS NOT OLD."phoneEnc" AND NEW."phoneEnc" IS NOT NULL) OR (NEW."address1Enc" IS NOT OLD."address1Enc" AND NEW."address1Enc" IS NOT NULL) OR (NEW."address2Enc" IS NOT OLD."address2Enc" AND NEW."address2Enc" IS NOT NULL) OR (NEW."deliveryMemoEnc" IS NOT OLD."deliveryMemoEnc" AND NEW."deliveryMemoEnc" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'OrderShippingAddressHistory_wipe_only: 배송지 이력은 바꿀 수 없습니다 (개인정보 비우기만 가능)'); END;

-- 변경 기록 보관
DROP TRIGGER IF EXISTS "OrderShippingAddressHistory_no_delete";
CREATE TRIGGER "OrderShippingAddressHistory_no_delete" BEFORE DELETE ON "OrderShippingAddressHistory"
BEGIN SELECT RAISE(ABORT, 'OrderShippingAddressHistory_no_delete: 배송지 이력은 삭제할 수 없습니다'); END;

-- 배송비 규칙 기간이 겹치면 어느 규칙을 쓸지 모호함
DROP TRIGGER IF EXISTS "ShippingPolicy_no_overlap_ins";
CREATE TRIGGER "ShippingPolicy_no_overlap_ins" BEFORE INSERT ON "ShippingPolicy"
WHEN EXISTS (SELECT 1 FROM "ShippingPolicy" sp WHERE NEW."validFrom" < COALESCE(sp."validTo", '9999-12-31T23:59:59.999+00:00') AND sp."validFrom" < COALESCE(NEW."validTo", '9999-12-31T23:59:59.999+00:00'))
BEGIN SELECT RAISE(ABORT, 'ShippingPolicy_no_overlap: 적용 기간이 겹치는 배송비 규칙이 있습니다'); END;

-- 배송비 규칙 기간이 겹치면 어느 규칙을 쓸지 모호함
DROP TRIGGER IF EXISTS "ShippingPolicy_no_overlap_upd";
CREATE TRIGGER "ShippingPolicy_no_overlap_upd" BEFORE UPDATE OF "validFrom", "validTo" ON "ShippingPolicy"
WHEN EXISTS (SELECT 1 FROM "ShippingPolicy" sp WHERE sp."id" <> NEW."id" AND NEW."validFrom" < COALESCE(sp."validTo", '9999-12-31T23:59:59.999+00:00') AND sp."validFrom" < COALESCE(NEW."validTo", '9999-12-31T23:59:59.999+00:00'))
BEGIN SELECT RAISE(ABORT, 'ShippingPolicy_no_overlap: 적용 기간이 겹치는 배송비 규칙이 있습니다'); END;

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

-- 출고 상자의 주문·종류·창고는 바꿀 수 없고, 출고 뒤에는 택배사·송장도 고정
DROP TRIGGER IF EXISTS "Shipment_fixed";
CREATE TRIGGER "Shipment_fixed" BEFORE UPDATE ON "Shipment"
WHEN NEW."orderId" IS NOT OLD."orderId" OR NEW."type" IS NOT OLD."type" OR NEW."locationId" IS NOT OLD."locationId" OR NEW."createdAt" IS NOT OLD."createdAt" OR NEW."createdBy" IS NOT OLD."createdBy"
  OR (OLD."status" <> 'READY' AND (NEW."courierId" IS NOT OLD."courierId" OR NEW."trackingNo" IS NOT OLD."trackingNo"))
BEGIN SELECT RAISE(ABORT, 'Shipment_fixed: 출고 상자의 주문·창고는 바꿀 수 없고, 출고 후에는 송장도 바꿀 수 없습니다'); END;

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

-- 상자를 출고하면 안의 상품 = 배송중 + 재고 확정(판매 원장 → 실재고 감소), 배송 완료하면 상품 = 배송 완료 + 자동 구매확정 예정일
DROP TRIGGER IF EXISTS "Shipment_cascade";
CREATE TRIGGER "Shipment_cascade" AFTER UPDATE OF "status" ON "Shipment"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
  UPDATE "OrderItem" SET "status" = 'SHIPPED', "shippedAt" = NEW."shippedAt", "statusChangedAt" = NEW."statusChangedAt", "statusChangedBy" = (CASE WHEN NEW."createdBy" = 'SYSTEM' THEN 'SYSTEM' ELSE 'ADMIN' END), "statusMemo" = NULL
  WHERE NEW."status" = 'SHIPPED' AND "id" IN (SELECT si."orderItemId" FROM "ShipmentItem" si WHERE si."shipmentId" = NEW."id") AND "status" = 'PREPARING';
  UPDATE "InventoryReservation" SET "status" = 'CONFIRMED', "confirmedAt" = NEW."shippedAt", "shipmentId" = NEW."id"
  WHERE NEW."status" = 'SHIPPED' AND "orderItemId" IN (SELECT si."orderItemId" FROM "ShipmentItem" si WHERE si."shipmentId" = NEW."id") AND "status" = 'ALLOCATED';
  UPDATE "OrderItem" SET "status" = 'DELIVERED', "deliveredAt" = NEW."deliveredAt", "autoConfirmAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', NEW."deliveredAt", '+7 days'),
    "statusChangedAt" = NEW."statusChangedAt", "statusChangedBy" = (CASE WHEN NEW."createdBy" = 'SYSTEM' THEN 'SYSTEM' ELSE 'ADMIN' END), "statusMemo" = NULL
  WHERE NEW."status" = 'DELIVERED' AND "id" IN (SELECT si."orderItemId" FROM "ShipmentItem" si WHERE si."shipmentId" = NEW."id") AND "status" = 'SHIPPED';
END;

-- 출고 기록 보관
DROP TRIGGER IF EXISTS "Shipment_no_delete";
CREATE TRIGGER "Shipment_no_delete" BEFORE DELETE ON "Shipment"
BEGIN SELECT RAISE(ABORT, 'Shipment_no_delete: 출고 기록은 삭제할 수 없습니다 (송장 취소는 CANCELED)'); END;

-- 송장 등록 상태의 상자에만, 같은 주문의 준비중 상품을 수량 그대로, 한 상품 줄은 살아 있는 출고 상자 하나에만
DROP TRIGGER IF EXISTS "ShipmentItem_insert_guard";
CREATE TRIGGER "ShipmentItem_insert_guard" BEFORE INSERT ON "ShipmentItem"
BEGIN
SELECT CASE
  WHEN (SELECT s."status" FROM "Shipment" s WHERE s."id" = NEW."shipmentId") IS NOT 'READY'
    THEN RAISE(ABORT, 'ShipmentItem_insert_guard: 송장 등록 상태의 상자에만 담을 수 있습니다')
  WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" i JOIN "Shipment" s ON s."orderId" = i."orderId" WHERE i."id" = NEW."orderItemId" AND s."id" = NEW."shipmentId")
    THEN RAISE(ABORT, 'ShipmentItem_insert_guard: 다른 주문의 상품은 담을 수 없습니다')
  WHEN (SELECT i."status" FROM "OrderItem" i WHERE i."id" = NEW."orderItemId") IS NOT 'PREPARING'
    THEN RAISE(ABORT, 'ShipmentItem_insert_guard: 상품 준비중인 상품만 담을 수 있습니다')
  WHEN NEW."qty" IS NOT (SELECT i."quantity" FROM "OrderItem" i WHERE i."id" = NEW."orderItemId")
    THEN RAISE(ABORT, 'ShipmentItem_insert_guard: 상품 줄 수량 전체를 한 상자에 담습니다')
  WHEN EXISTS (SELECT 1 FROM "ShipmentItem" x JOIN "Shipment" s ON s."id" = x."shipmentId" WHERE x."orderItemId" = NEW."orderItemId" AND s."type" = 'OUTBOUND' AND s."status" <> 'CANCELED')
    THEN RAISE(ABORT, 'ShipmentItem_one_box: 이 상품은 이미 다른 출고 상자에 담겨 있습니다')
END;
END;

-- 상자에 담은 내용은 수정 금지 (잘못 담았으면 송장 취소 후 새 상자)
DROP TRIGGER IF EXISTS "ShipmentItem_no_update";
CREATE TRIGGER "ShipmentItem_no_update" BEFORE UPDATE ON "ShipmentItem"
BEGIN SELECT RAISE(ABORT, 'ShipmentItem_no_update: 상자에 담은 상품은 바꿀 수 없습니다. 송장을 취소하고 새로 등록하세요'); END;

-- 출고 기록 보관
DROP TRIGGER IF EXISTS "ShipmentItem_no_delete";
CREATE TRIGGER "ShipmentItem_no_delete" BEFORE DELETE ON "ShipmentItem"
BEGIN SELECT RAISE(ABORT, 'ShipmentItem_no_delete: 출고 상자 내용은 삭제할 수 없습니다'); END;

-- <<< db-constraints
