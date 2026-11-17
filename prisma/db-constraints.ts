// DB 제약조건 정의 (한 곳에서 관리)
//
// Prisma 스키마 문법으로는 CHECK 제약과 트리거를 쓸 수 없습니다. 그래서 여기에 정의하고,
//  - scripts/inject-constraints.ts : 마이그레이션 SQL의 CREATE TABLE에 CHECK를 끼워 넣고 트리거를 붙임
//  - scripts/db-verify.ts          : 실제 DB에 제약이 살아 있는지 + 기존 데이터가 규칙을 지키는지 검사
// 두 스크립트가 모두 이 파일을 읽습니다. (규칙을 두 군데에 쓰면 언젠가 어긋나기 때문)
//
// ⚠️ SQLite + Prisma 주의
//  - SQLite에는 enum 타입이 없어서 Prisma enum은 TEXT로 저장됩니다. → enum마다 CHECK (… IN (…))를 자동 생성
//  - SQLite는 INTEGER 칸에도 글자를 저장합니다. 글자는 모든 숫자보다 "큰" 값이라 `x >= 0`만으로는 'abc'가 통과
//    → 금액·재고는 typeof(x) = 'integer'도 함께 검사
//  - Prisma는 컬럼을 바꿀 때 테이블을 새로 만들고(new_X) 데이터를 옮깁니다. 이때 CHECK·트리거가 사라지므로
//    새 마이그레이션마다 inject-constraints를 다시 실행해야 합니다. (db:verify가 빠진 것을 잡아냄)
//  - 날짜는 Prisma가 '2026-11-17T05:36:03.164+00:00' 형식의 TEXT로 저장합니다(항상 UTC).
//    형식이 같으면 글자 비교 = 시간 비교라서 CHECK (endAt > startAt)이 정확히 동작합니다.
//    SQLite의 CURRENT_TIMESTAMP('2026-11-17 06:06:50')는 형식이 달라 비교가 깨지므로 형식도 검사합니다.

export type CheckConstraint = {
  table: string;
  name: string; // CONSTRAINT 이름 (에러 메시지에 그대로 나옴: "CHECK constraint failed: Sku_stock_ck")
  expr: string; // CHECK ( … ) 안의 SQL
  why: string; // 사람이 읽는 설명
};

export type TriggerConstraint = {
  table: string; // 트리거가 붙는 테이블 (이 테이블을 다시 만들면 트리거도 다시 붙여야 함)
  name: string;
  sql: string; // CREATE TRIGGER 문 전체
  why: string;
};

// ---------------------------------------------------------------
// SQL 조각 도우미
// ---------------------------------------------------------------
const q = (col: string) => `"${col}"`;
/** 정수이고 조건을 만족 */
const int = (col: string, cond: string) => `typeof(${q(col)}) = 'integer' AND ${q(col)} ${cond}`;
/** NULL이거나, 정수이고 조건을 만족 */
const intOrNull = (col: string, cond: string) => `${q(col)} IS NULL OR (${int(col, cond)})`;
/** Prisma가 쓰는 날짜 형식 (YYYY-MM-DDTHH:MM:SS…) */
const ISO = "'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'";
const isoDate = (col: string) => `${q(col)} GLOB ${ISO}`;
const isoDateOrNull = (col: string) => `${q(col)} IS NULL OR ${q(col)} GLOB ${ISO}`;
/** 대문자·숫자·밑줄만 (코드값) */
const upperCode = (col: string) => `${q(col)} <> '' AND ${q(col)} NOT GLOB '*[^A-Z0-9_]*'`;
const notBlank = (col: string) => `trim(${q(col)}) <> ''`;
const FOREVER = "'9999-12-31T23:59:59.999+00:00'";

