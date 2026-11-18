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
DROP TRIGGER IF EXISTS "InventoryReservation_sync_upd";
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
DROP TRIGGER IF EXISTS "OrderItemStatusHistory_no_update";
DROP TRIGGER IF EXISTS "OrderItemStatusHistory_no_delete";
DROP TRIGGER IF EXISTS "Order_link_guard";
DROP TRIGGER IF EXISTS "GuestOrderAccess_insert_guard";
DROP TRIGGER IF EXISTS "GuestOrderAccess_update_guard";
DROP TRIGGER IF EXISTS "GuestOrderSession_insert_guard";
DROP TRIGGER IF EXISTS "Payment_order_ready";
DROP TRIGGER IF EXISTS "PaymentCancel_fulfillment_guard";
DROP TRIGGER IF EXISTS "OrderShippingAddress_insert_guard";
DROP TRIGGER IF EXISTS "OrderShippingAddress_update_guard";
DROP TRIGGER IF EXISTS "ShippingPolicy_used_fixed";
DROP TRIGGER IF EXISTS "ShippingSurchargeZone_no_overlap_ins";
DROP TRIGGER IF EXISTS "ShippingSurchargeZone_used_fixed";
DROP TRIGGER IF EXISTS "ShippingSurchargeZone_no_delete";
DROP TRIGGER IF EXISTS "Shipment_insert_guard";
DROP TRIGGER IF EXISTS "Shipment_transition";
DROP TRIGGER IF EXISTS "Shipment_cascade";
DROP TRIGGER IF EXISTS "ShipmentItem_insert_guard";
DROP TRIGGER IF EXISTS "PurchaseOrder_insert_draft";
DROP TRIGGER IF EXISTS "PurchaseOrder_transition";
DROP TRIGGER IF EXISTS "PurchaseOrder_fixed";
DROP TRIGGER IF EXISTS "PurchaseOrder_no_delete";
DROP TRIGGER IF EXISTS "PurchaseOrderLine_insert_guard";
DROP TRIGGER IF EXISTS "PurchaseOrderLine_update_guard";
DROP TRIGGER IF EXISTS "PurchaseOrderLine_delete_guard";
DROP TRIGGER IF EXISTS "PurchaseOrderEvent_no_update";
DROP TRIGGER IF EXISTS "PurchaseOrderEvent_no_delete";
DROP TRIGGER IF EXISTS "InboundReceipt_insert_guard";
DROP TRIGGER IF EXISTS "InboundReceipt_no_update";
DROP TRIGGER IF EXISTS "InboundReceipt_no_delete";
DROP TRIGGER IF EXISTS "InboundReceiptLine_insert_guard";
DROP TRIGGER IF EXISTS "InboundReceiptLine_apply";
DROP TRIGGER IF EXISTS "InboundReceiptLine_no_update";
DROP TRIGGER IF EXISTS "InboundReceiptLine_no_delete";
DROP TRIGGER IF EXISTS "RestockSubscription_insert_guard";
DROP TRIGGER IF EXISTS "RestockSubscription_update_guard";
DROP TRIGGER IF EXISTS "RestockSubscription_no_delete";
DROP TRIGGER IF EXISTS "Notification_update_guard";
DROP TRIGGER IF EXISTS "Notification_no_delete";
DROP TRIGGER IF EXISTS "StockAlert_insert_guard";
DROP TRIGGER IF EXISTS "StockAlert_update_guard";
DROP TRIGGER IF EXISTS "StockAlert_no_delete";
DROP TRIGGER IF EXISTS "ReturnRequest_insert_guard";
DROP TRIGGER IF EXISTS "ReturnRequest_transition";
DROP TRIGGER IF EXISTS "ReturnRequest_fixed";
DROP TRIGGER IF EXISTS "ReturnRequest_no_delete";
DROP TRIGGER IF EXISTS "ReturnItem_insert_guard";
DROP TRIGGER IF EXISTS "ReturnItem_update_guard";
DROP TRIGGER IF EXISTS "ReturnItem_no_delete";
DROP TRIGGER IF EXISTS "InventoryLedger_return_guard";
-- <<< db-constraints-top

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "poNo" TEXT NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "orderedAt" DATETIME,
    "confirmedAt" DATETIME,
    "canceledAt" DATETIME,
    "statusChangedAt" DATETIME NOT NULL,
    "createdBy" TEXT NOT NULL,
    "memo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sizeGroupId" INTEGER,
    CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Manufacturer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrder_sizeGroupId_fkey" FOREIGN KEY ("sizeGroupId") REFERENCES "SizeGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrder_status_enum_ck" CHECK ("status" IN ('DRAFT', 'ORDERED', 'CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELED')),
    CONSTRAINT "PurchaseOrder_values_ck" CHECK ("poNo" GLOB 'PO-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9]*' AND trim("createdBy") <> '' AND ("memo" IS NULL OR (trim("memo") <> '' AND length("memo") <= 500)) AND ("orderedAt" IS NULL OR "orderedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("confirmedAt" IS NULL OR "confirmedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("canceledAt" IS NULL OR "canceledAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("statusChangedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("updatedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*')),
    CONSTRAINT "PurchaseOrder_state_ck" CHECK (("status" = 'DRAFT' AND "orderedAt" IS NULL AND "confirmedAt" IS NULL AND "canceledAt" IS NULL)
      OR ("status" = 'ORDERED' AND "orderedAt" IS NOT NULL AND "confirmedAt" IS NULL AND "canceledAt" IS NULL)
      OR ("status" IN ('CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED') AND "orderedAt" IS NOT NULL AND "canceledAt" IS NULL)
      OR ("status" = 'CANCELED' AND "canceledAt" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "purchaseOrderId" INTEGER NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "skuId" INTEGER NOT NULL,
    "qtyOrdered" INTEGER NOT NULL,
    "qtyReceived" INTEGER NOT NULL DEFAULT 0,
    "expectedAt" DATETIME,
    "unitCost" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrderLine_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrderLine_qty_ck" CHECK ((typeof("lineNo") = 'integer' AND "lineNo" >= 1) AND (typeof("qtyOrdered") = 'integer' AND "qtyOrdered" >= 1) AND (typeof("qtyReceived") = 'integer' AND "qtyReceived" >= 0) AND "qtyReceived" <= "qtyOrdered" AND ("unitCost" IS NULL OR (typeof("unitCost") = 'integer' AND "unitCost" >= 0)) AND ("expectedAt" IS NULL OR "expectedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("updatedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- CreateTable
CREATE TABLE "PurchaseOrderEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "purchaseOrderId" INTEGER NOT NULL,
    "lineId" INTEGER,
    "type" TEXT NOT NULL,
    "fromDate" DATETIME,
    "toDate" DATETIME,
    "memo" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "PurchaseOrderEvent_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrderEvent_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "PurchaseOrderLine" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrderEvent_type_enum_ck" CHECK ("type" IN ('CREATED', 'ORDERED', 'CONFIRMED', 'DATE_CHANGED', 'RECEIVED', 'CANCELED')),
    CONSTRAINT "PurchaseOrderEvent_ck" CHECK (trim("createdBy") <> '' AND ("memo" IS NULL OR (trim("memo") <> '' AND length("memo") <= 500)) AND ("fromDate" IS NULL OR "fromDate" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("toDate" IS NULL OR "toDate" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("type" <> 'DATE_CHANGED' OR ("lineId" IS NOT NULL AND "toDate" IS NOT NULL)))
);

-- CreateTable
CREATE TABLE "InboundReceipt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "receiptNo" TEXT NOT NULL,
    "purchaseOrderId" INTEGER,
    "locationId" INTEGER NOT NULL,
    "receivedAt" DATETIME NOT NULL,
    "createdBy" TEXT NOT NULL,
    "memo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InboundReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InboundReceipt_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InboundReceipt_values_ck" CHECK ("receiptNo" GLOB 'IN-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9]*' AND trim("createdBy") <> '' AND ("memo" IS NULL OR (trim("memo") <> '' AND length("memo") <= 500)) AND ("receivedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- CreateTable
CREATE TABLE "InboundReceiptLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "receiptId" INTEGER NOT NULL,
    "purchaseOrderLineId" INTEGER,
    "skuId" INTEGER NOT NULL,
    "qtyGood" INTEGER NOT NULL,
    "qtyDefect" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "InboundReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "InboundReceipt" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InboundReceiptLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InboundReceiptLine_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InboundReceiptLine_qty_ck" CHECK ((typeof("qtyGood") = 'integer' AND "qtyGood" >= 0) AND (typeof("qtyDefect") = 'integer' AND "qtyDefect" >= 0) AND "qtyGood" + "qtyDefect" >= 1)
);

-- CreateTable
CREATE TABLE "RestockSubscription" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER NOT NULL,
    "skuId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "notifiedExpectedAt" DATETIME,
    "scheduledAt" DATETIME,
    "arrivedAt" DATETIME,
    "closedAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RestockSubscription_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RestockSubscription_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RestockSubscription_status_enum_ck" CHECK ("status" IN ('WAITING', 'SCHEDULED', 'ARRIVED', 'PURCHASED', 'CANCELED', 'EXPIRED')),
    CONSTRAINT "RestockSubscription_state_ck" CHECK ("expiresAt" > "createdAt" AND ("notifiedExpectedAt" IS NULL OR "notifiedExpectedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("scheduledAt" IS NULL OR "scheduledAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("arrivedAt" IS NULL OR "arrivedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("closedAt" IS NULL OR "closedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("expiresAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("updatedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*')
      AND (("status" IN ('WAITING', 'SCHEDULED')) = ("closedAt" IS NULL))
      AND ("status" <> 'SCHEDULED' OR ("notifiedExpectedAt" IS NOT NULL AND "scheduledAt" IS NOT NULL))
      AND ("status" NOT IN ('ARRIVED', 'PURCHASED') OR "arrivedAt" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "Notification" (
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
    CONSTRAINT "Notification_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Notification_type_enum_ck" CHECK ("type" IN ('RESTOCK_SCHEDULED', 'RESTOCK_RESCHEDULED', 'RESTOCK_CANCELED', 'RESTOCK_ARRIVED', 'RETURN_UPDATE', 'REORDER_NEEDED')),
    CONSTRAINT "Notification_channel_enum_ck" CHECK ("channel" IN ('IN_APP', 'EMAIL', 'KAKAO')),
    CONSTRAINT "Notification_status_enum_ck" CHECK ("status" IN ('PENDING', 'SENT', 'FAILED')),
    CONSTRAINT "Notification_values_ck" CHECK ("audience" IN ('CUSTOMER', 'ADMIN') AND ("audience" = 'CUSTOMER') = ("customerId" IS NOT NULL) AND trim("title") <> '' AND length("title") <= 100 AND trim("body") <> '' AND length("body") <= 1000
      AND ("linkUrl" IS NULL OR ("linkUrl" GLOB '/*' AND "linkUrl" NOT GLOB '//*')) AND length("dedupKey") BETWEEN 3 AND 200 AND (typeof("attempts") = 'integer' AND "attempts" >= 0)
      AND ("status" <> 'SENT' OR "sentAt" IS NOT NULL) AND ("channel" <> 'IN_APP' OR "status" = 'SENT') AND ("sentAt" IS NULL OR "sentAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("readAt" IS NULL OR "readAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- CreateTable
CREATE TABLE "StockAlert" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "skuId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "availableAtOpen" INTEGER NOT NULL,
    "reorderPoint" INTEGER NOT NULL,
    "openedAt" DATETIME NOT NULL,
    "resolvedAt" DATETIME,
    "resolution" TEXT,
    CONSTRAINT "StockAlert_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockAlert_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockAlert_status_enum_ck" CHECK ("status" IN ('OPEN', 'RESOLVED')),
    CONSTRAINT "StockAlert_resolution_enum_ck" CHECK ("resolution" IN ('RESTOCKED', 'PURCHASE_ORDERED', 'THRESHOLD_CHANGED')),
    CONSTRAINT "StockAlert_state_ck" CHECK ((typeof("availableAtOpen") = 'integer' AND "availableAtOpen" >= 0) AND (typeof("reorderPoint") = 'integer' AND "reorderPoint" >= 1) AND ("openedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("resolvedAt" IS NULL OR "resolvedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*')
      AND (("status" = 'OPEN') = ("resolvedAt" IS NULL)) AND (("status" = 'OPEN') = ("resolution" IS NULL)))
);

-- CreateTable
CREATE TABLE "ReturnRequest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "returnNo" TEXT NOT NULL,
    "orderId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "reasonText" TEXT,
    "fault" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "returnShippingFee" INTEGER NOT NULL DEFAULT 0,
    "refundAmount" INTEGER,
    "refundAccountId" INTEGER,
    "paymentCancelId" INTEGER,
    "pickupCourierId" INTEGER,
    "pickupTrackingNo" TEXT,
    "statusChangedAt" DATETIME NOT NULL,
    "requestedAt" DATETIME NOT NULL,
    "approvedAt" DATETIME,
    "collectingAt" DATETIME,
    "receivedAt" DATETIME,
    "inspectedAt" DATETIME,
    "completedAt" DATETIME,
    "closedAt" DATETIME,
    "memo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReturnRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReturnRequest_refundAccountId_fkey" FOREIGN KEY ("refundAccountId") REFERENCES "PaymentRefundAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReturnRequest_paymentCancelId_fkey" FOREIGN KEY ("paymentCancelId") REFERENCES "PaymentCancel" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReturnRequest_pickupCourierId_fkey" FOREIGN KEY ("pickupCourierId") REFERENCES "Courier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReturnRequest_status_enum_ck" CHECK ("status" IN ('REQUESTED', 'APPROVED', 'COLLECTING', 'RECEIVED', 'INSPECTED', 'COMPLETED', 'REJECTED', 'CANCELED')),
    CONSTRAINT "ReturnRequest_reason_enum_ck" CHECK ("reason" IN ('CHANGE_OF_MIND', 'SIZE', 'DEFECT', 'WRONG_ITEM', 'DAMAGED')),
    CONSTRAINT "ReturnRequest_fault_enum_ck" CHECK ("fault" IN ('CUSTOMER', 'SELLER')),
    CONSTRAINT "ReturnRequest_values_ck" CHECK ("returnNo" GLOB 'R[0-9]*-[0-9]*-[0-9]*' AND "requestedBy" IN ('CUSTOMER', 'ADMIN') AND ("reasonText" IS NULL OR (trim("reasonText") <> '' AND length("reasonText") <= 500)) AND ("memo" IS NULL OR (trim("memo") <> '' AND length("memo") <= 500))
      AND (typeof("returnShippingFee") = 'integer' AND "returnShippingFee" >= 0) AND ("refundAmount" IS NULL OR (typeof("refundAmount") = 'integer' AND "refundAmount" >= 0))
      AND ("fault" = CASE WHEN "reason" IN ('CHANGE_OF_MIND', 'SIZE') THEN 'CUSTOMER' ELSE 'SELLER' END)
      AND ("fault" = 'CUSTOMER' OR "returnShippingFee" = 0)
      AND ("pickupTrackingNo" IS NULL OR (length("pickupTrackingNo") BETWEEN 6 AND 30 AND "pickupTrackingNo" NOT GLOB '*[^0-9]*'))
      AND ("pickupCourierId" IS NULL) = ("pickupTrackingNo" IS NULL)),
    CONSTRAINT "ReturnRequest_state_ck" CHECK (("statusChangedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("requestedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("approvedAt" IS NULL OR "approvedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("collectingAt" IS NULL OR "collectingAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("receivedAt" IS NULL OR "receivedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("inspectedAt" IS NULL OR "inspectedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("completedAt" IS NULL OR "completedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("closedAt" IS NULL OR "closedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("updatedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*')
      AND ("status" NOT IN ('APPROVED', 'COLLECTING', 'RECEIVED', 'INSPECTED', 'COMPLETED') OR "approvedAt" IS NOT NULL)
      AND ("status" NOT IN ('COLLECTING', 'RECEIVED', 'INSPECTED', 'COMPLETED') OR ("collectingAt" IS NOT NULL AND "pickupTrackingNo" IS NOT NULL))
      AND ("status" NOT IN ('RECEIVED', 'INSPECTED', 'COMPLETED') OR "receivedAt" IS NOT NULL)
      AND ("status" NOT IN ('INSPECTED', 'COMPLETED') OR ("inspectedAt" IS NOT NULL AND "refundAmount" IS NOT NULL))
      AND (("status" = 'COMPLETED') = ("completedAt" IS NOT NULL))
      AND (("status" IN ('REJECTED', 'CANCELED')) = ("closedAt" IS NOT NULL))
      AND ("status" <> 'COMPLETED' OR "refundAmount" = 0 OR "paymentCancelId" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "ReturnItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "returnRequestId" INTEGER NOT NULL,
    "orderItemId" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "inspection" TEXT,
    "inspectedAt" DATETIME,
    "inspectionMemo" TEXT,
    "refundAmount" INTEGER,
    CONSTRAINT "ReturnItem_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReturnItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReturnItem_inspection_enum_ck" CHECK ("inspection" IN ('RESELLABLE', 'DEFECTIVE', 'NOT_RETURNABLE')),
    CONSTRAINT "ReturnItem_values_ck" CHECK ((typeof("qty") = 'integer' AND "qty" >= 1) AND ("refundAmount" IS NULL OR (typeof("refundAmount") = 'integer' AND "refundAmount" >= 0)) AND ("inspectionMemo" IS NULL OR (trim("inspectionMemo") <> '' AND length("inspectionMemo") <= 500)) AND ("inspectedAt" IS NULL OR "inspectedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*')
      AND ("inspection" IS NULL) = ("inspectedAt" IS NULL) AND ("inspection" IS NULL) = ("refundAmount" IS NULL)
      AND ("inspection" IS NOT 'NOT_RETURNABLE' OR "refundAmount" = 0))
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
-- Order: 새 컬럼 + 상태 값 목록(enum CHECK)을 새로 만들기 위해 테이블을 다시 만듦 (ALTER ADD COLUMN은 옛 CHECK를 그대로 둠)
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
    "returnedAt" DATETIME,
    CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_shippingPolicyId_fkey" FOREIGN KEY ("shippingPolicyId") REFERENCES "ShippingPolicy" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
,
    CONSTRAINT "Order_ordererType_enum_ck" CHECK ("ordererType" IN ('MEMBER', 'GUEST')),
    CONSTRAINT "Order_channel_enum_ck" CHECK ("channel" IN ('WEB', 'MOBILE_WEB')),
    CONSTRAINT "Order_status_enum_ck" CHECK ("status" IN ('PENDING', 'WAITING_DEPOSIT', 'PAID', 'CANCELED', 'EXPIRED', 'CANCEL_FAILED')),
    CONSTRAINT "Order_statusChangedBy_enum_ck" CHECK ("statusChangedBy" IN ('CUSTOMER', 'ADMIN', 'SYSTEM')),
    CONSTRAINT "Order_fulfillmentStatus_enum_ck" CHECK ("fulfillmentStatus" IN ('UNPAID', 'PAID', 'PREPARING', 'PARTIALLY_SHIPPED', 'SHIPPED', 'DELIVERED', 'CONFIRMED', 'CANCELED', 'RETURNED')),
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
    CONSTRAINT "Order_returned_date_ck" CHECK ("returnedAt" IS NULL OR "returnedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'),
    CONSTRAINT "Order_confirmed_ck" CHECK (("fulfillmentStatus" = 'CONFIRMED') = ("confirmedAt" IS NOT NULL)),
    CONSTRAINT "Order_orderer_type_ck" CHECK (("ordererType" = 'MEMBER' AND "customerId" IS NOT NULL AND "linkedAt" IS NULL) OR ("ordererType" = 'GUEST' AND ("customerId" IS NULL) = ("linkedAt" IS NULL))),
    CONSTRAINT "Order_guest_benefit_ck" CHECK ("ordererType" <> 'GUEST' OR ("couponDiscountTotal" = 0 AND "pointUsed" = 0 AND "shippingDiscount" = 0)),
    CONSTRAINT "Order_guest_orderer_ck" CHECK ("ordererType" <> 'GUEST' OR "piiPurgedAt" IS NOT NULL OR ("ordererNameEnc" IS NOT NULL AND "ordererPhoneEnc" IS NOT NULL AND "ordererPhoneHash" IS NOT NULL AND "ordererEmailEnc" IS NOT NULL)),
    CONSTRAINT "Order_linked_date_ck" CHECK (("linkedAt" IS NULL OR "linkedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("linkedAt" IS NULL OR "linkedAt" >= "createdAt"))
);
INSERT INTO "new_Order" ("id", "orderNo", "paymentOrderId", "orderName", "customerId", "ordererType", "linkedAt", "channel", "status", "statusChangedAt", "statusChangedBy", "statusMemo", "fulfillmentStatus", "itemsListTotal", "itemsDiscountTotal", "itemsTotal", "couponDiscountTotal", "shippingBaseFee", "shippingExtraFee", "shippingFee", "shippingDiscount", "pointUsed", "totalPrice", "shippingPolicyId", "freeShippingThreshold", "ordererNameEnc", "ordererPhoneEnc", "ordererPhoneHash", "ordererEmailEnc", "paidAt", "canceledAt", "confirmedAt", "piiPurgedAt", "createdAt", "updatedAt") SELECT "id", "orderNo", "paymentOrderId", "orderName", "customerId", "ordererType", "linkedAt", "channel", "status", "statusChangedAt", "statusChangedBy", "statusMemo", "fulfillmentStatus", "itemsListTotal", "itemsDiscountTotal", "itemsTotal", "couponDiscountTotal", "shippingBaseFee", "shippingExtraFee", "shippingFee", "shippingDiscount", "pointUsed", "totalPrice", "shippingPolicyId", "freeShippingThreshold", "ordererNameEnc", "ordererPhoneEnc", "ordererPhoneHash", "ordererEmailEnc", "paidAt", "canceledAt", "confirmedAt", "piiPurgedAt", "createdAt", "updatedAt" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_orderNo_key" ON "Order"("orderNo");
CREATE UNIQUE INDEX "Order_paymentOrderId_key" ON "Order"("paymentOrderId");
CREATE INDEX "Order_customerId_createdAt_idx" ON "Order"("customerId", "createdAt");
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");
CREATE INDEX "Order_fulfillmentStatus_createdAt_idx" ON "Order"("fulfillmentStatus", "createdAt");
CREATE INDEX "Order_ordererPhoneHash_idx" ON "Order"("ordererPhoneHash");
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");
-- OrderItem: 새 컬럼 + 상태 값 목록(enum CHECK)을 새로 만들기 위해 테이블을 다시 만듦 (ALTER ADD COLUMN은 옛 CHECK를 그대로 둠)
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
    "returnedAt" DATETIME,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "PricePromotion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
,
    CONSTRAINT "OrderItem_status_enum_ck" CHECK ("status" IN ('AWAITING_PAYMENT', 'PAID', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CONFIRMED', 'CANCELED', 'RETURN_REQUESTED', 'RETURN_COLLECTING', 'RETURNED')),
    CONSTRAINT "OrderItem_statusChangedBy_enum_ck" CHECK ("statusChangedBy" IN ('CUSTOMER', 'ADMIN', 'SYSTEM')),
    CONSTRAINT "OrderItem_confirmType_enum_ck" CHECK ("confirmType" IN ('MANUAL', 'AUTO')),
    CONSTRAINT "OrderItem_quantity_ck" CHECK (typeof("quantity") = 'integer' AND "quantity" >= 1),
    CONSTRAINT "OrderItem_amounts_ck" CHECK (typeof("listPrice") = 'integer' AND "listPrice" >= 0 AND typeof("discountAmount") = 'integer' AND "discountAmount" >= 0 AND typeof("price") = 'integer' AND "price" >= 0),
    CONSTRAINT "OrderItem_price_math_ck" CHECK ("price" = "listPrice" - "discountAmount"),
    CONSTRAINT "OrderItem_promotion_ck" CHECK ("discountAmount" = 0 OR "promotionName" IS NOT NULL),
    CONSTRAINT "OrderItem_line_no_ck" CHECK (typeof("lineNo") = 'integer' AND "lineNo" >= 1),
    CONSTRAINT "OrderItem_line_math_ck" CHECK ((typeof("lineListTotal") = 'integer' AND "lineListTotal" >= 0) AND (typeof("lineDiscountTotal") = 'integer' AND "lineDiscountTotal" >= 0) AND (typeof("lineTotal") = 'integer' AND "lineTotal" >= 0) AND (typeof("couponAllocated") = 'integer' AND "couponAllocated" >= 0) AND (typeof("pointAllocated") = 'integer' AND "pointAllocated" >= 0) AND (typeof("payAmount") = 'integer' AND "payAmount" >= 0) AND "lineListTotal" = "listPrice" * "quantity" AND "lineDiscountTotal" = "discountAmount" * "quantity" AND "lineTotal" = "price" * "quantity" AND "payAmount" = "lineTotal" - "couponAllocated" - "pointAllocated"),
    CONSTRAINT "OrderItem_state_ck" CHECK ((("status" = 'AWAITING_PAYMENT' AND "paidAt" IS NULL AND "preparingAt" IS NULL AND "shippedAt" IS NULL AND "deliveredAt" IS NULL AND "confirmedAt" IS NULL AND "canceledAt" IS NULL) OR ("status" = 'PAID' AND "paidAt" IS NOT NULL AND "preparingAt" IS NULL AND "shippedAt" IS NULL AND "deliveredAt" IS NULL AND "confirmedAt" IS NULL AND "canceledAt" IS NULL) OR ("status" = 'PREPARING' AND "paidAt" IS NOT NULL AND "preparingAt" IS NOT NULL AND "shippedAt" IS NULL AND "deliveredAt" IS NULL AND "confirmedAt" IS NULL AND "canceledAt" IS NULL) OR ("status" = 'SHIPPED' AND "paidAt" IS NOT NULL AND "preparingAt" IS NOT NULL AND "shippedAt" IS NOT NULL AND "deliveredAt" IS NULL AND "confirmedAt" IS NULL AND "canceledAt" IS NULL) OR ("status" = 'DELIVERED' AND "paidAt" IS NOT NULL AND "preparingAt" IS NOT NULL AND "shippedAt" IS NOT NULL AND "deliveredAt" IS NOT NULL AND "confirmedAt" IS NULL AND "canceledAt" IS NULL) OR ("status" = 'CONFIRMED' AND "paidAt" IS NOT NULL AND "preparingAt" IS NOT NULL AND "shippedAt" IS NOT NULL AND "confirmedAt" IS NOT NULL AND "canceledAt" IS NULL) OR ("status" = 'CANCELED' AND "shippedAt" IS NULL AND "deliveredAt" IS NULL AND "confirmedAt" IS NULL AND "canceledAt" IS NOT NULL) OR ("status" IN ('RETURN_REQUESTED', 'RETURN_COLLECTING') AND "paidAt" IS NOT NULL AND "shippedAt" IS NOT NULL AND "deliveredAt" IS NOT NULL AND "confirmedAt" IS NULL AND "canceledAt" IS NULL) OR ("status" = 'RETURNED' AND "deliveredAt" IS NOT NULL AND "confirmedAt" IS NULL AND "canceledAt" IS NULL)) AND (("status" = 'CONFIRMED') = ("confirmType" IS NOT NULL)) AND ("autoConfirmAt" IS NULL OR "status" IN ('DELIVERED', 'CONFIRMED', 'RETURN_REQUESTED', 'RETURN_COLLECTING', 'RETURNED')) AND ("status" <> 'DELIVERED' OR "autoConfirmAt" IS NOT NULL) AND (("status" = 'RETURNED') = ("returnedAt" IS NOT NULL))),
    CONSTRAINT "OrderItem_dates_ck" CHECK (("statusMemo" IS NULL OR (trim("statusMemo") <> '' AND length("statusMemo") <= 200)) AND ("statusChangedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("paidAt" IS NULL OR "paidAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("preparingAt" IS NULL OR "preparingAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("shippedAt" IS NULL OR "shippedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("deliveredAt" IS NULL OR "deliveredAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("confirmedAt" IS NULL OR "confirmedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("canceledAt" IS NULL OR "canceledAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("autoConfirmAt" IS NULL OR "autoConfirmAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("returnedAt" IS NULL OR "returnedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);
INSERT INTO "new_OrderItem" ("id", "orderId", "lineNo", "skuId", "quantity", "listPrice", "discountAmount", "price", "promotionId", "promotionName", "lineListTotal", "lineDiscountTotal", "lineTotal", "couponAllocated", "pointAllocated", "payAmount", "styleCode", "skuCode", "styleName", "colorName", "sizeName", "imageUrl", "status", "statusChangedAt", "statusChangedBy", "statusMemo", "paidAt", "preparingAt", "shippedAt", "deliveredAt", "confirmedAt", "canceledAt", "confirmType", "autoConfirmAt", "createdAt") SELECT "id", "orderId", "lineNo", "skuId", "quantity", "listPrice", "discountAmount", "price", "promotionId", "promotionName", "lineListTotal", "lineDiscountTotal", "lineTotal", "couponAllocated", "pointAllocated", "payAmount", "styleCode", "skuCode", "styleName", "colorName", "sizeName", "imageUrl", "status", "statusChangedAt", "statusChangedBy", "statusMemo", "paidAt", "preparingAt", "shippedAt", "deliveredAt", "confirmedAt", "canceledAt", "confirmType", "autoConfirmAt", "createdAt" FROM "OrderItem";
DROP TABLE "OrderItem";
ALTER TABLE "new_OrderItem" RENAME TO "OrderItem";
CREATE INDEX "OrderItem_skuId_idx" ON "OrderItem"("skuId");
CREATE INDEX "OrderItem_status_autoConfirmAt_idx" ON "OrderItem"("status", "autoConfirmAt");
CREATE UNIQUE INDEX "OrderItem_orderId_lineNo_key" ON "OrderItem"("orderId", "lineNo");
CREATE UNIQUE INDEX "OrderItem_orderId_skuId_key" ON "OrderItem"("orderId", "skuId");
-- OrderItemStatusHistory: 새 컬럼 + 상태 값 목록(enum CHECK)을 새로 만들기 위해 테이블을 다시 만듦 (ALTER ADD COLUMN은 옛 CHECK를 그대로 둠)
CREATE TABLE "new_OrderItemStatusHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderItemId" INTEGER NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "memo" TEXT,
    "changedAt" DATETIME NOT NULL,
    CONSTRAINT "OrderItemStatusHistory_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
,
    CONSTRAINT "OrderItemStatusHistory_fromStatus_enum_ck" CHECK ("fromStatus" IN ('AWAITING_PAYMENT', 'PAID', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CONFIRMED', 'CANCELED', 'RETURN_REQUESTED', 'RETURN_COLLECTING', 'RETURNED')),
    CONSTRAINT "OrderItemStatusHistory_toStatus_enum_ck" CHECK ("toStatus" IN ('AWAITING_PAYMENT', 'PAID', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CONFIRMED', 'CANCELED', 'RETURN_REQUESTED', 'RETURN_COLLECTING', 'RETURNED')),
    CONSTRAINT "OrderItemStatusHistory_changedBy_enum_ck" CHECK ("changedBy" IN ('CUSTOMER', 'ADMIN', 'SYSTEM')),
    CONSTRAINT "OrderItemStatusHistory_ck" CHECK (("fromStatus" IS NULL OR "fromStatus" <> "toStatus") AND ("memo" IS NULL OR (trim("memo") <> '' AND length("memo") <= 200)) AND ("changedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);
INSERT INTO "new_OrderItemStatusHistory" ("id", "orderItemId", "fromStatus", "toStatus", "changedBy", "memo", "changedAt") SELECT "id", "orderItemId", "fromStatus", "toStatus", "changedBy", "memo", "changedAt" FROM "OrderItemStatusHistory";
DROP TABLE "OrderItemStatusHistory";
ALTER TABLE "new_OrderItemStatusHistory" RENAME TO "OrderItemStatusHistory";
CREATE INDEX "OrderItemStatusHistory_orderItemId_id_idx" ON "OrderItemStatusHistory"("orderItemId", "id");
CREATE TABLE "new_InventoryBalance" (
    "skuId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "safetyStock" INTEGER NOT NULL DEFAULT 0,
    "lastCountedAt" DATETIME,
    "reorderPoint" INTEGER NOT NULL DEFAULT 0,
    "reorderQty" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("skuId", "locationId"),
    CONSTRAINT "InventoryBalance_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryBalance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryBalance_qty_ck" CHECK (typeof("onHand") = 'integer' AND "onHand" >= 0 AND typeof("reserved") = 'integer' AND "reserved" >= 0 AND typeof("safetyStock") = 'integer' AND "safetyStock" >= 0),
    CONSTRAINT "InventoryBalance_reserved_ck" CHECK ("reserved" <= "onHand"),
    CONSTRAINT "InventoryBalance_reorder_ck" CHECK (typeof("reorderPoint") = 'integer' AND "reorderPoint" >= 0 AND typeof("reorderQty") = 'integer' AND "reorderQty" >= 0),
    CONSTRAINT "InventoryBalance_dates_ck" CHECK (("updatedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("lastCountedAt" IS NULL OR "lastCountedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);
INSERT INTO "new_InventoryBalance" ("createdAt", "lastCountedAt", "locationId", "onHand", "reserved", "safetyStock", "skuId", "updatedAt") SELECT "createdAt", "lastCountedAt", "locationId", "onHand", "reserved", "safetyStock", "skuId", "updatedAt" FROM "InventoryBalance";
DROP TABLE "InventoryBalance";
ALTER TABLE "new_InventoryBalance" RENAME TO "InventoryBalance";
CREATE INDEX "InventoryBalance_locationId_idx" ON "InventoryBalance"("locationId");
CREATE TABLE "new_InventoryLedger" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "skuId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" TEXT,
    "reservationId" INTEGER,
    "inboundLineId" INTEGER,
    "returnItemId" INTEGER,
    "reason" TEXT,
    "memo" TEXT,
    "createdBy" TEXT,
    "occurredAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryLedger_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryLedger_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryLedger_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "InventoryReservation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryLedger_inboundLineId_fkey" FOREIGN KEY ("inboundLineId") REFERENCES "InboundReceiptLine" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryLedger_returnItemId_fkey" FOREIGN KEY ("returnItemId") REFERENCES "ReturnItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryLedger_type_enum_ck" CHECK ("type" IN ('INITIAL', 'INBOUND', 'RETURN_IN', 'ADJUST_IN', 'TRANSFER_IN', 'SALE', 'ADJUST_OUT', 'DEFECT_OUT', 'TRANSFER_OUT', 'RETURN_REJECT_OUT')),
    CONSTRAINT "InventoryLedger_refType_enum_ck" CHECK ("refType" IN ('ORDER', 'RETURN', 'INBOUND_ORDER', 'STOCK_COUNT', 'TRANSFER', 'MANUAL', 'MIGRATION')),
    CONSTRAINT "InventoryLedger_qty_ck" CHECK (typeof("qty") = 'integer' AND "qty" <> 0),
    CONSTRAINT "InventoryLedger_sign_ck" CHECK (("type" IN ('INITIAL', 'INBOUND', 'RETURN_IN', 'ADJUST_IN', 'TRANSFER_IN') AND "qty" > 0) OR ("type" IN ('SALE', 'ADJUST_OUT', 'DEFECT_OUT', 'TRANSFER_OUT', 'RETURN_REJECT_OUT') AND "qty" < 0)),
    CONSTRAINT "InventoryLedger_doc_ck" CHECK (("type" NOT IN ('RETURN_IN', 'RETURN_REJECT_OUT') OR ("returnItemId" IS NOT NULL AND "refType" = 'RETURN'))
      AND ("returnItemId" IS NULL OR ("refType" = 'RETURN' AND "type" IN ('RETURN_IN', 'RETURN_REJECT_OUT', 'TRANSFER_IN', 'TRANSFER_OUT')))
      AND ("inboundLineId" IS NULL OR ("type" = 'INBOUND' AND "refType" = 'INBOUND_ORDER'))),
    CONSTRAINT "InventoryLedger_balance_after_ck" CHECK (typeof("balanceAfter") = 'integer' AND "balanceAfter" >= 0),
    CONSTRAINT "InventoryLedger_sale_ck" CHECK (("type" = 'SALE') = ("reservationId" IS NOT NULL) AND ("type" <> 'SALE' OR "refType" = 'ORDER')),
    CONSTRAINT "InventoryLedger_ref_ck" CHECK ("refType" IN ('MANUAL', 'MIGRATION') OR ("refId" IS NOT NULL AND trim("refId") <> '')),
    CONSTRAINT "InventoryLedger_reason_ck" CHECK (("type" NOT IN ('ADJUST_IN', 'ADJUST_OUT', 'DEFECT_OUT') AND "refType" <> 'MANUAL') OR ("reason" IS NOT NULL AND trim("reason") <> '')),
    CONSTRAINT "InventoryLedger_dates_ck" CHECK (("occurredAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("createdAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);
INSERT INTO "new_InventoryLedger" ("balanceAfter", "createdAt", "createdBy", "id", "locationId", "memo", "occurredAt", "qty", "reason", "refId", "refType", "reservationId", "skuId", "type") SELECT "balanceAfter", "createdAt", "createdBy", "id", "locationId", "memo", "occurredAt", "qty", "reason", "refId", "refType", "reservationId", "skuId", "type" FROM "InventoryLedger";
DROP TABLE "InventoryLedger";
ALTER TABLE "new_InventoryLedger" RENAME TO "InventoryLedger";
CREATE INDEX "InventoryLedger_skuId_locationId_id_idx" ON "InventoryLedger"("skuId", "locationId", "id");
CREATE INDEX "InventoryLedger_refType_refId_idx" ON "InventoryLedger"("refType", "refId");
CREATE INDEX "InventoryLedger_reservationId_idx" ON "InventoryLedger"("reservationId");
CREATE INDEX "InventoryLedger_inboundLineId_idx" ON "InventoryLedger"("inboundLineId");
CREATE INDEX "InventoryLedger_returnItemId_idx" ON "InventoryLedger"("returnItemId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_poNo_key" ON "PurchaseOrder"("poNo");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_skuId_expectedAt_idx" ON "PurchaseOrderLine"("skuId", "expectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderLine_purchaseOrderId_lineNo_key" ON "PurchaseOrderLine"("purchaseOrderId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderLine_purchaseOrderId_skuId_key" ON "PurchaseOrderLine"("purchaseOrderId", "skuId");

-- CreateIndex
CREATE INDEX "PurchaseOrderEvent_purchaseOrderId_id_idx" ON "PurchaseOrderEvent"("purchaseOrderId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "InboundReceipt_receiptNo_key" ON "InboundReceipt"("receiptNo");

-- CreateIndex
CREATE INDEX "InboundReceiptLine_purchaseOrderLineId_idx" ON "InboundReceiptLine"("purchaseOrderLineId");

-- CreateIndex
CREATE INDEX "InboundReceiptLine_skuId_idx" ON "InboundReceiptLine"("skuId");

-- CreateIndex
CREATE INDEX "RestockSubscription_skuId_status_idx" ON "RestockSubscription"("skuId", "status");

-- CreateIndex
CREATE INDEX "RestockSubscription_customerId_status_idx" ON "RestockSubscription"("customerId", "status");

-- CreateIndex
CREATE INDEX "RestockSubscription_status_expiresAt_idx" ON "RestockSubscription"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupKey_key" ON "Notification"("dedupKey");

-- CreateIndex
CREATE INDEX "Notification_customerId_readAt_id_idx" ON "Notification"("customerId", "readAt", "id");

-- CreateIndex
CREATE INDEX "Notification_audience_createdAt_idx" ON "Notification"("audience", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_status_channel_idx" ON "Notification"("status", "channel");

-- CreateIndex
CREATE INDEX "StockAlert_status_openedAt_idx" ON "StockAlert"("status", "openedAt");

-- CreateIndex
CREATE INDEX "StockAlert_skuId_locationId_status_idx" ON "StockAlert"("skuId", "locationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnRequest_returnNo_key" ON "ReturnRequest"("returnNo");

-- CreateIndex
CREATE INDEX "ReturnRequest_orderId_idx" ON "ReturnRequest"("orderId");

-- CreateIndex
CREATE INDEX "ReturnRequest_status_statusChangedAt_idx" ON "ReturnRequest"("status", "statusChangedAt");

-- CreateIndex
CREATE INDEX "ReturnItem_orderItemId_idx" ON "ReturnItem"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnItem_returnRequestId_orderItemId_key" ON "ReturnItem"("returnRequestId", "orderItemId");

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
WHEN NEW."reserved" IS NOT (SELECT COALESCE(SUM(r."qty"), 0) FROM "InventoryReservation" r WHERE r."skuId" = NEW."skuId" AND r."locationId" = NEW."locationId" AND r."status" IN ('RESERVED', 'ALLOCATED'))
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
  WHEN NEW."status" = 'CANCELED' AND EXISTS (SELECT 1 FROM "OrderItem" i WHERE i."orderId" = NEW."id" AND i."status" IN ('SHIPPED', 'DELIVERED', 'CONFIRMED', 'RETURN_REQUESTED', 'RETURN_COLLECTING'))
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
    WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."id" AND fi."status" NOT IN ('CANCELED', 'RETURNED')) THEN (CASE WHEN EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."id" AND fi."status" = 'RETURNED') THEN 'RETURNED' ELSE 'CANCELED' END)
    WHEN EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."id" AND fi."status" = 'AWAITING_PAYMENT') THEN 'UNPAID'
    WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."id" AND fi."status" NOT IN ('CONFIRMED', 'CANCELED', 'RETURNED')) THEN 'CONFIRMED'
    WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."id" AND fi."status" NOT IN ('DELIVERED', 'CONFIRMED', 'CANCELED', 'RETURNED', 'RETURN_REQUESTED', 'RETURN_COLLECTING')) THEN 'DELIVERED'
    WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."id" AND fi."status" IN ('PAID', 'PREPARING')) THEN 'SHIPPED'
    WHEN EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."id" AND fi."status" IN ('SHIPPED', 'DELIVERED', 'CONFIRMED', 'RETURN_REQUESTED', 'RETURN_COLLECTING', 'RETURNED')) THEN 'PARTIALLY_SHIPPED'
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
  WHEN (OLD."status" || '>' || NEW."status") NOT IN ('AWAITING_PAYMENT>PAID', 'AWAITING_PAYMENT>CANCELED', 'PAID>PREPARING', 'PAID>CANCELED', 'PREPARING>SHIPPED', 'PREPARING>CANCELED', 'SHIPPED>DELIVERED', 'SHIPPED>CONFIRMED', 'DELIVERED>CONFIRMED', 'DELIVERED>RETURN_REQUESTED', 'RETURN_REQUESTED>RETURN_COLLECTING', 'RETURN_REQUESTED>DELIVERED', 'RETURN_COLLECTING>RETURNED', 'RETURN_COLLECTING>DELIVERED')
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
  WHEN NEW."status" = 'RETURN_REQUESTED' AND NOT EXISTS (SELECT 1 FROM "ReturnItem" ri JOIN "ReturnRequest" rr ON rr."id" = ri."returnRequestId" WHERE ri."orderItemId" = NEW."id" AND rr."status" IN ('REQUESTED', 'APPROVED'))
    THEN RAISE(ABORT, 'OrderItem_return_guard: 반품 요청(ReturnRequest)이 있어야 반품 요청 상태로 바꿀 수 있습니다')
  WHEN NEW."status" = 'RETURN_COLLECTING' AND NOT EXISTS (SELECT 1 FROM "ReturnItem" ri JOIN "ReturnRequest" rr ON rr."id" = ri."returnRequestId" WHERE ri."orderItemId" = NEW."id" AND rr."status" = 'COLLECTING')
    THEN RAISE(ABORT, 'OrderItem_return_guard: 회수 중인 반품이 있어야 합니다')
  WHEN NEW."status" = 'RETURNED' AND NOT EXISTS (SELECT 1 FROM "ReturnItem" ri WHERE ri."orderItemId" = NEW."id" AND ri."inspection" IN ('RESELLABLE', 'DEFECTIVE'))
    THEN RAISE(ABORT, 'OrderItem_return_guard: 검수를 통과(정상·불량)한 반품 상품만 반품 완료로 바꿀 수 있습니다')
  WHEN OLD."status" IN ('RETURN_REQUESTED', 'RETURN_COLLECTING') AND NEW."status" = 'DELIVERED'
      AND NOT EXISTS (SELECT 1 FROM "ReturnItem" ri JOIN "ReturnRequest" rr ON rr."id" = ri."returnRequestId" WHERE ri."orderItemId" = NEW."id" AND (rr."status" IN ('REJECTED', 'CANCELED') OR ri."inspection" = 'NOT_RETURNABLE'))
    THEN RAISE(ABORT, 'OrderItem_return_guard: 반품이 거절·철회되었거나 반품 불가 판정일 때만 배송 완료로 되돌립니다')
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
    WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" NOT IN ('CANCELED', 'RETURNED')) THEN (CASE WHEN EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" = 'RETURNED') THEN 'RETURNED' ELSE 'CANCELED' END)
    WHEN EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" = 'AWAITING_PAYMENT') THEN 'UNPAID'
    WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" NOT IN ('CONFIRMED', 'CANCELED', 'RETURNED')) THEN 'CONFIRMED'
    WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" NOT IN ('DELIVERED', 'CONFIRMED', 'CANCELED', 'RETURNED', 'RETURN_REQUESTED', 'RETURN_COLLECTING')) THEN 'DELIVERED'
    WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" IN ('PAID', 'PREPARING')) THEN 'SHIPPED'
    WHEN EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" IN ('SHIPPED', 'DELIVERED', 'CONFIRMED', 'RETURN_REQUESTED', 'RETURN_COLLECTING', 'RETURNED')) THEN 'PARTIALLY_SHIPPED'
    WHEN EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" = 'PREPARING') THEN 'PREPARING'
    ELSE 'PAID' END),
    "confirmedAt" = CASE WHEN (CASE
    WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" NOT IN ('CANCELED', 'RETURNED')) THEN (CASE WHEN EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" = 'RETURNED') THEN 'RETURNED' ELSE 'CANCELED' END)
    WHEN EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" = 'AWAITING_PAYMENT') THEN 'UNPAID'
    WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" NOT IN ('CONFIRMED', 'CANCELED', 'RETURNED')) THEN 'CONFIRMED'
    WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" NOT IN ('DELIVERED', 'CONFIRMED', 'CANCELED', 'RETURNED', 'RETURN_REQUESTED', 'RETURN_COLLECTING')) THEN 'DELIVERED'
    WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" IN ('PAID', 'PREPARING')) THEN 'SHIPPED'
    WHEN EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = NEW."orderId" AND fi."status" IN ('SHIPPED', 'DELIVERED', 'CONFIRMED', 'RETURN_REQUESTED', 'RETURN_COLLECTING', 'RETURNED')) THEN 'PARTIALLY_SHIPPED'
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
DROP TRIGGER IF EXISTS "OrderItemStatusHistory_no_update";
CREATE TRIGGER "OrderItemStatusHistory_no_update" BEFORE UPDATE ON "OrderItemStatusHistory"
BEGIN SELECT RAISE(ABORT, 'OrderItemStatusHistory_append_only: 이력은 수정할 수 없습니다'); END;

-- 이력은 삭제 금지
DROP TRIGGER IF EXISTS "OrderItemStatusHistory_no_delete";
CREATE TRIGGER "OrderItemStatusHistory_no_delete" BEFORE DELETE ON "OrderItemStatusHistory"
BEGIN SELECT RAISE(ABORT, 'OrderItemStatusHistory_append_only: 이력은 삭제할 수 없습니다'); END;

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

-- 아직 회원 계정으로 옮기지 않은 비회원 주문에만 출입증 발급
DROP TRIGGER IF EXISTS "GuestOrderSession_insert_guard";
CREATE TRIGGER "GuestOrderSession_insert_guard" BEFORE INSERT ON "GuestOrderSession"
WHEN (SELECT o."ordererType" = 'GUEST' AND o."customerId" IS NULL FROM "Order" o WHERE o."id" = NEW."orderId") IS NOT 1 OR NEW."revokedAt" IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'GuestOrderSession_insert_guard: 회원 계정으로 옮긴 주문이나 회원 주문에는 비회원 출입증을 만들 수 없습니다'); END;

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

-- 고객은 상품 준비가 시작되면 직접 취소 불가, 출고된 상품이 있으면 전액 취소 불가(반품으로). 토스에서 이미 일어난 취소를 반영(PG_SYNC)하는 것은 사실 기록이라 막지 않음
DROP TRIGGER IF EXISTS "PaymentCancel_fulfillment_guard";
CREATE TRIGGER "PaymentCancel_fulfillment_guard" BEFORE INSERT ON "PaymentCancel"
WHEN NEW."reasonCode" <> 'PG_SYNC'
BEGIN
SELECT CASE
  WHEN NEW."requestedBy" = 'CUSTOMER' AND EXISTS (SELECT 1 FROM "OrderItem" i WHERE i."orderId" = (SELECT p."orderId" FROM "Payment" p WHERE p."id" = NEW."paymentId") AND i."status" IN ('PREPARING', 'SHIPPED', 'DELIVERED', 'CONFIRMED'))
    THEN RAISE(ABORT, 'PaymentCancel_customer_preparing: 상품 준비가 시작되어 직접 취소할 수 없습니다')
  WHEN EXISTS (SELECT 1 FROM "OrderItem" i WHERE i."orderId" = (SELECT p."orderId" FROM "Payment" p WHERE p."id" = NEW."paymentId") AND i."status" IN ('SHIPPED', 'DELIVERED', 'CONFIRMED', 'RETURN_REQUESTED', 'RETURN_COLLECTING'))
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

-- 발주는 작성 중(DRAFT)으로 만들고 줄을 채운 뒤 발주
DROP TRIGGER IF EXISTS "PurchaseOrder_insert_draft";
CREATE TRIGGER "PurchaseOrder_insert_draft" BEFORE INSERT ON "PurchaseOrder"
WHEN NEW."status" <> 'DRAFT'
BEGIN SELECT RAISE(ABORT, 'PurchaseOrder_insert_draft: 발주는 작성 중(DRAFT)으로만 만들 수 있습니다'); END;

-- 정해진 길로만, 발주하려면 줄이 있어야 하고, 날짜 확정은 모든 줄에 예정일, 입고가 있으면 취소 불가
DROP TRIGGER IF EXISTS "PurchaseOrder_transition";
CREATE TRIGGER "PurchaseOrder_transition" BEFORE UPDATE OF "status" ON "PurchaseOrder"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
SELECT CASE
  WHEN (OLD."status" || '>' || NEW."status") NOT IN ('DRAFT>ORDERED', 'DRAFT>CANCELED', 'ORDERED>CONFIRMED', 'ORDERED>CANCELED', 'ORDERED>PARTIALLY_RECEIVED', 'ORDERED>RECEIVED', 'CONFIRMED>PARTIALLY_RECEIVED', 'CONFIRMED>RECEIVED', 'CONFIRMED>CANCELED', 'PARTIALLY_RECEIVED>RECEIVED')
    THEN RAISE(ABORT, 'PurchaseOrder_transition: 허용되지 않은 발주 상태 변경입니다')
  WHEN NEW."statusChangedAt" < OLD."statusChangedAt"
    THEN RAISE(ABORT, 'PurchaseOrder_transition: 상태 변경 시각이 이전보다 앞설 수 없습니다')
  WHEN NEW."status" = 'ORDERED' AND NOT EXISTS (SELECT 1 FROM "PurchaseOrderLine" l WHERE l."purchaseOrderId" = NEW."id")
    THEN RAISE(ABORT, 'PurchaseOrder_transition: 줄이 없는 발주는 보낼 수 없습니다')
  WHEN NEW."status" = 'CONFIRMED' AND EXISTS (SELECT 1 FROM "PurchaseOrderLine" l WHERE l."purchaseOrderId" = NEW."id" AND l."expectedAt" IS NULL)
    THEN RAISE(ABORT, 'PurchaseOrder_confirm_guard: 모든 줄에 입고 예정일이 있어야 확정할 수 있습니다')
  WHEN NEW."status" = 'CANCELED' AND EXISTS (SELECT 1 FROM "PurchaseOrderLine" l WHERE l."purchaseOrderId" = NEW."id" AND l."qtyReceived" > 0)
    THEN RAISE(ABORT, 'PurchaseOrder_transition: 입고가 시작된 발주는 취소할 수 없습니다 (잔량 마감으로 처리)')
  WHEN NEW."status" IN ('PARTIALLY_RECEIVED', 'RECEIVED') AND NOT EXISTS (SELECT 1 FROM "PurchaseOrderLine" l WHERE l."purchaseOrderId" = NEW."id" AND l."qtyReceived" > 0)
    THEN RAISE(ABORT, 'PurchaseOrder_transition: 입고된 수량이 없습니다')
END;
END;

-- 발주 기본 정보 고정
DROP TRIGGER IF EXISTS "PurchaseOrder_fixed";
CREATE TRIGGER "PurchaseOrder_fixed" BEFORE UPDATE OF "poNo", "supplierId", "createdBy", "createdAt" ON "PurchaseOrder"
WHEN NEW."poNo" IS NOT OLD."poNo" OR NEW."supplierId" IS NOT OLD."supplierId" OR NEW."createdBy" IS NOT OLD."createdBy" OR NEW."createdAt" IS NOT OLD."createdAt"
BEGIN SELECT RAISE(ABORT, 'PurchaseOrder_fixed: 발주번호·거래처·처리자는 바꿀 수 없습니다'); END;

-- 발주 기록 보관
DROP TRIGGER IF EXISTS "PurchaseOrder_no_delete";
CREATE TRIGGER "PurchaseOrder_no_delete" BEFORE DELETE ON "PurchaseOrder"
BEGIN SELECT RAISE(ABORT, 'PurchaseOrder_no_delete: 발주는 삭제할 수 없습니다 (취소로 처리)'); END;

-- 작성 중인 발주에만 줄 추가, 순번은 차례로, 입고 수량 0으로 시작
DROP TRIGGER IF EXISTS "PurchaseOrderLine_insert_guard";
CREATE TRIGGER "PurchaseOrderLine_insert_guard" BEFORE INSERT ON "PurchaseOrderLine"
BEGIN
SELECT CASE
  WHEN (SELECT p."status" FROM "PurchaseOrder" p WHERE p."id" = NEW."purchaseOrderId") IS NOT 'DRAFT'
    THEN RAISE(ABORT, 'PurchaseOrderLine_insert_guard: 작성 중인 발주에만 줄을 추가할 수 있습니다')
  WHEN NEW."qtyReceived" <> 0
    THEN RAISE(ABORT, 'PurchaseOrderLine_insert_guard: 입고 수량은 0으로 시작합니다')
  WHEN NEW."lineNo" IS NOT (SELECT COALESCE(MAX(l."lineNo"), 0) + 1 FROM "PurchaseOrderLine" l WHERE l."purchaseOrderId" = NEW."purchaseOrderId")
    THEN RAISE(ABORT, 'PurchaseOrderLine_insert_guard: 순번은 1부터 차례로 붙입니다')
END;
END;

-- 발주·SKU·순번 고정, 수량은 작성 중에만, 입고 수량은 입고 전표 합계와 같아야 함(트리거만), 예정일은 진행 중인 발주에서만 바꾸고 확정 뒤에는 비울 수 없음
DROP TRIGGER IF EXISTS "PurchaseOrderLine_update_guard";
CREATE TRIGGER "PurchaseOrderLine_update_guard" BEFORE UPDATE ON "PurchaseOrderLine"
BEGIN
SELECT CASE
  WHEN NEW."purchaseOrderId" IS NOT OLD."purchaseOrderId" OR NEW."lineNo" IS NOT OLD."lineNo" OR NEW."skuId" IS NOT OLD."skuId" OR NEW."createdAt" IS NOT OLD."createdAt"
    THEN RAISE(ABORT, 'PurchaseOrderLine_fixed: 발주 줄의 발주·SKU·순번은 바꿀 수 없습니다')
  WHEN (NEW."qtyOrdered" IS NOT OLD."qtyOrdered" OR NEW."unitCost" IS NOT OLD."unitCost") AND (SELECT p."status" FROM "PurchaseOrder" p WHERE p."id" = NEW."purchaseOrderId") <> 'DRAFT'
    THEN RAISE(ABORT, 'PurchaseOrderLine_fixed: 발주를 보낸 뒤에는 수량·단가를 바꿀 수 없습니다')
  WHEN NEW."qtyReceived" IS NOT (SELECT COALESCE(SUM(r."qtyGood" + r."qtyDefect"), 0) FROM "InboundReceiptLine" r WHERE r."purchaseOrderLineId" = NEW."id")
    THEN RAISE(ABORT, 'PurchaseOrderLine_received_guard: 입고 수량은 입고 전표로만 바뀝니다')
  WHEN NEW."expectedAt" IS NOT OLD."expectedAt" AND (SELECT p."status" FROM "PurchaseOrder" p WHERE p."id" = NEW."purchaseOrderId") NOT IN ('DRAFT', 'ORDERED', 'CONFIRMED', 'PARTIALLY_RECEIVED')
    THEN RAISE(ABORT, 'PurchaseOrderLine_fixed: 끝난 발주의 예정일은 바꿀 수 없습니다')
  WHEN NEW."expectedAt" IS NULL AND OLD."expectedAt" IS NOT NULL AND (SELECT p."status" FROM "PurchaseOrder" p WHERE p."id" = NEW."purchaseOrderId") <> 'DRAFT'
    THEN RAISE(ABORT, 'PurchaseOrderLine_fixed: 보낸 발주의 예정일은 비울 수 없습니다 (날짜를 바꾸세요)')
END;
END;

-- 작성 중인 발주의 줄만 삭제 가능
DROP TRIGGER IF EXISTS "PurchaseOrderLine_delete_guard";
CREATE TRIGGER "PurchaseOrderLine_delete_guard" BEFORE DELETE ON "PurchaseOrderLine"
WHEN (SELECT p."status" FROM "PurchaseOrder" p WHERE p."id" = OLD."purchaseOrderId") IS NOT 'DRAFT'
BEGIN SELECT RAISE(ABORT, 'PurchaseOrderLine_delete_guard: 보낸 발주의 줄은 지울 수 없습니다'); END;

-- 이력은 수정 금지
DROP TRIGGER IF EXISTS "PurchaseOrderEvent_no_update";
CREATE TRIGGER "PurchaseOrderEvent_no_update" BEFORE UPDATE ON "PurchaseOrderEvent"
BEGIN SELECT RAISE(ABORT, 'PurchaseOrderEvent_append_only: 이력은 수정할 수 없습니다'); END;

-- 이력은 삭제 금지
DROP TRIGGER IF EXISTS "PurchaseOrderEvent_no_delete";
CREATE TRIGGER "PurchaseOrderEvent_no_delete" BEFORE DELETE ON "PurchaseOrderEvent"
BEGIN SELECT RAISE(ABORT, 'PurchaseOrderEvent_append_only: 이력은 삭제할 수 없습니다'); END;

-- 입고는 사용 중인 위치로, 발주가 있으면 진행 중인 발주만
DROP TRIGGER IF EXISTS "InboundReceipt_insert_guard";
CREATE TRIGGER "InboundReceipt_insert_guard" BEFORE INSERT ON "InboundReceipt"
WHEN NOT EXISTS (SELECT 1 FROM "InventoryLocation" loc WHERE loc."id" = NEW."locationId" AND loc."isActive" = 1 AND loc."type" IN ('WAREHOUSE', 'STORE'))
  OR (NEW."purchaseOrderId" IS NOT NULL AND (SELECT p."status" FROM "PurchaseOrder" p WHERE p."id" = NEW."purchaseOrderId") NOT IN ('ORDERED', 'CONFIRMED', 'PARTIALLY_RECEIVED'))
BEGIN SELECT RAISE(ABORT, 'InboundReceipt_insert_guard: 입고할 수 없는 위치이거나 진행 중인 발주가 아닙니다'); END;

-- 입고 전표는 수정 금지 (잘못 입고했으면 조정 원장)
DROP TRIGGER IF EXISTS "InboundReceipt_no_update";
CREATE TRIGGER "InboundReceipt_no_update" BEFORE UPDATE ON "InboundReceipt"
BEGIN SELECT RAISE(ABORT, 'InboundReceipt_append_only: 입고 전표는 수정할 수 없습니다'); END;

-- 입고 기록 보관
DROP TRIGGER IF EXISTS "InboundReceipt_no_delete";
CREATE TRIGGER "InboundReceipt_no_delete" BEFORE DELETE ON "InboundReceipt"
BEGIN SELECT RAISE(ABORT, 'InboundReceipt_no_delete: 입고 전표는 삭제할 수 없습니다'); END;

-- 발주 줄과 같은 발주·SKU, 발주 수량을 넘는 입고 금지, 발주 없는 입고는 발주 줄 없이
DROP TRIGGER IF EXISTS "InboundReceiptLine_insert_guard";
CREATE TRIGGER "InboundReceiptLine_insert_guard" BEFORE INSERT ON "InboundReceiptLine"
BEGIN
SELECT CASE
  WHEN NEW."purchaseOrderLineId" IS NULL AND (SELECT r."purchaseOrderId" FROM "InboundReceipt" r WHERE r."id" = NEW."receiptId") IS NOT NULL
    THEN RAISE(ABORT, 'InboundReceiptLine_insert_guard: 발주 입고는 발주 줄을 지정해야 합니다')
  WHEN NEW."purchaseOrderLineId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "PurchaseOrderLine" l JOIN "InboundReceipt" r ON r."purchaseOrderId" = l."purchaseOrderId"
      WHERE l."id" = NEW."purchaseOrderLineId" AND r."id" = NEW."receiptId" AND l."skuId" = NEW."skuId")
    THEN RAISE(ABORT, 'InboundReceiptLine_insert_guard: 발주 줄의 발주·SKU와 다릅니다')
  WHEN NEW."purchaseOrderLineId" IS NOT NULL
      AND (SELECT l."qtyReceived" + NEW."qtyGood" + NEW."qtyDefect" > l."qtyOrdered" FROM "PurchaseOrderLine" l WHERE l."id" = NEW."purchaseOrderLineId")
    THEN RAISE(ABORT, 'InboundReceiptLine_over: 발주 수량보다 많이 입고할 수 없습니다')
END;
END;

-- 입고 전표 줄을 넣으면 발주 줄의 입고 수량을 자동 반영
DROP TRIGGER IF EXISTS "InboundReceiptLine_apply";
CREATE TRIGGER "InboundReceiptLine_apply" AFTER INSERT ON "InboundReceiptLine"
WHEN NEW."purchaseOrderLineId" IS NOT NULL
BEGIN
  UPDATE "PurchaseOrderLine" SET "qtyReceived" = (SELECT COALESCE(SUM(r."qtyGood" + r."qtyDefect"), 0) FROM "InboundReceiptLine" r WHERE r."purchaseOrderLineId" = NEW."purchaseOrderLineId"), "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')
  WHERE "id" = NEW."purchaseOrderLineId";
END;

-- 입고 전표 줄은 수정 금지
DROP TRIGGER IF EXISTS "InboundReceiptLine_no_update";
CREATE TRIGGER "InboundReceiptLine_no_update" BEFORE UPDATE ON "InboundReceiptLine"
BEGIN SELECT RAISE(ABORT, 'InboundReceiptLine_append_only: 입고 전표 줄은 수정할 수 없습니다'); END;

-- 입고 기록 보관
DROP TRIGGER IF EXISTS "InboundReceiptLine_no_delete";
CREATE TRIGGER "InboundReceiptLine_no_delete" BEFORE DELETE ON "InboundReceiptLine"
BEGIN SELECT RAISE(ABORT, 'InboundReceiptLine_no_delete: 입고 전표 줄은 삭제할 수 없습니다'); END;

-- 대기 상태로, 정상 회원만, 같은 SKU에 진행 중인 신청은 1개
DROP TRIGGER IF EXISTS "RestockSubscription_insert_guard";
CREATE TRIGGER "RestockSubscription_insert_guard" BEFORE INSERT ON "RestockSubscription"
BEGIN
SELECT CASE
  WHEN NEW."status" <> 'WAITING' OR NEW."closedAt" IS NOT NULL
    THEN RAISE(ABORT, 'RestockSubscription_insert_guard: 신청은 대기(WAITING)로 만듭니다')
  WHEN (SELECT c."status" FROM "Customer" c WHERE c."id" = NEW."customerId") IS NOT 'ACTIVE'
    THEN RAISE(ABORT, 'RestockSubscription_insert_guard: 정상(ACTIVE) 회원만 신청할 수 있습니다')
  WHEN EXISTS (SELECT 1 FROM "RestockSubscription" x WHERE x."customerId" = NEW."customerId" AND x."skuId" = NEW."skuId" AND x."status" IN ('WAITING', 'SCHEDULED'))
    THEN RAISE(ABORT, 'RestockSubscription_duplicate: 이미 재입고 알림을 신청한 상품입니다')
END;
END;

-- 회원·SKU·신청 시각·만료 시각 고정, 상태는 정해진 길로만
DROP TRIGGER IF EXISTS "RestockSubscription_update_guard";
CREATE TRIGGER "RestockSubscription_update_guard" BEFORE UPDATE ON "RestockSubscription"
BEGIN
SELECT CASE
  WHEN NEW."customerId" IS NOT OLD."customerId" OR NEW."skuId" IS NOT OLD."skuId" OR NEW."createdAt" IS NOT OLD."createdAt" OR NEW."expiresAt" IS NOT OLD."expiresAt"
    THEN RAISE(ABORT, 'RestockSubscription_fixed: 신청 내용은 바꿀 수 없습니다')
  WHEN NEW."status" IS NOT OLD."status" AND (OLD."status" || '>' || NEW."status") NOT IN ('WAITING>SCHEDULED', 'WAITING>ARRIVED', 'WAITING>CANCELED', 'WAITING>EXPIRED', 'SCHEDULED>WAITING', 'SCHEDULED>ARRIVED', 'SCHEDULED>CANCELED', 'SCHEDULED>EXPIRED', 'ARRIVED>PURCHASED')
    THEN RAISE(ABORT, 'RestockSubscription_transition: 허용되지 않은 재입고 알림 상태 변경입니다')
END;
END;

-- 알림 근거 보관
DROP TRIGGER IF EXISTS "RestockSubscription_no_delete";
CREATE TRIGGER "RestockSubscription_no_delete" BEFORE DELETE ON "RestockSubscription"
BEGIN SELECT RAISE(ABORT, 'RestockSubscription_no_delete: 재입고 알림 신청 기록은 삭제할 수 없습니다 (취소로 처리)'); END;

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

-- 새 알림은 진행 중(OPEN)으로, SKU·위치마다 진행 중인 알림은 1개
DROP TRIGGER IF EXISTS "StockAlert_insert_guard";
CREATE TRIGGER "StockAlert_insert_guard" BEFORE INSERT ON "StockAlert"
WHEN NEW."status" <> 'OPEN' OR EXISTS (SELECT 1 FROM "StockAlert" a WHERE a."skuId" = NEW."skuId" AND a."locationId" = NEW."locationId" AND a."status" = 'OPEN')
BEGIN SELECT RAISE(ABORT, 'StockAlert_insert_guard: 이미 진행 중인 재주문 알림이 있습니다'); END;

-- 진행 중 → 해소 한 번만, 발생 정보 고정
DROP TRIGGER IF EXISTS "StockAlert_update_guard";
CREATE TRIGGER "StockAlert_update_guard" BEFORE UPDATE ON "StockAlert"
WHEN OLD."status" <> 'OPEN' OR NEW."skuId" IS NOT OLD."skuId" OR NEW."locationId" IS NOT OLD."locationId" OR NEW."openedAt" IS NOT OLD."openedAt"
  OR NEW."availableAtOpen" IS NOT OLD."availableAtOpen" OR NEW."reorderPoint" IS NOT OLD."reorderPoint"
BEGIN SELECT RAISE(ABORT, 'StockAlert_update_guard: 해소된 재주문 알림·발생 정보는 바꿀 수 없습니다'); END;

-- 운영 기록 보관
DROP TRIGGER IF EXISTS "StockAlert_no_delete";
CREATE TRIGGER "StockAlert_no_delete" BEFORE DELETE ON "StockAlert"
BEGIN SELECT RAISE(ABORT, 'StockAlert_no_delete: 재주문 알림 기록은 삭제할 수 없습니다'); END;

-- 반품은 신청(REQUESTED)으로, 결제 완료 주문에만
DROP TRIGGER IF EXISTS "ReturnRequest_insert_guard";
CREATE TRIGGER "ReturnRequest_insert_guard" BEFORE INSERT ON "ReturnRequest"
WHEN NEW."status" <> 'REQUESTED' OR NEW."approvedAt" IS NOT NULL OR NEW."refundAmount" IS NOT NULL OR NEW."paymentCancelId" IS NOT NULL
  OR (SELECT o."status" FROM "Order" o WHERE o."id" = NEW."orderId") IS NOT 'PAID'
BEGIN SELECT RAISE(ABORT, 'ReturnRequest_insert_guard: 결제 완료 주문에 신청 상태로만 반품을 만들 수 있습니다'); END;

-- 정해진 길로만. 검수 끝은 모든 상품 검수 후, 완료는 환불(결제 취소 완료) 후, 전부 반품 불가일 때만 검수 뒤 거절
DROP TRIGGER IF EXISTS "ReturnRequest_transition";
CREATE TRIGGER "ReturnRequest_transition" BEFORE UPDATE OF "status" ON "ReturnRequest"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
SELECT CASE
  WHEN (OLD."status" || '>' || NEW."status") NOT IN ('REQUESTED>APPROVED', 'REQUESTED>REJECTED', 'REQUESTED>CANCELED', 'APPROVED>COLLECTING', 'APPROVED>REJECTED', 'APPROVED>CANCELED', 'COLLECTING>RECEIVED', 'RECEIVED>INSPECTED', 'INSPECTED>COMPLETED', 'INSPECTED>REJECTED')
    THEN RAISE(ABORT, 'ReturnRequest_transition: 허용되지 않은 반품 상태 변경입니다')
  WHEN NEW."statusChangedAt" < OLD."statusChangedAt"
    THEN RAISE(ABORT, 'ReturnRequest_transition: 상태 변경 시각이 이전보다 앞설 수 없습니다')
  WHEN NEW."status" = 'INSPECTED' AND EXISTS (SELECT 1 FROM "ReturnItem" ri WHERE ri."returnRequestId" = NEW."id" AND ri."inspection" IS NULL)
    THEN RAISE(ABORT, 'ReturnRequest_transition: 모든 반품 상품을 검수해야 합니다')
  WHEN NEW."status" = 'COMPLETED' AND NEW."refundAmount" > 0
      AND (SELECT c."status" FROM "PaymentCancel" c WHERE c."id" = NEW."paymentCancelId") IS NOT 'DONE'
    THEN RAISE(ABORT, 'ReturnRequest_refund_guard: 환불(결제 취소)이 완료되어야 반품을 끝낼 수 있습니다')
  WHEN OLD."status" = 'INSPECTED' AND NEW."status" = 'REJECTED'
      AND EXISTS (SELECT 1 FROM "ReturnItem" ri WHERE ri."returnRequestId" = NEW."id" AND ri."inspection" <> 'NOT_RETURNABLE')
    THEN RAISE(ABORT, 'ReturnRequest_transition: 검수를 통과한 상품이 있으면 거절할 수 없습니다 (환불로 완료)')
END;
END;

-- 반품번호·주문·사유·귀책·신청자·신청 시각 고정, 환불액·반품 배송비는 검수 끝날 때 한 번만 확정
DROP TRIGGER IF EXISTS "ReturnRequest_fixed";
CREATE TRIGGER "ReturnRequest_fixed" BEFORE UPDATE ON "ReturnRequest"
WHEN NEW."returnNo" IS NOT OLD."returnNo" OR NEW."orderId" IS NOT OLD."orderId" OR NEW."reason" IS NOT OLD."reason" OR NEW."fault" IS NOT OLD."fault"
  OR NEW."requestedBy" IS NOT OLD."requestedBy" OR NEW."requestedAt" IS NOT OLD."requestedAt" OR NEW."createdAt" IS NOT OLD."createdAt"
  OR (OLD."refundAmount" IS NOT NULL AND (NEW."refundAmount" IS NOT OLD."refundAmount" OR NEW."returnShippingFee" IS NOT OLD."returnShippingFee"))
  OR (OLD."paymentCancelId" IS NOT NULL AND NEW."paymentCancelId" IS NOT OLD."paymentCancelId")
BEGIN SELECT RAISE(ABORT, 'ReturnRequest_fixed: 반품 기본 정보·확정된 환불액은 바꿀 수 없습니다'); END;

-- 반품 기록 보관
DROP TRIGGER IF EXISTS "ReturnRequest_no_delete";
CREATE TRIGGER "ReturnRequest_no_delete" BEFORE DELETE ON "ReturnRequest"
BEGIN SELECT RAISE(ABORT, 'ReturnRequest_no_delete: 반품 기록은 삭제할 수 없습니다'); END;

-- 신청 중인 반품에, 같은 주문의 배송 완료 상품을, 반품 기간 안(고객 사유 7일·판매자 사유 30일), 줄 수량 전체로, 진행 중인 다른 반품이 없을 때
DROP TRIGGER IF EXISTS "ReturnItem_insert_guard";
CREATE TRIGGER "ReturnItem_insert_guard" BEFORE INSERT ON "ReturnItem"
BEGIN
SELECT CASE
  WHEN (SELECT rr."status" FROM "ReturnRequest" rr WHERE rr."id" = NEW."returnRequestId") IS NOT 'REQUESTED'
    THEN RAISE(ABORT, 'ReturnItem_insert_guard: 신청 중인 반품에만 상품을 담을 수 있습니다')
  WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" i JOIN "ReturnRequest" rr ON rr."orderId" = i."orderId" WHERE i."id" = NEW."orderItemId" AND rr."id" = NEW."returnRequestId")
    THEN RAISE(ABORT, 'ReturnItem_insert_guard: 다른 주문의 상품입니다')
  WHEN (SELECT i."status" FROM "OrderItem" i WHERE i."id" = NEW."orderItemId") IS NOT 'DELIVERED'
    THEN RAISE(ABORT, 'ReturnItem_status_guard: 배송 완료된(구매확정 전) 상품만 반품할 수 있습니다')
  WHEN NEW."qty" IS NOT (SELECT i."quantity" FROM "OrderItem" i WHERE i."id" = NEW."orderItemId")
    THEN RAISE(ABORT, 'ReturnItem_insert_guard: 지금은 상품 줄 수량 전체만 반품할 수 있습니다')
  WHEN (SELECT julianday(rr."requestedAt") - julianday(i."deliveredAt") FROM "ReturnRequest" rr, "OrderItem" i WHERE rr."id" = NEW."returnRequestId" AND i."id" = NEW."orderItemId")
      > (SELECT CASE rr."fault" WHEN 'CUSTOMER' THEN 7 ELSE 30 END FROM "ReturnRequest" rr WHERE rr."id" = NEW."returnRequestId")
    THEN RAISE(ABORT, 'ReturnItem_window: 반품 신청 기간이 지났습니다 (단순 변심·사이즈 7일, 불량·오배송·파손 30일)')
  WHEN EXISTS (SELECT 1 FROM "ReturnItem" x JOIN "ReturnRequest" rr ON rr."id" = x."returnRequestId" WHERE x."orderItemId" = NEW."orderItemId" AND rr."status" NOT IN ('REJECTED', 'CANCELED'))
    THEN RAISE(ABORT, 'ReturnItem_duplicate: 이미 반품이 진행 중이거나 끝난 상품입니다')
END;
END;

-- 반품 상품·수량 고정, 검수는 반품센터 도착 뒤 한 번만
DROP TRIGGER IF EXISTS "ReturnItem_update_guard";
CREATE TRIGGER "ReturnItem_update_guard" BEFORE UPDATE ON "ReturnItem"
BEGIN
SELECT CASE
  WHEN NEW."returnRequestId" IS NOT OLD."returnRequestId" OR NEW."orderItemId" IS NOT OLD."orderItemId" OR NEW."qty" IS NOT OLD."qty"
    THEN RAISE(ABORT, 'ReturnItem_fixed: 반품 상품·수량은 바꿀 수 없습니다')
  WHEN OLD."inspection" IS NOT NULL AND (NEW."inspection" IS NOT OLD."inspection" OR NEW."refundAmount" IS NOT OLD."refundAmount" OR NEW."inspectedAt" IS NOT OLD."inspectedAt")
    THEN RAISE(ABORT, 'ReturnItem_fixed: 검수 결과는 바꿀 수 없습니다')
  WHEN NEW."inspection" IS NOT NULL AND OLD."inspection" IS NULL AND (SELECT rr."status" FROM "ReturnRequest" rr WHERE rr."id" = NEW."returnRequestId") IS NOT 'RECEIVED'
    THEN RAISE(ABORT, 'ReturnItem_inspect_guard: 반품센터에 도착한 반품만 검수할 수 있습니다')
  WHEN NEW."inspection" IN ('RESELLABLE', 'DEFECTIVE') AND NEW."refundAmount" IS NOT (SELECT i."payAmount" FROM "OrderItem" i WHERE i."id" = NEW."orderItemId")
    THEN RAISE(ABORT, 'ReturnItem_refund: 검수를 통과한 상품의 환불액은 그 상품의 실결제액입니다')
END;
END;

-- 반품 기록 보관
DROP TRIGGER IF EXISTS "ReturnItem_no_delete";
CREATE TRIGGER "ReturnItem_no_delete" BEFORE DELETE ON "ReturnItem"
BEGIN SELECT RAISE(ABORT, 'ReturnItem_no_delete: 반품 상품 기록은 삭제할 수 없습니다'); END;

-- 반품 재고 이동은 실제 단계대로: 도착(반품센터 +)은 도착한 반품에 한 번, 검수 이동·반송은 검수 결과에 맞게, 수량은 반품 수량
DROP TRIGGER IF EXISTS "InventoryLedger_return_guard";
CREATE TRIGGER "InventoryLedger_return_guard" BEFORE INSERT ON "InventoryLedger"
WHEN NEW."returnItemId" IS NOT NULL
BEGIN
SELECT CASE
  WHEN abs(NEW."qty") IS NOT (SELECT ri."qty" FROM "ReturnItem" ri WHERE ri."id" = NEW."returnItemId")
    THEN RAISE(ABORT, 'InventoryLedger_return_guard: 반품 수량과 다릅니다')
  WHEN NEW."skuId" IS NOT (SELECT i."skuId" FROM "ReturnItem" ri JOIN "OrderItem" i ON i."id" = ri."orderItemId" WHERE ri."id" = NEW."returnItemId")
    THEN RAISE(ABORT, 'InventoryLedger_return_guard: 반품 상품의 SKU와 다릅니다')
  WHEN NEW."type" = 'RETURN_IN' AND (
      (SELECT rr."status" FROM "ReturnItem" ri JOIN "ReturnRequest" rr ON rr."id" = ri."returnRequestId" WHERE ri."id" = NEW."returnItemId") IS NOT 'RECEIVED'
      OR (SELECT loc."type" FROM "InventoryLocation" loc WHERE loc."id" = NEW."locationId") IS NOT 'RETURN_CENTER'
      OR EXISTS (SELECT 1 FROM "InventoryLedger" l WHERE l."returnItemId" = NEW."returnItemId" AND l."type" = 'RETURN_IN'))
    THEN RAISE(ABORT, 'InventoryLedger_return_guard: 반품 도착은 반품센터에, 도착한 반품마다 한 번만 기록합니다')
  WHEN NEW."type" IN ('TRANSFER_OUT', 'TRANSFER_IN') AND COALESCE((SELECT ri."inspection" FROM "ReturnItem" ri WHERE ri."id" = NEW."returnItemId"), '') NOT IN ('RESELLABLE', 'DEFECTIVE')
    THEN RAISE(ABORT, 'InventoryLedger_return_guard: 검수를 통과한(정상·불량) 반품만 이동합니다')
  WHEN NEW."type" = 'TRANSFER_IN' AND (SELECT loc."type" FROM "InventoryLocation" loc WHERE loc."id" = NEW."locationId")
      IS NOT (CASE (SELECT ri."inspection" FROM "ReturnItem" ri WHERE ri."id" = NEW."returnItemId") WHEN 'RESELLABLE' THEN 'WAREHOUSE' ELSE 'DEFECT' END)
    THEN RAISE(ABORT, 'InventoryLedger_return_guard: 정상은 물류센터, 불량은 불량 창고로만 옮깁니다')
  WHEN NEW."type" = 'RETURN_REJECT_OUT' AND (SELECT ri."inspection" FROM "ReturnItem" ri WHERE ri."id" = NEW."returnItemId") IS NOT 'NOT_RETURNABLE'
    THEN RAISE(ABORT, 'InventoryLedger_return_guard: 반품 불가 판정 상품만 고객에게 반송합니다')
  WHEN NEW."type" IN ('TRANSFER_OUT', 'RETURN_REJECT_OUT') AND (SELECT loc."type" FROM "InventoryLocation" loc WHERE loc."id" = NEW."locationId") IS NOT 'RETURN_CENTER'
    THEN RAISE(ABORT, 'InventoryLedger_return_guard: 검수 뒤 이동·반송은 반품센터에서 나갑니다')
END;
END;

-- <<< db-constraints
