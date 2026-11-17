-- 상품 도메인 A안 보강: Material, Manufacturer, CareSymbol, StyleCare, StyleWearSeason, StyleDetailBlock
-- StyleMaterial.material(글자)이 materialId(소재 마스터 참조)로 바뀝니다.
--
-- 지금 DB에는 seed로 넣은 샘플 상품만 있고 주문은 0건이라, 샘플 상품을 비우고 seed로 다시 넣습니다.
-- (실무에서 실제 데이터가 있다면: Material에 기존 글자값을 먼저 INSERT하고,
--  이름으로 JOIN해서 materialId를 채우는 "데이터 이전 SQL"을 여기에 씁니다.)
DELETE FROM "OrderItem";
DELETE FROM "Order";
DELETE FROM "StyleNotice";
DELETE FROM "ModelWear";
DELETE FROM "SizeMeasurement";
DELETE FROM "StyleMaterial";
DELETE FROM "StyleColorImage";
DELETE FROM "Sku";
DELETE FROM "StyleColor";
DELETE FROM "Style";
DELETE FROM "Size";
DELETE FROM "SizeGroup";
DELETE FROM "Color";
DELETE FROM "Category";
DELETE FROM "Season";

-- CreateTable
CREATE TABLE "Material" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CareSymbol" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0
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
    CONSTRAINT "StyleWearSeason_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    CONSTRAINT "StyleDetailBlock_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Style" (
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
    "listPrice" INTEGER NOT NULL,
    "salePrice" INTEGER NOT NULL,
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
    CONSTRAINT "Style_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Style_sizeGroupId_fkey" FOREIGN KEY ("sizeGroupId") REFERENCES "SizeGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Style_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "Manufacturer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Style" ("categoryId", "createdAt", "deletedAt", "description", "fit", "gender", "id", "isDisplayed", "lining", "listPrice", "name", "releasedAt", "saleEndAt", "salePrice", "saleStartAt", "seasonId", "sheerness", "sizeGroupId", "status", "stretch", "styleCode", "summary", "thickness", "updatedAt") SELECT "categoryId", "createdAt", "deletedAt", "description", "fit", "gender", "id", "isDisplayed", "lining", "listPrice", "name", "releasedAt", "saleEndAt", "salePrice", "saleStartAt", "seasonId", "sheerness", "sizeGroupId", "status", "stretch", "styleCode", "summary", "thickness", "updatedAt" FROM "Style";
DROP TABLE "Style";
ALTER TABLE "new_Style" RENAME TO "Style";
CREATE UNIQUE INDEX "Style_styleCode_key" ON "Style"("styleCode");
CREATE INDEX "Style_categoryId_idx" ON "Style"("categoryId");
CREATE INDEX "Style_status_isDisplayed_idx" ON "Style"("status", "isDisplayed");
CREATE TABLE "new_StyleMaterial" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "styleId" INTEGER NOT NULL,
    "part" TEXT NOT NULL,
    "materialId" INTEGER NOT NULL,
    "percent" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "StyleMaterial_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StyleMaterial_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_StyleMaterial" ("id", "part", "percent", "sortOrder", "styleId") SELECT "id", "part", "percent", "sortOrder", "styleId" FROM "StyleMaterial";
DROP TABLE "StyleMaterial";
ALTER TABLE "new_StyleMaterial" RENAME TO "StyleMaterial";
CREATE INDEX "StyleMaterial_styleId_idx" ON "StyleMaterial"("styleId");
CREATE INDEX "StyleMaterial_materialId_idx" ON "StyleMaterial"("materialId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Material_code_key" ON "Material"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Manufacturer_code_key" ON "Manufacturer"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CareSymbol_code_key" ON "CareSymbol"("code");

-- CreateIndex
CREATE INDEX "StyleWearSeason_season_idx" ON "StyleWearSeason"("season");

-- CreateIndex
CREATE INDEX "StyleDetailBlock_styleId_sortOrder_idx" ON "StyleDetailBlock"("styleId", "sortOrder");

