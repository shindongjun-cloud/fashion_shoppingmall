-- >>> db-constraints: 영향받는 트리거 먼저 제거 (prisma/db-constraints.ts에서 생성, 직접 수정 금지)
DROP TRIGGER IF EXISTS "Style_sale_ready_ins";
DROP TRIGGER IF EXISTS "Style_sale_ready_upd";
DROP TRIGGER IF EXISTS "StyleNotice_on_sale_delete";
DROP TRIGGER IF EXISTS "StyleColor_code_match_ins";
DROP TRIGGER IF EXISTS "StyleColor_code_match_upd";
DROP TRIGGER IF EXISTS "Sku_code_match_ins";
DROP TRIGGER IF EXISTS "Sku_code_match_upd";
DROP TRIGGER IF EXISTS "Style_code_fixed";
DROP TRIGGER IF EXISTS "Color_code_fixed";
DROP TRIGGER IF EXISTS "Size_code_fixed";
DROP TRIGGER IF EXISTS "Sku_size_group_ins";
DROP TRIGGER IF EXISTS "Sku_size_group_upd";
DROP TRIGGER IF EXISTS "SizeMeasurement_size_group_ins";
DROP TRIGGER IF EXISTS "SizeMeasurement_size_group_upd";
DROP TRIGGER IF EXISTS "ModelWear_consistency_ins";
DROP TRIGGER IF EXISTS "ModelWear_consistency_upd";
DROP TRIGGER IF EXISTS "Style_size_group_change";
DROP TRIGGER IF EXISTS "StyleColor_style_fixed";
DROP TRIGGER IF EXISTS "StylePrice_no_overlap_ins";
DROP TRIGGER IF EXISTS "StylePrice_no_overlap_upd";
DROP TRIGGER IF EXISTS "PricePromotionTarget_rate_override_ins";
DROP TRIGGER IF EXISTS "PricePromotionTarget_rate_override_upd";
DROP TRIGGER IF EXISTS "PricePromotion_rate_targets_upd";
DROP TRIGGER IF EXISTS "Category_path_fill";
DROP TRIGGER IF EXISTS "Category_path_guard";
DROP TRIGGER IF EXISTS "Category_parent_fixed";
-- <<< db-constraints-top

-- 상품 도메인(B안 + A안 보강) + 가격 도메인(C안) v2
-- 이전 마이그레이션 3개(product_domain_b, product_domain_a_plus, price_domain_c)를 하나로 다시 만든 버전입니다.
-- DB 제약조건(CHECK·트리거)은 prisma/db-constraints.ts에서 scripts/inject-constraints.ts로 주입했습니다.
--
-- 기존 테스트 주문은 옛 Product를 가리켜서 SKU 구조로 옮길 수 없으므로 지웁니다.
DELETE FROM "OrderItem";
DELETE FROM "Order";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Product";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "Season" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "term" TEXT NOT NULL,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Season_term_enum_ck" CHECK ("term" IN ('SS', 'FW', 'ALL')),
    CONSTRAINT "Season_code_ck" CHECK ("code" <> '' AND "code" NOT GLOB '*[^A-Z0-9_]*'),
    CONSTRAINT "Season_year_ck" CHECK (typeof("year") = 'integer' AND "year" BETWEEN 2000 AND 2100),
    CONSTRAINT "Season_period_ck" CHECK ("startDate" IS NULL OR "endDate" IS NULL OR "endDate" > "startDate"),
    CONSTRAINT "Season_dates_ck" CHECK (("startDate" IS NULL OR "startDate" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("endDate" IS NULL OR "endDate" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*')),
    CONSTRAINT "Season_code_term_ck" CHECK ("code" = substr(CAST("year" AS TEXT), 3, 2) || "term")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "parentId" INTEGER,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL DEFAULT '/',
    "depth" INTEGER NOT NULL DEFAULT 1,
    "noticeType" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Category_noticeType_enum_ck" CHECK ("noticeType" IN ('CLOTHING', 'SHOES', 'BAG', 'ACCESSORY')),
    CONSTRAINT "Category_isActive_bool_ck" CHECK ("isActive" IN (0, 1)),
    CONSTRAINT "Category_code_ck" CHECK ("code" <> '' AND "code" NOT GLOB '*[^A-Z0-9_]*'),
    CONSTRAINT "Category_name_ck" CHECK (trim("name") <> ''),
    CONSTRAINT "Category_not_self_parent_ck" CHECK ("parentId" IS NULL OR "parentId" <> "id"),
    CONSTRAINT "Category_depth_ck" CHECK (typeof("depth") = 'integer' AND "depth" >= 1),
    CONSTRAINT "Category_path_ck" CHECK ("path" GLOB '/*')
);

-- CreateTable
CREATE TABLE "Color" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "hex" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Color_family_enum_ck" CHECK ("family" IN ('BLACK', 'WHITE', 'GRAY', 'BEIGE', 'BROWN', 'NAVY', 'BLUE', 'GREEN', 'RED', 'PINK', 'YELLOW', 'PURPLE', 'MULTI')),
    CONSTRAINT "Color_code_ck" CHECK (length("code") = 2 AND "code" NOT GLOB '*[^A-Z]*'),
    CONSTRAINT "Color_hex_ck" CHECK ("hex" GLOB '#[0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F]')
);

-- CreateTable
CREATE TABLE "SizeGroup" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "SizeGroup_code_ck" CHECK ("code" <> '' AND "code" NOT GLOB '*[^A-Z0-9_]*')
);

