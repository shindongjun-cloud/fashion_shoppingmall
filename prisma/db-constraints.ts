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

  // ----- 재고
  { table: "InventoryLocation", name: "InventoryLocation_code_ck", expr: upperCode("code"), why: "위치 코드 형식" },
  { table: "InventoryLocation", name: "InventoryLocation_name_ck", expr: notBlank("name"), why: "위치 이름 필수" },
  { table: "InventoryLocation", name: "InventoryLocation_priority_ck", expr: int("priority", ">= 0"), why: "할당 우선순위 >= 0" },
  { table: "InventoryLocation", name: "InventoryLocation_online_ck", expr: `"isOnlineSellable" = 0 OR ("isActive" = 1 AND "type" IN ('WAREHOUSE', 'STORE'))`, why: "온라인 판매 위치는 활성 상태인 물류센터·매장만 (반품센터·불량창고 재고는 팔 수 없음)" },

  { table: "InventoryBalance", name: "InventoryBalance_qty_ck", expr: `${int("onHand", ">= 0")} AND ${int("reserved", ">= 0")} AND ${int("safetyStock", ">= 0")}`, why: "실재고·예약·안전재고는 0 이상의 정수" },
  { table: "InventoryBalance", name: "InventoryBalance_reserved_ck", expr: `"reserved" <= "onHand"`, why: "예약은 실재고를 넘을 수 없음 (초과 판매 방지의 마지막 방어선)" },
  { table: "InventoryBalance", name: "InventoryBalance_dates_ck", expr: `(${isoDate("updatedAt")}) AND (${isoDateOrNull("lastCountedAt")})`, why: "날짜 형식" },

  { table: "InventoryLedger", name: "InventoryLedger_qty_ck", expr: int("qty", "<> 0"), why: "변동 수량은 0이 아닌 정수" },
  {
    table: "InventoryLedger",
    name: "InventoryLedger_sign_ck",
    expr: `("type" IN ('INITIAL', 'INBOUND', 'RETURN_IN', 'ADJUST_IN', 'TRANSFER_IN') AND "qty" > 0) OR ("type" IN ('SALE', 'ADJUST_OUT', 'DEFECT_OUT', 'TRANSFER_OUT') AND "qty" < 0)`,
    why: "유형별 부호: 입고·반품·조정입고·이동입고는 +, 판매·조정출고·불량·이동출고는 −",
  },
  { table: "InventoryLedger", name: "InventoryLedger_balance_after_ck", expr: int("balanceAfter", ">= 0"), why: "반영 후 실재고 >= 0" },
  { table: "InventoryLedger", name: "InventoryLedger_sale_ck", expr: `("type" = 'SALE') = ("reservationId" IS NOT NULL) AND ("type" <> 'SALE' OR "refType" = 'ORDER')`, why: "판매(SALE)는 반드시 예약 확정에서만 생기고 주문을 참조. 다른 유형은 예약을 참조하지 않음" },
  { table: "InventoryLedger", name: "InventoryLedger_ref_ck", expr: `"refType" IN ('MANUAL', 'MIGRATION') OR ("refId" IS NOT NULL AND trim("refId") <> '')`, why: "주문·반품·입고·실사·이동은 참조 번호 필수" },
  { table: "InventoryLedger", name: "InventoryLedger_reason_ck", expr: `("type" NOT IN ('ADJUST_IN', 'ADJUST_OUT', 'DEFECT_OUT') AND "refType" <> 'MANUAL') OR ("reason" IS NOT NULL AND trim("reason") <> '')`, why: "조정·불량·수동 처리는 사유 필수 (재고가 사라진 이유를 남겨야 함)" },
  { table: "InventoryLedger", name: "InventoryLedger_dates_ck", expr: `(${isoDate("occurredAt")}) AND (${isoDate("createdAt")})`, why: "날짜 형식" },

  { table: "InventoryReservation", name: "InventoryReservation_qty_ck", expr: int("qty", ">= 1"), why: "예약 수량 1개 이상" },
  { table: "InventoryReservation", name: "InventoryReservation_expiry_ck", expr: `"expiresAt" > "createdAt"`, why: "만료 시각은 생성 이후" },
  {
    table: "InventoryReservation",
    name: "InventoryReservation_state_ck",
    expr: [
      `("status" = 'RESERVED'  AND "confirmedAt" IS NULL     AND "releasedAt" IS NULL     AND "releaseReason" IS NULL)`,
      `("status" = 'CONFIRMED' AND "confirmedAt" IS NOT NULL AND "releasedAt" IS NULL     AND "releaseReason" IS NULL)`,
      `("status" = 'RELEASED'  AND "confirmedAt" IS NULL     AND "releasedAt" IS NOT NULL AND "releaseReason" IS NOT NULL)`,
      `("status" = 'EXPIRED'   AND "confirmedAt" IS NULL     AND "releasedAt" IS NOT NULL AND "releaseReason" IS NULL)`,
    ].join(" OR "),
    why: "상태별 필수 칸 (확정이면 확정 시각, 해제면 해제 시각+사유, 만료면 해제 시각)",
  },
  { table: "InventoryReservation", name: "InventoryReservation_dates_ck", expr: `(${isoDate("createdAt")}) AND (${isoDate("expiresAt")}) AND (${isoDateOrNull("confirmedAt")}) AND (${isoDateOrNull("releasedAt")})`, why: "날짜 형식 (만료 비교가 깨지지 않게)" },
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
// 정의 검사: 제약이 "없는 컬럼"을 가리키지 않는지
// ⚠️ SQLite는 "없는컬럼"처럼 큰따옴표로 쓴 이름이 실제 컬럼이 아니면 오류 없이 '글자'로 취급합니다.
//    그래서 컬럼을 지우고 제약을 안 지우면, CHECK가 항상 거짓이 되어 모든 쓰기가 막히거나
//    (반대로 조건에 따라) 검사가 조용히 무력화됩니다. 실제로 Sku.stock을 지울 때 이 문제로 마이그레이션이 실패했습니다.
// ---------------------------------------------------------------
const SCALARS = new Set(["String", "Int", "Float", "Boolean", "DateTime", "Json", "BigInt", "Decimal", "Bytes"]);