// ---------------------------------------------------------------
// 1) 직접 정의하는 CHECK 제약
// ---------------------------------------------------------------
const MANUAL_CHECKS: CheckConstraint[] = [
  // ----- 마스터
  { table: "Season", name: "Season_code_ck", expr: upperCode("code"), why: "시즌 코드는 26FW처럼 대문자·숫자" },
  { table: "Season", name: "Season_year_ck", expr: int("year", "BETWEEN 2000 AND 2100"), why: "연도 범위" },
  { table: "Season", name: "Season_period_ck", expr: `"startDate" IS NULL OR "endDate" IS NULL OR "endDate" > "startDate"`, why: "종료일은 시작일 이후" },
  { table: "Season", name: "Season_dates_ck", expr: `(${isoDateOrNull("startDate")}) AND (${isoDateOrNull("endDate")})`, why: "날짜 형식" },
  { table: "Season", name: "Season_code_term_ck", expr: `"code" = substr(CAST("year" AS TEXT), 3, 2) || "term"`, why: "시즌 코드 = 연도 끝 2자리 + 구분 (2026·FW → 26FW). 코드와 구분이 어긋나지 않게" },

  { table: "Category", name: "Category_code_ck", expr: upperCode("code"), why: "카테고리 코드 형식" },
  { table: "Category", name: "Category_name_ck", expr: notBlank("name"), why: "이름 필수" },
  { table: "Category", name: "Category_not_self_parent_ck", expr: `"parentId" IS NULL OR "parentId" <> "id"`, why: "자기 자신을 부모로 지정 금지" },
  { table: "Category", name: "Category_depth_ck", expr: int("depth", ">= 1"), why: "깊이는 1 이상 (정확한 값은 트리거가 계산)" },
  { table: "Category", name: "Category_path_ck", expr: `"path" GLOB '/*'`, why: "경로는 /로 시작 (정확한 값은 트리거가 계산)" },

  { table: "Color", name: "Color_code_ck", expr: `length("code") = 2 AND "code" NOT GLOB '*[^A-Z]*'`, why: "컬러 코드는 대문자 2자리 (품번에 들어감)" },
  { table: "Color", name: "Color_hex_ck", expr: `"hex" GLOB '#[0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F]'`, why: "컬러칩 색은 #RRGGBB (대문자)" },

  { table: "SizeGroup", name: "SizeGroup_code_ck", expr: upperCode("code"), why: "사이즈 체계 코드 형식" },
  { table: "Size", name: "Size_code_ck", expr: `${notBlank("code")} AND "code" NOT GLOB '*[^A-Z0-9]*'`, why: "사이즈 코드는 SKU 코드에 들어가므로 대문자·숫자만" },
  { table: "Size", name: "Size_sort_ck", expr: int("sortOrder", ">= 0"), why: "정렬 순서" },

  { table: "Material", name: "Material_code_ck", expr: upperCode("code"), why: "소재 코드 형식" },
  { table: "Manufacturer", name: "Manufacturer_code_ck", expr: upperCode("code"), why: "제조사 코드 형식" },
  { table: "Manufacturer", name: "Manufacturer_name_ck", expr: notBlank("name"), why: "고시 정보에 쓰이므로 이름 필수" },
  { table: "CareSymbol", name: "CareSymbol_code_ck", expr: upperCode("code"), why: "세탁 기호 코드 형식" },

  // ----- 핵심 3단 구조
  { table: "Style", name: "Style_code_ck", expr: `length("styleCode") BETWEEN 6 AND 20 AND "styleCode" NOT GLOB '*[^A-Z0-9]*'`, why: "품번은 대문자·숫자 6~20자 (URL·SKU 코드에 쓰임)" },
  { table: "Style", name: "Style_name_ck", expr: notBlank("name"), why: "상품명 필수" },
  { table: "Style", name: "Style_max_qty_ck", expr: intOrNull("maxQtyPerOrder", ">= 1"), why: "1회 주문 한도는 1개 이상" },
  { table: "Style", name: "Style_sale_period_ck", expr: `"saleStartAt" IS NULL OR "saleEndAt" IS NULL OR "saleEndAt" > "saleStartAt"`, why: "판매 종료는 시작 이후" },
  { table: "Style", name: "Style_dates_ck", expr: `(${isoDateOrNull("saleStartAt")}) AND (${isoDateOrNull("saleEndAt")}) AND (${isoDateOrNull("releasedAt")}) AND (${isoDateOrNull("preorderShipDate")})`, why: "날짜 형식 (비교가 깨지지 않게)" },

  { table: "StyleColor", name: "StyleColor_code_ck", expr: `"code" GLOB '*-[A-Z][A-Z]'`, why: "컬러 품번은 스타일코드-컬러코드" },
  { table: "StyleColor", name: "StyleColor_sort_ck", expr: int("sortOrder", ">= 0"), why: "정렬 순서" },

  { table: "Sku", name: "Sku_stock_ck", expr: int("stock", ">= 0"), why: "재고는 0 이상의 정수" },
  { table: "Sku", name: "Sku_code_ck", expr: `"skuCode" GLOB '*-*-*' AND "skuCode" NOT GLOB '*[^A-Z0-9-]*'`, why: "SKU 코드는 스타일-컬러-사이즈" },
  { table: "Sku", name: "Sku_barcode_ck", expr: `"barcode" IS NULL OR (length("barcode") BETWEEN 8 AND 14 AND "barcode" NOT GLOB '*[^0-9]*')`, why: "바코드는 숫자 8~14자리" },

  // ----- 상세 정보
  { table: "StyleColorImage", name: "StyleColorImage_url_ck", expr: notBlank("url"), why: "이미지 주소 필수" },
  { table: "StyleColorImage", name: "StyleColorImage_alt_ck", expr: notBlank("alt"), why: "대체 텍스트 필수 (접근성)" },
  { table: "StyleMaterial", name: "StyleMaterial_percent_ck", expr: int("percent", "BETWEEN 1 AND 100"), why: "혼용률은 1~100% (부위별 합계 100은 db:verify가 검사)" },
  { table: "StyleMaterial", name: "StyleMaterial_part_ck", expr: notBlank("part"), why: "부위 필수" },
  { table: "SizeMeasurement", name: "SizeMeasurement_value_ck", expr: `typeof("valueCm") IN ('real', 'integer') AND "valueCm" > 0 AND "valueCm" < 500`, why: "실측값은 0~500cm" },
  { table: "ModelWear", name: "ModelWear_height_ck", expr: int("heightCm", "BETWEEN 100 AND 250"), why: "모델 키 범위" },
  { table: "ModelWear", name: "ModelWear_weight_ck", expr: intOrNull("weightKg", "BETWEEN 20 AND 300"), why: "모델 몸무게 범위" },
  { table: "StyleNotice", name: "StyleNotice_content_ck", expr: `json_valid("content") AND json_type("content") = 'array' AND json_array_length("content") > 0`, why: "고시 정보는 비어 있지 않은 JSON 배열" },
  {
    table: "StyleDetailBlock",
    name: "StyleDetailBlock_type_fields_ck",
    expr: `("type" = 'TEXT' AND "body" IS NOT NULL AND trim("body") <> '') OR ("type" = 'IMAGE' AND "mediaUrl" IS NOT NULL AND "alt" IS NOT NULL) OR ("type" = 'VIDEO' AND "mediaUrl" IS NOT NULL)`,
    why: "블록 종류별 필수 칸 (TEXT=본문, IMAGE=주소+대체텍스트, VIDEO=주소)",
  },

  // ----- 가격
  { table: "StylePrice", name: "StylePrice_amount_ck", expr: int("listPrice", "> 0"), why: "정가는 1원 이상의 정수" },
  { table: "StylePrice", name: "StylePrice_currency_ck", expr: `"currency" GLOB '[A-Z][A-Z][A-Z]'`, why: "통화 코드 3자리 (KRW)" },
  { table: "StylePrice", name: "StylePrice_period_ck", expr: `"validTo" IS NULL OR "validTo" > "validFrom"`, why: "적용 종료는 시작 이후" },
  { table: "StylePrice", name: "StylePrice_dates_ck", expr: `(${isoDate("validFrom")}) AND (${isoDateOrNull("validTo")})`, why: "날짜 형식 (기간 비교가 깨지지 않게)" },

  { table: "PricePromotion", name: "PricePromotion_code_ck", expr: upperCode("code"), why: "행사 코드 형식" },
  { table: "PricePromotion", name: "PricePromotion_value_ck", expr: `${int("discountValue", "> 0")} AND ("discountType" <> 'RATE' OR "discountValue" BETWEEN 1 AND 99)`, why: "할인값 > 0, 정률은 1~99% (100% = 무료 판매 사고)" },
  { table: "PricePromotion", name: "PricePromotion_max_discount_ck", expr: intOrNull("maxDiscountAmount", "> 0"), why: "최대 할인 한도 > 0" },
  { table: "PricePromotion", name: "PricePromotion_min_price_ck", expr: intOrNull("minListPrice", ">= 0"), why: "최소 정가 >= 0" },
  { table: "PricePromotion", name: "PricePromotion_rounding_ck", expr: `"roundingUnit" IN (1, 10, 100, 1000)`, why: "끝자리 단위는 1/10/100/1000원" },
  { table: "PricePromotion", name: "PricePromotion_period_ck", expr: `"endAt" > "startAt"`, why: "종료는 시작 이후" },
  { table: "PricePromotion", name: "PricePromotion_dates_ck", expr: `(${isoDate("startAt")}) AND (${isoDate("endAt")}) AND (${isoDateOrNull("approvedAt")})`, why: "날짜 형식" },
  { table: "PricePromotion", name: "PricePromotion_approval_ck", expr: `"status" <> 'APPROVED' OR "approvedAt" IS NOT NULL`, why: "확정된 행사는 승인 시각 필수" },
  { table: "PricePromotion", name: "PricePromotion_priority_ck", expr: int("priority", ">= 0"), why: "우선순위 >= 0" },
  {
    table: "PricePromotionTarget",
    name: "PricePromotionTarget_shape_ck",
    expr: [
      `("targetType" = 'ALL'      AND "categoryId" IS NULL     AND "seasonId" IS NULL     AND "gender" IS NULL     AND "styleId" IS NULL)`,
      `("targetType" = 'CATEGORY' AND "categoryId" IS NOT NULL AND "seasonId" IS NULL     AND "gender" IS NULL     AND "styleId" IS NULL)`,
      `("targetType" = 'SEASON'   AND "categoryId" IS NULL     AND "seasonId" IS NOT NULL AND "gender" IS NULL     AND "styleId" IS NULL)`,
      `("targetType" = 'GENDER'   AND "categoryId" IS NULL     AND "seasonId" IS NULL     AND "gender" IS NOT NULL AND "styleId" IS NULL)`,
      `("targetType" = 'STYLE'    AND "categoryId" IS NULL     AND "seasonId" IS NULL     AND "gender" IS NULL     AND "styleId" IS NOT NULL)`,
    ].join(" OR "),
    why: "대상 종류에 맞는 칸 하나만 채움 (CATEGORY면 categoryId만)",
  },
  { table: "PricePromotionTarget", name: "PricePromotionTarget_override_ck", expr: `"discountValueOverride" IS NULL OR ("mode" = 'INCLUDE' AND ${int("discountValueOverride", "> 0")})`, why: "할인값 덮어쓰기는 포함 대상에만, 0보다 큼" },

  // ----- 주문 항목 (가격 스냅샷)
  { table: "OrderItem", name: "OrderItem_quantity_ck", expr: int("quantity", ">= 1"), why: "수량 1개 이상" },
  { table: "OrderItem", name: "OrderItem_amounts_ck", expr: `${int("listPrice", ">= 0")} AND ${int("discountAmount", ">= 0")} AND ${int("price", ">= 0")}`, why: "금액은 0 이상의 정수" },
  { table: "OrderItem", name: "OrderItem_price_math_ck", expr: `"price" = "listPrice" - "discountAmount"`, why: "판매가 = 정가 − 할인 (스냅샷끼리 어긋나지 않게)" },
  { table: "OrderItem", name: "OrderItem_promotion_ck", expr: `"discountAmount" = 0 OR "promotionName" IS NOT NULL`, why: "할인이 있으면 어떤 행사인지 기록 필수" },
];

