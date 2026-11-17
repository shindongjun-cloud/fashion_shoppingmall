-- 상품 도메인 B안 (Style → StyleColor → Sku)
-- 기존 테스트 주문 데이터 초기화 (옛 Product 기준이라 SKU로 변환 불가)
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Category" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "parentId" INTEGER,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL,
    "noticeType" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Color" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "hex" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "SizeGroup" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Size" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sizeGroupId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    CONSTRAINT "Size_sizeGroupId_fkey" FOREIGN KEY ("sizeGroupId") REFERENCES "SizeGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
    CONSTRAINT "Style_sizeGroupId_fkey" FOREIGN KEY ("sizeGroupId") REFERENCES "SizeGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
    CONSTRAINT "StyleColor_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "Color" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
    CONSTRAINT "Sku_sizeId_fkey" FOREIGN KEY ("sizeId") REFERENCES "Size" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StyleColorImage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "styleColorId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "alt" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "StyleColorImage_styleColorId_fkey" FOREIGN KEY ("styleColorId") REFERENCES "StyleColor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StyleMaterial" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "styleId" INTEGER NOT NULL,
    "part" TEXT NOT NULL,
    "material" TEXT NOT NULL,
    "percent" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "StyleMaterial_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SizeMeasurement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "styleId" INTEGER NOT NULL,
    "sizeId" INTEGER NOT NULL,
    "item" TEXT NOT NULL,
    "valueCm" REAL NOT NULL,
    CONSTRAINT "SizeMeasurement_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SizeMeasurement_sizeId_fkey" FOREIGN KEY ("sizeId") REFERENCES "Size" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
    CONSTRAINT "ModelWear_sizeId_fkey" FOREIGN KEY ("sizeId") REFERENCES "Size" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StyleNotice" (
    "styleId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "noticeType" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StyleNotice_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OrderItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "skuId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "styleCode" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "styleName" TEXT NOT NULL,
    "colorName" TEXT NOT NULL,
    "sizeName" TEXT NOT NULL,
    "imageUrl" TEXT,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- 기존 테스트 주문은 옛 Product를 가리켜서 새 구조(SKU)로 옮길 수 없으므로 복사하지 않습니다.
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
CREATE UNIQUE INDEX "SizeMeasurement_styleId_sizeId_item_key" ON "SizeMeasurement"("styleId", "sizeId", "item");

-- CreateIndex
CREATE INDEX "ModelWear_styleId_idx" ON "ModelWear"("styleId");