-- CreateTable
CREATE TABLE "Size" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sizeGroupId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    CONSTRAINT "Size_sizeGroupId_fkey" FOREIGN KEY ("sizeGroupId") REFERENCES "SizeGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Size_code_ck" CHECK (trim("code") <> '' AND "code" NOT GLOB '*[^A-Z0-9]*'),
    CONSTRAINT "Size_sort_ck" CHECK (typeof("sortOrder") = 'integer' AND "sortOrder" >= 0)
);

-- CreateTable
CREATE TABLE "Material" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Material_kind_enum_ck" CHECK ("kind" IN ('NATURAL', 'SYNTHETIC', 'REGENERATED', 'LEATHER', 'OTHER')),
    CONSTRAINT "Material_code_ck" CHECK ("code" <> '' AND "code" NOT GLOB '*[^A-Z0-9_]*')
);

-- CreateTable
CREATE TABLE "Manufacturer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "contactPhone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Manufacturer_role_enum_ck" CHECK ("role" IN ('MANUFACTURER', 'IMPORTER')),
    CONSTRAINT "Manufacturer_isActive_bool_ck" CHECK ("isActive" IN (0, 1)),
    CONSTRAINT "Manufacturer_code_ck" CHECK ("code" <> '' AND "code" NOT GLOB '*[^A-Z0-9_]*'),
    CONSTRAINT "Manufacturer_name_ck" CHECK (trim("name") <> '')
);

-- CreateTable
CREATE TABLE "CareSymbol" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CareSymbol_category_enum_ck" CHECK ("category" IN ('WASH', 'BLEACH', 'DRY', 'IRON', 'DRYCLEAN')),
    CONSTRAINT "CareSymbol_code_ck" CHECK ("code" <> '' AND "code" NOT GLOB '*[^A-Z0-9_]*')
);

-- CreateTable
CREATE TABLE "Style" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "styleCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT,
    "description" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "seasonId" INTEGER,
    "sizeGroupId" INTEGER NOT NULL,
    "manufacturerId" INTEGER,
    "maxQtyPerOrder" INTEGER,
    "preorderShipDate" DATETIME,
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "fit" TEXT,
    "thickness" TEXT,
    "stretch" TEXT,
    "sheerness" TEXT,
    "lining" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "isDisplayed" BOOLEAN NOT NULL DEFAULT false,
    "releasedAt" DATETIME,
    "saleStartAt" DATETIME,
    "saleEndAt" DATETIME,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Style_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Style_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Style_sizeGroupId_fkey" FOREIGN KEY ("sizeGroupId") REFERENCES "SizeGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Style_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "Manufacturer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Style_gender_enum_ck" CHECK ("gender" IN ('MEN', 'WOMEN', 'UNISEX')),
    CONSTRAINT "Style_fit_enum_ck" CHECK ("fit" IN ('SLIM', 'REGULAR', 'RELAXED', 'OVERSIZED')),
    CONSTRAINT "Style_thickness_enum_ck" CHECK ("thickness" IN ('LOW', 'MEDIUM', 'HIGH')),
    CONSTRAINT "Style_stretch_enum_ck" CHECK ("stretch" IN ('LOW', 'MEDIUM', 'HIGH')),
    CONSTRAINT "Style_sheerness_enum_ck" CHECK ("sheerness" IN ('LOW', 'MEDIUM', 'HIGH')),
    CONSTRAINT "Style_lining_enum_ck" CHECK ("lining" IN ('NONE', 'PARTIAL', 'FULL')),
    CONSTRAINT "Style_status_enum_ck" CHECK ("status" IN ('DRAFT', 'ON_SALE', 'SUSPENDED', 'DISCONTINUED')),
    CONSTRAINT "Style_isDisplayed_bool_ck" CHECK ("isDisplayed" IN (0, 1)),
    CONSTRAINT "Style_code_ck" CHECK (length("styleCode") BETWEEN 6 AND 20 AND "styleCode" NOT GLOB '*[^A-Z0-9]*'),
    CONSTRAINT "Style_name_ck" CHECK (trim("name") <> ''),
    CONSTRAINT "Style_max_qty_ck" CHECK ("maxQtyPerOrder" IS NULL OR (typeof("maxQtyPerOrder") = 'integer' AND "maxQtyPerOrder" >= 1)),
    CONSTRAINT "Style_sale_period_ck" CHECK ("saleStartAt" IS NULL OR "saleEndAt" IS NULL OR "saleEndAt" > "saleStartAt"),
    CONSTRAINT "Style_dates_ck" CHECK (("saleStartAt" IS NULL OR "saleStartAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("saleEndAt" IS NULL OR "saleEndAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("releasedAt" IS NULL OR "releasedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("preorderShipDate" IS NULL OR "preorderShipDate" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- CreateTable
CREATE TABLE "StyleColor" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "styleId" INTEGER NOT NULL,
    "colorId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "colorLabel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ON_SALE',
    "isDisplayed" BOOLEAN NOT NULL DEFAULT true,
    "releasedAt" DATETIME,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "StyleColor_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StyleColor_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "Color" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StyleColor_status_enum_ck" CHECK ("status" IN ('ON_SALE', 'SUSPENDED', 'DISCONTINUED')),
    CONSTRAINT "StyleColor_isDisplayed_bool_ck" CHECK ("isDisplayed" IN (0, 1)),
    CONSTRAINT "StyleColor_code_ck" CHECK ("code" GLOB '*-[A-Z][A-Z]'),
    CONSTRAINT "StyleColor_sort_ck" CHECK (typeof("sortOrder") = 'integer' AND "sortOrder" >= 0)
);

-- CreateTable
CREATE TABLE "Sku" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "styleColorId" INTEGER NOT NULL,
    "sizeId" INTEGER NOT NULL,
    "skuCode" TEXT NOT NULL,
    "barcode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ON_SALE',
    "stock" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Sku_styleColorId_fkey" FOREIGN KEY ("styleColorId") REFERENCES "StyleColor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Sku_sizeId_fkey" FOREIGN KEY ("sizeId") REFERENCES "Size" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Sku_status_enum_ck" CHECK ("status" IN ('ON_SALE', 'SUSPENDED', 'DISCONTINUED')),
    CONSTRAINT "Sku_stock_ck" CHECK (typeof("stock") = 'integer' AND "stock" >= 0),
    CONSTRAINT "Sku_code_ck" CHECK ("skuCode" GLOB '*-*-*' AND "skuCode" NOT GLOB '*[^A-Z0-9-]*'),
    CONSTRAINT "Sku_barcode_ck" CHECK ("barcode" IS NULL OR (length("barcode") BETWEEN 8 AND 14 AND "barcode" NOT GLOB '*[^0-9]*'))
);

-- CreateTable
CREATE TABLE "StyleColorImage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "styleColorId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "alt" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "StyleColorImage_styleColorId_fkey" FOREIGN KEY ("styleColorId") REFERENCES "StyleColor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StyleColorImage_type_enum_ck" CHECK ("type" IN ('MAIN', 'BACK', 'MODEL', 'DETAIL')),
    CONSTRAINT "StyleColorImage_url_ck" CHECK (trim("url") <> ''),
    CONSTRAINT "StyleColorImage_alt_ck" CHECK (trim("alt") <> '')
);