// ---------------------------------------------------------------
// 2) 스키마에서 자동으로 만드는 CHECK (enum 값 목록, Boolean 0/1)
//    enum에 값을 추가하면 CHECK의 값 목록도 바뀌어야 합니다. db:verify가 어긋남을 잡아냅니다.
// ---------------------------------------------------------------
export function autoChecks(schemaText: string): CheckConstraint[] {
  const stripComment = (line: string) => line.replace(/\/\/.*$/, "").trim();
  const enums = new Map<string, string[]>();
  for (const m of schemaText.matchAll(/^enum\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const values = m[2].split("\n").map(stripComment).filter((v) => /^\w+$/.test(v));
    enums.set(m[1], values);
  }
  const checks: CheckConstraint[] = [];
  for (const m of schemaText.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const table = m[1];
    for (const raw of m[2].split("\n")) {
      const line = stripComment(raw);
      const f = line.match(/^(\w+)\s+(\w+)(\?|\[\])?(\s|$)/);
      if (!f || f[3] === "[]") continue;
      const [, field, type] = f;
      const values = enums.get(type);
      if (values) {
        checks.push({
          table,
          name: `${table}_${field}_enum_ck`,
          expr: `${q(field)} IN (${values.map((v) => `'${v}'`).join(", ")})`,
          why: `${type} 값만 허용 (SQLite는 enum을 TEXT로 저장해서 DB가 막아 주지 않음)`,
        });
      } else if (type === "Boolean") {
        checks.push({ table, name: `${table}_${field}_bool_ck`, expr: `${q(field)} IN (0, 1)`, why: "Boolean은 0 또는 1" });
      }
    }
  }
  return checks;
}

export function allChecks(schemaText: string): CheckConstraint[] {
  return [...autoChecks(schemaText), ...MANUAL_CHECKS];
}

// ---------------------------------------------------------------
// 3) 트리거: 여러 행·여러 테이블에 걸친 규칙 (CHECK로는 다른 행을 볼 수 없음)
// ---------------------------------------------------------------
const raise = (name: string, message: string) => `SELECT RAISE(ABORT, '${name}: ${message}');`;

// SKU·실측·모델 정보의 사이즈가 그 스타일의 사이즈 체계에 속하는지
const skuStyleGroup = `(SELECT st."sizeGroupId" FROM "StyleColor" sc JOIN "Style" st ON st."id" = sc."styleId" WHERE sc."id" = NEW."styleColorId")`;
const sizeGroupOf = (sizeCol: string) => `(SELECT z."sizeGroupId" FROM "Size" z WHERE z."id" = NEW."${sizeCol}")`;
const styleGroupOf = `(SELECT st."sizeGroupId" FROM "Style" st WHERE st."id" = NEW."styleId")`;

// 정가 기간 겹침 검사: [validFrom, validTo) 구간이 하나라도 겹치면 거부 (validTo NULL = 무한대)
const priceOverlap = (excludeSelf: boolean) => `EXISTS (
    SELECT 1 FROM "StylePrice" o
    WHERE o."styleId" = NEW."styleId"${excludeSelf ? ` AND o."id" <> NEW."id"` : ""}
      AND NEW."validFrom" < COALESCE(o."validTo", ${FOREVER})
      AND o."validFrom" < COALESCE(NEW."validTo", ${FOREVER}))`;

// 카테고리 경로 = 부모 경로 + 내 id + "/", 깊이 = 부모 깊이 + 1
const expectedPath = `COALESCE((SELECT p."path" FROM "Category" p WHERE p."id" = NEW."parentId"), '/') || NEW."id" || '/'`;
const expectedDepth = `COALESCE((SELECT p."depth" FROM "Category" p WHERE p."id" = NEW."parentId"), 0) + 1`;

// 판매 시작 조건 (Style을 ON_SALE로 바꾸는 순간 검사)
// CASE로 순서대로 검사해서, 무엇이 빠졌는지 정확한 메시지로 알려 줍니다.
const NOW = `strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')`; // Prisma와 같은 날짜 형식
const SELLABLE_COLOR = `c."styleId" = NEW."id" AND c."status" = 'ON_SALE' AND c."isDisplayed" = 1`;
const saleReadyCheck = (name: string) => `SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM "StylePrice" p WHERE p."styleId" = NEW."id" AND p."validFrom" <= ${NOW} AND (p."validTo" IS NULL OR p."validTo" > ${NOW}))
    THEN RAISE(ABORT, '${name}: 지금 유효한 정가(StylePrice)가 없어 판매를 시작할 수 없습니다')
  WHEN NOT EXISTS (SELECT 1 FROM "StyleNotice" n WHERE n."styleId" = NEW."id")
    THEN RAISE(ABORT, '${name}: 상품정보제공고시(StyleNotice)가 없어 판매를 시작할 수 없습니다')
  WHEN NOT EXISTS (SELECT 1 FROM "StyleColor" c WHERE ${SELLABLE_COLOR})
    THEN RAISE(ABORT, '${name}: 판매 중인 컬러가 없어 판매를 시작할 수 없습니다')
  WHEN EXISTS (SELECT 1 FROM "StyleColor" c WHERE ${SELLABLE_COLOR}
      AND (NOT EXISTS (SELECT 1 FROM "Sku" k WHERE k."styleColorId" = c."id")
        OR NOT EXISTS (SELECT 1 FROM "StyleColorImage" i WHERE i."styleColorId" = c."id" AND i."type" = 'MAIN')))
    THEN RAISE(ABORT, '${name}: SKU나 대표(MAIN) 이미지가 없는 판매 컬러가 있습니다')
  WHEN NOT EXISTS (SELECT 1 FROM "StyleMaterial" m WHERE m."styleId" = NEW."id")
    THEN RAISE(ABORT, '${name}: 혼용률(StyleMaterial)이 없어 판매를 시작할 수 없습니다')
  WHEN EXISTS (SELECT 1 FROM "StyleMaterial" m WHERE m."styleId" = NEW."id" GROUP BY m."part" HAVING sum(m."percent") <> 100)
    THEN RAISE(ABORT, '${name}: 혼용률 합계가 100%가 아닌 부위가 있습니다')
END;`;

export const TRIGGERS: TriggerConstraint[] = [
  // ----- 판매 시작 검사 (⭐1)
  {
    table: "Style",
    name: "Style_sale_ready_ins",
    why: "처음부터 ON_SALE로 등록 금지. 등록 순간에는 고시·이미지가 없으므로 DRAFT로 등록 → 정보 입력 → ON_SALE",
    sql: `CREATE TRIGGER "Style_sale_ready_ins" BEFORE INSERT ON "Style"
WHEN NEW."status" = 'ON_SALE'
BEGIN ${raise("Style_sale_ready", "DRAFT로 등록한 뒤 필요한 정보를 채우고 ON_SALE로 바꿔야 합니다")} END;`,
  },
  {
    table: "Style",
    name: "Style_sale_ready_upd",
    why: "ON_SALE로 바꾸는 순간 정가·고시(법적 의무)·판매 컬러·SKU·대표 이미지·혼용률 합계 100%를 검사",
    sql: `CREATE TRIGGER "Style_sale_ready_upd" BEFORE UPDATE OF "status" ON "Style"
WHEN NEW."status" = 'ON_SALE' AND OLD."status" IS NOT 'ON_SALE'
BEGIN
${saleReadyCheck("Style_sale_ready")}
END;`,
  },
  {
    table: "StyleNotice",
    name: "StyleNotice_on_sale_delete",
    why: "판매 중인 상품의 고시 정보 삭제 금지 (판매 중지 후 수정)",
    sql: `CREATE TRIGGER "StyleNotice_on_sale_delete" BEFORE DELETE ON "StyleNotice"
WHEN (SELECT s."status" FROM "Style" s WHERE s."id" = OLD."styleId") = 'ON_SALE'
BEGIN ${raise("StyleNotice_on_sale_delete", "판매 중인 상품의 고시 정보는 지울 수 없습니다. 먼저 판매를 중지하세요")} END;`,
  },

  // ----- 코드 일치 (⭐2): 컬러 품번 = 스타일코드-컬러코드, SKU 코드 = 컬러품번-사이즈코드
  {
    table: "StyleColor",
    name: "StyleColor_code_match_ins",
    why: "컬러 품번은 반드시 '스타일코드-컬러코드' (JK26F001-BK)",
    sql: `CREATE TRIGGER "StyleColor_code_match_ins" BEFORE INSERT ON "StyleColor"
WHEN NEW."code" IS NOT ((SELECT s."styleCode" FROM "Style" s WHERE s."id" = NEW."styleId") || '-' || (SELECT c."code" FROM "Color" c WHERE c."id" = NEW."colorId"))
BEGIN ${raise("StyleColor_code_match", "컬러 품번은 스타일코드-컬러코드여야 합니다")} END;`,
  },
  {
    table: "StyleColor",
    name: "StyleColor_code_match_upd",
    why: "위와 같음 (수정 시)",
    sql: `CREATE TRIGGER "StyleColor_code_match_upd" BEFORE UPDATE OF "code", "colorId" ON "StyleColor"
WHEN NEW."code" IS NOT ((SELECT s."styleCode" FROM "Style" s WHERE s."id" = NEW."styleId") || '-' || (SELECT c."code" FROM "Color" c WHERE c."id" = NEW."colorId"))
BEGIN ${raise("StyleColor_code_match", "컬러 품번은 스타일코드-컬러코드여야 합니다")} END;`,
  },
  {
    table: "Sku",
    name: "Sku_code_match_ins",
    why: "SKU 코드는 반드시 '컬러품번-사이즈코드' (JK26F001-BK-100)",
    sql: `CREATE TRIGGER "Sku_code_match_ins" BEFORE INSERT ON "Sku"
WHEN NEW."skuCode" IS NOT ((SELECT sc."code" FROM "StyleColor" sc WHERE sc."id" = NEW."styleColorId") || '-' || (SELECT z."code" FROM "Size" z WHERE z."id" = NEW."sizeId"))
BEGIN ${raise("Sku_code_match", "SKU 코드는 컬러품번-사이즈코드여야 합니다")} END;`,
  },
  {
    table: "Sku",
    name: "Sku_code_match_upd",
    why: "위와 같음 (수정 시)",
    sql: `CREATE TRIGGER "Sku_code_match_upd" BEFORE UPDATE OF "skuCode", "sizeId", "styleColorId" ON "Sku"
WHEN NEW."skuCode" IS NOT ((SELECT sc."code" FROM "StyleColor" sc WHERE sc."id" = NEW."styleColorId") || '-' || (SELECT z."code" FROM "Size" z WHERE z."id" = NEW."sizeId"))
BEGIN ${raise("Sku_code_match", "SKU 코드는 컬러품번-사이즈코드여야 합니다")} END;`,
  },
  // 코드의 "재료"가 바뀌면 이미 만든 품번과 어긋나므로, 사용 중이면 변경 금지
  {
    table: "Style",
    name: "Style_code_fixed",
    why: "컬러가 있는 스타일의 품번 변경 금지 (컬러 품번·SKU 코드·ERP·바코드와 어긋남)",
    sql: `CREATE TRIGGER "Style_code_fixed" BEFORE UPDATE OF "styleCode" ON "Style"
WHEN NEW."styleCode" IS NOT OLD."styleCode" AND EXISTS (SELECT 1 FROM "StyleColor" c WHERE c."styleId" = NEW."id")
BEGIN ${raise("Style_code_fixed", "컬러가 등록된 스타일의 품번은 바꿀 수 없습니다")} END;`,
  },
  {
    table: "Color",
    name: "Color_code_fixed",
    why: "상품에 쓰인 컬러 코드 변경 금지",
    sql: `CREATE TRIGGER "Color_code_fixed" BEFORE UPDATE OF "code" ON "Color"
WHEN NEW."code" IS NOT OLD."code" AND EXISTS (SELECT 1 FROM "StyleColor" c WHERE c."colorId" = NEW."id")
BEGIN ${raise("Color_code_fixed", "상품에 쓰인 컬러 코드는 바꿀 수 없습니다")} END;`,
  },
  {
    table: "Size",
    name: "Size_code_fixed",
    why: "SKU에 쓰인 사이즈 코드 변경 금지",
    sql: `CREATE TRIGGER "Size_code_fixed" BEFORE UPDATE OF "code" ON "Size"
WHEN NEW."code" IS NOT OLD."code" AND EXISTS (SELECT 1 FROM "Sku" k WHERE k."sizeId" = NEW."id")
BEGIN ${raise("Size_code_fixed", "SKU에 쓰인 사이즈 코드는 바꿀 수 없습니다")} END;`,
  },

  {
    table: "Sku",
    name: "Sku_size_group_ins",
    why: "SKU의 사이즈는 스타일의 사이즈 체계에 속해야 함 (상의 자켓에 신발 270 금지)",
    sql: `CREATE TRIGGER "Sku_size_group_ins" BEFORE INSERT ON "Sku"
WHEN ${sizeGroupOf("sizeId")} IS NOT ${skuStyleGroup}
BEGIN ${raise("Sku_size_group", "SKU 사이즈가 스타일의 사이즈 체계에 속하지 않습니다")} END;`,
  },
  {
    table: "Sku",
    name: "Sku_size_group_upd",
    why: "위와 같음 (수정 시)",
    sql: `CREATE TRIGGER "Sku_size_group_upd" BEFORE UPDATE OF "sizeId", "styleColorId" ON "Sku"
WHEN ${sizeGroupOf("sizeId")} IS NOT ${skuStyleGroup}
BEGIN ${raise("Sku_size_group", "SKU 사이즈가 스타일의 사이즈 체계에 속하지 않습니다")} END;`,
  },
  {
    table: "SizeMeasurement",
    name: "SizeMeasurement_size_group_ins",
    why: "실측 사이즈는 스타일의 사이즈 체계에 속해야 함",
    sql: `CREATE TRIGGER "SizeMeasurement_size_group_ins" BEFORE INSERT ON "SizeMeasurement"
WHEN ${sizeGroupOf("sizeId")} IS NOT ${styleGroupOf}
BEGIN ${raise("SizeMeasurement_size_group", "실측 사이즈가 스타일의 사이즈 체계에 속하지 않습니다")} END;`,
  },
  {
    table: "SizeMeasurement",
    name: "SizeMeasurement_size_group_upd",
    why: "위와 같음 (수정 시)",
    sql: `CREATE TRIGGER "SizeMeasurement_size_group_upd" BEFORE UPDATE OF "sizeId", "styleId" ON "SizeMeasurement"
WHEN ${sizeGroupOf("sizeId")} IS NOT ${styleGroupOf}
BEGIN ${raise("SizeMeasurement_size_group", "실측 사이즈가 스타일의 사이즈 체계에 속하지 않습니다")} END;`,
  },
  {
    table: "ModelWear",
    name: "ModelWear_consistency_ins",
    why: "착용 사이즈는 스타일의 사이즈 체계, 착용 컬러는 같은 스타일의 컬러여야 함",
    sql: `CREATE TRIGGER "ModelWear_consistency_ins" BEFORE INSERT ON "ModelWear"
WHEN ${sizeGroupOf("sizeId")} IS NOT ${styleGroupOf}
  OR (NEW."styleColorId" IS NOT NULL AND (SELECT sc."styleId" FROM "StyleColor" sc WHERE sc."id" = NEW."styleColorId") IS NOT NEW."styleId")
BEGIN ${raise("ModelWear_consistency", "착용 사이즈나 컬러가 이 스타일의 것이 아닙니다")} END;`,
  },
  {
    table: "ModelWear",
    name: "ModelWear_consistency_upd",
    why: "위와 같음 (수정 시)",
    sql: `CREATE TRIGGER "ModelWear_consistency_upd" BEFORE UPDATE OF "sizeId", "styleId", "styleColorId" ON "ModelWear"
WHEN ${sizeGroupOf("sizeId")} IS NOT ${styleGroupOf}
  OR (NEW."styleColorId" IS NOT NULL AND (SELECT sc."styleId" FROM "StyleColor" sc WHERE sc."id" = NEW."styleColorId") IS NOT NEW."styleId")
BEGIN ${raise("ModelWear_consistency", "착용 사이즈나 컬러가 이 스타일의 것이 아닙니다")} END;`,
  },
  {
    table: "Style",
    name: "Style_size_group_change",
    why: "SKU·실측·모델 정보가 있는 스타일의 사이즈 체계를 바꾸면 기존 사이즈와 어긋남 → 거부",
    sql: `CREATE TRIGGER "Style_size_group_change" BEFORE UPDATE OF "sizeGroupId" ON "Style"
WHEN NEW."sizeGroupId" <> OLD."sizeGroupId" AND (
  EXISTS (SELECT 1 FROM "Sku" k JOIN "StyleColor" sc ON sc."id" = k."styleColorId" WHERE sc."styleId" = NEW."id")
  OR EXISTS (SELECT 1 FROM "SizeMeasurement" m WHERE m."styleId" = NEW."id")
  OR EXISTS (SELECT 1 FROM "ModelWear" w WHERE w."styleId" = NEW."id"))
BEGIN ${raise("Style_size_group_change", "SKU·실측·모델 정보가 있는 스타일은 사이즈 체계를 바꿀 수 없습니다")} END;`,
  },
  {
    table: "StyleColor",
    name: "StyleColor_style_fixed",
    why: "컬러를 다른 스타일로 옮기면 SKU 사이즈 검사를 우회하게 됨 → 스타일 변경 금지",
    sql: `CREATE TRIGGER "StyleColor_style_fixed" BEFORE UPDATE OF "styleId" ON "StyleColor"
WHEN NEW."styleId" <> OLD."styleId"
BEGIN ${raise("StyleColor_style_fixed", "컬러를 다른 스타일로 옮길 수 없습니다")} END;`,
  },
  {
    table: "StylePrice",
    name: "StylePrice_no_overlap_ins",
    why: "같은 스타일의 정가 기간이 겹치면 '지금 정가'가 2개가 됨 → 거부 (현재 정가 1개도 이걸로 보장)",
    sql: `CREATE TRIGGER "StylePrice_no_overlap_ins" BEFORE INSERT ON "StylePrice"
WHEN ${priceOverlap(false)}
BEGIN ${raise("StylePrice_no_overlap", "같은 스타일의 정가 적용 기간이 겹칩니다")} END;`,
  },
  {
    table: "StylePrice",
    name: "StylePrice_no_overlap_upd",
    why: "위와 같음 (수정 시)",
    sql: `CREATE TRIGGER "StylePrice_no_overlap_upd" BEFORE UPDATE OF "styleId", "validFrom", "validTo" ON "StylePrice"
WHEN ${priceOverlap(true)}
BEGIN ${raise("StylePrice_no_overlap", "같은 스타일의 정가 적용 기간이 겹칩니다")} END;`,
  },
  {
    table: "PricePromotionTarget",
    name: "PricePromotionTarget_rate_override_ins",
    why: "정률 행사의 대상별 할인값도 1~99%",
    sql: `CREATE TRIGGER "PricePromotionTarget_rate_override_ins" BEFORE INSERT ON "PricePromotionTarget"
WHEN NEW."discountValueOverride" IS NOT NULL
  AND (SELECT p."discountType" FROM "PricePromotion" p WHERE p."id" = NEW."promotionId") = 'RATE'
  AND NEW."discountValueOverride" NOT BETWEEN 1 AND 99
BEGIN ${raise("PricePromotionTarget_rate_override", "정률 할인값은 1~99%여야 합니다")} END;`,
  },
  {
    table: "PricePromotionTarget",
    name: "PricePromotionTarget_rate_override_upd",
    why: "위와 같음 (수정 시)",
    sql: `CREATE TRIGGER "PricePromotionTarget_rate_override_upd" BEFORE UPDATE OF "discountValueOverride", "promotionId" ON "PricePromotionTarget"
WHEN NEW."discountValueOverride" IS NOT NULL
  AND (SELECT p."discountType" FROM "PricePromotion" p WHERE p."id" = NEW."promotionId") = 'RATE'
  AND NEW."discountValueOverride" NOT BETWEEN 1 AND 99
BEGIN ${raise("PricePromotionTarget_rate_override", "정률 할인값은 1~99%여야 합니다")} END;`,
  },
  {
    table: "PricePromotion",
    name: "PricePromotion_rate_targets_upd",
    why: "행사를 정률로 바꿀 때 대상별 할인값이 99%를 넘으면 거부",
    sql: `CREATE TRIGGER "PricePromotion_rate_targets_upd" BEFORE UPDATE OF "discountType" ON "PricePromotion"
WHEN NEW."discountType" = 'RATE' AND EXISTS (
  SELECT 1 FROM "PricePromotionTarget" t
  WHERE t."promotionId" = NEW."id" AND t."discountValueOverride" IS NOT NULL AND t."discountValueOverride" NOT BETWEEN 1 AND 99)
BEGIN ${raise("PricePromotion_rate_targets", "대상별 할인값이 1~99%를 벗어나 정률로 바꿀 수 없습니다")} END;`,
  },
  {
    table: "Category",
    name: "Category_path_fill",
    why: "path·depth는 사람이 입력하지 않고 DB가 부모를 보고 계산 (중복 저장 값이 어긋나지 않게)",
    sql: `CREATE TRIGGER "Category_path_fill" AFTER INSERT ON "Category"
BEGIN
  UPDATE "Category" SET "path" = ${expectedPath}, "depth" = ${expectedDepth} WHERE "id" = NEW."id";
END;`,
  },
  {
    table: "Category",
    name: "Category_path_guard",
    why: "path·depth를 계산 값과 다르게 고치는 것 금지",
    sql: `CREATE TRIGGER "Category_path_guard" BEFORE UPDATE OF "path", "depth" ON "Category"
WHEN NEW."path" IS NOT (${expectedPath}) OR NEW."depth" IS NOT (${expectedDepth})
BEGIN ${raise("Category_path_guard", "path/depth는 부모 기준으로 자동 계산되며 직접 바꿀 수 없습니다")} END;`,
  },
  {
    table: "Category",
    name: "Category_parent_fixed",
    why: "부모를 바꾸면 하위 전체의 path를 다시 계산해야 함 → 지금은 금지 (필요해지면 관리자 단계에서 이동 기능으로)",
    sql: `CREATE TRIGGER "Category_parent_fixed" BEFORE UPDATE OF "parentId" ON "Category"
WHEN NEW."parentId" IS NOT OLD."parentId"
BEGIN ${raise("Category_parent_fixed", "카테고리 부모는 바꿀 수 없습니다")} END;`,
  },
];