/** 모델 이름 → 실제 컬럼 이름들 (관계 필드는 컬럼이 아니므로 제외) */
export function tableColumns(schemaText: string): Map<string, Set<string>> {
  const enumNames = new Set([...schemaText.matchAll(/^enum\s+(\w+)/gm)].map((m) => m[1]));
  const result = new Map<string, Set<string>>();
  for (const m of schemaText.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const cols = new Set<string>();
    for (const raw of m[2].split("\n")) {
      const f = raw.replace(/\/\/.*$/, "").trim().match(/^(\w+)\s+(\w+)(\?)?(\s|$)/);
      if (f && (SCALARS.has(f[2]) || enumNames.has(f[2]))) cols.add(f[1]);
    }
    result.set(m[1], cols);
  }
  return result;
}

/** 문제가 있으면 설명 목록을 돌려줍니다 (없으면 빈 배열) */
export function validateConstraints(schemaText: string): string[] {
  const columns = tableColumns(schemaText);
  const problems: string[] = [];

  for (const c of allChecks(schemaText)) {
    const cols = columns.get(c.table);
    if (!cols) {
      problems.push(`CHECK ${c.name}: 테이블 ${c.table}이 스키마에 없음`);
      continue;
    }
    for (const [, ident] of c.expr.matchAll(/"(\w+)"/g)) {
      if (!cols.has(ident)) problems.push(`CHECK ${c.name}: ${c.table}에 "${ident}" 컬럼이 없음`);
    }
  }

  for (const t of TRIGGERS) {
    const own = columns.get(t.table);
    if (!own) {
      problems.push(`트리거 ${t.name}: 테이블 ${t.table}이 스키마에 없음`);
      continue;
    }
    // 트리거 안에서 쓰는 테이블과 별칭: FROM "Sku" k / JOIN "StyleColor" sc
    const aliases = new Map<string, string>([["NEW", t.table], ["OLD", t.table]]);
    for (const [, table, alias] of t.sql.matchAll(/(?:FROM|JOIN)\s+"(\w+)"\s+(\w+)/g)) aliases.set(alias, table);
    const referenced = new Set([t.table, ...[...t.sql.matchAll(/"(\w+)"/g)].map((m) => m[1]).filter((n) => columns.has(n))]);
    for (const n of referenced) {
      if (!columns.has(n)) problems.push(`트리거 ${t.name}: 테이블 ${n}이 스키마에 없음`);
    }
    // 별칭.컬럼 (NEW."qty", b."onHand")
    for (const [, alias, col] of t.sql.matchAll(/\b(\w+)\."(\w+)"/g)) {
      const table = aliases.get(alias);
      if (!table) problems.push(`트리거 ${t.name}: 별칭 ${alias}를 알 수 없음`);
      else if (!columns.get(table)?.has(col)) problems.push(`트리거 ${t.name}: ${table}에 "${col}" 컬럼이 없음 (${alias}."${col}")`);
    }
    // 별칭 없이 쓴 "이름": 테이블 이름이거나, 트리거가 다루는 테이블 중 하나의 컬럼이어야 함
    const allCols = new Set([...referenced].flatMap((n) => [...(columns.get(n) ?? [])]));
    for (const m of t.sql.matchAll(/(^|[^.\w])"(\w+)"/g)) {
      const ident = m[2];
      if (!columns.has(ident) && !allCols.has(ident) && ident !== t.name) {
        problems.push(`트리거 ${t.name}: "${ident}"는 테이블도 컬럼도 아님`);
      }
    }
  }
  return problems;
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

// ----- 재고 도우미
const BAL = (alias: string, rec: "NEW" | "OLD") =>
  `${alias}."skuId" = ${rec}."skuId" AND ${alias}."locationId" = ${rec}."locationId"`;
const LEDGER_SUM = (rec: "NEW" | "OLD") =>
  `(SELECT COALESCE(SUM(l."qty"), 0) FROM "InventoryLedger" l WHERE ${BAL("l", rec)})`;
const RESERVED_SUM = (rec: "NEW" | "OLD") =>
  `(SELECT COALESCE(SUM(r."qty"), 0) FROM "InventoryReservation" r WHERE ${BAL("r", rec)} AND r."status" = 'RESERVED')`;
const syncReserved = (rec: "NEW" | "OLD") =>
  `UPDATE "InventoryBalance" SET "reserved" = ${RESERVED_SUM(rec)}, "updatedAt" = ${NOW} WHERE "skuId" = ${rec}."skuId" AND "locationId" = ${rec}."locationId";`;

const INVENTORY_TRIGGERS: TriggerConstraint[] = [
  // --- 잔고: 앱이 직접 숫자를 바꾸지 못하게
  {
    table: "InventoryBalance",
    name: "InventoryBalance_insert_zero",
    why: "잔고 행은 0으로만 생성 (재고는 원장 입고로만 늘어남)",
    sql: `CREATE TRIGGER "InventoryBalance_insert_zero" BEFORE INSERT ON "InventoryBalance"
WHEN NEW."onHand" <> 0 OR NEW."reserved" <> 0
BEGIN ${raise("InventoryBalance_insert_zero", "잔고는 0으로 만들고 원장(InventoryLedger)으로 입고해야 합니다")} END;`,
  },
  {
    table: "InventoryBalance",
    name: "InventoryBalance_onhand_guard",
    why: "실재고는 항상 원장 합계와 같아야 함 → 원장 없이 숫자만 고치는 것 금지",
    sql: `CREATE TRIGGER "InventoryBalance_onhand_guard" BEFORE UPDATE OF "onHand" ON "InventoryBalance"
WHEN NEW."onHand" IS NOT ${LEDGER_SUM("NEW")}
BEGIN ${raise("InventoryBalance_onhand_guard", "실재고는 원장(InventoryLedger)으로만 바꿀 수 있습니다")} END;`,
  },
  {
    table: "InventoryBalance",
    name: "InventoryBalance_reserved_guard",
    why: "예약 수량은 항상 RESERVED 예약 합계와 같아야 함",
    sql: `CREATE TRIGGER "InventoryBalance_reserved_guard" BEFORE UPDATE OF "reserved" ON "InventoryBalance"
WHEN NEW."reserved" IS NOT ${RESERVED_SUM("NEW")}
BEGIN ${raise("InventoryBalance_reserved_guard", "예약 수량은 예약(InventoryReservation)으로만 바꿀 수 있습니다")} END;`,
  },
  {
    table: "InventoryBalance",
    name: "InventoryBalance_key_fixed",
    why: "잔고 행의 SKU·위치를 바꾸면 원장과 어긋남",
    sql: `CREATE TRIGGER "InventoryBalance_key_fixed" BEFORE UPDATE OF "skuId", "locationId" ON "InventoryBalance"
WHEN NEW."skuId" IS NOT OLD."skuId" OR NEW."locationId" IS NOT OLD."locationId"
BEGIN ${raise("InventoryBalance_key_fixed", "잔고 행의 SKU·위치는 바꿀 수 없습니다")} END;`,
  },
  {
    table: "InventoryBalance",
    name: "InventoryBalance_no_delete",
    why: "원장 기록이 있는 잔고 행 삭제 금지",
    sql: `CREATE TRIGGER "InventoryBalance_no_delete" BEFORE DELETE ON "InventoryBalance"
WHEN EXISTS (SELECT 1 FROM "InventoryLedger" l WHERE ${BAL("l", "OLD")})
  OR EXISTS (SELECT 1 FROM "InventoryReservation" r WHERE ${BAL("r", "OLD")})
BEGIN ${raise("InventoryBalance_no_delete", "원장·예약 기록이 있는 잔고는 지울 수 없습니다")} END;`,
  },

  // --- 원장: 추가만 가능, 추가하면 잔고에 자동 반영
  {
    table: "InventoryLedger",
    name: "InventoryLedger_no_update",
    why: "원장은 수정 금지 (잘못 넣었으면 반대 방향 행을 추가)",
    sql: `CREATE TRIGGER "InventoryLedger_no_update" BEFORE UPDATE ON "InventoryLedger"
BEGIN ${raise("InventoryLedger_append_only", "원장은 수정할 수 없습니다. 반대 방향 행을 추가하세요")} END;`,
  },
  {
    table: "InventoryLedger",
    name: "InventoryLedger_no_delete",
    why: "원장은 삭제 금지",
    sql: `CREATE TRIGGER "InventoryLedger_no_delete" BEFORE DELETE ON "InventoryLedger"
BEGIN ${raise("InventoryLedger_append_only", "원장은 삭제할 수 없습니다")} END;`,
  },
  {
    table: "InventoryLedger",
    name: "InventoryLedger_check_balance",
    why: "잔고 행이 있어야 하고, balanceAfter = 직전 실재고 + qty, 결과가 예약 수량보다 작아지면 거부",
    sql: `CREATE TRIGGER "InventoryLedger_check_balance" BEFORE INSERT ON "InventoryLedger"
BEGIN
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM "InventoryBalance" b WHERE ${BAL("b", "NEW")})
    THEN RAISE(ABORT, 'InventoryLedger_check_balance: 잔고 행(InventoryBalance)이 없습니다. 먼저 0으로 만드세요')
  WHEN NEW."balanceAfter" IS NOT ((SELECT b."onHand" FROM "InventoryBalance" b WHERE ${BAL("b", "NEW")}) + NEW."qty")
    THEN RAISE(ABORT, 'InventoryLedger_check_balance: balanceAfter가 직전 실재고 + qty와 다릅니다')
  WHEN NEW."balanceAfter" < (SELECT b."reserved" FROM "InventoryBalance" b WHERE ${BAL("b", "NEW")})
    THEN RAISE(ABORT, 'InventoryLedger_check_balance: 결제 대기 예약보다 실재고가 적어집니다')
END;
END;`,
  },
  {
    table: "InventoryLedger",
    name: "InventoryLedger_apply",
    why: "원장을 추가하면 잔고 실재고에 자동 반영 (앱이 따로 고치지 않음)",
    sql: `CREATE TRIGGER "InventoryLedger_apply" AFTER INSERT ON "InventoryLedger"
BEGIN
  UPDATE "InventoryBalance" SET "onHand" = "onHand" + NEW."qty", "updatedAt" = ${NOW}
  WHERE "skuId" = NEW."skuId" AND "locationId" = NEW."locationId";
END;`,
  },

  // --- 예약: 판매 가능 수량 안에서만, 상태는 한 번만 바뀜, 확정되면 판매 원장 자동 생성
  {
    table: "InventoryReservation",
    name: "InventoryReservation_reserve",
    why: "판매 가능 수량(실재고−예약−안전재고)보다 많이 예약 금지. DB가 한 번에 검사하므로 동시 주문에도 초과 판매 불가",
    sql: `CREATE TRIGGER "InventoryReservation_reserve" BEFORE INSERT ON "InventoryReservation"
BEGIN
SELECT CASE
  WHEN NEW."status" <> 'RESERVED'
    THEN RAISE(ABORT, 'InventoryReservation_reserve: 예약은 RESERVED 상태로만 만들 수 있습니다')
  WHEN NOT EXISTS (SELECT 1 FROM "InventoryLocation" loc WHERE loc."id" = NEW."locationId" AND loc."isOnlineSellable" = 1 AND loc."isActive" = 1)
    THEN RAISE(ABORT, 'InventoryReservation_reserve: 온라인 판매 위치가 아닙니다')
  WHEN EXISTS (SELECT 1 FROM "InventoryReservation" r WHERE r."orderId" = NEW."orderId" AND r."skuId" = NEW."skuId" AND r."status" = 'RESERVED')
    THEN RAISE(ABORT, 'InventoryReservation_reserve: 같은 주문에 이 SKU의 예약이 이미 있습니다')
  WHEN COALESCE((SELECT b."onHand" - b."reserved" - b."safetyStock" FROM "InventoryBalance" b WHERE ${BAL("b", "NEW")}), 0) < NEW."qty"
    THEN RAISE(ABORT, 'InventoryReservation_insufficient: 판매 가능 재고가 부족합니다')
END;
END;`,
  },
  {
    table: "InventoryReservation",
    name: "InventoryReservation_sync_ins",
    why: "예약을 만들면 잔고의 예약 수량 자동 반영",
    sql: `CREATE TRIGGER "InventoryReservation_sync_ins" AFTER INSERT ON "InventoryReservation"
BEGIN
  ${syncReserved("NEW")}
END;`,
  },
  {
    table: "InventoryReservation",
    name: "InventoryReservation_transition",
    why: "RESERVED에서만 상태 변경 가능 (확정된 예약을 되돌리기 금지), 만료 시각이 지난 예약은 확정 금지",
    sql: `CREATE TRIGGER "InventoryReservation_transition" BEFORE UPDATE OF "status" ON "InventoryReservation"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
SELECT CASE
  WHEN OLD."status" <> 'RESERVED'
    THEN RAISE(ABORT, 'InventoryReservation_transition: 이미 처리된 예약은 상태를 바꿀 수 없습니다')
  WHEN NEW."status" = 'CONFIRMED' AND OLD."expiresAt" <= ${NOW}
    THEN RAISE(ABORT, 'InventoryReservation_transition: 만료된 예약은 확정할 수 없습니다')
END;
END;`,
  },
  {
    table: "InventoryReservation",
    name: "InventoryReservation_immutable",
    why: "예약의 주문·SKU·위치·수량·만료 시각은 바꿀 수 없음 (바꾸려면 해제 후 새로 예약)",
    sql: `CREATE TRIGGER "InventoryReservation_immutable" BEFORE UPDATE OF "orderId", "skuId", "locationId", "qty", "expiresAt", "createdAt" ON "InventoryReservation"
WHEN NEW."orderId" IS NOT OLD."orderId" OR NEW."skuId" IS NOT OLD."skuId" OR NEW."locationId" IS NOT OLD."locationId"
  OR NEW."qty" IS NOT OLD."qty" OR NEW."expiresAt" IS NOT OLD."expiresAt" OR NEW."createdAt" IS NOT OLD."createdAt"
BEGIN ${raise("InventoryReservation_immutable", "예약 내용은 바꿀 수 없습니다. 해제 후 새로 예약하세요")} END;`,
  },
  {
    table: "InventoryReservation",
    name: "InventoryReservation_sync_upd",
    why: "상태가 바뀌면 예약 수량을 다시 맞추고, 확정(CONFIRMED)이면 판매 원장(SALE)을 자동 생성 → 실재고 감소",
    sql: `CREATE TRIGGER "InventoryReservation_sync_upd" AFTER UPDATE OF "status" ON "InventoryReservation"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
  ${syncReserved("NEW")}
  INSERT INTO "InventoryLedger" ("skuId", "locationId", "type", "qty", "balanceAfter", "refType", "refId", "reservationId", "createdBy", "occurredAt", "createdAt")
  SELECT NEW."skuId", NEW."locationId", 'SALE', -NEW."qty", b."onHand" - NEW."qty", 'ORDER', CAST(NEW."orderId" AS TEXT), NEW."id", 'SYSTEM', ${NOW}, ${NOW}
  FROM "InventoryBalance" b
  WHERE NEW."status" = 'CONFIRMED' AND ${BAL("b", "NEW")};
END;`,
  },
  {
    table: "InventoryReservation",
    name: "InventoryReservation_no_delete",
    why: "예약 기록 삭제 금지 (해제·만료 상태로 남김)",
    sql: `CREATE TRIGGER "InventoryReservation_no_delete" BEFORE DELETE ON "InventoryReservation"
BEGIN ${raise("InventoryReservation_no_delete", "예약 기록은 지울 수 없습니다. 해제(RELEASED)하세요")} END;`,
  },
  {
    table: "InventoryLocation",
    name: "InventoryLocation_deactivate_guard",
    why: "결제 대기 예약이 남아 있는 위치를 판매 중지·비활성화하면 확정할 재고가 사라짐",
    sql: `CREATE TRIGGER "InventoryLocation_deactivate_guard" BEFORE UPDATE OF "isActive", "isOnlineSellable" ON "InventoryLocation"
WHEN (NEW."isActive" = 0 OR NEW."isOnlineSellable" = 0)
  AND EXISTS (SELECT 1 FROM "InventoryReservation" r WHERE r."locationId" = NEW."id" AND r."status" = 'RESERVED')
BEGIN ${raise("InventoryLocation_deactivate_guard", "결제 대기 예약이 있는 위치는 판매 중지할 수 없습니다")} END;`,
  },
];

export const TRIGGERS: TriggerConstraint[] = [
  ...INVENTORY_TRIGGERS,
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