-- CreateTable
CREATE TABLE "StyleMaterial" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "styleId" INTEGER NOT NULL,
    "part" TEXT NOT NULL,
    "materialId" INTEGER NOT NULL,
    "percent" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "StyleMaterial_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StyleMaterial_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StyleMaterial_percent_ck" CHECK (typeof("percent") = 'integer' AND "percent" BETWEEN 1 AND 100),
    CONSTRAINT "StyleMaterial_part_ck" CHECK (trim("part") <> '')
);

-- CreateTable
CREATE TABLE "StyleCare" (
    "styleId" INTEGER NOT NULL,
    "careSymbolId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("styleId", "careSymbolId"),
    CONSTRAINT "StyleCare_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StyleCare_careSymbolId_fkey" FOREIGN KEY ("careSymbolId") REFERENCES "CareSymbol" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StyleWearSeason" (
    "styleId" INTEGER NOT NULL,
    "season" TEXT NOT NULL,

    PRIMARY KEY ("styleId", "season"),
    CONSTRAINT "StyleWearSeason_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StyleWearSeason_season_enum_ck" CHECK ("season" IN ('SPRING', 'SUMMER', 'FALL', 'WINTER'))
);

-- CreateTable
CREATE TABLE "StyleDetailBlock" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "styleId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "mediaUrl" TEXT,
    "alt" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "StyleDetailBlock_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StyleDetailBlock_type_enum_ck" CHECK ("type" IN ('TEXT', 'IMAGE', 'VIDEO')),
    CONSTRAINT "StyleDetailBlock_isVisible_bool_ck" CHECK ("isVisible" IN (0, 1)),
    CONSTRAINT "StyleDetailBlock_type_fields_ck" CHECK (("type" = 'TEXT' AND "body" IS NOT NULL AND trim("body") <> '') OR ("type" = 'IMAGE' AND "mediaUrl" IS NOT NULL AND "alt" IS NOT NULL) OR ("type" = 'VIDEO' AND "mediaUrl" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "SizeMeasurement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "styleId" INTEGER NOT NULL,
    "sizeId" INTEGER NOT NULL,
    "item" TEXT NOT NULL,
    "valueCm" REAL NOT NULL,
    CONSTRAINT "SizeMeasurement_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SizeMeasurement_sizeId_fkey" FOREIGN KEY ("sizeId") REFERENCES "Size" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SizeMeasurement_item_enum_ck" CHECK ("item" IN ('SHOULDER', 'CHEST', 'SLEEVE', 'LENGTH', 'WAIST', 'HIP', 'THIGH', 'RISE', 'HEM', 'HEAD', 'BRIM', 'DEPTH')),
    CONSTRAINT "SizeMeasurement_value_ck" CHECK (typeof("valueCm") IN ('real', 'integer') AND "valueCm" > 0 AND "valueCm" < 500)
);

-- CreateTable
CREATE TABLE "ModelWear" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "styleId" INTEGER NOT NULL,
    "styleColorId" INTEGER,
    "sizeId" INTEGER NOT NULL,
    "modelName" TEXT,
    "heightCm" INTEGER NOT NULL,
    "weightKg" INTEGER,
    "note" TEXT,
    CONSTRAINT "ModelWear_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ModelWear_styleColorId_fkey" FOREIGN KEY ("styleColorId") REFERENCES "StyleColor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ModelWear_sizeId_fkey" FOREIGN KEY ("sizeId") REFERENCES "Size" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ModelWear_height_ck" CHECK (typeof("heightCm") = 'integer' AND "heightCm" BETWEEN 100 AND 250),
    CONSTRAINT "ModelWear_weight_ck" CHECK ("weightKg" IS NULL OR (typeof("weightKg") = 'integer' AND "weightKg" BETWEEN 20 AND 300))
);

-- CreateTable
CREATE TABLE "StyleNotice" (
    "styleId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "noticeType" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StyleNotice_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StyleNotice_noticeType_enum_ck" CHECK ("noticeType" IN ('CLOTHING', 'SHOES', 'BAG', 'ACCESSORY')),
    CONSTRAINT "StyleNotice_content_ck" CHECK (json_valid("content") AND json_type("content") = 'array' AND json_array_length("content") > 0)
);

-- CreateTable
CREATE TABLE "StylePrice" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "styleId" INTEGER NOT NULL,
    "listPrice" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "validFrom" DATETIME NOT NULL,
    "validTo" DATETIME,
    "reason" TEXT NOT NULL,
    "memo" TEXT,
    "changedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StylePrice_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StylePrice_reason_enum_ck" CHECK ("reason" IN ('INITIAL', 'REPRICE', 'COST_CHANGE', 'ERROR_FIX')),
    CONSTRAINT "StylePrice_amount_ck" CHECK (typeof("listPrice") = 'integer' AND "listPrice" > 0),
    CONSTRAINT "StylePrice_currency_ck" CHECK ("currency" GLOB '[A-Z][A-Z][A-Z]'),
    CONSTRAINT "StylePrice_period_ck" CHECK ("validTo" IS NULL OR "validTo" > "validFrom"),
    CONSTRAINT "StylePrice_dates_ck" CHECK (("validFrom" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("validTo" IS NULL OR "validTo" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'))
);

-- CreateTable
CREATE TABLE "PricePromotion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "discountType" TEXT NOT NULL,
    "discountValue" INTEGER NOT NULL,
    "maxDiscountAmount" INTEGER,
    "minListPrice" INTEGER,
    "roundingUnit" INTEGER NOT NULL DEFAULT 100,
    "roundingMode" TEXT NOT NULL DEFAULT 'FLOOR',
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "badgeText" TEXT,
    "showEndDate" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "approvedBy" TEXT,
    "approvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PricePromotion_discountType_enum_ck" CHECK ("discountType" IN ('RATE', 'AMOUNT', 'FIXED_PRICE')),
    CONSTRAINT "PricePromotion_roundingMode_enum_ck" CHECK ("roundingMode" IN ('FLOOR', 'ROUND', 'CEIL')),
    CONSTRAINT "PricePromotion_status_enum_ck" CHECK ("status" IN ('DRAFT', 'APPROVED', 'PAUSED', 'CANCELED')),
    CONSTRAINT "PricePromotion_showEndDate_bool_ck" CHECK ("showEndDate" IN (0, 1)),
    CONSTRAINT "PricePromotion_code_ck" CHECK ("code" <> '' AND "code" NOT GLOB '*[^A-Z0-9_]*'),
    CONSTRAINT "PricePromotion_value_ck" CHECK (typeof("discountValue") = 'integer' AND "discountValue" > 0 AND ("discountType" <> 'RATE' OR "discountValue" BETWEEN 1 AND 99)),
    CONSTRAINT "PricePromotion_max_discount_ck" CHECK ("maxDiscountAmount" IS NULL OR (typeof("maxDiscountAmount") = 'integer' AND "maxDiscountAmount" > 0)),
    CONSTRAINT "PricePromotion_min_price_ck" CHECK ("minListPrice" IS NULL OR (typeof("minListPrice") = 'integer' AND "minListPrice" >= 0)),
    CONSTRAINT "PricePromotion_rounding_ck" CHECK ("roundingUnit" IN (1, 10, 100, 1000)),
    CONSTRAINT "PricePromotion_period_ck" CHECK ("endAt" > "startAt"),
    CONSTRAINT "PricePromotion_dates_ck" CHECK (("startAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("endAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*') AND ("approvedAt" IS NULL OR "approvedAt" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*')),
    CONSTRAINT "PricePromotion_approval_ck" CHECK ("status" <> 'APPROVED' OR "approvedAt" IS NOT NULL),
    CONSTRAINT "PricePromotion_priority_ck" CHECK (typeof("priority") = 'integer' AND "priority" >= 0)
);

-- CreateTable
CREATE TABLE "PricePromotionTarget" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "promotionId" INTEGER NOT NULL,
    "targetType" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'INCLUDE',
    "categoryId" INTEGER,
    "seasonId" INTEGER,
    "gender" TEXT,
    "styleId" INTEGER,
    "discountValueOverride" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PricePromotionTarget_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "PricePromotion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PricePromotionTarget_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PricePromotionTarget_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PricePromotionTarget_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PricePromotionTarget_targetType_enum_ck" CHECK ("targetType" IN ('ALL', 'CATEGORY', 'SEASON', 'GENDER', 'STYLE')),
    CONSTRAINT "PricePromotionTarget_mode_enum_ck" CHECK ("mode" IN ('INCLUDE', 'EXCLUDE')),
    CONSTRAINT "PricePromotionTarget_gender_enum_ck" CHECK ("gender" IN ('MEN', 'WOMEN', 'UNISEX')),
    CONSTRAINT "PricePromotionTarget_shape_ck" CHECK (("targetType" = 'ALL'      AND "categoryId" IS NULL     AND "seasonId" IS NULL     AND "gender" IS NULL     AND "styleId" IS NULL) OR ("targetType" = 'CATEGORY' AND "categoryId" IS NOT NULL AND "seasonId" IS NULL     AND "gender" IS NULL     AND "styleId" IS NULL) OR ("targetType" = 'SEASON'   AND "categoryId" IS NULL     AND "seasonId" IS NOT NULL AND "gender" IS NULL     AND "styleId" IS NULL) OR ("targetType" = 'GENDER'   AND "categoryId" IS NULL     AND "seasonId" IS NULL     AND "gender" IS NOT NULL AND "styleId" IS NULL) OR ("targetType" = 'STYLE'    AND "categoryId" IS NULL     AND "seasonId" IS NULL     AND "gender" IS NULL     AND "styleId" IS NOT NULL)),
    CONSTRAINT "PricePromotionTarget_override_ck" CHECK ("discountValueOverride" IS NULL OR ("mode" = 'INCLUDE' AND typeof("discountValueOverride") = 'integer' AND "discountValueOverride" > 0))
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OrderItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "skuId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "listPrice" INTEGER NOT NULL,
    "discountAmount" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "promotionId" INTEGER,
    "promotionName" TEXT,
    "styleCode" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "styleName" TEXT NOT NULL,
    "colorName" TEXT NOT NULL,
    "sizeName" TEXT NOT NULL,
    "imageUrl" TEXT,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "PricePromotion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_quantity_ck" CHECK (typeof("quantity") = 'integer' AND "quantity" >= 1),
    CONSTRAINT "OrderItem_amounts_ck" CHECK (typeof("listPrice") = 'integer' AND "listPrice" >= 0 AND typeof("discountAmount") = 'integer' AND "discountAmount" >= 0 AND typeof("price") = 'integer' AND "price" >= 0),
    CONSTRAINT "OrderItem_price_math_ck" CHECK ("price" = "listPrice" - "discountAmount"),
    CONSTRAINT "OrderItem_promotion_ck" CHECK ("discountAmount" = 0 OR "promotionName" IS NOT NULL)
);
-- (위에서 기존 주문을 지웠으므로 옮길 행이 없습니다)
DROP TABLE "OrderItem";
ALTER TABLE "new_OrderItem" RENAME TO "OrderItem";
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX "OrderItem_skuId_idx" ON "OrderItem"("skuId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Season_code_key" ON "Season"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Category_code_key" ON "Category"("code");

-- CreateIndex
CREATE INDEX "Category_parentId_idx" ON "Category"("parentId");

-- CreateIndex
CREATE INDEX "Category_path_idx" ON "Category"("path");

-- CreateIndex
CREATE UNIQUE INDEX "Color_code_key" ON "Color"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SizeGroup_code_key" ON "SizeGroup"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Size_sizeGroupId_code_key" ON "Size"("sizeGroupId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Size_sizeGroupId_sortOrder_key" ON "Size"("sizeGroupId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Material_code_key" ON "Material"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Manufacturer_code_key" ON "Manufacturer"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CareSymbol_code_key" ON "CareSymbol"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Style_styleCode_key" ON "Style"("styleCode");

-- CreateIndex
CREATE INDEX "Style_categoryId_idx" ON "Style"("categoryId");

-- CreateIndex
CREATE INDEX "Style_status_isDisplayed_idx" ON "Style"("status", "isDisplayed");

-- CreateIndex
CREATE UNIQUE INDEX "StyleColor_code_key" ON "StyleColor"("code");

-- CreateIndex
CREATE UNIQUE INDEX "StyleColor_styleId_colorId_key" ON "StyleColor"("styleId", "colorId");

-- CreateIndex
CREATE UNIQUE INDEX "StyleColor_styleId_sortOrder_key" ON "StyleColor"("styleId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Sku_skuCode_key" ON "Sku"("skuCode");

-- CreateIndex
CREATE UNIQUE INDEX "Sku_barcode_key" ON "Sku"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "Sku_styleColorId_sizeId_key" ON "Sku"("styleColorId", "sizeId");

-- CreateIndex
CREATE INDEX "StyleColorImage_styleColorId_sortOrder_idx" ON "StyleColorImage"("styleColorId", "sortOrder");

-- CreateIndex
CREATE INDEX "StyleMaterial_styleId_idx" ON "StyleMaterial"("styleId");

-- CreateIndex
CREATE INDEX "StyleMaterial_materialId_idx" ON "StyleMaterial"("materialId");

-- CreateIndex
CREATE INDEX "StyleWearSeason_season_idx" ON "StyleWearSeason"("season");

-- CreateIndex
CREATE INDEX "StyleDetailBlock_styleId_sortOrder_idx" ON "StyleDetailBlock"("styleId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "SizeMeasurement_styleId_sizeId_item_key" ON "SizeMeasurement"("styleId", "sizeId", "item");

-- CreateIndex
CREATE INDEX "ModelWear_styleId_idx" ON "ModelWear"("styleId");

-- CreateIndex
CREATE INDEX "StylePrice_styleId_validFrom_idx" ON "StylePrice"("styleId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PricePromotion_code_key" ON "PricePromotion"("code");

-- CreateIndex
CREATE INDEX "PricePromotion_status_startAt_endAt_idx" ON "PricePromotion"("status", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "PricePromotionTarget_promotionId_idx" ON "PricePromotionTarget"("promotionId");

-- CreateIndex
CREATE INDEX "PricePromotionTarget_styleId_idx" ON "PricePromotionTarget"("styleId");

-- CreateIndex
CREATE INDEX "PricePromotionTarget_categoryId_idx" ON "PricePromotionTarget"("categoryId");

-- >>> db-constraints: 트리거 (prisma/db-constraints.ts에서 생성, 직접 수정 금지)

-- 처음부터 ON_SALE로 등록 금지. 등록 순간에는 고시·이미지가 없으므로 DRAFT로 등록 → 정보 입력 → ON_SALE
DROP TRIGGER IF EXISTS "Style_sale_ready_ins";
CREATE TRIGGER "Style_sale_ready_ins" BEFORE INSERT ON "Style"
WHEN NEW."status" = 'ON_SALE'
BEGIN SELECT RAISE(ABORT, 'Style_sale_ready: DRAFT로 등록한 뒤 필요한 정보를 채우고 ON_SALE로 바꿔야 합니다'); END;

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

-- 판매 중인 상품의 고시 정보 삭제 금지 (판매 중지 후 수정)
DROP TRIGGER IF EXISTS "StyleNotice_on_sale_delete";
CREATE TRIGGER "StyleNotice_on_sale_delete" BEFORE DELETE ON "StyleNotice"
WHEN (SELECT s."status" FROM "Style" s WHERE s."id" = OLD."styleId") = 'ON_SALE'
BEGIN SELECT RAISE(ABORT, 'StyleNotice_on_sale_delete: 판매 중인 상품의 고시 정보는 지울 수 없습니다. 먼저 판매를 중지하세요'); END;

-- 컬러 품번은 반드시 '스타일코드-컬러코드' (JK26F001-BK)
DROP TRIGGER IF EXISTS "StyleColor_code_match_ins";
CREATE TRIGGER "StyleColor_code_match_ins" BEFORE INSERT ON "StyleColor"
WHEN NEW."code" IS NOT ((SELECT s."styleCode" FROM "Style" s WHERE s."id" = NEW."styleId") || '-' || (SELECT c."code" FROM "Color" c WHERE c."id" = NEW."colorId"))
BEGIN SELECT RAISE(ABORT, 'StyleColor_code_match: 컬러 품번은 스타일코드-컬러코드여야 합니다'); END;

-- 위와 같음 (수정 시)
DROP TRIGGER IF EXISTS "StyleColor_code_match_upd";
CREATE TRIGGER "StyleColor_code_match_upd" BEFORE UPDATE OF "code", "colorId" ON "StyleColor"
WHEN NEW."code" IS NOT ((SELECT s."styleCode" FROM "Style" s WHERE s."id" = NEW."styleId") || '-' || (SELECT c."code" FROM "Color" c WHERE c."id" = NEW."colorId"))
BEGIN SELECT RAISE(ABORT, 'StyleColor_code_match: 컬러 품번은 스타일코드-컬러코드여야 합니다'); END;

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

-- 컬러가 있는 스타일의 품번 변경 금지 (컬러 품번·SKU 코드·ERP·바코드와 어긋남)
DROP TRIGGER IF EXISTS "Style_code_fixed";
CREATE TRIGGER "Style_code_fixed" BEFORE UPDATE OF "styleCode" ON "Style"
WHEN NEW."styleCode" IS NOT OLD."styleCode" AND EXISTS (SELECT 1 FROM "StyleColor" c WHERE c."styleId" = NEW."id")
BEGIN SELECT RAISE(ABORT, 'Style_code_fixed: 컬러가 등록된 스타일의 품번은 바꿀 수 없습니다'); END;

-- 상품에 쓰인 컬러 코드 변경 금지
DROP TRIGGER IF EXISTS "Color_code_fixed";
CREATE TRIGGER "Color_code_fixed" BEFORE UPDATE OF "code" ON "Color"
WHEN NEW."code" IS NOT OLD."code" AND EXISTS (SELECT 1 FROM "StyleColor" c WHERE c."colorId" = NEW."id")
BEGIN SELECT RAISE(ABORT, 'Color_code_fixed: 상품에 쓰인 컬러 코드는 바꿀 수 없습니다'); END;

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

-- 실측 사이즈는 스타일의 사이즈 체계에 속해야 함
DROP TRIGGER IF EXISTS "SizeMeasurement_size_group_ins";
CREATE TRIGGER "SizeMeasurement_size_group_ins" BEFORE INSERT ON "SizeMeasurement"
WHEN (SELECT z."sizeGroupId" FROM "Size" z WHERE z."id" = NEW."sizeId") IS NOT (SELECT st."sizeGroupId" FROM "Style" st WHERE st."id" = NEW."styleId")
BEGIN SELECT RAISE(ABORT, 'SizeMeasurement_size_group: 실측 사이즈가 스타일의 사이즈 체계에 속하지 않습니다'); END;

-- 위와 같음 (수정 시)
DROP TRIGGER IF EXISTS "SizeMeasurement_size_group_upd";
CREATE TRIGGER "SizeMeasurement_size_group_upd" BEFORE UPDATE OF "sizeId", "styleId" ON "SizeMeasurement"
WHEN (SELECT z."sizeGroupId" FROM "Size" z WHERE z."id" = NEW."sizeId") IS NOT (SELECT st."sizeGroupId" FROM "Style" st WHERE st."id" = NEW."styleId")
BEGIN SELECT RAISE(ABORT, 'SizeMeasurement_size_group: 실측 사이즈가 스타일의 사이즈 체계에 속하지 않습니다'); END;

-- 착용 사이즈는 스타일의 사이즈 체계, 착용 컬러는 같은 스타일의 컬러여야 함
DROP TRIGGER IF EXISTS "ModelWear_consistency_ins";
CREATE TRIGGER "ModelWear_consistency_ins" BEFORE INSERT ON "ModelWear"
WHEN (SELECT z."sizeGroupId" FROM "Size" z WHERE z."id" = NEW."sizeId") IS NOT (SELECT st."sizeGroupId" FROM "Style" st WHERE st."id" = NEW."styleId")
  OR (NEW."styleColorId" IS NOT NULL AND (SELECT sc."styleId" FROM "StyleColor" sc WHERE sc."id" = NEW."styleColorId") IS NOT NEW."styleId")
BEGIN SELECT RAISE(ABORT, 'ModelWear_consistency: 착용 사이즈나 컬러가 이 스타일의 것이 아닙니다'); END;

-- 위와 같음 (수정 시)
DROP TRIGGER IF EXISTS "ModelWear_consistency_upd";
CREATE TRIGGER "ModelWear_consistency_upd" BEFORE UPDATE OF "sizeId", "styleId", "styleColorId" ON "ModelWear"
WHEN (SELECT z."sizeGroupId" FROM "Size" z WHERE z."id" = NEW."sizeId") IS NOT (SELECT st."sizeGroupId" FROM "Style" st WHERE st."id" = NEW."styleId")
  OR (NEW."styleColorId" IS NOT NULL AND (SELECT sc."styleId" FROM "StyleColor" sc WHERE sc."id" = NEW."styleColorId") IS NOT NEW."styleId")
BEGIN SELECT RAISE(ABORT, 'ModelWear_consistency: 착용 사이즈나 컬러가 이 스타일의 것이 아닙니다'); END;

-- SKU·실측·모델 정보가 있는 스타일의 사이즈 체계를 바꾸면 기존 사이즈와 어긋남 → 거부
DROP TRIGGER IF EXISTS "Style_size_group_change";
CREATE TRIGGER "Style_size_group_change" BEFORE UPDATE OF "sizeGroupId" ON "Style"
WHEN NEW."sizeGroupId" <> OLD."sizeGroupId" AND (
  EXISTS (SELECT 1 FROM "Sku" k JOIN "StyleColor" sc ON sc."id" = k."styleColorId" WHERE sc."styleId" = NEW."id")
  OR EXISTS (SELECT 1 FROM "SizeMeasurement" m WHERE m."styleId" = NEW."id")
  OR EXISTS (SELECT 1 FROM "ModelWear" w WHERE w."styleId" = NEW."id"))
BEGIN SELECT RAISE(ABORT, 'Style_size_group_change: SKU·실측·모델 정보가 있는 스타일은 사이즈 체계를 바꿀 수 없습니다'); END;

-- 컬러를 다른 스타일로 옮기면 SKU 사이즈 검사를 우회하게 됨 → 스타일 변경 금지
DROP TRIGGER IF EXISTS "StyleColor_style_fixed";
CREATE TRIGGER "StyleColor_style_fixed" BEFORE UPDATE OF "styleId" ON "StyleColor"
WHEN NEW."styleId" <> OLD."styleId"
BEGIN SELECT RAISE(ABORT, 'StyleColor_style_fixed: 컬러를 다른 스타일로 옮길 수 없습니다'); END;

-- 같은 스타일의 정가 기간이 겹치면 '지금 정가'가 2개가 됨 → 거부 (현재 정가 1개도 이걸로 보장)
DROP TRIGGER IF EXISTS "StylePrice_no_overlap_ins";
CREATE TRIGGER "StylePrice_no_overlap_ins" BEFORE INSERT ON "StylePrice"
WHEN EXISTS (
    SELECT 1 FROM "StylePrice" o
    WHERE o."styleId" = NEW."styleId"
      AND NEW."validFrom" < COALESCE(o."validTo", '9999-12-31T23:59:59.999+00:00')
      AND o."validFrom" < COALESCE(NEW."validTo", '9999-12-31T23:59:59.999+00:00'))
BEGIN SELECT RAISE(ABORT, 'StylePrice_no_overlap: 같은 스타일의 정가 적용 기간이 겹칩니다'); END;

-- 위와 같음 (수정 시)
DROP TRIGGER IF EXISTS "StylePrice_no_overlap_upd";
CREATE TRIGGER "StylePrice_no_overlap_upd" BEFORE UPDATE OF "styleId", "validFrom", "validTo" ON "StylePrice"
WHEN EXISTS (
    SELECT 1 FROM "StylePrice" o
    WHERE o."styleId" = NEW."styleId" AND o."id" <> NEW."id"
      AND NEW."validFrom" < COALESCE(o."validTo", '9999-12-31T23:59:59.999+00:00')
      AND o."validFrom" < COALESCE(NEW."validTo", '9999-12-31T23:59:59.999+00:00'))
BEGIN SELECT RAISE(ABORT, 'StylePrice_no_overlap: 같은 스타일의 정가 적용 기간이 겹칩니다'); END;

-- 정률 행사의 대상별 할인값도 1~99%
DROP TRIGGER IF EXISTS "PricePromotionTarget_rate_override_ins";
CREATE TRIGGER "PricePromotionTarget_rate_override_ins" BEFORE INSERT ON "PricePromotionTarget"
WHEN NEW."discountValueOverride" IS NOT NULL
  AND (SELECT p."discountType" FROM "PricePromotion" p WHERE p."id" = NEW."promotionId") = 'RATE'
  AND NEW."discountValueOverride" NOT BETWEEN 1 AND 99
BEGIN SELECT RAISE(ABORT, 'PricePromotionTarget_rate_override: 정률 할인값은 1~99%여야 합니다'); END;

-- 위와 같음 (수정 시)
DROP TRIGGER IF EXISTS "PricePromotionTarget_rate_override_upd";
CREATE TRIGGER "PricePromotionTarget_rate_override_upd" BEFORE UPDATE OF "discountValueOverride", "promotionId" ON "PricePromotionTarget"
WHEN NEW."discountValueOverride" IS NOT NULL
  AND (SELECT p."discountType" FROM "PricePromotion" p WHERE p."id" = NEW."promotionId") = 'RATE'
  AND NEW."discountValueOverride" NOT BETWEEN 1 AND 99
BEGIN SELECT RAISE(ABORT, 'PricePromotionTarget_rate_override: 정률 할인값은 1~99%여야 합니다'); END;

-- 행사를 정률로 바꿀 때 대상별 할인값이 99%를 넘으면 거부
DROP TRIGGER IF EXISTS "PricePromotion_rate_targets_upd";
CREATE TRIGGER "PricePromotion_rate_targets_upd" BEFORE UPDATE OF "discountType" ON "PricePromotion"
WHEN NEW."discountType" = 'RATE' AND EXISTS (
  SELECT 1 FROM "PricePromotionTarget" t
  WHERE t."promotionId" = NEW."id" AND t."discountValueOverride" IS NOT NULL AND t."discountValueOverride" NOT BETWEEN 1 AND 99)
BEGIN SELECT RAISE(ABORT, 'PricePromotion_rate_targets: 대상별 할인값이 1~99%를 벗어나 정률로 바꿀 수 없습니다'); END;

-- path·depth는 사람이 입력하지 않고 DB가 부모를 보고 계산 (중복 저장 값이 어긋나지 않게)
DROP TRIGGER IF EXISTS "Category_path_fill";
CREATE TRIGGER "Category_path_fill" AFTER INSERT ON "Category"
BEGIN
  UPDATE "Category" SET "path" = COALESCE((SELECT p."path" FROM "Category" p WHERE p."id" = NEW."parentId"), '/') || NEW."id" || '/', "depth" = COALESCE((SELECT p."depth" FROM "Category" p WHERE p."id" = NEW."parentId"), 0) + 1 WHERE "id" = NEW."id";
END;

-- path·depth를 계산 값과 다르게 고치는 것 금지
DROP TRIGGER IF EXISTS "Category_path_guard";
CREATE TRIGGER "Category_path_guard" BEFORE UPDATE OF "path", "depth" ON "Category"
WHEN NEW."path" IS NOT (COALESCE((SELECT p."path" FROM "Category" p WHERE p."id" = NEW."parentId"), '/') || NEW."id" || '/') OR NEW."depth" IS NOT (COALESCE((SELECT p."depth" FROM "Category" p WHERE p."id" = NEW."parentId"), 0) + 1)
BEGIN SELECT RAISE(ABORT, 'Category_path_guard: path/depth는 부모 기준으로 자동 계산되며 직접 바꿀 수 없습니다'); END;

-- 부모를 바꾸면 하위 전체의 path를 다시 계산해야 함 → 지금은 금지 (필요해지면 관리자 단계에서 이동 기능으로)
DROP TRIGGER IF EXISTS "Category_parent_fixed";
CREATE TRIGGER "Category_parent_fixed" BEFORE UPDATE OF "parentId" ON "Category"
WHEN NEW."parentId" IS NOT OLD."parentId"
BEGIN SELECT RAISE(ABORT, 'Category_parent_fixed: 카테고리 부모는 바꿀 수 없습니다'); END;

-- <<< db-constraints
