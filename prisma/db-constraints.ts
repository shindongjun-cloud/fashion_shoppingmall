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
/** 암호문 형식 v1:IV:태그:암호문 (lib/crypto.ts) */
const encOrNull = (col: string) => `${q(col)} IS NULL OR ${q(col)} GLOB 'v[0-9]*:?*:?*:?*'`;
/** HMAC-SHA256 16진수 64자 */
const hashOrNull = (col: string) => `${q(col)} IS NULL OR (length(${q(col)}) = 64 AND ${q(col)} NOT GLOB '*[^0-9a-f]*')`;
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
  { table: "InventoryBalance", name: "InventoryBalance_reorder_ck", expr: `${int("reorderPoint", ">= 0")} AND ${int("reorderQty", ">= 0")}`, why: "재주문점·권장 수량은 0 이상 (0 = 알림 안 함)" },
  { table: "InventoryBalance", name: "InventoryBalance_dates_ck", expr: `(${isoDate("updatedAt")}) AND (${isoDateOrNull("lastCountedAt")})`, why: "날짜 형식" },

  { table: "InventoryLedger", name: "InventoryLedger_qty_ck", expr: int("qty", "<> 0"), why: "변동 수량은 0이 아닌 정수" },
  {
    table: "InventoryLedger",
    name: "InventoryLedger_sign_ck",
    expr: `("type" IN ('INITIAL', 'INBOUND', 'RETURN_IN', 'ADJUST_IN', 'TRANSFER_IN') AND "qty" > 0) OR ("type" IN ('SALE', 'ADJUST_OUT', 'DEFECT_OUT', 'TRANSFER_OUT', 'RETURN_REJECT_OUT') AND "qty" < 0)`,
    why: "유형별 부호: 입고·반품·조정입고·이동입고는 +, 판매·조정출고·불량·이동출고·반품 반송은 −",
  },
  {
    table: "InventoryLedger",
    name: "InventoryLedger_doc_ck",
    expr: `("type" NOT IN ('RETURN_IN', 'RETURN_REJECT_OUT') OR ("returnItemId" IS NOT NULL AND "refType" = 'RETURN'))
      AND ("returnItemId" IS NULL OR ("refType" = 'RETURN' AND "type" IN ('RETURN_IN', 'RETURN_REJECT_OUT', 'TRANSFER_IN', 'TRANSFER_OUT')))
      AND ("inboundLineId" IS NULL OR ("type" = 'INBOUND' AND "refType" = 'INBOUND_ORDER'))`,
    why: "반품 도착·반송은 반품 상품을 가리켜야 하고, 입고 전표 줄은 입고(INBOUND)에만 연결",
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
      `("status" = 'RESERVED'  AND "allocatedAt" IS NULL     AND "confirmedAt" IS NULL     AND "shipmentId" IS NULL     AND "releasedAt" IS NULL     AND "releaseReason" IS NULL)`,
      `("status" = 'ALLOCATED' AND "allocatedAt" IS NOT NULL AND "confirmedAt" IS NULL     AND "shipmentId" IS NULL     AND "releasedAt" IS NULL     AND "releaseReason" IS NULL)`,
      `("status" = 'CONFIRMED' AND "allocatedAt" IS NOT NULL AND "confirmedAt" IS NOT NULL AND "shipmentId" IS NOT NULL AND "releasedAt" IS NULL     AND "releaseReason" IS NULL)`,
      `("status" = 'RELEASED'  AND "confirmedAt" IS NULL     AND "shipmentId" IS NULL     AND "releasedAt" IS NOT NULL AND "releaseReason" IS NOT NULL)`,
      `("status" = 'EXPIRED'   AND "allocatedAt" IS NULL     AND "confirmedAt" IS NULL     AND "shipmentId" IS NULL     AND "releasedAt" IS NOT NULL AND "releaseReason" IS NULL)`,
    ].join(" OR "),
    why: "상태별 필수 칸 (할당이면 할당 시각, 확정이면 출고 시각+출고 상자, 해제면 해제 시각+사유, 만료면 해제 시각. 만료는 결제 전 예약만)",
  },
  { table: "InventoryReservation", name: "InventoryReservation_dates_ck", expr: `(${isoDate("createdAt")}) AND (${isoDate("expiresAt")}) AND (${isoDateOrNull("allocatedAt")}) AND (${isoDateOrNull("confirmedAt")}) AND (${isoDateOrNull("releasedAt")})`, why: "날짜 형식 (만료 비교가 깨지지 않게)" },

  // ----- 고객
  { table: "Customer", name: "Customer_no_ck", expr: `"customerNo" GLOB 'C[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'`, why: "고객번호는 C + 숫자 10자리" },
  {
    table: "Customer",
    name: "Customer_withdrawn_ck",
    expr: `("status" = 'WITHDRAWN' AND "userId" IS NULL AND "withdrawnAt" IS NOT NULL AND "anonymizedAt" IS NOT NULL) OR ("status" <> 'WITHDRAWN' AND "withdrawnAt" IS NULL AND "anonymizedAt" IS NULL)`,
    why: "탈퇴 완료면 로그인 계정 없음 + 탈퇴·익명화 시각 필수, 아니면 둘 다 비어 있음",
  },
  { table: "Customer", name: "Customer_suspended_ck", expr: `("status" = 'SUSPENDED') = ("suspendedAt" IS NOT NULL AND "suspendedReason" IS NOT NULL)`, why: "정지 상태면 정지 시각·사유 필수, 아니면 비어 있음" },
  { table: "Customer", name: "Customer_dormant_ck", expr: `("status" = 'DORMANT') = ("dormantAt" IS NOT NULL)`, why: "휴면 상태면 휴면 시각 필수" },
  {
    table: "Customer",
    name: "Customer_dates_ck",
    expr: [isoDate("joinedAt"), isoDate("statusChangedAt"), isoDateOrNull("lastLoginAt"), isoDateOrNull("lastOrderAt"), isoDateOrNull("dormantAt"), isoDateOrNull("suspendedAt"), isoDateOrNull("withdrawnAt"), isoDateOrNull("anonymizedAt")].map((e) => `(${e})`).join(" AND "),
    why: "날짜 형식",
  },

  { table: "CustomerProfile", name: "CustomerProfile_enc_ck", expr: ["nameEnc", "phoneEnc", "birthDateEnc", "contactEmailEnc"].map((c) => `(${encOrNull(c)})`).join(" AND "), why: "개인정보는 암호문 형식(v1:IV:태그:암호문)으로만 저장 (평문 저장 실수 방지)" },
  { table: "CustomerProfile", name: "CustomerProfile_hash_ck", expr: `(${hashOrNull("phoneHash")}) AND (${hashOrNull("emailHash")})`, why: "검색용 해시는 HMAC-SHA256 16진수 64자" },
  { table: "CustomerProfile", name: "CustomerProfile_pairs_ck", expr: `("phoneEnc" IS NULL) = ("phoneHash" IS NULL) AND ("contactEmailEnc" IS NULL) = ("emailHash" IS NULL) AND ("birthDateEnc" IS NULL) = ("birthMonth" IS NULL)`, why: "암호문과 검색 해시(또는 생일 월)는 함께 있거나 함께 없음" },
  { table: "CustomerProfile", name: "CustomerProfile_birth_month_ck", expr: intOrNull("birthMonth", "BETWEEN 1 AND 12"), why: "생일 월 1~12" },

  { table: "CustomerBodyProfile", name: "CustomerBodyProfile_range_ck", expr: `(${intOrNull("heightCm", "BETWEEN 100 AND 230")}) AND (${intOrNull("weightKg", "BETWEEN 25 AND 200")}) AND (${intOrNull("shoeSizeMm", "BETWEEN 200 AND 330")})`, why: "키 100~230, 몸무게 25~200, 신발 200~330mm" },
  { table: "CustomerBodyProfile", name: "CustomerBodyProfile_size_ck", expr: `("topSize" IS NULL OR trim("topSize") <> '') AND ("bottomSize" IS NULL OR trim("bottomSize") <> '')`, why: "사이즈를 넣으면 빈 글자 금지" },

  { table: "CustomerAddress", name: "CustomerAddress_label_ck", expr: `${notBlank("label")} AND length("label") <= 20`, why: "배송지 이름 1~20자" },
  { table: "CustomerAddress", name: "CustomerAddress_zip_ck", expr: `length("zipCode") = 5 AND "zipCode" NOT GLOB '*[^0-9]*'`, why: "우편번호는 숫자 5자리" },
  { table: "CustomerAddress", name: "CustomerAddress_enc_ck", expr: ["recipientEnc", "phoneEnc", "address1Enc", "address2Enc"].map((c) => `(${encOrNull(c)})`).join(" AND "), why: "주소·수령인·연락처는 암호문으로만 저장" },
  { table: "CustomerAddress", name: "CustomerAddress_memo_ck", expr: encOrNull("deliveryMemoEnc"), why: "배송 메모는 암호문으로만 (공동현관 비밀번호 등이 들어감. 100자 제한은 앱에서)" },

  { table: "CustomerStatusHistory", name: "CustomerStatusHistory_change_ck", expr: `"fromStatus" IS NULL OR "fromStatus" <> "toStatus"`, why: "상태가 실제로 바뀐 경우만 기록" },
  { table: "CustomerStatusHistory", name: "CustomerStatusHistory_dates_ck", expr: isoDate("changedAt"), why: "날짜 형식" },

  { table: "CustomerWithdrawal", name: "CustomerWithdrawal_outcome_ck", expr: `"completedAt" IS NULL OR "canceledAt" IS NULL`, why: "완료와 철회는 동시에 불가" },
  { table: "CustomerWithdrawal", name: "CustomerWithdrawal_grace_ck", expr: `julianday("scheduledAt") - julianday("requestedAt") >= 7`, why: "처리 예정일은 신청 후 7일 이상 (철회 기간 보장)" },
  { table: "CustomerWithdrawal", name: "CustomerWithdrawal_order_ck", expr: `("completedAt" IS NULL OR "completedAt" >= "scheduledAt") AND ("canceledAt" IS NULL OR "canceledAt" >= "requestedAt")`, why: "유예 기간이 끝나야 완료, 철회는 신청 이후" },
  { table: "CustomerWithdrawal", name: "CustomerWithdrawal_rejoin_ck", expr: `("rejoinBlockHash" IS NULL) = ("rejoinBlockUntil" IS NULL) AND ("rejoinBlockHash" IS NULL OR "completedAt" IS NOT NULL) AND (${hashOrNull("rejoinBlockHash")})`, why: "재가입 제한 정보는 완료된 탈퇴에만, 해시와 기한은 함께" },
  { table: "CustomerWithdrawal", name: "CustomerWithdrawal_text_ck", expr: `"reasonText" IS NULL OR length("reasonText") <= 500`, why: "사유 500자 이내" },
  { table: "CustomerWithdrawal", name: "CustomerWithdrawal_dates_ck", expr: [isoDate("requestedAt"), isoDate("scheduledAt"), isoDateOrNull("completedAt"), isoDateOrNull("canceledAt"), isoDateOrNull("rejoinBlockUntil")].map((e) => `(${e})`).join(" AND "), why: "날짜 형식" },

  { table: "CustomerGrade", name: "CustomerGrade_code_ck", expr: upperCode("code"), why: "등급 코드 형식" },
  { table: "CustomerGrade", name: "CustomerGrade_name_ck", expr: notBlank("name"), why: "등급 이름 필수" },
  { table: "CustomerGrade", name: "CustomerGrade_values_ck", expr: `${int("minAmount", ">= 0")} AND ${int("pointRateBp", "BETWEEN 0 AND 10000")} AND ${int("sortOrder", ">= 0")}`, why: "기준 금액 >= 0, 적립률 0~100%(bp), 정렬 >= 0" },

  { table: "CustomerGradeHistory", name: "CustomerGradeHistory_change_ck", expr: `"fromGradeId" IS NULL OR "fromGradeId" <> "toGradeId"`, why: "등급이 실제로 바뀐 경우만 기록" },
  { table: "CustomerGradeHistory", name: "CustomerGradeHistory_values_ck", expr: `(${intOrNull("purchaseAmount", ">= 0")}) AND ("periodFrom" IS NULL OR "periodTo" IS NULL OR "periodTo" > "periodFrom")`, why: "산정 금액 >= 0, 산정 기간 순서" },
  { table: "CustomerGradeHistory", name: "CustomerGradeHistory_dates_ck", expr: [isoDate("changedAt"), isoDateOrNull("periodFrom"), isoDateOrNull("periodTo")].map((e) => `(${e})`).join(" AND "), why: "날짜 형식" },

  { table: "CustomerLoginHistory", name: "CustomerLoginHistory_values_ck", expr: `${notBlank("provider")} AND ("userAgent" IS NULL OR length("userAgent") <= 500) AND ("ipMasked" IS NULL OR "ipMasked" GLOB '*[*]*')`, why: "로그인 수단 필수, IP는 반드시 마스킹된 값만 (원본 IP 저장 금지)" },
  { table: "CustomerLoginHistory", name: "CustomerLoginHistory_dates_ck", expr: isoDate("loggedInAt"), why: "날짜 형식" },
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

// ---------------------------------------------------------------
// 결제·주문 CHECK
// ---------------------------------------------------------------
/** 토스 주문번호 규칙: 6~64자, 영문·숫자·-_= */
const pgOrderIdOk = (col: string) => `length(${q(col)}) BETWEEN 6 AND 64 AND ${q(col)} NOT GLOB '*[^A-Za-z0-9_=-]*'`;
const dates = (...cols: [string, boolean][]) => cols.map(([c, nullable]) => `(${nullable ? isoDateOrNull(c) : isoDate(c)})`).join(" AND ");
const httpsOrNull = (col: string) => `${q(col)} IS NULL OR ${q(col)} GLOB 'https://?*'`;

const PAYMENT_CHECKS: CheckConstraint[] = [
  // ----- 주문
  { table: "Order", name: "Order_total_ck", expr: int("totalPrice", ">= 1"), why: "주문 금액은 1원 이상의 정수 (0원 이하 판매 금지)" },
  { table: "Order", name: "Order_payment_order_id_ck", expr: pgOrderIdOk("paymentOrderId"), why: "토스 주문번호 규칙 (6~64자, 영문·숫자·-_=). 어기면 결제창에서 INVALID_ORDER_ID" },
  { table: "Order", name: "Order_name_ck", expr: `${notBlank("orderName")} AND length("orderName") <= 100`, why: "결제창 상품명 1~100자 (토스 제한)" },
  {
    table: "Order",
    name: "Order_state_ck",
    expr: [
      `("status" IN ('PENDING', 'WAITING_DEPOSIT') AND "paidAt" IS NULL AND "canceledAt" IS NULL)`,
      `("status" = 'PAID' AND "paidAt" IS NOT NULL AND "canceledAt" IS NULL)`,
      `("status" IN ('CANCELED', 'EXPIRED') AND "canceledAt" IS NOT NULL)`,
      `("status" = 'CANCEL_FAILED')`,
    ].join(" OR "),
    why: "결제 완료면 결제 시각, 취소·만료면 취소 시각 필수. 결제 전에는 둘 다 비어 있음",
  },
  { table: "Order", name: "Order_dates_ck", expr: dates(["createdAt", false], ["paidAt", true], ["canceledAt", true]), why: "날짜 형식" },

  // ----- 결제
  {
    table: "Payment",
    name: "Payment_amounts_ck",
    expr: [
      int("amount", ">= 1"),
      int("canceledAmount", ">= 0"),
      `"canceledAmount" <= "amount"`,
      `typeof("balanceAmount") = 'integer' AND "balanceAmount" = "amount" - "canceledAmount"`,
      int("taxFreeAmount", ">= 0"),
      `"taxFreeAmount" <= "amount"`,
      `(${intOrNull("suppliedAmount", ">= 0")})`,
      `(${intOrNull("vat", ">= 0")})`,
    ].join(" AND "),
    why: "금액은 정수, 결제 금액 1원 이상, 취소 합계 ≤ 결제 금액, 잔액 = 결제 금액 − 취소 합계",
  },
  { table: "Payment", name: "Payment_currency_ck", expr: `"currency" = 'KRW'`, why: "원화만 (해외 결제는 지원하지 않음)" },
  { table: "Payment", name: "Payment_attempt_ck", expr: int("attemptNo", ">= 1"), why: "시도 번호는 1부터" },
  {
    table: "Payment",
    name: "Payment_keys_ck",
    expr: [
      `("paymentKey" IS NULL OR length("paymentKey") BETWEEN 1 AND 200)`,
      pgOrderIdOk("pgOrderId"),
      `("confirmIdempotencyKey" IS NULL OR length("confirmIdempotencyKey") BETWEEN 1 AND 300)`,
      `(${hashOrNull("secretHash")})`,
      `(${httpsOrNull("receiptUrl")})`,
      `("failMessage" IS NULL OR length("failMessage") <= 510)`,
    ].join(" AND "),
    why: "토스 규격 길이 (결제 키 200자, 주문번호 6~64자, 멱등키 300자), secret은 해시로만, 영수증은 https",
  },
  {
    table: "Payment",
    name: "Payment_state_ck",
    expr: [
      `("status" IN ('IN_PROGRESS', 'UNKNOWN') AND "paymentKey" IS NOT NULL AND "confirmIdempotencyKey" IS NOT NULL AND "canceledAmount" = 0 AND "failCode" IS NULL AND "approvedAt" IS NULL)`,
      `("status" = 'WAITING_FOR_DEPOSIT' AND "paymentKey" IS NOT NULL AND "method" = 'VIRTUAL_ACCOUNT' AND "canceledAmount" = 0 AND "failCode" IS NULL AND "approvedAt" IS NULL)`,
      `("status" = 'DONE' AND "paymentKey" IS NOT NULL AND "approvedAt" IS NOT NULL AND "canceledAmount" = 0 AND "failCode" IS NULL)`,
      `("status" = 'PARTIAL_CANCELED' AND "paymentKey" IS NOT NULL AND "approvedAt" IS NOT NULL AND "canceledAmount" > 0 AND "canceledAmount" < "amount")`,
      `("status" = 'CANCELED' AND "paymentKey" IS NOT NULL AND "canceledAmount" = "amount" AND "canceledAt" IS NOT NULL)`,
      `("status" = 'ABORTED' AND "failCode" IS NOT NULL AND "failedAt" IS NOT NULL AND "canceledAmount" = 0 AND "approvedAt" IS NULL)`,
      `("status" = 'EXPIRED' AND "expiredAt" IS NOT NULL AND "canceledAmount" = 0 AND "approvedAt" IS NULL)`,
    ].join(" OR "),
    why: "상태별 필수 칸: 완료는 승인 시각, 실패는 실패 코드·시각, 만료는 만료 시각, 취소는 취소 금액 = 결제 금액, 입금 대기는 가상계좌만",
  },
  {
    table: "Payment",
    name: "Payment_dates_ck",
    expr: dates(["requestedAt", true], ["approvedAt", true], ["failedAt", true], ["canceledAt", true], ["expiredAt", true], ["syncedAt", true], ["statusChangedAt", false], ["createdAt", false]),
    why: "날짜 형식",
  },

  { table: "PaymentCard", name: "PaymentCard_values_ck", expr: [notBlank("issuerCode"), notBlank("approveNo"), `"numberMasked" GLOB '*[*]*' AND length("numberMasked") <= 20`, int("installmentPlanMonths", "BETWEEN 0 AND 60"), int("amount", ">= 0")].join(" AND "), why: "카드번호는 가린 값(*)만, 할부 0~60개월, 금액 0 이상" },
  { table: "PaymentEasyPay", name: "PaymentEasyPay_values_ck", expr: `${notBlank("provider")} AND ${int("amount", ">= 0")} AND ${int("discountAmount", ">= 0")}`, why: "간편결제사 필수, 금액·할인 0 이상" },
  { table: "PaymentVirtualAccount", name: "PaymentVirtualAccount_values_ck", expr: `${notBlank("bankCode")} AND "accountNumberEnc" GLOB 'v[0-9]*:?*:?*:?*' AND (${encOrNull("customerNameEnc")})`, why: "가상계좌 번호·입금자명은 암호문으로만" },
  { table: "PaymentVirtualAccount", name: "PaymentVirtualAccount_dates_ck", expr: dates(["dueDate", false], ["depositedAt", true]), why: "날짜 형식 (입금 기한 비교가 깨지지 않게)" },
  {
    table: "PaymentRefundAccount",
    name: "PaymentRefundAccount_values_ck",
    expr: [
      notBlank("bankCode"),
      `"accountNumberMasked" GLOB '*[*]*' AND "holderNameMasked" GLOB '*[*]*'`,
      `(${encOrNull("accountNumberEnc")}) AND (${encOrNull("holderNameEnc")})`,
      `("accountNumberEnc" IS NULL) = ("holderNameEnc" IS NULL) AND ("accountNumberEnc" IS NULL) = ("wipedAt" IS NOT NULL)`,
    ].join(" AND "),
    why: "환불 계좌는 암호문 + 가린 값, 파기하면 암호문 둘 다 지우고 파기 시각 기록",
  },
  { table: "PaymentRefundAccount", name: "PaymentRefundAccount_dates_ck", expr: dates(["createdAt", false], ["wipedAt", true]), why: "날짜 형식" },

  {
    table: "PaymentCancel",
    name: "PaymentCancel_values_ck",
    expr: [
      int("cancelAmount", ">= 1"),
      int("taxFreeAmount", ">= 0"),
      `"taxFreeAmount" <= "cancelAmount"`,
      `(${intOrNull("refundableAmountAfter", ">= 0")})`,
      `${notBlank("reasonText")} AND length("reasonText") <= 200`,
      `length("idempotencyKey") BETWEEN 1 AND 300`,
    ].join(" AND "),
    why: "취소 금액 1원 이상, 사유 1~200자(토스 제한), 멱등키 300자 이내",
  },
  {
    table: "PaymentCancel",
    name: "PaymentCancel_state_ck",
    expr: [
      `("status" IN ('REQUESTED', 'UNKNOWN') AND "transactionKey" IS NULL AND "canceledAt" IS NULL AND "failCode" IS NULL)`,
      `("status" = 'DONE' AND "transactionKey" IS NOT NULL AND "canceledAt" IS NOT NULL AND "failCode" IS NULL)`,
      `("status" = 'FAILED' AND "transactionKey" IS NULL AND "canceledAt" IS NULL AND "failCode" IS NOT NULL)`,
    ].join(" OR "),
    why: "취소 완료는 거래 키·취소 시각 필수, 실패는 실패 코드 필수",
  },
  { table: "PaymentCancel", name: "PaymentCancel_dates_ck", expr: dates(["requestedAt", false], ["canceledAt", true]), why: "날짜 형식" },

  { table: "PaymentStatusHistory", name: "PaymentStatusHistory_values_ck", expr: `${int("canceledAmount", ">= 0")} AND ${isoDate("changedAt")}`, why: "취소 금액 0 이상, 날짜 형식" },

  {
    table: "PaymentApiLog",
    name: "PaymentApiLog_values_ck",
    expr: [
      `"httpMethod" IN ('GET', 'POST')`,
      `"path" GLOB '/v1/*'`,
      int("durationMs", ">= 0"),
      `("idempotencyKey" IS NULL OR length("idempotencyKey") <= 300)`,
      `(("outcome" = 'SUCCESS' AND "httpStatus" BETWEEN 200 AND 299) OR ("outcome" = 'FAIL' AND "httpStatus" BETWEEN 300 AND 599) OR ("outcome" IN ('TIMEOUT', 'NETWORK_ERROR') AND "httpStatus" IS NULL))`,
      `("requestBody" IS NULL OR length("requestBody") <= 20000) AND ("responseBody" IS NULL OR length("responseBody") <= 20000)`,
      isoDate("createdAt"),
    ].join(" AND "),
    why: "결과와 HTTP 상태가 맞아야 함 (성공=2xx, 실패=응답 있음, 시간 초과·네트워크 오류=응답 없음), 본문 2만 자 이내",
  },

  {
    table: "PaymentWebhookEvent",
    name: "PaymentWebhookEvent_values_ck",
    expr: [
      notBlank("eventType"),
      notBlank("dedupKey"),
      int("retriedCount", ">= 0"),
      int("attempts", ">= 0"),
      `length("payload") <= 100000`,
      `("status" NOT IN ('PROCESSED', 'IGNORED') OR "processedAt" IS NOT NULL) AND ("status" <> 'FAILED' OR "lastError" IS NOT NULL)`,
      dates(["receivedAt", false], ["processedAt", true]),
    ].join(" AND "),
    why: "처리·무시하면 처리 시각, 실패하면 오류 내용 필수",
  },

  { table: "CashReceipt", name: "CashReceipt_values_ck", expr: `${int("amount", ">= 0")} AND ${int("taxFreeAmount", ">= 0")} AND "taxFreeAmount" <= "amount" AND (${httpsOrNull("receiptUrl")}) AND ${dates(["issuedAt", true], ["createdAt", false])}`, why: "금액 0 이상, 영수증 주소 https, 날짜 형식" },
];

// ---------------------------------------------------------------
// ⑦ 주문 CHECK (금액 공식·상태별 필수 칸·형식)
// ---------------------------------------------------------------
const zip5 = (col: string) => `length(${q(col)}) = 5 AND ${q(col)} NOT GLOB '*[^0-9]*'`;
const memoOk = (col: string, max = 200) => `${q(col)} IS NULL OR (trim(${q(col)}) <> '' AND length(${q(col)}) <= ${max})`;
/** 주소 암호문 칸들 (파기하면 전부 null) */
const ADDRESS_ENC_COLS = ["recipientEnc", "phoneEnc", "address1Enc", "address2Enc", "deliveryMemoEnc"];
const ORDERER_COLS = ["ordererNameEnc", "ordererPhoneEnc", "ordererPhoneHash", "ordererEmailEnc"];

const ORDER_CHECKS: CheckConstraint[] = [
  // ----- 주문 (금액은 앱이 계산해 넣지만, 공식이 어긋나면 DB가 거부)
  { table: "Order", name: "Order_no_ck", expr: `"orderNo" GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'`, why: "고객용 주문번호 형식: 날짜 8자리-숫자 8자리" },
  {
    table: "Order",
    name: "Order_amounts_ck",
    expr: ["itemsListTotal", "itemsDiscountTotal", "itemsTotal", "couponDiscountTotal", "shippingBaseFee", "shippingExtraFee", "shippingFee", "shippingDiscount", "pointUsed"].map((c) => `(${int(c, ">= 0")})`).join(" AND ") + ` AND (${intOrNull("freeShippingThreshold", "> 0")})`,
    why: "금액 칸은 0 이상의 정수 (무료배송 기준은 비우거나 1원 이상)",
  },
  {
    table: "Order",
    name: "Order_amount_math_ck",
    expr: [
      `"itemsTotal" = "itemsListTotal" - "itemsDiscountTotal"`,
      `"shippingFee" = "shippingBaseFee" + "shippingExtraFee"`,
      `"couponDiscountTotal" <= "itemsTotal"`,
      `"shippingDiscount" <= "shippingFee"`,
      `"totalPrice" = "itemsTotal" - "couponDiscountTotal" + "shippingFee" - "shippingDiscount" - "pointUsed"`,
    ].join(" AND "),
    why: "판매가 합계 = 정가 − 할인, 배송비 = 기본 + 추가, 결제액 = 판매가 − 쿠폰 + 배송비 − 배송비 할인 − 포인트 (할인이 원금을 넘지 않음)",
  },
  { table: "Order", name: "Order_status_meta_ck", expr: `(${memoOk("statusMemo")}) AND ${dates(["statusChangedAt", false], ["confirmedAt", true], ["piiPurgedAt", true], ["updatedAt", false])}`, why: "상태 사유 200자 이내, 날짜 형식" },
  {
    table: "Order",
    name: "Order_orderer_ck",
    expr: `(${encOrNull("ordererNameEnc")}) AND (${encOrNull("ordererPhoneEnc")}) AND (${encOrNull("ordererEmailEnc")}) AND (${hashOrNull("ordererPhoneHash")}) AND ("piiPurgedAt" IS NULL OR (${ORDERER_COLS.map((c) => `"${c}" IS NULL`).join(" AND ")}))`,
    why: "주문자 정보는 암호문·해시로만 저장, 파기하면 전부 비움",
  },
  { table: "Order", name: "Order_returned_date_ck", expr: isoDateOrNull("returnedAt"), why: "날짜 형식" },
  { table: "Order", name: "Order_confirmed_ck", expr: `("fulfillmentStatus" = 'CONFIRMED') = ("confirmedAt" IS NOT NULL)`, why: "전체 구매확정 시각은 모두 확정됐을 때만" },

  // ----- 주문 상품 (줄 금액·상태별 시각)
  { table: "OrderItem", name: "OrderItem_line_no_ck", expr: int("lineNo", ">= 1"), why: "순번은 1부터" },
  {
    table: "OrderItem",
    name: "OrderItem_line_math_ck",
    expr: [
      `(${int("lineListTotal", ">= 0")}) AND (${int("lineDiscountTotal", ">= 0")}) AND (${int("lineTotal", ">= 0")}) AND (${int("couponAllocated", ">= 0")}) AND (${int("pointAllocated", ">= 0")}) AND (${int("payAmount", ">= 0")})`,
      `"lineListTotal" = "listPrice" * "quantity"`,
      `"lineDiscountTotal" = "discountAmount" * "quantity"`,
      `"lineTotal" = "price" * "quantity"`,
      `"payAmount" = "lineTotal" - "couponAllocated" - "pointAllocated"`,
    ].join(" AND "),
    why: "줄 금액 = 단가 × 수량, 실결제액 = 판매가 합계 − 쿠폰 몫 − 포인트 몫 (0 이상)",
  },
  {
    table: "OrderItem",
    name: "OrderItem_state_ck",
    expr: "(" + [
      `("status" = 'AWAITING_PAYMENT' AND "paidAt" IS NULL AND "preparingAt" IS NULL AND "shippedAt" IS NULL AND "deliveredAt" IS NULL AND "confirmedAt" IS NULL AND "canceledAt" IS NULL)`,
      `("status" = 'PAID' AND "paidAt" IS NOT NULL AND "preparingAt" IS NULL AND "shippedAt" IS NULL AND "deliveredAt" IS NULL AND "confirmedAt" IS NULL AND "canceledAt" IS NULL)`,
      `("status" = 'PREPARING' AND "paidAt" IS NOT NULL AND "preparingAt" IS NOT NULL AND "shippedAt" IS NULL AND "deliveredAt" IS NULL AND "confirmedAt" IS NULL AND "canceledAt" IS NULL)`,
      `("status" = 'SHIPPED' AND "paidAt" IS NOT NULL AND "preparingAt" IS NOT NULL AND "shippedAt" IS NOT NULL AND "deliveredAt" IS NULL AND "confirmedAt" IS NULL AND "canceledAt" IS NULL)`,
      `("status" = 'DELIVERED' AND "paidAt" IS NOT NULL AND "preparingAt" IS NOT NULL AND "shippedAt" IS NOT NULL AND "deliveredAt" IS NOT NULL AND "confirmedAt" IS NULL AND "canceledAt" IS NULL)`,
      `("status" = 'CONFIRMED' AND "paidAt" IS NOT NULL AND "preparingAt" IS NOT NULL AND "shippedAt" IS NOT NULL AND "confirmedAt" IS NOT NULL AND "canceledAt" IS NULL)`,
      `("status" = 'CANCELED' AND "shippedAt" IS NULL AND "deliveredAt" IS NULL AND "confirmedAt" IS NULL AND "canceledAt" IS NOT NULL)`,
      `("status" IN ('RETURN_REQUESTED', 'RETURN_COLLECTING') AND "paidAt" IS NOT NULL AND "shippedAt" IS NOT NULL AND "deliveredAt" IS NOT NULL AND "confirmedAt" IS NULL AND "canceledAt" IS NULL)`,
      `("status" = 'RETURNED' AND "deliveredAt" IS NOT NULL AND "confirmedAt" IS NULL AND "canceledAt" IS NULL)`,
    ].join(" OR ") + `) AND (("status" = 'CONFIRMED') = ("confirmType" IS NOT NULL)) AND ("autoConfirmAt" IS NULL OR "status" IN ('DELIVERED', 'CONFIRMED', 'RETURN_REQUESTED', 'RETURN_COLLECTING', 'RETURNED')) AND ("status" <> 'DELIVERED' OR "autoConfirmAt" IS NOT NULL) AND (("status" = 'RETURNED') = ("returnedAt" IS NOT NULL))`,
    why: "단계별 시각: 그 단계까지 거친 시각은 필수, 아직 안 간 단계는 비어 있음. 구매확정이면 확정 방식, 배송 완료면 자동확정 예정일 필수",
  },
  { table: "OrderItem", name: "OrderItem_dates_ck", expr: `(${memoOk("statusMemo")}) AND ${dates(["statusChangedAt", false], ["paidAt", true], ["preparingAt", true], ["shippedAt", true], ["deliveredAt", true], ["confirmedAt", true], ["canceledAt", true], ["autoConfirmAt", true], ["returnedAt", true], ["createdAt", false])}`, why: "날짜 형식, 상태 사유 200자 이내" },

  // ----- 주문 배송지 (암호문, 파기)
  {
    table: "OrderShippingAddress",
    name: "OrderShippingAddress_values_ck",
    expr: `(${zip5("zipCode")}) AND ${ADDRESS_ENC_COLS.map((c) => `(${encOrNull(c)})`).join(" AND ")} AND (${hashOrNull("phoneHash")}) AND (${int("version", ">= 1")}) AND (${memoOk("changeReason")})`,
    why: "우편번호 5자리, 주소·연락처·메모는 암호문으로만, 버전 1 이상",
  },
  {
    table: "OrderShippingAddress",
    name: "OrderShippingAddress_purge_ck",
    expr: `("piiPurgedAt" IS NULL AND "recipientEnc" IS NOT NULL AND "phoneEnc" IS NOT NULL AND "address1Enc" IS NOT NULL) OR ("piiPurgedAt" IS NOT NULL AND ${[...ADDRESS_ENC_COLS, "phoneHash"].map((c) => `"${c}" IS NULL`).join(" AND ")})`,
    why: "파기 전에는 받는 분·연락처·주소 필수, 파기 후에는 전부 비어 있음",
  },
  { table: "OrderShippingAddress", name: "OrderShippingAddress_change_ck", expr: `("version" = 1) = ("changedBy" IS NULL)`, why: "처음 저장(1버전)은 변경자 없음, 바꾼 버전은 변경자 필수" },
  { table: "OrderShippingAddress", name: "OrderShippingAddress_dates_ck", expr: dates(["createdAt", false], ["updatedAt", false], ["piiPurgedAt", true]), why: "날짜 형식" },
  {
    table: "OrderShippingAddressHistory",
    name: "OrderShippingAddressHistory_values_ck",
    expr: `(${zip5("zipCode")}) AND ${ADDRESS_ENC_COLS.map((c) => `(${encOrNull(c)})`).join(" AND ")} AND (${int("version", ">= 1")}) AND (${memoOk("changeReason")}) AND ${dates(["changedAt", false])}`,
    why: "이전 주소도 암호문으로만",
  },

  // ----- 이력
  { table: "OrderStatusHistory", name: "OrderStatusHistory_ck", expr: `("fromStatus" IS NULL OR "fromStatus" <> "toStatus") AND (${memoOk("memo")}) AND ${dates(["changedAt", false])}`, why: "실제로 바뀐 경우만, 날짜 형식" },
  { table: "OrderItemStatusHistory", name: "OrderItemStatusHistory_ck", expr: `("fromStatus" IS NULL OR "fromStatus" <> "toStatus") AND (${memoOk("memo")}) AND ${dates(["changedAt", false])}`, why: "실제로 바뀐 경우만, 날짜 형식" },

  // ----- 배송비 규칙
  { table: "ShippingPolicy", name: "ShippingPolicy_values_ck", expr: `${q("code")} <> '' AND ${q("code")} NOT GLOB '*[^A-Z0-9_-]*' AND ${notBlank("name")} AND (${int("baseFee", ">= 0")}) AND (${intOrNull("freeShippingThreshold", "> 0")}) AND (${memoOk("memo")})`, why: "코드 형식, 배송비 0 이상, 무료 기준 1원 이상" },
  { table: "ShippingPolicy", name: "ShippingPolicy_period_ck", expr: `${dates(["validFrom", false], ["validTo", true], ["createdAt", false])} AND ("validTo" IS NULL OR "validTo" > "validFrom")`, why: "적용 기간: 끝은 시작 이후" },
  { table: "ShippingSurchargeZone", name: "ShippingSurchargeZone_values_ck", expr: `"region" <> 'NORMAL' AND ${notBlank("name")} AND (${zip5("zipFrom")}) AND (${zip5("zipTo")}) AND "zipFrom" <= "zipTo" AND (${int("extraFee", "> 0")})`, why: "제주·도서산간만, 우편번호 범위 시작 ≤ 끝, 추가 배송비 1원 이상" },

  // ----- 택배사·출고
  {
    table: "Courier",
    name: "Courier_values_ck",
    expr: `${upperCode("code")} AND ${notBlank("name")} AND "trackingUrlTemplate" GLOB 'https://?*{no}*' AND (${int("trackingNoMinLength", "BETWEEN 6 AND 30")}) AND (${int("trackingNoMaxLength", "BETWEEN 6 AND 30")}) AND "trackingNoMinLength" <= "trackingNoMaxLength" AND (${int("sortOrder", ">= 0")})`,
    why: "배송조회 주소는 https + 송장 자리 {no}, 송장 자릿수 6~30",
  },
  { table: "Shipment", name: "Shipment_tracking_ck", expr: `length("trackingNo") BETWEEN 6 AND 30 AND "trackingNo" NOT GLOB '*[^0-9]*'`, why: "송장번호는 숫자만 (하이픈 없이 저장)" },
  {
    table: "Shipment",
    name: "Shipment_state_ck",
    expr: [
      `("status" = 'READY' AND "shippedAt" IS NULL AND "deliveredAt" IS NULL AND "canceledAt" IS NULL)`,
      `("status" = 'SHIPPED' AND "shippedAt" IS NOT NULL AND "deliveredAt" IS NULL AND "canceledAt" IS NULL)`,
      `("status" = 'DELIVERED' AND "shippedAt" IS NOT NULL AND "deliveredAt" IS NOT NULL AND "deliveredAt" >= "shippedAt" AND "canceledAt" IS NULL)`,
      `("status" = 'CANCELED' AND "shippedAt" IS NULL AND "deliveredAt" IS NULL AND "canceledAt" IS NOT NULL)`,
    ].join(" OR "),
    why: "출고면 출고 시각, 배송 완료면 완료 시각(출고 이후), 취소는 출고 전에만",
  },
  { table: "Shipment", name: "Shipment_meta_ck", expr: `${notBlank("createdBy")} AND (${memoOk("memo")}) AND ${dates(["statusChangedAt", false], ["shippedAt", true], ["deliveredAt", true], ["canceledAt", true], ["createdAt", false], ["updatedAt", false])}`, why: "처리자 필수, 날짜 형식" },
  { table: "ShipmentItem", name: "ShipmentItem_qty_ck", expr: int("qty", ">= 1"), why: "수량 1개 이상" },
];

// ----- 비회원 주문
const GUEST_CHECKS: CheckConstraint[] = [
  {
    table: "Order",
    name: "Order_orderer_type_ck",
    expr: `("ordererType" = 'MEMBER' AND "customerId" IS NOT NULL AND "linkedAt" IS NULL) OR ("ordererType" = 'GUEST' AND ("customerId" IS NULL) = ("linkedAt" IS NULL))`,
    why: "회원 주문은 회원 필수, 비회원 주문은 회원이 비어 있거나(가져오기 전) 가져온 시각과 함께 있음",
  },
  { table: "Order", name: "Order_guest_benefit_ck", expr: `"ordererType" <> 'GUEST' OR ("couponDiscountTotal" = 0 AND "pointUsed" = 0 AND "shippingDiscount" = 0)`, why: "비회원은 쿠폰·포인트·배송비 할인 없이 결제" },
  {
    table: "Order",
    name: "Order_guest_orderer_ck",
    expr: `"ordererType" <> 'GUEST' OR "piiPurgedAt" IS NOT NULL OR ("ordererNameEnc" IS NOT NULL AND "ordererPhoneEnc" IS NOT NULL AND "ordererPhoneHash" IS NOT NULL AND "ordererEmailEnc" IS NOT NULL)`,
    why: "비회원 주문은 주문자 이름·연락처·이메일 필수 (회원 정보가 없으므로 연락 수단) — 5년 뒤 파기 전까지",
  },
  { table: "Order", name: "Order_linked_date_ck", expr: `(${isoDateOrNull("linkedAt")}) AND ("linkedAt" IS NULL OR "linkedAt" >= "createdAt")`, why: "가져온 시각은 주문 이후" },
  {
    table: "GuestOrderAccess",
    name: "GuestOrderAccess_values_ck",
    expr: `("passwordHash" IS NULL OR ("passwordHash" GLOB 's1:?*:?*' AND length("passwordHash") BETWEEN 40 AND 300)) AND (${int("failedCount", ">= 0")}) AND ${notBlank("privacyConsentVersion")} AND ("claimedAt" IS NULL) = ("claimedByCustomerId" IS NULL) AND ${dates(["lockedUntil", true], ["lastFailedAt", true], ["lastAccessAt", true], ["privacyConsentAt", false], ["claimedAt", true], ["createdAt", false], ["updatedAt", false])}`,
    why: "비밀번호는 해시 형식만(원문 금지), 실패 횟수 0 이상, 동의 버전 필수, 가져온 시각·회원은 함께",
  },
  { table: "GuestOrderSession", name: "GuestOrderSession_values_ck", expr: `length("tokenHash") = 64 AND "tokenHash" NOT GLOB '*[^0-9a-f]*' AND "expiresAt" > "createdAt" AND ${dates(["expiresAt", false], ["revokedAt", true], ["createdAt", false])}`, why: "출입증은 해시(64자)로만, 만료는 발급 이후" },
  {
    table: "GuestLookupAttempt",
    name: "GuestLookupAttempt_values_ck",
    expr: `length("ipHash") = 64 AND "ipHash" NOT GLOB '*[^0-9a-f]*' AND length("orderNoInput") BETWEEN 1 AND 20 AND ("purpose" = 'CLAIM') = ("customerId" IS NOT NULL) AND ${dates(["attemptedAt", false])}`,
    why: "IP는 해시로만, 가져오기 시도는 회원 필수",
  },
];

// ----- 재고 보강 (발주·입고·재입고 알림·알림·재주문·반품)
const INV2_CHECKS: CheckConstraint[] = [
  { table: "PurchaseOrder", name: "PurchaseOrder_values_ck", expr: `"poNo" GLOB 'PO-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9]*' AND ${notBlank("createdBy")} AND (${memoOk("memo", 500)}) AND ${dates(["orderedAt", true], ["confirmedAt", true], ["canceledAt", true], ["statusChangedAt", false], ["createdAt", false], ["updatedAt", false])}`, why: "발주번호 형식 PO-날짜-순번, 처리자 필수" },
  {
    table: "PurchaseOrder",
    name: "PurchaseOrder_state_ck",
    expr: `("status" = 'DRAFT' AND "orderedAt" IS NULL AND "confirmedAt" IS NULL AND "canceledAt" IS NULL)
      OR ("status" = 'ORDERED' AND "orderedAt" IS NOT NULL AND "confirmedAt" IS NULL AND "canceledAt" IS NULL)
      OR ("status" IN ('CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED') AND "orderedAt" IS NOT NULL AND "canceledAt" IS NULL)
      OR ("status" = 'CANCELED' AND "canceledAt" IS NOT NULL)`,
    why: "상태별 시각: 발주 이후는 발주 시각, 취소는 취소 시각",
  },
  { table: "PurchaseOrderLine", name: "PurchaseOrderLine_qty_ck", expr: `(${int("lineNo", ">= 1")}) AND (${int("qtyOrdered", ">= 1")}) AND (${int("qtyReceived", ">= 0")}) AND "qtyReceived" <= "qtyOrdered" AND (${intOrNull("unitCost", ">= 0")}) AND ${dates(["expectedAt", true], ["createdAt", false], ["updatedAt", false])}`, why: "발주 수량 1 이상, 입고 수량은 발주 수량 이하" },
  { table: "PurchaseOrderEvent", name: "PurchaseOrderEvent_ck", expr: `${notBlank("createdBy")} AND (${memoOk("memo", 500)}) AND ${dates(["fromDate", true], ["toDate", true], ["createdAt", false])} AND ("type" <> 'DATE_CHANGED' OR ("lineId" IS NOT NULL AND "toDate" IS NOT NULL))`, why: "예정일 변경 이력은 줄·새 날짜 필수" },
  { table: "InboundReceipt", name: "InboundReceipt_values_ck", expr: `"receiptNo" GLOB 'IN-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9]*' AND ${notBlank("createdBy")} AND (${memoOk("memo", 500)}) AND ${dates(["receivedAt", false], ["createdAt", false])}`, why: "입고번호 형식, 처리자 필수" },
  { table: "InboundReceiptLine", name: "InboundReceiptLine_qty_ck", expr: `(${int("qtyGood", ">= 0")}) AND (${int("qtyDefect", ">= 0")}) AND "qtyGood" + "qtyDefect" >= 1`, why: "정상·불량 0 이상, 합계 1 이상" },
  {
    table: "RestockSubscription",
    name: "RestockSubscription_state_ck",
    expr: `"expiresAt" > "createdAt" AND ${dates(["notifiedExpectedAt", true], ["scheduledAt", true], ["arrivedAt", true], ["closedAt", true], ["expiresAt", false], ["createdAt", false], ["updatedAt", false])}
      AND (("status" IN ('WAITING', 'SCHEDULED')) = ("closedAt" IS NULL))
      AND ("status" <> 'SCHEDULED' OR ("notifiedExpectedAt" IS NOT NULL AND "scheduledAt" IS NOT NULL))
      AND ("status" NOT IN ('ARRIVED', 'PURCHASED') OR "arrivedAt" IS NOT NULL)`,
    why: "진행 중(대기·예정 안내)이면 끝난 시각 없음, 예정 안내면 안내한 날짜 필수, 재입고 안내·구매는 안내 시각 필수",
  },
  {
    table: "Notification",
    name: "Notification_values_ck",
    expr: `"audience" IN ('CUSTOMER', 'ADMIN') AND ("audience" = 'CUSTOMER') = ("customerId" IS NOT NULL) AND ${notBlank("title")} AND length("title") <= 100 AND ${notBlank("body")} AND length("body") <= 1000
      AND ("linkUrl" IS NULL OR ("linkUrl" GLOB '/*' AND "linkUrl" NOT GLOB '//*')) AND length("dedupKey") BETWEEN 3 AND 200 AND (${int("attempts", ">= 0")})
      AND ("status" <> 'SENT' OR "sentAt" IS NOT NULL) AND ("channel" <> 'IN_APP' OR "status" = 'SENT') AND ${dates(["sentAt", true], ["readAt", true], ["createdAt", false])}`,
    why: "회원 알림은 회원 필수(관리자 알림은 없음), 링크는 사이트 안 경로만, 알림함은 만들자마자 보냄",
  },
  {
    table: "StockAlert",
    name: "StockAlert_state_ck",
    expr: `(${int("availableAtOpen", ">= 0")}) AND (${int("reorderPoint", ">= 1")}) AND ${dates(["openedAt", false], ["resolvedAt", true])}
      AND (("status" = 'OPEN') = ("resolvedAt" IS NULL)) AND (("status" = 'OPEN') = ("resolution" IS NULL))`,
    why: "해소되면 해소 시각·사유 필수",
  },
  {
    table: "ReturnRequest",
    name: "ReturnRequest_values_ck",
    expr: `"returnNo" GLOB 'R[0-9]*-[0-9]*-[0-9]*' AND "requestedBy" IN ('CUSTOMER', 'ADMIN') AND (${memoOk("reasonText", 500)}) AND (${memoOk("memo", 500)})
      AND (${int("returnShippingFee", ">= 0")}) AND (${intOrNull("refundAmount", ">= 0")})
      AND ("fault" = CASE WHEN "reason" IN ('CHANGE_OF_MIND', 'SIZE') THEN 'CUSTOMER' ELSE 'SELLER' END)
      AND ("fault" = 'CUSTOMER' OR "returnShippingFee" = 0)
      AND ("pickupTrackingNo" IS NULL OR (length("pickupTrackingNo") BETWEEN 6 AND 30 AND "pickupTrackingNo" NOT GLOB '*[^0-9]*'))
      AND ("pickupCourierId" IS NULL) = ("pickupTrackingNo" IS NULL)`,
    why: "반품번호 형식, 사유에 따른 귀책(단순 변심·사이즈 = 고객), 판매자 사유면 반품 배송비 0, 회수 송장은 택배사와 함께",
  },
  {
    table: "ReturnRequest",
    name: "ReturnRequest_state_ck",
    expr: `${dates(["statusChangedAt", false], ["requestedAt", false], ["approvedAt", true], ["collectingAt", true], ["receivedAt", true], ["inspectedAt", true], ["completedAt", true], ["closedAt", true], ["createdAt", false], ["updatedAt", false])}
      AND ("status" NOT IN ('APPROVED', 'COLLECTING', 'RECEIVED', 'INSPECTED', 'COMPLETED') OR "approvedAt" IS NOT NULL)
      AND ("status" NOT IN ('COLLECTING', 'RECEIVED', 'INSPECTED', 'COMPLETED') OR ("collectingAt" IS NOT NULL AND "pickupTrackingNo" IS NOT NULL))
      AND ("status" NOT IN ('RECEIVED', 'INSPECTED', 'COMPLETED') OR "receivedAt" IS NOT NULL)
      AND ("status" NOT IN ('INSPECTED', 'COMPLETED') OR ("inspectedAt" IS NOT NULL AND "refundAmount" IS NOT NULL))
      AND (("status" = 'COMPLETED') = ("completedAt" IS NOT NULL))
      AND (("status" IN ('REJECTED', 'CANCELED')) = ("closedAt" IS NOT NULL))
      AND ("status" <> 'COMPLETED' OR "refundAmount" = 0 OR "paymentCancelId" IS NOT NULL)`,
    why: "단계별 시각 필수, 검수 끝나면 환불액 확정, 환불할 금액이 있으면 완료 전에 결제 취소가 있어야 함",
  },
  {
    table: "ReturnItem",
    name: "ReturnItem_values_ck",
    expr: `(${int("qty", ">= 1")}) AND (${intOrNull("refundAmount", ">= 0")}) AND (${memoOk("inspectionMemo", 500)}) AND ${dates(["inspectedAt", true])}
      AND ("inspection" IS NULL) = ("inspectedAt" IS NULL) AND ("inspection" IS NULL) = ("refundAmount" IS NULL)
      AND ("inspection" IS NOT 'NOT_RETURNABLE' OR "refundAmount" = 0)`,
    why: "검수하면 검수 시각·환불액 필수, 반품 불가는 환불 0",
  },
];

export function allChecks(schemaText: string): CheckConstraint[] {
  return [...autoChecks(schemaText), ...MANUAL_CHECKS, ...PAYMENT_CHECKS, ...ORDER_CHECKS, ...GUEST_CHECKS, ...INV2_CHECKS, ...COUPON_CHECKS];
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
  `(SELECT COALESCE(SUM(r."qty"), 0) FROM "InventoryReservation" r WHERE ${BAL("r", rec)} AND r."status" IN ('RESERVED', 'ALLOCATED'))`; // 결제 대기 + 출고 대기
/** 돈이 걸린(진행 중·입금 대기·완료) 결제 상태 */
const LIVE_PAYMENT_STATES = `('IN_PROGRESS', 'UNKNOWN', 'WAITING_FOR_DEPOSIT', 'DONE', 'PARTIAL_CANCELED')`;
/** 자동 구매확정까지 걸리는 날 (lib/order.ts AUTO_CONFIRM_DAYS와 같아야 함 — 테스트가 비교) */
export const AUTO_CONFIRM_DAYS = 7;
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
  WHEN EXISTS (SELECT 1 FROM "InventoryReservation" r WHERE r."orderId" = NEW."orderId" AND r."skuId" = NEW."skuId" AND r."status" IN ('RESERVED', 'ALLOCATED'))
    THEN RAISE(ABORT, 'InventoryReservation_reserve: 같은 주문에 이 SKU의 예약이 이미 있습니다')
  WHEN NOT EXISTS (SELECT 1 FROM "OrderItem" i WHERE i."id" = NEW."orderItemId" AND i."orderId" = NEW."orderId" AND i."skuId" = NEW."skuId" AND i."quantity" = NEW."qty")
    THEN RAISE(ABORT, 'InventoryReservation_item_match: 예약의 주문·SKU·수량이 주문 상품 줄과 다릅니다')
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
    why: "정해진 길로만: RESERVED → ALLOCATED(완료된 결제가 있을 때, 만료 전) / RELEASED / EXPIRED, ALLOCATED → CONFIRMED(출고 상자가 출고됐을 때) / RELEASED(환불이 끝나 돈이 걸린 결제가 없을 때만). 할당은 만료되지 않음",
    sql: `CREATE TRIGGER "InventoryReservation_transition" BEFORE UPDATE OF "status" ON "InventoryReservation"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
SELECT CASE
  WHEN (OLD."status" || '>' || NEW."status") NOT IN ('RESERVED>ALLOCATED', 'RESERVED>RELEASED', 'RESERVED>EXPIRED', 'ALLOCATED>CONFIRMED', 'ALLOCATED>RELEASED')
    THEN RAISE(ABORT, 'InventoryReservation_transition: 허용되지 않은 예약 상태 변경입니다 (할당은 만료되지 않고, 확정·해제·만료된 예약은 되돌릴 수 없음)')
  WHEN NEW."status" = 'ALLOCATED' AND OLD."expiresAt" <= ${NOW}
    THEN RAISE(ABORT, 'InventoryReservation_transition: 만료된 예약은 할당할 수 없습니다')
  WHEN NEW."status" = 'ALLOCATED' AND NOT EXISTS (SELECT 1 FROM "Payment" p JOIN "Order" o ON o."id" = p."orderId" WHERE p."orderId" = NEW."orderId" AND p."status" IN ('DONE', 'PARTIAL_CANCELED') AND p."amount" = o."totalPrice")
    THEN RAISE(ABORT, 'InventoryReservation_allocate_guard: 완료된 결제가 없어 재고를 할당할 수 없습니다')
  WHEN NEW."status" = 'CONFIRMED' AND NOT EXISTS (
      SELECT 1 FROM "Shipment" s JOIN "ShipmentItem" si ON si."shipmentId" = s."id"
      WHERE s."id" = NEW."shipmentId" AND s."type" = 'OUTBOUND' AND s."status" IN ('SHIPPED', 'DELIVERED') AND si."orderItemId" = NEW."orderItemId")
    THEN RAISE(ABORT, 'InventoryReservation_confirm_guard: 출고된 상자에 담긴 상품만 재고를 확정(차감)할 수 있습니다')
  WHEN OLD."status" = 'ALLOCATED' AND NEW."status" = 'RELEASED'
      AND EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = NEW."orderId" AND p."status" IN ${LIVE_PAYMENT_STATES})
    THEN RAISE(ABORT, 'InventoryReservation_release_guard: 환불이 끝나기 전에는 할당된 재고를 풀 수 없습니다')
END;
END;`,
  },
  {
    table: "InventoryReservation",
    name: "InventoryReservation_immutable",
    why: "예약의 주문·상품 줄·SKU·위치·수량·만료 시각은 바꿀 수 없음 (바꾸려면 해제 후 새로 예약). 출고 상자는 한 번 정하면 고정",
    sql: `CREATE TRIGGER "InventoryReservation_immutable" BEFORE UPDATE OF "orderId", "orderItemId", "skuId", "locationId", "qty", "expiresAt", "createdAt", "shipmentId" ON "InventoryReservation"
WHEN NEW."orderId" IS NOT OLD."orderId" OR NEW."orderItemId" IS NOT OLD."orderItemId" OR NEW."skuId" IS NOT OLD."skuId" OR NEW."locationId" IS NOT OLD."locationId"
  OR NEW."qty" IS NOT OLD."qty" OR NEW."expiresAt" IS NOT OLD."expiresAt" OR NEW."createdAt" IS NOT OLD."createdAt"
  OR (OLD."shipmentId" IS NOT NULL AND NEW."shipmentId" IS NOT OLD."shipmentId")
BEGIN ${raise("InventoryReservation_immutable", "예약 내용은 바꿀 수 없습니다. 해제 후 새로 예약하세요")} END;`,
  },
  {
    table: "InventoryReservation",
    name: "InventoryReservation_sync_upd",
    why: "상태가 바뀌면 예약 수량을 다시 맞추고, 확정(CONFIRMED = 출고)이면 판매 원장(SALE)을 자동 생성 → 실재고 감소 (일어난 시각 = 출고 시각)",
    sql: `CREATE TRIGGER "InventoryReservation_sync_upd" AFTER UPDATE OF "status" ON "InventoryReservation"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
  ${syncReserved("NEW")}
  INSERT INTO "InventoryLedger" ("skuId", "locationId", "type", "qty", "balanceAfter", "refType", "refId", "reservationId", "createdBy", "occurredAt", "createdAt")
  SELECT NEW."skuId", NEW."locationId", 'SALE', -NEW."qty", b."onHand" - NEW."qty", 'ORDER', CAST(NEW."orderId" AS TEXT), NEW."id", 'SYSTEM', NEW."confirmedAt", ${NOW}
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
    why: "결제 대기·출고 대기 예약이 남아 있는 위치를 판매 중지·비활성화하면 출고할 재고가 사라짐",
    sql: `CREATE TRIGGER "InventoryLocation_deactivate_guard" BEFORE UPDATE OF "isActive", "isOnlineSellable" ON "InventoryLocation"
WHEN (NEW."isActive" = 0 OR NEW."isOnlineSellable" = 0)
  AND EXISTS (SELECT 1 FROM "InventoryReservation" r WHERE r."locationId" = NEW."id" AND r."status" IN ('RESERVED', 'ALLOCATED'))
BEGIN ${raise("InventoryLocation_deactivate_guard", "결제 대기·출고 대기 예약이 있는 위치는 판매 중지할 수 없습니다")} END;`,
  },
];

// ----- 고객 도우미
const PROFILE_PII_COLS = ["nameEnc", "phoneEnc", "phoneHash", "birthDateEnc", "birthMonth", "contactEmailEnc", "emailHash"];
const ALLOWED_STATUS_CHANGES = [
  "ACTIVE>DORMANT", "ACTIVE>SUSPENDED", "ACTIVE>WITHDRAW_PENDING",
  "DORMANT>ACTIVE", "DORMANT>SUSPENDED", "DORMANT>WITHDRAW_PENDING",
  "SUSPENDED>ACTIVE", "SUSPENDED>WITHDRAW_PENDING",
  "WITHDRAW_PENDING>ACTIVE", "WITHDRAW_PENDING>WITHDRAWN",
];
const customerStatusOf = (col: string, rec: "NEW" | "OLD" = "NEW") => `(SELECT c."status" FROM "Customer" c WHERE c."id" = ${rec}."${col}")`;
const appendOnly = (table: string): TriggerConstraint[] => [
  {
    table,
    name: `${table}_no_update`,
    why: "이력은 수정 금지",
    sql: `CREATE TRIGGER "${table}_no_update" BEFORE UPDATE ON "${table}"
BEGIN ${raise(`${table}_append_only`, "이력은 수정할 수 없습니다")} END;`,
  },
  {
    table,
    name: `${table}_no_delete`,
    why: "이력은 삭제 금지",
    sql: `CREATE TRIGGER "${table}_no_delete" BEFORE DELETE ON "${table}"
BEGIN ${raise(`${table}_append_only`, "이력은 삭제할 수 없습니다")} END;`,
  },
];

const CUSTOMER_TRIGGERS: TriggerConstraint[] = [
  // --- 상태: 가입은 ACTIVE로, 정해진 길로만 바뀌고, 바뀌면 이력 자동 기록
  {
    table: "Customer",
    name: "Customer_status_insert",
    why: "가입은 ACTIVE 상태로만",
    sql: `CREATE TRIGGER "Customer_status_insert" BEFORE INSERT ON "Customer"
WHEN NEW."status" <> 'ACTIVE'
BEGIN ${raise("Customer_status_insert", "고객은 ACTIVE 상태로만 만들 수 있습니다")} END;`,
  },
  {
    table: "Customer",
    name: "Customer_status_transition",
    why: "허용된 상태 변경만 (탈퇴 완료는 되돌릴 수 없음, 탈퇴는 반드시 유예를 거침), 사유·시각 함께 기록, 탈퇴 완료 전 개인정보 파기 확인",
    sql: `CREATE TRIGGER "Customer_status_transition" BEFORE UPDATE OF "status" ON "Customer"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
SELECT CASE
  WHEN OLD."status" = 'WITHDRAWN'
    THEN RAISE(ABORT, 'Customer_status_transition: 탈퇴 완료된 고객은 상태를 바꿀 수 없습니다')
  WHEN (OLD."status" || '>' || NEW."status") NOT IN (${ALLOWED_STATUS_CHANGES.map((s) => `'${s}'`).join(", ")})
    THEN RAISE(ABORT, 'Customer_status_transition: 허용되지 않은 상태 변경입니다')
  WHEN NEW."statusChangedAt" IS OLD."statusChangedAt"
    THEN RAISE(ABORT, 'Customer_status_transition: 상태를 바꿀 때 statusReason·statusChangedAt도 함께 바꿔야 합니다')
  WHEN NEW."status" = 'WITHDRAWN' AND NOT EXISTS (SELECT 1 FROM "CustomerWithdrawal" w WHERE w."customerId" = NEW."id" AND w."completedAt" IS NOT NULL)
    THEN RAISE(ABORT, 'Customer_status_transition: 완료된 탈퇴 신청 없이 탈퇴 상태로 바꿀 수 없습니다')
  WHEN NEW."status" = 'WITHDRAWN' AND (
      EXISTS (SELECT 1 FROM "CustomerProfile" p WHERE p."customerId" = NEW."id" AND (${PROFILE_PII_COLS.map((c) => `p."${c}" IS NOT NULL`).join(" OR ")}))
      OR EXISTS (SELECT 1 FROM "CustomerAddress" a WHERE a."customerId" = NEW."id")
      OR EXISTS (SELECT 1 FROM "CustomerBodyProfile" b WHERE b."customerId" = NEW."id"))
    THEN RAISE(ABORT, 'Customer_status_transition: 개인정보(프로필·배송지·체형)를 먼저 파기해야 탈퇴 완료할 수 있습니다')
END;
END;`,
  },
  {
    table: "Customer",
    name: "Customer_status_history_ins",
    why: "가입하면 상태 이력 첫 줄 자동 기록",
    sql: `CREATE TRIGGER "Customer_status_history_ins" AFTER INSERT ON "Customer"
BEGIN
  INSERT INTO "CustomerStatusHistory" ("customerId", "fromStatus", "toStatus", "reason", "memo", "changedBy", "changedAt")
  VALUES (NEW."id", NULL, NEW."status", NEW."statusReason", NEW."statusMemo", NEW."statusChangedBy", NEW."statusChangedAt");
END;`,
  },
  {
    table: "Customer",
    name: "Customer_status_history_upd",
    why: "상태가 바뀌면 이력 자동 기록 (앱이 깜빡해도 빠지지 않음)",
    sql: `CREATE TRIGGER "Customer_status_history_upd" AFTER UPDATE OF "status" ON "Customer"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
  INSERT INTO "CustomerStatusHistory" ("customerId", "fromStatus", "toStatus", "reason", "memo", "changedBy", "changedAt")
  VALUES (NEW."id", OLD."status", NEW."status", NEW."statusReason", NEW."statusMemo", NEW."statusChangedBy", NEW."statusChangedAt");
END;`,
  },
  {
    table: "Customer",
    name: "Customer_grade_guard",
    why: "등급은 등급 이력을 먼저 남긴 뒤에만 바꿀 수 있음 (가장 최근 이력의 등급 = 새 등급)",
    sql: `CREATE TRIGGER "Customer_grade_guard" BEFORE UPDATE OF "gradeId" ON "Customer"
WHEN NEW."gradeId" IS NOT OLD."gradeId"
  AND (SELECT h."toGradeId" FROM "CustomerGradeHistory" h WHERE h."customerId" = NEW."id" ORDER BY h."id" DESC LIMIT 1) IS NOT NEW."gradeId"
BEGIN ${raise("Customer_grade_guard", "등급 이력(CustomerGradeHistory)을 먼저 추가해야 등급을 바꿀 수 있습니다")} END;`,
  },
  {
    table: "Customer",
    name: "Customer_no_delete",
    why: "고객 행은 삭제 금지 (탈퇴는 익명화, 주문 5년 보관)",
    sql: `CREATE TRIGGER "Customer_no_delete" BEFORE DELETE ON "Customer"
BEGIN ${raise("Customer_no_delete", "고객은 삭제하지 않고 탈퇴(익명화) 처리합니다")} END;`,
  },

  // --- 개인정보: 탈퇴 고객에게 다시 들어가지 않게, 휴대폰 중복 가입 금지
  {
    table: "CustomerProfile",
    name: "CustomerProfile_withdrawn_ins",
    why: "탈퇴 고객의 개인정보 다시 저장 금지",
    sql: `CREATE TRIGGER "CustomerProfile_withdrawn_ins" BEFORE INSERT ON "CustomerProfile"
WHEN ${customerStatusOf("customerId")} = 'WITHDRAWN' AND (${PROFILE_PII_COLS.map((c) => `NEW."${c}" IS NOT NULL`).join(" OR ")})
BEGIN ${raise("CustomerProfile_withdrawn", "탈퇴한 고객의 개인정보는 저장할 수 없습니다")} END;`,
  },
  {
    table: "CustomerProfile",
    name: "CustomerProfile_withdrawn_upd",
    why: "위와 같음 (수정 시)",
    sql: `CREATE TRIGGER "CustomerProfile_withdrawn_upd" BEFORE UPDATE ON "CustomerProfile"
WHEN ${customerStatusOf("customerId")} = 'WITHDRAWN' AND (${PROFILE_PII_COLS.map((c) => `NEW."${c}" IS NOT NULL`).join(" OR ")})
BEGIN ${raise("CustomerProfile_withdrawn", "탈퇴한 고객의 개인정보는 저장할 수 없습니다")} END;`,
  },
  {
    table: "CustomerProfile",
    name: "CustomerProfile_phone_unique_ins",
    // ⚠️ 본인 행은 제외해야 합니다. Prisma upsert는 SQLite의 INSERT ... ON CONFLICT DO UPDATE를 쓰는데,
    //    이때 이미 있는 행을 "수정"하는 경우에도 BEFORE INSERT 트리거가 실행됩니다.
    //    (본인 번호를 그대로 다시 저장하면 "다른 회원이 사용 중"으로 막히던 버그 — 테스트로 발견)
    why: "같은 휴대폰 번호로 중복 가입 금지 (검색용 해시로 비교, 본인 제외)",
    sql: `CREATE TRIGGER "CustomerProfile_phone_unique_ins" BEFORE INSERT ON "CustomerProfile"
WHEN NEW."phoneHash" IS NOT NULL AND EXISTS (SELECT 1 FROM "CustomerProfile" p WHERE p."phoneHash" = NEW."phoneHash" AND p."customerId" <> NEW."customerId")
BEGIN ${raise("CustomerProfile_phone_unique", "이미 다른 회원이 사용 중인 휴대폰 번호입니다")} END;`,
  },
  {
    table: "CustomerProfile",
    name: "CustomerProfile_phone_unique_upd",
    why: "위와 같음 (수정 시)",
    sql: `CREATE TRIGGER "CustomerProfile_phone_unique_upd" BEFORE UPDATE OF "phoneHash" ON "CustomerProfile"
WHEN NEW."phoneHash" IS NOT NULL AND EXISTS (SELECT 1 FROM "CustomerProfile" p WHERE p."phoneHash" = NEW."phoneHash" AND p."customerId" <> NEW."customerId")
BEGIN ${raise("CustomerProfile_phone_unique", "이미 다른 회원이 사용 중인 휴대폰 번호입니다")} END;`,
  },
  {
    table: "CustomerBodyProfile",
    name: "CustomerBodyProfile_withdrawn",
    why: "탈퇴 고객의 체형 정보 저장 금지",
    sql: `CREATE TRIGGER "CustomerBodyProfile_withdrawn" BEFORE INSERT ON "CustomerBodyProfile"
WHEN ${customerStatusOf("customerId")} = 'WITHDRAWN'
BEGIN ${raise("CustomerBodyProfile_withdrawn", "탈퇴한 고객의 체형 정보는 저장할 수 없습니다")} END;`,
  },

  // --- 배송지: 기본 배송지 1개, 최대 20개, 탈퇴 고객 금지
  {
    table: "CustomerAddress",
    name: "CustomerAddress_insert_guard",
    why: "탈퇴 고객 금지, 배송지 최대 20개, 기본 배송지는 1개",
    sql: `CREATE TRIGGER "CustomerAddress_insert_guard" BEFORE INSERT ON "CustomerAddress"
BEGIN
SELECT CASE
  WHEN ${customerStatusOf("customerId")} = 'WITHDRAWN'
    THEN RAISE(ABORT, 'CustomerAddress_guard: 탈퇴한 고객의 배송지는 저장할 수 없습니다')
  WHEN (SELECT count(*) FROM "CustomerAddress" a WHERE a."customerId" = NEW."customerId") >= 20
    THEN RAISE(ABORT, 'CustomerAddress_guard: 배송지는 최대 20개까지 저장할 수 있습니다')
  WHEN NEW."isDefault" = 1 AND EXISTS (SELECT 1 FROM "CustomerAddress" a WHERE a."customerId" = NEW."customerId" AND a."isDefault" = 1)
    THEN RAISE(ABORT, 'CustomerAddress_default_one: 기본 배송지는 1개만 지정할 수 있습니다')
END;
END;`,
  },
  {
    table: "CustomerAddress",
    name: "CustomerAddress_default_one_upd",
    why: "기본 배송지는 고객당 1개 (새 기본을 지정하려면 기존 기본을 먼저 해제)",
    sql: `CREATE TRIGGER "CustomerAddress_default_one_upd" BEFORE UPDATE OF "isDefault", "customerId" ON "CustomerAddress"
WHEN NEW."isDefault" = 1 AND EXISTS (SELECT 1 FROM "CustomerAddress" a WHERE a."customerId" = NEW."customerId" AND a."isDefault" = 1 AND a."id" <> NEW."id")
BEGIN ${raise("CustomerAddress_default_one", "기본 배송지는 1개만 지정할 수 있습니다")} END;`,
  },

  // --- 탈퇴 신청
  {
    table: "CustomerWithdrawal",
    name: "CustomerWithdrawal_open_one",
    why: "진행 중인 탈퇴 신청은 고객당 1개",
    sql: `CREATE TRIGGER "CustomerWithdrawal_open_one" BEFORE INSERT ON "CustomerWithdrawal"
WHEN EXISTS (SELECT 1 FROM "CustomerWithdrawal" w WHERE w."customerId" = NEW."customerId" AND w."completedAt" IS NULL AND w."canceledAt" IS NULL)
BEGIN ${raise("CustomerWithdrawal_open_one", "이미 진행 중인 탈퇴 신청이 있습니다")} END;`,
  },
  {
    table: "CustomerWithdrawal",
    name: "CustomerWithdrawal_immutable",
    why: "신청 내용은 바꿀 수 없고, 완료·철회된 신청은 더 이상 바꿀 수 없음",
    sql: `CREATE TRIGGER "CustomerWithdrawal_immutable" BEFORE UPDATE ON "CustomerWithdrawal"
WHEN OLD."completedAt" IS NOT NULL OR OLD."canceledAt" IS NOT NULL
  OR NEW."customerId" IS NOT OLD."customerId" OR NEW."requestedAt" IS NOT OLD."requestedAt"
  OR NEW."scheduledAt" IS NOT OLD."scheduledAt" OR NEW."reasonCode" IS NOT OLD."reasonCode"
BEGIN ${raise("CustomerWithdrawal_immutable", "탈퇴 신청 내용·처리 결과는 바꿀 수 없습니다")} END;`,
  },
  {
    table: "CustomerWithdrawal",
    name: "CustomerWithdrawal_no_delete",
    why: "탈퇴 신청 기록 삭제 금지",
    sql: `CREATE TRIGGER "CustomerWithdrawal_no_delete" BEFORE DELETE ON "CustomerWithdrawal"
BEGIN ${raise("CustomerWithdrawal_no_delete", "탈퇴 신청 기록은 지울 수 없습니다")} END;`,
  },

  // --- 이력: 추가만 가능
  ...appendOnly("CustomerStatusHistory"),
  ...appendOnly("CustomerGradeHistory"),
  {
    table: "CustomerLoginHistory",
    name: "CustomerLoginHistory_no_update",
    why: "로그인 기록은 수정 금지",
    sql: `CREATE TRIGGER "CustomerLoginHistory_no_update" BEFORE UPDATE ON "CustomerLoginHistory"
BEGIN ${raise("CustomerLoginHistory_append_only", "로그인 기록은 수정할 수 없습니다")} END;`,
  },
  {
    table: "CustomerLoginHistory",
    name: "CustomerLoginHistory_retention",
    why: "로그인 기록은 3개월(90일)이 지난 것만 삭제 가능 (통신비밀보호법 접속기록 보관)",
    sql: `CREATE TRIGGER "CustomerLoginHistory_retention" BEFORE DELETE ON "CustomerLoginHistory"
WHEN julianday(${NOW}) - julianday(OLD."loggedInAt") < 90
BEGIN ${raise("CustomerLoginHistory_retention", "3개월이 지나지 않은 로그인 기록은 지울 수 없습니다")} END;`,
  },

  // --- 주문: 정상(ACTIVE) 고객만
  {
    table: "Order",
    name: "Order_customer_active",
    why: "탈퇴·탈퇴 신청·정지·휴면 고객은 새 주문 금지",
    sql: `CREATE TRIGGER "Order_customer_active" BEFORE INSERT ON "Order"
WHEN NEW."customerId" IS NOT NULL AND ${customerStatusOf("customerId")} IS NOT 'ACTIVE'
BEGIN ${raise("Order_customer_active", "정상(ACTIVE) 상태의 고객만 주문할 수 있습니다")} END;`,
  },
];

// ----- 결제·주문 도우미
const ORDER_STATUS_CHANGES = [
  "PENDING>WAITING_DEPOSIT", "PENDING>PAID", "PENDING>CANCELED", "PENDING>CANCEL_FAILED",
  "WAITING_DEPOSIT>PAID", "WAITING_DEPOSIT>CANCELED", "WAITING_DEPOSIT>EXPIRED", "WAITING_DEPOSIT>CANCEL_FAILED",
  "PAID>CANCELED", "PAID>CANCEL_FAILED",
  "CANCEL_FAILED>CANCELED", "CANCEL_FAILED>PAID",
];
const PAYMENT_STATUS_CHANGES = [
  "IN_PROGRESS>UNKNOWN", "IN_PROGRESS>DONE", "IN_PROGRESS>WAITING_FOR_DEPOSIT", "IN_PROGRESS>ABORTED", "IN_PROGRESS>EXPIRED",
  "UNKNOWN>IN_PROGRESS", "UNKNOWN>DONE", "UNKNOWN>WAITING_FOR_DEPOSIT", "UNKNOWN>ABORTED", "UNKNOWN>EXPIRED",
  "WAITING_FOR_DEPOSIT>DONE", "WAITING_FOR_DEPOSIT>CANCELED", "WAITING_FOR_DEPOSIT>EXPIRED",
  "DONE>PARTIAL_CANCELED", "DONE>CANCELED", "PARTIAL_CANCELED>CANCELED",
];
const CANCEL_STATUS_CHANGES = ["REQUESTED>DONE", "REQUESTED>FAILED", "REQUESTED>UNKNOWN", "UNKNOWN>DONE", "UNKNOWN>FAILED"];
/** 돈이 걸려 있는(진행 중이거나 결제된) 결제 상태 */
const LIVE_PAYMENT = `('IN_PROGRESS', 'UNKNOWN', 'WAITING_FOR_DEPOSIT', 'DONE', 'PARTIAL_CANCELED')`;
const inList = (xs: string[]) => xs.map((x) => `'${x}'`).join(", ");
const DONE_CANCEL_SUM = (paymentRef: string) =>
  `(SELECT COALESCE(SUM(c."cancelAmount"), 0) FROM "PaymentCancel" c WHERE c."paymentId" = ${paymentRef} AND c."status" = 'DONE')`;
/** 취소가 완료되면 결제의 취소 금액·잔액·상태를 다시 계산 (앱이 직접 숫자를 바꾸지 않음) */
const applyCancel = `UPDATE "Payment" SET
    "canceledAmount" = ${DONE_CANCEL_SUM(`NEW."paymentId"`)},
    "balanceAmount" = "amount" - ${DONE_CANCEL_SUM(`NEW."paymentId"`)},
    "status" = CASE WHEN ${DONE_CANCEL_SUM(`NEW."paymentId"`)} >= "amount" THEN 'CANCELED' ELSE 'PARTIAL_CANCELED' END,
    "canceledAt" = CASE WHEN ${DONE_CANCEL_SUM(`NEW."paymentId"`)} >= "amount" THEN NEW."canceledAt" ELSE "canceledAt" END,
    "statusSource" = 'CANCEL',
    "statusChangedAt" = NEW."canceledAt",
    "updatedAt" = ${NOW}
  WHERE "id" = NEW."paymentId";`;
const fixedColumns = (table: string, name: string, cols: string[], message: string, why: string): TriggerConstraint => ({
  table,
  name,
  why,
  sql: `CREATE TRIGGER "${name}" BEFORE UPDATE OF ${cols.map(q).join(", ")} ON "${table}"
WHEN ${cols.map((c) => `NEW."${c}" IS NOT OLD."${c}"`).join(" OR ")}
BEGIN ${raise(name, message)} END;`,
});
const noDelete = (table: string, message: string, why: string): TriggerConstraint => ({
  table,
  name: `${table}_no_delete`,
  why,
  sql: `CREATE TRIGGER "${table}_no_delete" BEFORE DELETE ON "${table}"
BEGIN ${raise(`${table}_no_delete`, message)} END;`,
});
const methodGuard = (table: string, methods: string[], label: string): TriggerConstraint => ({
  table,
  name: `${table}_method`,
  why: `${label} 상세는 해당 결제수단의 결제에만`,
  sql: `CREATE TRIGGER "${table}_method" BEFORE INSERT ON "${table}"
WHEN (SELECT p."method" FROM "Payment" p WHERE p."id" = NEW."paymentId") IS NULL
  OR (SELECT p."method" FROM "Payment" p WHERE p."id" = NEW."paymentId") NOT IN (${inList(methods)})
BEGIN ${raise(`${table}_method`, `${label} 상세는 결제수단이 ${methods.join("/")}인 결제에만 추가할 수 있습니다`)} END;`,
});

const PAYMENT_TRIGGERS: TriggerConstraint[] = [
  // --- 주문
  {
    table: "Order",
    name: "Order_insert_pending",
    why: "주문은 결제 대기(PENDING)·미결제 요약(UNPAID)·확정 전으로만 생성. 결제 완료는 결제(Payment)를 거쳐야 함",
    sql: `CREATE TRIGGER "Order_insert_pending" BEFORE INSERT ON "Order"
WHEN NEW."status" IS NOT 'PENDING' OR NEW."fulfillmentStatus" IS NOT 'UNPAID' OR NEW."confirmedAt" IS NOT NULL OR NEW."piiPurgedAt" IS NOT NULL
BEGIN ${raise("Order_insert_pending", "주문은 PENDING 상태로만 만들 수 있습니다")} END;`,
  },
  fixedColumns(
    "Order",
    "Order_total_fixed",
    ["totalPrice", "paymentOrderId", "orderNo", "ordererType", "channel", "itemsListTotal", "itemsDiscountTotal", "itemsTotal", "couponDiscountTotal", "shippingBaseFee", "shippingExtraFee", "shippingFee", "shippingDiscount", "pointUsed", "shippingPolicyId", "freeShippingThreshold", "createdAt"],
    "주문 금액·주문번호·고객·배송비 규칙은 바꿀 수 없습니다",
    "결제 금액 비교 기준·토스 주문번호·금액 구성이 바뀌면 결제·환불 계산과 어긋남",
  ),
  {
    table: "Order",
    name: "Order_status_transition",
    why: "허용된 주문 상태 변경만 + 결제·재고·배송과 맞아야 함 (결제 없이 결제 완료 금지, 돈이 걸린 결제·남은 재고 예약이 있는데 취소 금지, 출고된 상품이 있으면 전체 취소 금지), 바꿀 때 변경 시각도 새로",
    sql: `CREATE TRIGGER "Order_status_transition" BEFORE UPDATE OF "status" ON "Order"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
SELECT CASE
  WHEN (OLD."status" || '>' || NEW."status") NOT IN (${inList(ORDER_STATUS_CHANGES)})
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
  WHEN NEW."status" IN ('CANCELED', 'EXPIRED') AND EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = NEW."id" AND p."status" IN ${LIVE_PAYMENT})
    THEN RAISE(ABORT, 'Order_cancel_guard: 진행 중이거나 결제된 결제가 있어 취소할 수 없습니다. 결제를 먼저 취소하세요')
  WHEN NEW."status" = 'CANCEL_FAILED' AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = NEW."id" AND p."status" IN ('DONE', 'PARTIAL_CANCELED', 'WAITING_FOR_DEPOSIT'))
    THEN RAISE(ABORT, 'Order_status_transition: 취소 실패는 돈이 걸린 결제가 남아 있을 때만 기록합니다')
END;
END;`,
  },
  noDelete("Order", "주문은 삭제할 수 없습니다 (전자상거래법 5년 보관)", "주문·결제 기록은 5년 보관"),
  {
    table: "InventoryReservation",
    name: "InventoryReservation_order_open",
    why: "결제 대기·입금 대기 주문만 재고를 예약할 수 있음 (취소·완료된 주문이 재고를 다시 잡는 것 방지)",
    sql: `CREATE TRIGGER "InventoryReservation_order_open" BEFORE INSERT ON "InventoryReservation"
WHEN (SELECT o."status" FROM "Order" o WHERE o."id" = NEW."orderId") NOT IN ('PENDING', 'WAITING_DEPOSIT')
BEGIN ${raise("InventoryReservation_order_open", "결제 대기·입금 대기 주문만 재고를 예약할 수 있습니다")} END;`,
  },

  // --- 결제
  {
    table: "Payment",
    name: "Payment_insert_guard",
    why: "결제는 승인 시작(IN_PROGRESS) 또는 결제창 실패(ABORTED)로만 생성, 금액·주문번호는 주문과 같아야 함, 시도 번호는 순서대로, 한 주문에 진행 중·완료 결제는 1개만 (동시 승인 방지)",
    sql: `CREATE TRIGGER "Payment_insert_guard" BEFORE INSERT ON "Payment"
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
  WHEN NEW."status" = 'IN_PROGRESS' AND EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = NEW."orderId" AND p."status" IN ${LIVE_PAYMENT})
    THEN RAISE(ABORT, 'Payment_one_active: 이 주문은 이미 결제가 진행 중이거나 완료되었습니다')
END;
END;`,
  },
  fixedColumns("Payment", "Payment_immutable", ["orderId", "attemptNo", "provider", "pgOrderId", "amount", "confirmIdempotencyKey", "createdAt"], "결제의 주문·금액·시도 번호·멱등키는 바꿀 수 없습니다", "결제 기본 정보 변경 금지"),
  {
    table: "Payment",
    name: "Payment_key_fixed",
    why: "결제 키는 한 번 정해지면 변경 금지 (다른 결제로 바꿔치기 방지)",
    sql: `CREATE TRIGGER "Payment_key_fixed" BEFORE UPDATE OF "paymentKey" ON "Payment"
WHEN OLD."paymentKey" IS NOT NULL AND NEW."paymentKey" IS NOT OLD."paymentKey"
BEGIN ${raise("Payment_key_fixed", "결제 키는 바꿀 수 없습니다")} END;`,
  },
  {
    table: "Payment",
    name: "Payment_status_transition",
    why: "허용된 결제 상태 변경만 (실패·만료·전액취소는 되돌릴 수 없음)",
    sql: `CREATE TRIGGER "Payment_status_transition" BEFORE UPDATE OF "status" ON "Payment"
WHEN NEW."status" IS NOT OLD."status" AND (OLD."status" || '>' || NEW."status") NOT IN (${inList(PAYMENT_STATUS_CHANGES)})
BEGIN ${raise("Payment_status_transition", "허용되지 않은 결제 상태 변경입니다")} END;`,
  },
  {
    table: "Payment",
    name: "Payment_amount_guard",
    why: "취소 금액은 완료된 취소(PaymentCancel DONE)의 합계와 항상 같음 → 앱이 숫자를 직접 못 바꿈",
    sql: `CREATE TRIGGER "Payment_amount_guard" BEFORE UPDATE OF "canceledAmount", "balanceAmount" ON "Payment"
WHEN NEW."canceledAmount" IS NOT ${DONE_CANCEL_SUM(`NEW."id"`)}
BEGIN ${raise("Payment_amount_guard", "취소 금액은 결제 취소(PaymentCancel)로만 바꿀 수 있습니다")} END;`,
  },
  {
    table: "Payment",
    name: "Payment_status_history_ins",
    why: "결제가 생기면 상태 이력 첫 줄 자동 기록",
    sql: `CREATE TRIGGER "Payment_status_history_ins" AFTER INSERT ON "Payment"
BEGIN
  INSERT INTO "PaymentStatusHistory" ("paymentId", "fromStatus", "toStatus", "source", "canceledAmount", "failCode", "changedAt")
  VALUES (NEW."id", NULL, NEW."status", NEW."statusSource", NEW."canceledAmount", NEW."failCode", NEW."statusChangedAt");
END;`,
  },
  {
    table: "Payment",
    name: "Payment_status_history_upd",
    why: "상태나 취소 금액이 바뀌면 이력 자동 기록 (부분 취소를 여러 번 해도 매번 남음)",
    sql: `CREATE TRIGGER "Payment_status_history_upd" AFTER UPDATE OF "status", "canceledAmount" ON "Payment"
WHEN NEW."status" IS NOT OLD."status" OR NEW."canceledAmount" IS NOT OLD."canceledAmount"
BEGIN
  INSERT INTO "PaymentStatusHistory" ("paymentId", "fromStatus", "toStatus", "source", "canceledAmount", "failCode", "changedAt")
  VALUES (NEW."id", OLD."status", NEW."status", NEW."statusSource", NEW."canceledAmount", NEW."failCode", NEW."statusChangedAt");
END;`,
  },
  noDelete("Payment", "결제 기록은 삭제할 수 없습니다 (5년 보관)", "결제 기록 보관"),

  // --- 수단별 상세
  methodGuard("PaymentCard", ["CARD", "EASY_PAY"], "카드"),
  methodGuard("PaymentEasyPay", ["EASY_PAY"], "간편결제"),
  methodGuard("PaymentVirtualAccount", ["VIRTUAL_ACCOUNT"], "가상계좌"),
  fixedColumns("PaymentVirtualAccount", "PaymentVirtualAccount_fixed", ["bankCode", "accountNumberEnc", "paymentId"], "발급된 가상계좌 정보는 바꿀 수 없습니다", "발급된 계좌번호를 바꾸면 고객이 엉뚱한 계좌로 입금"),
  noDelete("PaymentCard", "결제 상세는 삭제할 수 없습니다", "결제 기록 보관"),
  noDelete("PaymentEasyPay", "결제 상세는 삭제할 수 없습니다", "결제 기록 보관"),
  noDelete("PaymentVirtualAccount", "결제 상세는 삭제할 수 없습니다", "결제 기록 보관"),

  // --- 환불 계좌: 파기(암호문 지우기)만 가능
  fixedColumns("PaymentRefundAccount", "PaymentRefundAccount_fixed", ["paymentId", "bankCode", "accountNumberMasked", "holderNameMasked", "createdAt"], "환불 계좌는 바꿀 수 없습니다. 새로 등록하세요", "환불 계좌 변경 금지 (어느 계좌로 환불했는지 남겨야 함)"),
  {
    table: "PaymentRefundAccount",
    name: "PaymentRefundAccount_wipe_only",
    why: "암호문은 지우는 것(파기)만 가능, 다른 값으로 바꿀 수 없음",
    sql: `CREATE TRIGGER "PaymentRefundAccount_wipe_only" BEFORE UPDATE OF "accountNumberEnc", "holderNameEnc" ON "PaymentRefundAccount"
WHEN (NEW."accountNumberEnc" IS NOT NULL AND NEW."accountNumberEnc" IS NOT OLD."accountNumberEnc")
  OR (NEW."holderNameEnc" IS NOT NULL AND NEW."holderNameEnc" IS NOT OLD."holderNameEnc")
BEGIN ${raise("PaymentRefundAccount_wipe_only", "환불 계좌 암호문은 파기(NULL)만 할 수 있습니다")} END;`,
  },
  noDelete("PaymentRefundAccount", "환불 계좌 기록은 삭제할 수 없습니다 (가린 값은 남김)", "환불 기록 보관"),

  // --- 취소
  {
    table: "PaymentCancel",
    name: "PaymentCancel_insert_guard",
    why: "완료된 결제만 취소, 남은 금액을 넘는 취소 금지(진행 중인 취소 포함 → 동시에 두 번 취소해도 초과 불가), 입금 전 가상계좌는 전액만, 입금된 가상계좌는 환불 계좌 필수",
    sql: `CREATE TRIGGER "PaymentCancel_insert_guard" BEFORE INSERT ON "PaymentCancel"
BEGIN
SELECT CASE
  WHEN NEW."status" <> 'REQUESTED' AND NOT (NEW."status" = 'DONE' AND NEW."reasonCode" = 'PG_SYNC')
    THEN RAISE(ABORT, 'PaymentCancel_insert_guard: 취소는 REQUESTED로 만들고 결과를 반영합니다 (토스에서 이미 취소된 것을 반영하는 PG_SYNC만 DONE으로 기록)')
  WHEN (SELECT p."status" FROM "Payment" p WHERE p."id" = NEW."paymentId") NOT IN ('DONE', 'PARTIAL_CANCELED', 'WAITING_FOR_DEPOSIT')
    THEN RAISE(ABORT, 'PaymentCancel_payment_state: 완료되었거나 입금 대기 중인 결제만 취소할 수 있습니다')
  WHEN (SELECT p."status" FROM "Payment" p WHERE p."id" = NEW."paymentId") = 'WAITING_FOR_DEPOSIT'
      AND (NEW."cancelAmount" IS NOT (SELECT p."amount" FROM "Payment" p WHERE p."id" = NEW."paymentId") OR NEW."refundAccountId" IS NOT NULL)
    THEN RAISE(ABORT, 'PaymentCancel_waiting_deposit: 입금 전 가상계좌는 전액 취소만 가능합니다 (환불 계좌 불필요)')
  WHEN (SELECT COALESCE(SUM(c."cancelAmount"), 0) FROM "PaymentCancel" c WHERE c."paymentId" = NEW."paymentId" AND c."status" IN ('REQUESTED', 'UNKNOWN', 'DONE')) + NEW."cancelAmount"
      > (SELECT p."amount" FROM "Payment" p WHERE p."id" = NEW."paymentId")
    THEN RAISE(ABORT, 'PaymentCancel_exceeds: 취소 금액이 남은 결제 금액을 넘습니다')
  WHEN NEW."refundAccountId" IS NOT NULL AND (SELECT a."paymentId" FROM "PaymentRefundAccount" a WHERE a."id" = NEW."refundAccountId") IS NOT NEW."paymentId"
    THEN RAISE(ABORT, 'PaymentCancel_insert_guard: 다른 결제의 환불 계좌입니다')
  WHEN NEW."reasonCode" <> 'PG_SYNC' AND NEW."refundAccountId" IS NULL
      AND (SELECT p."method" || '/' || p."status" FROM "Payment" p WHERE p."id" = NEW."paymentId") IN ('VIRTUAL_ACCOUNT/DONE', 'VIRTUAL_ACCOUNT/PARTIAL_CANCELED')
    THEN RAISE(ABORT, 'PaymentCancel_refund_account: 입금된 가상계좌 결제를 취소하려면 환불 계좌가 필요합니다')
END;
END;`,
  },
  {
    table: "PaymentCancel",
    name: "PaymentCancel_transition",
    why: "취소 상태는 정해진 길로만 (완료·실패는 되돌릴 수 없음)",
    sql: `CREATE TRIGGER "PaymentCancel_transition" BEFORE UPDATE OF "status" ON "PaymentCancel"
WHEN NEW."status" IS NOT OLD."status" AND (OLD."status" || '>' || NEW."status") NOT IN (${inList(CANCEL_STATUS_CHANGES)})
BEGIN ${raise("PaymentCancel_transition", "허용되지 않은 취소 상태 변경입니다")} END;`,
  },
  fixedColumns("PaymentCancel", "PaymentCancel_immutable", ["paymentId", "cancelAmount", "taxFreeAmount", "reasonCode", "idempotencyKey", "refundAccountId", "requestedAt"], "취소 요청 내용은 바꿀 수 없습니다. 새로 요청하세요", "취소 요청 내용 변경 금지 (멱등키와 내용이 어긋나면 위험)"),
  {
    table: "PaymentCancel",
    name: "PaymentCancel_apply_upd",
    why: "취소가 완료되면 결제의 취소 금액·잔액·상태(부분/전액 취소)를 자동 계산",
    sql: `CREATE TRIGGER "PaymentCancel_apply_upd" AFTER UPDATE OF "status" ON "PaymentCancel"
WHEN NEW."status" = 'DONE' AND OLD."status" IS NOT 'DONE'
BEGIN
  ${applyCancel}
END;`,
  },
  {
    table: "PaymentCancel",
    name: "PaymentCancel_apply_ins",
    why: "토스 쪽 취소를 반영(PG_SYNC, 처음부터 DONE)할 때도 같은 계산",
    sql: `CREATE TRIGGER "PaymentCancel_apply_ins" AFTER INSERT ON "PaymentCancel"
WHEN NEW."status" = 'DONE'
BEGIN
  ${applyCancel}
END;`,
  },
  noDelete("PaymentCancel", "취소 기록은 삭제할 수 없습니다", "취소·환불 기록 보관"),

  // --- 이력·기록
  ...appendOnly("PaymentStatusHistory"),
  {
    table: "PaymentApiLog",
    name: "PaymentApiLog_no_update",
    why: "API 기록은 수정 금지",
    sql: `CREATE TRIGGER "PaymentApiLog_no_update" BEFORE UPDATE ON "PaymentApiLog"
BEGIN ${raise("PaymentApiLog_append_only", "API 기록은 수정할 수 없습니다")} END;`,
  },
  {
    table: "PaymentApiLog",
    name: "PaymentApiLog_retention",
    why: "API 기록은 1년(365일)이 지난 것만 삭제 가능 (내부 보관 정책)",
    sql: `CREATE TRIGGER "PaymentApiLog_retention" BEFORE DELETE ON "PaymentApiLog"
WHEN julianday(${NOW}) - julianday(OLD."createdAt") < 365
BEGIN ${raise("PaymentApiLog_retention", "1년이 지나지 않은 API 기록은 지울 수 없습니다")} END;`,
  },
  fixedColumns("PaymentWebhookEvent", "PaymentWebhookEvent_immutable", ["eventType", "dedupKey", "payload", "receivedAt"], "받은 웹훅 원문은 바꿀 수 없습니다", "받은 알림 원문 보존"),
  noDelete("PaymentWebhookEvent", "웹훅 기록은 삭제할 수 없습니다", "받은 알림 기록 보관"),
  noDelete("CashReceipt", "현금영수증 기록은 삭제할 수 없습니다", "세무 기록 보관"),
];

// ----- ⑦ 주문 도우미
const ITEM_STATUS_CHANGES = [
  "AWAITING_PAYMENT>PAID", "AWAITING_PAYMENT>CANCELED",
  "PAID>PREPARING", "PAID>CANCELED",
  "PREPARING>SHIPPED", "PREPARING>CANCELED",
  "SHIPPED>DELIVERED", "SHIPPED>CONFIRMED",
  "DELIVERED>CONFIRMED",
  "DELIVERED>RETURN_REQUESTED", // 반품 신청
  "RETURN_REQUESTED>RETURN_COLLECTING", // 회수 송장 등록
  "RETURN_REQUESTED>DELIVERED", // 반품 거절·철회 (회수 전)
  "RETURN_COLLECTING>RETURNED", // 검수 통과 (정상·불량)
  "RETURN_COLLECTING>DELIVERED", // 검수 결과 반품 불가 → 고객에게 반송
];
const SHIPMENT_STATUS_CHANGES = ["READY>SHIPPED", "READY>CANCELED", "SHIPPED>DELIVERED"];
/** 개인정보 보관 기간 (전자상거래법: 계약·대금결제 기록 5년) */
const PII_RETENTION_DAYS = 365 * 5;
const orderStatusOf = (orderRef: string) => `(SELECT o."status" FROM "Order" o WHERE o."id" = ${orderRef})`;
/** 주문의 상품 상태들 → 진행 요약 (취소된 상품은 빼고 판단) */
export const FULFILLMENT_OF = (orderRef: string) => {
  const has = (cond: string) => `EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = ${orderRef} AND ${cond})`;
  // 취소·반품 완료된 상품은 빼고 판단. 반품 진행 중(요청·회수)은 "배송 완료" 단계로 봄
  return `(CASE
    WHEN NOT ${has(`fi."status" NOT IN ('CANCELED', 'RETURNED')`)} THEN (CASE WHEN ${has(`fi."status" = 'RETURNED'`)} THEN 'RETURNED' ELSE 'CANCELED' END)
    WHEN ${has(`fi."status" = 'AWAITING_PAYMENT'`)} THEN 'UNPAID'
    WHEN NOT ${has(`fi."status" NOT IN ('CONFIRMED', 'CANCELED', 'RETURNED')`)} THEN 'CONFIRMED'
    WHEN NOT ${has(`fi."status" NOT IN ('DELIVERED', 'CONFIRMED', 'CANCELED', 'RETURNED', 'RETURN_REQUESTED', 'RETURN_COLLECTING')`)} THEN 'DELIVERED'
    WHEN NOT ${has(`fi."status" IN ('PAID', 'PREPARING')`)} THEN 'SHIPPED'
    WHEN ${has(`fi."status" IN ('SHIPPED', 'DELIVERED', 'CONFIRMED', 'RETURN_REQUESTED', 'RETURN_COLLECTING', 'RETURNED')`)} THEN 'PARTIALLY_SHIPPED'
    WHEN ${has(`fi."status" = 'PREPARING'`)} THEN 'PREPARING'
    ELSE 'PAID' END)`;
};
/** 주문 배송지 우편번호 → 그 주문의 배송비 규칙에서 찾은 추가 배송 지역 칸 (없으면 NULL) */
const zoneOf = (zipRef: string, orderRef: string, col: "extraFee" | "region") =>
  `(SELECT z."${col}" FROM "ShippingSurchargeZone" z WHERE z."policyId" = (SELECT o."shippingPolicyId" FROM "Order" o WHERE o."id" = ${orderRef}) AND ${zipRef} BETWEEN z."zipFrom" AND z."zipTo")`;
const ADDRESS_CHANGED = ["recipientEnc", "phoneEnc", "phoneHash", "zipCode", "address1Enc", "address2Enc", "deliveryMemoEnc", "region"].map((c) => `NEW."${c}" IS NOT OLD."${c}"`).join(" OR ");
const SHIPMENT_ITEM_IDS = `(SELECT si."orderItemId" FROM "ShipmentItem" si WHERE si."shipmentId" = NEW."id")`;
const SHIPMENT_ACTOR = `(CASE WHEN NEW."createdBy" = 'SYSTEM' THEN 'SYSTEM' ELSE 'ADMIN' END)`;
const policyOverlap = (excludeSelf: boolean) => `EXISTS (SELECT 1 FROM "ShippingPolicy" sp WHERE ${excludeSelf ? `sp."id" <> NEW."id" AND ` : ""}NEW."validFrom" < COALESCE(sp."validTo", ${FOREVER}) AND sp."validFrom" < COALESCE(NEW."validTo", ${FOREVER}))`;
const zoneOverlap = (excludeSelf: boolean) => `EXISTS (SELECT 1 FROM "ShippingSurchargeZone" sz WHERE sz."policyId" = NEW."policyId"${excludeSelf ? ` AND sz."id" <> NEW."id"` : ""} AND NEW."zipFrom" <= sz."zipTo" AND sz."zipFrom" <= NEW."zipTo")`;
const policyUsed = (policyRef: string) => `EXISTS (SELECT 1 FROM "Order" o WHERE o."shippingPolicyId" = ${policyRef})`;
const historyInsert = (table: "OrderStatusHistory" | "OrderItemStatusHistory", fk: "orderId" | "orderItemId", from: string) =>
  `INSERT INTO "${table}" ("${fk}", "fromStatus", "toStatus", "changedBy", "memo", "changedAt") VALUES (NEW."id", ${from}, NEW."status", NEW."statusChangedBy", NEW."statusMemo", NEW."statusChangedAt");`;

const ORDER_TRIGGERS: TriggerConstraint[] = [
  // --- 주문: 배송비 규칙, 진행 요약, 상태 연쇄, 이력, 주문자 정보 파기
  {
    table: "Order",
    name: "Order_shipping_rule",
    why: "주문 시각에 적용 중인 배송비 규칙만, 기본 배송비·무료 기준은 규칙과 같아야 함 (무료 기준 이상이면 기본 배송비 0)",
    sql: `CREATE TRIGGER "Order_shipping_rule" BEFORE INSERT ON "Order"
BEGIN
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM "ShippingPolicy" sp WHERE sp."id" = NEW."shippingPolicyId" AND sp."validFrom" <= NEW."createdAt" AND NEW."createdAt" < COALESCE(sp."validTo", ${FOREVER}))
    THEN RAISE(ABORT, 'Order_shipping_rule: 주문 시각에 적용 중인 배송비 규칙이 아닙니다')
  WHEN NEW."freeShippingThreshold" IS NOT (SELECT sp."freeShippingThreshold" FROM "ShippingPolicy" sp WHERE sp."id" = NEW."shippingPolicyId")
    THEN RAISE(ABORT, 'Order_shipping_rule: 무료배송 기준이 배송비 규칙과 다릅니다')
  WHEN NEW."shippingBaseFee" IS NOT (SELECT CASE WHEN sp."freeShippingThreshold" IS NOT NULL AND NEW."itemsTotal" >= sp."freeShippingThreshold" THEN 0 ELSE sp."baseFee" END FROM "ShippingPolicy" sp WHERE sp."id" = NEW."shippingPolicyId")
    THEN RAISE(ABORT, 'Order_shipping_rule: 기본 배송비가 배송비 규칙과 다릅니다')
END;
END;`,
  },
  {
    table: "Order",
    name: "Order_fulfillment_guard",
    why: "진행 요약은 상품 상태들로 계산한 값만 (앱이 임의로 바꾸지 못함 — 상품 상태가 바뀌면 트리거가 맞춤)",
    sql: `CREATE TRIGGER "Order_fulfillment_guard" BEFORE UPDATE OF "fulfillmentStatus" ON "Order"
WHEN NEW."fulfillmentStatus" IS NOT ${FULFILLMENT_OF(`NEW."id"`)}
BEGIN ${raise("Order_fulfillment_guard", "진행 요약(fulfillmentStatus)은 상품 상태로만 바뀝니다")} END;`,
  },
  {
    table: "Order",
    name: "Order_status_cascade",
    why: "주문이 결제 완료되면 상품도 결제 완료, 주문이 취소·만료되면 출고 전 상품은 취소 (주문과 상품 상태가 어긋나지 않게)",
    sql: `CREATE TRIGGER "Order_status_cascade" AFTER UPDATE OF "status" ON "Order"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
  UPDATE "OrderItem" SET "status" = 'PAID', "paidAt" = NEW."paidAt", "statusChangedAt" = NEW."statusChangedAt", "statusChangedBy" = NEW."statusChangedBy", "statusMemo" = NULL
  WHERE NEW."status" = 'PAID' AND "orderId" = NEW."id" AND "status" = 'AWAITING_PAYMENT';
  UPDATE "OrderItem" SET "status" = 'CANCELED', "canceledAt" = NEW."canceledAt", "statusChangedAt" = NEW."statusChangedAt", "statusChangedBy" = NEW."statusChangedBy", "statusMemo" = NEW."statusMemo"
  WHERE NEW."status" IN ('CANCELED', 'EXPIRED') AND "orderId" = NEW."id" AND "status" IN ('AWAITING_PAYMENT', 'PAID', 'PREPARING');
END;`,
  },
  {
    table: "Order",
    name: "Order_status_history_ins",
    why: "주문 생성을 상태 이력 첫 줄로 자동 기록",
    sql: `CREATE TRIGGER "Order_status_history_ins" AFTER INSERT ON "Order"
BEGIN
  ${historyInsert("OrderStatusHistory", "orderId", "NULL")}
END;`,
  },
  {
    table: "Order",
    name: "Order_status_history_upd",
    why: "주문 상태가 바뀌면 이력 자동 기록 (누가·언제·왜)",
    sql: `CREATE TRIGGER "Order_status_history_upd" AFTER UPDATE OF "status" ON "Order"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
  ${historyInsert("OrderStatusHistory", "orderId", `OLD."status"`)}
END;`,
  },
  {
    table: "Order",
    name: "Order_orderer_fixed",
    why: "주문자 정보는 바꿀 수 없고, 5년 보관 뒤 파기(비우기)만 가능. 파기는 되돌릴 수 없음",
    sql: `CREATE TRIGGER "Order_orderer_fixed" BEFORE UPDATE OF ${[...ORDERER_COLS, "piiPurgedAt"].map(q).join(", ")} ON "Order"
WHEN (OLD."piiPurgedAt" IS NOT NULL AND NEW."piiPurgedAt" IS NOT OLD."piiPurgedAt")
  OR ${ORDERER_COLS.map((c) => `(NEW."${c}" IS NOT OLD."${c}" AND NEW."${c}" IS NOT NULL)`).join(" OR ")}
  OR (NEW."piiPurgedAt" IS NOT NULL AND julianday(NEW."piiPurgedAt") - julianday(OLD."createdAt") < ${PII_RETENTION_DAYS})
BEGIN ${raise("Order_orderer_fixed", "주문자 정보는 바꿀 수 없고, 주문 5년 뒤 파기만 할 수 있습니다")} END;`,
  },

  // --- 주문 상품: 생성 규칙, 스냅샷 고정, 상태 길, 이력, 진행 요약
  {
    table: "OrderItem",
    name: "OrderItem_insert_guard",
    why: "결제 대기 주문에만 추가, 결제 대기 상태로, 순번은 1부터 차례로",
    sql: `CREATE TRIGGER "OrderItem_insert_guard" BEFORE INSERT ON "OrderItem"
BEGIN
SELECT CASE
  WHEN ${orderStatusOf(`NEW."orderId"`)} IS NOT 'PENDING'
    THEN RAISE(ABORT, 'OrderItem_insert_guard: 결제 대기 주문에만 상품을 추가할 수 있습니다')
  WHEN NEW."status" <> 'AWAITING_PAYMENT'
    THEN RAISE(ABORT, 'OrderItem_insert_guard: 주문 상품은 결제 대기 상태로만 만들 수 있습니다')
  WHEN NEW."lineNo" IS NOT (SELECT COALESCE(MAX(i."lineNo"), 0) + 1 FROM "OrderItem" i WHERE i."orderId" = NEW."orderId")
    THEN RAISE(ABORT, 'OrderItem_insert_guard: 순번은 1부터 차례로 붙입니다')
END;
END;`,
  },
  fixedColumns(
    "OrderItem",
    "OrderItem_immutable",
    ["orderId", "lineNo", "skuId", "quantity", "listPrice", "discountAmount", "price", "promotionName", "lineListTotal", "lineDiscountTotal", "lineTotal", "couponAllocated", "pointAllocated", "payAmount", "styleCode", "skuCode", "styleName", "colorName", "sizeName", "imageUrl", "createdAt"],
    "주문 상품의 수량·가격·금액 배분·스냅샷은 바꿀 수 없습니다",
    "주문 당시 기록·환불 기준이 바뀌면 안 됨",
  ),
  {
    table: "OrderItem",
    name: "OrderItem_status_transition",
    why: "정해진 길로만 (건너뛰기·되돌리기 금지). 준비중은 결제 완료 주문 + 재고 할당 + 진행 중인 결제 취소 없음, 배송중·배송완료는 출고 상자로만, 취소는 주문 취소로만",
    sql: `CREATE TRIGGER "OrderItem_status_transition" BEFORE UPDATE OF "status" ON "OrderItem"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
SELECT CASE
  WHEN (OLD."status" || '>' || NEW."status") NOT IN (${inList(ITEM_STATUS_CHANGES)})
    THEN RAISE(ABORT, 'OrderItem_status_transition: 허용되지 않은 상품 상태 변경입니다')
  WHEN NEW."statusChangedAt" < OLD."statusChangedAt"
    THEN RAISE(ABORT, 'OrderItem_status_transition: 상태 변경 시각이 이전 변경보다 앞설 수 없습니다')
  WHEN NEW."status" IN ('PAID', 'PREPARING', 'CONFIRMED') AND ${orderStatusOf(`NEW."orderId"`)} IS NOT 'PAID'
    THEN RAISE(ABORT, 'OrderItem_order_paid: 결제 완료된 주문의 상품만 처리할 수 있습니다')
  WHEN NEW."status" = 'PREPARING' AND EXISTS (SELECT 1 FROM "PaymentCancel" c JOIN "Payment" p ON p."id" = c."paymentId" WHERE p."orderId" = NEW."orderId" AND c."status" IN ('REQUESTED', 'UNKNOWN'))
    THEN RAISE(ABORT, 'OrderItem_prepare_guard: 결제 취소가 처리 중인 주문은 상품 준비를 시작할 수 없습니다')
  WHEN NEW."status" = 'PREPARING' AND NOT EXISTS (SELECT 1 FROM "InventoryReservation" r WHERE r."orderItemId" = NEW."id" AND r."status" = 'ALLOCATED')
    THEN RAISE(ABORT, 'OrderItem_prepare_guard: 재고가 할당되지 않은 상품은 준비할 수 없습니다')
  WHEN NEW."status" = 'SHIPPED' AND NOT EXISTS (SELECT 1 FROM "ShipmentItem" si JOIN "Shipment" s ON s."id" = si."shipmentId" WHERE si."orderItemId" = NEW."id" AND s."type" = 'OUTBOUND' AND s."status" IN ('SHIPPED', 'DELIVERED'))
    THEN RAISE(ABORT, 'OrderItem_shipment_only: 배송중은 출고 상자를 출고 처리해서만 바뀝니다')
  WHEN NEW."status" = 'DELIVERED' AND NOT EXISTS (SELECT 1 FROM "ShipmentItem" si JOIN "Shipment" s ON s."id" = si."shipmentId" WHERE si."orderItemId" = NEW."id" AND s."type" = 'OUTBOUND' AND s."status" = 'DELIVERED')
    THEN RAISE(ABORT, 'OrderItem_shipment_only: 배송 완료는 출고 상자를 배송 완료 처리해서만 바뀝니다')
  WHEN NEW."status" = 'CANCELED' AND ${orderStatusOf(`NEW."orderId"`)} NOT IN ('CANCELED', 'EXPIRED')
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
END;`,
  },
  {
    table: "OrderItem",
    name: "OrderItem_status_history_ins",
    why: "주문 상품 생성을 상태 이력 첫 줄로 자동 기록",
    sql: `CREATE TRIGGER "OrderItem_status_history_ins" AFTER INSERT ON "OrderItem"
BEGIN
  ${historyInsert("OrderItemStatusHistory", "orderItemId", "NULL")}
END;`,
  },
  {
    table: "OrderItem",
    name: "OrderItem_status_history_upd",
    why: "상품 상태가 바뀌면 이력 자동 기록",
    sql: `CREATE TRIGGER "OrderItem_status_history_upd" AFTER UPDATE OF "status" ON "OrderItem"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
  ${historyInsert("OrderItemStatusHistory", "orderItemId", `OLD."status"`)}
END;`,
  },
  {
    table: "OrderItem",
    name: "OrderItem_fulfillment",
    why: "상품 상태가 바뀌면 주문의 진행 요약·전체 구매확정 시각을 다시 계산",
    sql: `CREATE TRIGGER "OrderItem_fulfillment" AFTER UPDATE OF "status" ON "OrderItem"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
  UPDATE "Order" SET
    "fulfillmentStatus" = ${FULFILLMENT_OF(`NEW."orderId"`)},
    "confirmedAt" = CASE WHEN ${FULFILLMENT_OF(`NEW."orderId"`)} = 'CONFIRMED' THEN COALESCE("confirmedAt", NEW."confirmedAt") ELSE NULL END,
    "updatedAt" = ${NOW}
  WHERE "id" = NEW."orderId";
END;`,
  },
  noDelete("OrderItem", "주문 상품은 삭제할 수 없습니다", "주문 기록 보관"),
  ...appendOnly("OrderStatusHistory"),
  ...appendOnly("OrderItemStatusHistory"),

  // --- 비회원 주문 → 회원 계정 가져오기 (한 번만)
  {
    table: "Order",
    name: "Order_link_guard",
    why: "주문자 신분은 바꿀 수 없음. 회원 지정은 비회원 주문에서 '비어 있음 → 회원' 한 번만, 결제 대기가 아닐 때, 정상 회원에게, 가져오기 기록(GuestOrderAccess)과 같은 회원으로",
    sql: `CREATE TRIGGER "Order_link_guard" BEFORE UPDATE OF "customerId", "linkedAt", "ordererType" ON "Order"
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
  WHEN ${customerStatusOf("customerId")} IS NOT 'ACTIVE'
    THEN RAISE(ABORT, 'Order_link_guard: 정상(ACTIVE) 회원만 주문을 가져올 수 있습니다')
  WHEN (SELECT g."claimedByCustomerId" FROM "GuestOrderAccess" g WHERE g."orderId" = NEW."id") IS NOT NEW."customerId"
    THEN RAISE(ABORT, 'Order_link_guard: 가져오기 기록(GuestOrderAccess)의 회원과 다릅니다')
END;
END;`,
  },
  {
    table: "GuestOrderAccess",
    name: "GuestOrderAccess_insert_guard",
    why: "비회원 결제 대기 주문에만, 처음에는 실패·잠금·가져오기 기록 없이",
    sql: `CREATE TRIGGER "GuestOrderAccess_insert_guard" BEFORE INSERT ON "GuestOrderAccess"
WHEN (SELECT o."ordererType" || '/' || o."status" FROM "Order" o WHERE o."id" = NEW."orderId") IS NOT 'GUEST/PENDING'
  OR NEW."failedCount" <> 0 OR NEW."lockedUntil" IS NOT NULL OR NEW."claimedAt" IS NOT NULL OR NEW."passwordHash" IS NULL
BEGIN ${raise("GuestOrderAccess_insert_guard", "비회원 결제 대기 주문에만 조회 비밀번호를 만들 수 있습니다")} END;`,
  },
  {
    table: "GuestOrderAccess",
    name: "GuestOrderAccess_update_guard",
    why: "동의 기록·주문은 고정, 비밀번호는 파기(비우기)만, 가져오기는 한 번만(결제 대기 아닌, 아직 회원이 없는 주문)",
    sql: `CREATE TRIGGER "GuestOrderAccess_update_guard" BEFORE UPDATE ON "GuestOrderAccess"
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
END;`,
  },
  noDelete("GuestOrderAccess", "비회원 주문 조회 기록은 삭제할 수 없습니다 (파기는 비밀번호 비우기)", "동의·가져오기 기록 보관"),
  {
    table: "GuestOrderSession",
    name: "GuestOrderSession_insert_guard",
    why: "아직 회원 계정으로 옮기지 않은 비회원 주문에만 출입증 발급",
    sql: `CREATE TRIGGER "GuestOrderSession_insert_guard" BEFORE INSERT ON "GuestOrderSession"
WHEN (SELECT o."ordererType" = 'GUEST' AND o."customerId" IS NULL FROM "Order" o WHERE o."id" = NEW."orderId") IS NOT 1 OR NEW."revokedAt" IS NOT NULL
BEGIN ${raise("GuestOrderSession_insert_guard", "회원 계정으로 옮긴 주문이나 회원 주문에는 비회원 출입증을 만들 수 없습니다")} END;`,
  },
  {
    table: "GuestOrderSession",
    name: "GuestOrderSession_revoke_only",
    why: "출입증은 무효로 만드는 것(revokedAt)만 가능 — 기간 연장·다른 주문으로 바꾸기 금지",
    sql: `CREATE TRIGGER "GuestOrderSession_revoke_only" BEFORE UPDATE ON "GuestOrderSession"
WHEN NEW."orderId" IS NOT OLD."orderId" OR NEW."tokenHash" IS NOT OLD."tokenHash" OR NEW."purpose" IS NOT OLD."purpose" OR NEW."expiresAt" IS NOT OLD."expiresAt"
  OR NEW."createdAt" IS NOT OLD."createdAt" OR (OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS NOT OLD."revokedAt") OR NEW."revokedAt" IS NULL
BEGIN ${raise("GuestOrderSession_revoke_only", "출입증은 무효 처리만 할 수 있습니다")} END;`,
  },
  {
    table: "GuestOrderSession",
    name: "GuestOrderSession_delete_guard",
    why: "만료되거나 무효가 된 출입증만 삭제(정리) 가능",
    sql: `CREATE TRIGGER "GuestOrderSession_delete_guard" BEFORE DELETE ON "GuestOrderSession"
WHEN OLD."revokedAt" IS NULL AND OLD."expiresAt" > ${NOW}
BEGIN ${raise("GuestOrderSession_delete_guard", "아직 유효한 출입증은 지울 수 없습니다")} END;`,
  },
  {
    table: "GuestLookupAttempt",
    name: "GuestLookupAttempt_no_update",
    why: "시도 기록은 수정 금지",
    sql: `CREATE TRIGGER "GuestLookupAttempt_no_update" BEFORE UPDATE ON "GuestLookupAttempt"
BEGIN ${raise("GuestLookupAttempt_append_only", "시도 기록은 수정할 수 없습니다")} END;`,
  },
  {
    table: "GuestLookupAttempt",
    name: "GuestLookupAttempt_retention",
    why: "시도 기록은 90일이 지난 것만 삭제 가능",
    sql: `CREATE TRIGGER "GuestLookupAttempt_retention" BEFORE DELETE ON "GuestLookupAttempt"
WHEN julianday(${NOW}) - julianday(OLD."attemptedAt") < 90
BEGIN ${raise("GuestLookupAttempt_retention", "90일이 지나지 않은 시도 기록은 지울 수 없습니다")} END;`,
  },

  // --- 결제와의 연결: 결제 시작 전 마지막 검사, 출고 후 취소 막기
  {
    table: "Payment",
    name: "Payment_order_ready",
    why: "결제를 시작하려면 배송지가 있어야 하고, 상품별 금액 합계가 주문 금액 구성과 맞아야 함 (돈이 오가기 전 마지막 검사)",
    sql: `CREATE TRIGGER "Payment_order_ready" BEFORE INSERT ON "Payment"
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
END;`,
  },
  {
    table: "PaymentCancel",
    name: "PaymentCancel_fulfillment_guard",
    why: "고객은 상품 준비가 시작되면 직접 취소 불가, 출고된 상품이 있으면 전액 취소 불가(반품으로). 토스에서 이미 일어난 취소를 반영(PG_SYNC)하는 것은 사실 기록이라 막지 않음",
    sql: `CREATE TRIGGER "PaymentCancel_fulfillment_guard" BEFORE INSERT ON "PaymentCancel"
WHEN NEW."reasonCode" <> 'PG_SYNC'
BEGIN
SELECT CASE
  WHEN NEW."requestedBy" = 'CUSTOMER' AND EXISTS (SELECT 1 FROM "OrderItem" i WHERE i."orderId" = (SELECT p."orderId" FROM "Payment" p WHERE p."id" = NEW."paymentId") AND i."status" IN ('PREPARING', 'SHIPPED', 'DELIVERED', 'CONFIRMED'))
    THEN RAISE(ABORT, 'PaymentCancel_customer_preparing: 상품 준비가 시작되어 직접 취소할 수 없습니다')
  WHEN EXISTS (SELECT 1 FROM "OrderItem" i WHERE i."orderId" = (SELECT p."orderId" FROM "Payment" p WHERE p."id" = NEW."paymentId") AND i."status" IN ('SHIPPED', 'DELIVERED', 'CONFIRMED', 'RETURN_REQUESTED', 'RETURN_COLLECTING'))
      AND NEW."cancelAmount" >= (SELECT p."balanceAmount" FROM "Payment" p WHERE p."id" = NEW."paymentId")
    THEN RAISE(ABORT, 'PaymentCancel_shipped: 출고된 상품이 있어 전액 취소할 수 없습니다 (반품으로 처리)')
END;
END;`,
  },

  // --- 주문 배송지: 결제 전 1개, 준비 전까지만 변경(배송비 같은 지역으로), 변경 이력, 5년 뒤 파기
  {
    table: "OrderShippingAddress",
    name: "OrderShippingAddress_insert_guard",
    why: "결제 대기 주문에만, 처음 버전으로, 배송 지역·추가 배송비가 우편번호와 맞아야 함",
    sql: `CREATE TRIGGER "OrderShippingAddress_insert_guard" BEFORE INSERT ON "OrderShippingAddress"
BEGIN
SELECT CASE
  WHEN ${orderStatusOf(`NEW."orderId"`)} IS NOT 'PENDING'
    THEN RAISE(ABORT, 'OrderShippingAddress_insert_guard: 결제 대기 주문에만 배송지를 저장할 수 있습니다')
  WHEN NEW."version" <> 1 OR NEW."changedBy" IS NOT NULL OR NEW."piiPurgedAt" IS NOT NULL
    THEN RAISE(ABORT, 'OrderShippingAddress_insert_guard: 처음 저장은 1버전으로 합니다')
  WHEN NEW."region" IS NOT COALESCE(${zoneOf(`NEW."zipCode"`, `NEW."orderId"`, "region")}, 'NORMAL')
    THEN RAISE(ABORT, 'OrderShippingAddress_region: 배송 지역이 우편번호와 맞지 않습니다')
  WHEN (SELECT o."shippingExtraFee" FROM "Order" o WHERE o."id" = NEW."orderId") IS NOT COALESCE(${zoneOf(`NEW."zipCode"`, `NEW."orderId"`, "extraFee")}, 0)
    THEN RAISE(ABORT, 'OrderShippingAddress_fee: 주문의 추가 배송비가 배송지 지역과 맞지 않습니다')
END;
END;`,
  },
  {
    table: "OrderShippingAddress",
    name: "OrderShippingAddress_update_guard",
    why: "주소를 바꾸면 버전 +1, 모든 상품이 준비 전이고 주문이 살아 있을 때만, 추가 배송비가 달라지는 지역으로는 불가. 파기는 5년 뒤에만, 되돌릴 수 없음",
    sql: `CREATE TRIGGER "OrderShippingAddress_update_guard" BEFORE UPDATE ON "OrderShippingAddress"
BEGIN
SELECT CASE
  WHEN NEW."orderId" IS NOT OLD."orderId" OR NEW."createdAt" IS NOT OLD."createdAt"
    THEN RAISE(ABORT, 'OrderShippingAddress_fixed: 주문 배송지의 주문은 바꿀 수 없습니다')
  WHEN OLD."piiPurgedAt" IS NOT NULL AND (NEW."piiPurgedAt" IS NOT OLD."piiPurgedAt" OR NEW."version" IS NOT OLD."version" OR ${ADDRESS_CHANGED})
    THEN RAISE(ABORT, 'OrderShippingAddress_purged: 파기한 배송지는 바꿀 수 없습니다')
  WHEN OLD."piiPurgedAt" IS NULL AND NEW."piiPurgedAt" IS NOT NULL
      AND (NEW."zipCode" IS NOT OLD."zipCode" OR NEW."region" IS NOT OLD."region" OR NEW."version" IS NOT OLD."version" OR julianday(NEW."piiPurgedAt") - julianday(OLD."createdAt") < ${PII_RETENTION_DAYS})
    THEN RAISE(ABORT, 'OrderShippingAddress_purge: 배송지 개인정보는 주문 5년 뒤에 비우기만 할 수 있습니다')
  WHEN NEW."piiPurgedAt" IS NULL AND NEW."version" IS OLD."version" AND (${ADDRESS_CHANGED} OR (NEW."sourceAddressId" IS NOT OLD."sourceAddressId" AND NEW."sourceAddressId" IS NOT NULL))
    THEN RAISE(ABORT, 'OrderShippingAddress_version: 배송지를 바꾸면 version을 1 올려야 합니다 (이력 기록용)')
  WHEN NEW."piiPurgedAt" IS NULL AND NEW."version" IS NOT OLD."version" AND NEW."version" IS NOT OLD."version" + 1
    THEN RAISE(ABORT, 'OrderShippingAddress_version: version은 1씩 올립니다')
  WHEN NEW."piiPurgedAt" IS NULL AND NEW."version" IS NOT OLD."version" AND ${orderStatusOf(`NEW."orderId"`)} NOT IN ('PENDING', 'WAITING_DEPOSIT', 'PAID')
    THEN RAISE(ABORT, 'OrderShippingAddress_locked: 취소·만료된 주문의 배송지는 바꿀 수 없습니다')
  WHEN NEW."piiPurgedAt" IS NULL AND NEW."version" IS NOT OLD."version" AND EXISTS (SELECT 1 FROM "OrderItem" i WHERE i."orderId" = NEW."orderId" AND i."status" IN ('PREPARING', 'SHIPPED', 'DELIVERED', 'CONFIRMED'))
    THEN RAISE(ABORT, 'OrderShippingAddress_locked: 상품 준비가 시작되어 배송지를 바꿀 수 없습니다')
  WHEN NEW."piiPurgedAt" IS NULL AND NEW."version" IS NOT OLD."version" AND COALESCE(${zoneOf(`NEW."zipCode"`, `NEW."orderId"`, "extraFee")}, 0) IS NOT (SELECT o."shippingExtraFee" FROM "Order" o WHERE o."id" = NEW."orderId")
    THEN RAISE(ABORT, 'OrderShippingAddress_fee_changed: 배송비가 달라지는 지역(제주·도서산간)으로는 바꿀 수 없습니다')
  WHEN NEW."piiPurgedAt" IS NULL AND NEW."region" IS NOT COALESCE(${zoneOf(`NEW."zipCode"`, `NEW."orderId"`, "region")}, 'NORMAL')
    THEN RAISE(ABORT, 'OrderShippingAddress_region: 배송 지역이 우편번호와 맞지 않습니다')
END;
END;`,
  },
  {
    table: "OrderShippingAddress",
    name: "OrderShippingAddress_history",
    why: "배송지를 바꾸면 바뀌기 전 주소를 이력에 자동 저장",
    sql: `CREATE TRIGGER "OrderShippingAddress_history" AFTER UPDATE OF "version" ON "OrderShippingAddress"
WHEN NEW."version" IS NOT OLD."version"
BEGIN
  INSERT INTO "OrderShippingAddressHistory" ("orderShippingAddressId", "version", "recipientEnc", "phoneEnc", "zipCode", "address1Enc", "address2Enc", "deliveryMemoEnc", "region", "changedBy", "changeReason", "changedAt")
  VALUES (OLD."id", OLD."version", OLD."recipientEnc", OLD."phoneEnc", OLD."zipCode", OLD."address1Enc", OLD."address2Enc", OLD."deliveryMemoEnc", OLD."region", NEW."changedBy", NEW."changeReason", NEW."updatedAt");
END;`,
  },
  noDelete("OrderShippingAddress", "주문 배송지는 삭제할 수 없습니다 (파기는 암호문 비우기)", "주문 기록 보관"),
  {
    table: "OrderShippingAddressHistory",
    name: "OrderShippingAddressHistory_wipe_only",
    why: "배송지 이력은 수정 금지. 5년 뒤 개인정보 파기(암호문 비우기)만 가능",
    sql: `CREATE TRIGGER "OrderShippingAddressHistory_wipe_only" BEFORE UPDATE ON "OrderShippingAddressHistory"
WHEN NEW."orderShippingAddressId" IS NOT OLD."orderShippingAddressId" OR NEW."version" IS NOT OLD."version" OR NEW."zipCode" IS NOT OLD."zipCode"
  OR NEW."region" IS NOT OLD."region" OR NEW."changedBy" IS NOT OLD."changedBy" OR NEW."changeReason" IS NOT OLD."changeReason" OR NEW."changedAt" IS NOT OLD."changedAt"
  OR ${ADDRESS_ENC_COLS.map((c) => `(NEW."${c}" IS NOT OLD."${c}" AND NEW."${c}" IS NOT NULL)`).join(" OR ")}
BEGIN ${raise("OrderShippingAddressHistory_wipe_only", "배송지 이력은 바꿀 수 없습니다 (개인정보 비우기만 가능)")} END;`,
  },
  noDelete("OrderShippingAddressHistory", "배송지 이력은 삭제할 수 없습니다", "변경 기록 보관"),

  // --- 배송비 규칙: 기간 겹침 금지, 주문에 쓰인 규칙은 금액 고정
  {
    table: "ShippingPolicy",
    name: "ShippingPolicy_no_overlap_ins",
    why: "배송비 규칙 기간이 겹치면 어느 규칙을 쓸지 모호함",
    sql: `CREATE TRIGGER "ShippingPolicy_no_overlap_ins" BEFORE INSERT ON "ShippingPolicy"
WHEN ${policyOverlap(false)}
BEGIN ${raise("ShippingPolicy_no_overlap", "적용 기간이 겹치는 배송비 규칙이 있습니다")} END;`,
  },
  {
    table: "ShippingPolicy",
    name: "ShippingPolicy_no_overlap_upd",
    why: "배송비 규칙 기간이 겹치면 어느 규칙을 쓸지 모호함",
    sql: `CREATE TRIGGER "ShippingPolicy_no_overlap_upd" BEFORE UPDATE OF "validFrom", "validTo" ON "ShippingPolicy"
WHEN ${policyOverlap(true)}
BEGIN ${raise("ShippingPolicy_no_overlap", "적용 기간이 겹치는 배송비 규칙이 있습니다")} END;`,
  },
  {
    table: "ShippingPolicy",
    name: "ShippingPolicy_used_fixed",
    why: "주문에 쓰인 규칙의 금액·시작일은 바꿀 수 없고, 종료일을 당겨 이미 받은 주문을 기간 밖으로 밀어낼 수 없음 (새 규칙은 새 행으로)",
    sql: `CREATE TRIGGER "ShippingPolicy_used_fixed" BEFORE UPDATE ON "ShippingPolicy"
WHEN ${policyUsed(`OLD."id"`)} AND (NEW."code" IS NOT OLD."code" OR NEW."baseFee" IS NOT OLD."baseFee" OR NEW."freeShippingThreshold" IS NOT OLD."freeShippingThreshold" OR NEW."validFrom" IS NOT OLD."validFrom"
  OR (NEW."validTo" IS NOT NULL AND EXISTS (SELECT 1 FROM "Order" o WHERE o."shippingPolicyId" = OLD."id" AND o."createdAt" >= NEW."validTo")))
BEGIN ${raise("ShippingPolicy_used_fixed", "주문에 쓰인 배송비 규칙은 바꿀 수 없습니다. 종료일을 정하고 새 규칙을 추가하세요")} END;`,
  },
  {
    table: "ShippingSurchargeZone",
    name: "ShippingSurchargeZone_no_overlap_ins",
    why: "같은 규칙 안에서 우편번호 범위가 겹치면 추가 배송비가 모호함",
    sql: `CREATE TRIGGER "ShippingSurchargeZone_no_overlap_ins" BEFORE INSERT ON "ShippingSurchargeZone"
WHEN ${zoneOverlap(false)} OR ${policyUsed(`NEW."policyId"`)}
BEGIN ${raise("ShippingSurchargeZone_guard", "우편번호 범위가 겹치거나, 이미 주문에 쓰인 규칙입니다")} END;`,
  },
  {
    table: "ShippingSurchargeZone",
    name: "ShippingSurchargeZone_used_fixed",
    why: "주문에 쓰인 규칙의 추가 배송 지역은 수정 금지, 범위 겹침 금지",
    sql: `CREATE TRIGGER "ShippingSurchargeZone_used_fixed" BEFORE UPDATE ON "ShippingSurchargeZone"
WHEN ${policyUsed(`OLD."policyId"`)} OR ${policyUsed(`NEW."policyId"`)} OR ${zoneOverlap(true)}
BEGIN ${raise("ShippingSurchargeZone_guard", "우편번호 범위가 겹치거나, 이미 주문에 쓰인 규칙입니다")} END;`,
  },
  {
    table: "ShippingSurchargeZone",
    name: "ShippingSurchargeZone_no_delete",
    why: "주문에 쓰인 규칙의 추가 배송 지역은 삭제 금지",
    sql: `CREATE TRIGGER "ShippingSurchargeZone_no_delete" BEFORE DELETE ON "ShippingSurchargeZone"
WHEN ${policyUsed(`OLD."policyId"`)}
BEGIN ${raise("ShippingSurchargeZone_guard", "이미 주문에 쓰인 규칙의 추가 배송 지역은 지울 수 없습니다")} END;`,
  },

  // --- 출고: 결제 완료·준비중 상품만, 송장 형식, 상태 길, 상품·재고로 연쇄
  {
    table: "Shipment",
    name: "Shipment_insert_guard",
    why: "주문 출고만(반품·교환은 ⑩), 송장 등록 상태로, 결제 완료 주문에, 사용 중인 택배사의 송장 자릿수로",
    sql: `CREATE TRIGGER "Shipment_insert_guard" BEFORE INSERT ON "Shipment"
BEGIN
SELECT CASE
  WHEN NEW."type" <> 'OUTBOUND'
    THEN RAISE(ABORT, 'Shipment_insert_guard: 지금은 주문 출고(OUTBOUND)만 만들 수 있습니다 (반품·교환은 ⑩ 클레임)')
  WHEN NEW."status" <> 'READY'
    THEN RAISE(ABORT, 'Shipment_insert_guard: 출고는 송장 등록(READY) 상태로 만듭니다')
  WHEN ${orderStatusOf(`NEW."orderId"`)} IS NOT 'PAID'
    THEN RAISE(ABORT, 'Shipment_insert_guard: 결제 완료된 주문만 출고할 수 있습니다')
  WHEN NOT EXISTS (SELECT 1 FROM "Courier" c WHERE c."id" = NEW."courierId" AND c."isActive" = 1 AND length(NEW."trackingNo") BETWEEN c."trackingNoMinLength" AND c."trackingNoMaxLength")
    THEN RAISE(ABORT, 'Shipment_tracking_format: 사용 중인 택배사가 아니거나 송장번호 자릿수가 맞지 않습니다')
END;
END;`,
  },
  {
    table: "Shipment",
    name: "Shipment_fixed",
    why: "출고 상자의 주문·종류·창고는 바꿀 수 없고, 출고 뒤에는 택배사·송장도 고정",
    sql: `CREATE TRIGGER "Shipment_fixed" BEFORE UPDATE ON "Shipment"
WHEN NEW."orderId" IS NOT OLD."orderId" OR NEW."type" IS NOT OLD."type" OR NEW."locationId" IS NOT OLD."locationId" OR NEW."createdAt" IS NOT OLD."createdAt" OR NEW."createdBy" IS NOT OLD."createdBy"
  OR (OLD."status" <> 'READY' AND (NEW."courierId" IS NOT OLD."courierId" OR NEW."trackingNo" IS NOT OLD."trackingNo"))
BEGIN ${raise("Shipment_fixed", "출고 상자의 주문·창고는 바꿀 수 없고, 출고 후에는 송장도 바꿀 수 없습니다")} END;`,
  },
  {
    table: "Shipment",
    name: "Shipment_transition",
    why: "송장 등록 → 출고 → 배송 완료, 취소는 출고 전에만. 출고하려면 상자에 상품이 있고, 모두 준비중이며 재고가 할당돼 있어야 함",
    sql: `CREATE TRIGGER "Shipment_transition" BEFORE UPDATE OF "status" ON "Shipment"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
SELECT CASE
  WHEN (OLD."status" || '>' || NEW."status") NOT IN (${inList(SHIPMENT_STATUS_CHANGES)})
    THEN RAISE(ABORT, 'Shipment_transition: 허용되지 않은 출고 상태 변경입니다')
  WHEN NEW."statusChangedAt" < OLD."statusChangedAt"
    THEN RAISE(ABORT, 'Shipment_transition: 상태 변경 시각이 이전 변경보다 앞설 수 없습니다')
  WHEN NEW."status" = 'SHIPPED' AND NOT EXISTS (SELECT 1 FROM "ShipmentItem" si WHERE si."shipmentId" = NEW."id")
    THEN RAISE(ABORT, 'Shipment_transition: 빈 상자는 출고할 수 없습니다')
  WHEN NEW."status" = 'SHIPPED' AND ${orderStatusOf(`NEW."orderId"`)} IS NOT 'PAID'
    THEN RAISE(ABORT, 'Shipment_transition: 결제 완료 상태가 아닌 주문(취소 등)은 출고할 수 없습니다')
  WHEN NEW."status" = 'SHIPPED' AND EXISTS (SELECT 1 FROM "ShipmentItem" si JOIN "OrderItem" i ON i."id" = si."orderItemId" WHERE si."shipmentId" = NEW."id"
      AND (i."status" <> 'PREPARING' OR NOT EXISTS (SELECT 1 FROM "InventoryReservation" r WHERE r."orderItemId" = i."id" AND r."status" = 'ALLOCATED')))
    THEN RAISE(ABORT, 'Shipment_transition: 상자 안 상품이 모두 상품 준비중이고 재고가 할당돼 있어야 출고할 수 있습니다')
END;
END;`,
  },
  {
    table: "Shipment",
    name: "Shipment_cascade",
    why: "상자를 출고하면 안의 상품 = 배송중 + 재고 확정(판매 원장 → 실재고 감소), 배송 완료하면 상품 = 배송 완료 + 자동 구매확정 예정일",
    sql: `CREATE TRIGGER "Shipment_cascade" AFTER UPDATE OF "status" ON "Shipment"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
  UPDATE "OrderItem" SET "status" = 'SHIPPED', "shippedAt" = NEW."shippedAt", "statusChangedAt" = NEW."statusChangedAt", "statusChangedBy" = ${SHIPMENT_ACTOR}, "statusMemo" = NULL
  WHERE NEW."status" = 'SHIPPED' AND "id" IN ${SHIPMENT_ITEM_IDS} AND "status" = 'PREPARING';
  UPDATE "InventoryReservation" SET "status" = 'CONFIRMED', "confirmedAt" = NEW."shippedAt", "shipmentId" = NEW."id"
  WHERE NEW."status" = 'SHIPPED' AND "orderItemId" IN ${SHIPMENT_ITEM_IDS} AND "status" = 'ALLOCATED';
  UPDATE "OrderItem" SET "status" = 'DELIVERED', "deliveredAt" = NEW."deliveredAt", "autoConfirmAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', NEW."deliveredAt", '+${AUTO_CONFIRM_DAYS} days'),
    "statusChangedAt" = NEW."statusChangedAt", "statusChangedBy" = ${SHIPMENT_ACTOR}, "statusMemo" = NULL
  WHERE NEW."status" = 'DELIVERED' AND "id" IN ${SHIPMENT_ITEM_IDS} AND "status" = 'SHIPPED';
END;`,
  },
  noDelete("Shipment", "출고 기록은 삭제할 수 없습니다 (송장 취소는 CANCELED)", "출고 기록 보관"),
  {
    table: "ShipmentItem",
    name: "ShipmentItem_insert_guard",
    why: "송장 등록 상태의 상자에만, 같은 주문의 준비중 상품을 수량 그대로, 한 상품 줄은 살아 있는 출고 상자 하나에만",
    sql: `CREATE TRIGGER "ShipmentItem_insert_guard" BEFORE INSERT ON "ShipmentItem"
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
END;`,
  },
  {
    table: "ShipmentItem",
    name: "ShipmentItem_no_update",
    why: "상자에 담은 내용은 수정 금지 (잘못 담았으면 송장 취소 후 새 상자)",
    sql: `CREATE TRIGGER "ShipmentItem_no_update" BEFORE UPDATE ON "ShipmentItem"
BEGIN ${raise("ShipmentItem_no_update", "상자에 담은 상품은 바꿀 수 없습니다. 송장을 취소하고 새로 등록하세요")} END;`,
  },
  noDelete("ShipmentItem", "출고 상자 내용은 삭제할 수 없습니다", "출고 기록 보관"),
];


// ----- 재고 보강 트리거
const PO_STATUS_CHANGES = [
  "DRAFT>ORDERED", "DRAFT>CANCELED",
  "ORDERED>CONFIRMED", "ORDERED>CANCELED", "ORDERED>PARTIALLY_RECEIVED", "ORDERED>RECEIVED",
  "CONFIRMED>PARTIALLY_RECEIVED", "CONFIRMED>RECEIVED", "CONFIRMED>CANCELED",
  "PARTIALLY_RECEIVED>RECEIVED", // 잔량 마감
];
const RESTOCK_STATUS_CHANGES = [
  "WAITING>SCHEDULED", "WAITING>ARRIVED", "WAITING>CANCELED", "WAITING>EXPIRED",
  "SCHEDULED>WAITING", "SCHEDULED>ARRIVED", "SCHEDULED>CANCELED", "SCHEDULED>EXPIRED",
  "ARRIVED>PURCHASED",
];
const RETURN_STATUS_CHANGES = [
  "REQUESTED>APPROVED", "REQUESTED>REJECTED", "REQUESTED>CANCELED",
  "APPROVED>COLLECTING", "APPROVED>REJECTED", "APPROVED>CANCELED",
  "COLLECTING>RECEIVED", "RECEIVED>INSPECTED",
  "INSPECTED>COMPLETED", "INSPECTED>REJECTED", // 전부 반품 불가면 거절로 끝
];
/** 반품 기간: 단순 변심·사이즈 7일, 불량·오배송·파손 30일 (배송 완료일 기준) */
const RETURN_WINDOW_DAYS = { CUSTOMER: 7, SELLER: 30 };
const PO_OPEN = "('ORDERED', 'CONFIRMED', 'PARTIALLY_RECEIVED')";

const INV2_TRIGGERS: TriggerConstraint[] = [
  // --- 발주
  {
    table: "PurchaseOrder",
    name: "PurchaseOrder_insert_draft",
    why: "발주는 작성 중(DRAFT)으로 만들고 줄을 채운 뒤 발주",
    sql: `CREATE TRIGGER "PurchaseOrder_insert_draft" BEFORE INSERT ON "PurchaseOrder"
WHEN NEW."status" <> 'DRAFT'
BEGIN ${raise("PurchaseOrder_insert_draft", "발주는 작성 중(DRAFT)으로만 만들 수 있습니다")} END;`,
  },
  {
    table: "PurchaseOrder",
    name: "PurchaseOrder_transition",
    why: "정해진 길로만, 발주하려면 줄이 있어야 하고, 날짜 확정은 모든 줄에 예정일, 입고가 있으면 취소 불가",
    sql: `CREATE TRIGGER "PurchaseOrder_transition" BEFORE UPDATE OF "status" ON "PurchaseOrder"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
SELECT CASE
  WHEN (OLD."status" || '>' || NEW."status") NOT IN (${inList(PO_STATUS_CHANGES)})
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
END;`,
  },
  fixedColumns("PurchaseOrder", "PurchaseOrder_fixed", ["poNo", "supplierId", "createdBy", "createdAt"], "발주번호·거래처·처리자는 바꿀 수 없습니다", "발주 기본 정보 고정"),
  noDelete("PurchaseOrder", "발주는 삭제할 수 없습니다 (취소로 처리)", "발주 기록 보관"),
  {
    table: "PurchaseOrderLine",
    name: "PurchaseOrderLine_insert_guard",
    why: "작성 중인 발주에만 줄 추가, 순번은 차례로, 입고 수량 0으로 시작",
    sql: `CREATE TRIGGER "PurchaseOrderLine_insert_guard" BEFORE INSERT ON "PurchaseOrderLine"
BEGIN
SELECT CASE
  WHEN (SELECT p."status" FROM "PurchaseOrder" p WHERE p."id" = NEW."purchaseOrderId") IS NOT 'DRAFT'
    THEN RAISE(ABORT, 'PurchaseOrderLine_insert_guard: 작성 중인 발주에만 줄을 추가할 수 있습니다')
  WHEN NEW."qtyReceived" <> 0
    THEN RAISE(ABORT, 'PurchaseOrderLine_insert_guard: 입고 수량은 0으로 시작합니다')
  WHEN NEW."lineNo" IS NOT (SELECT COALESCE(MAX(l."lineNo"), 0) + 1 FROM "PurchaseOrderLine" l WHERE l."purchaseOrderId" = NEW."purchaseOrderId")
    THEN RAISE(ABORT, 'PurchaseOrderLine_insert_guard: 순번은 1부터 차례로 붙입니다')
END;
END;`,
  },
  {
    table: "PurchaseOrderLine",
    name: "PurchaseOrderLine_update_guard",
    why: "발주·SKU·순번 고정, 수량은 작성 중에만, 입고 수량은 입고 전표 합계와 같아야 함(트리거만), 예정일은 진행 중인 발주에서만 바꾸고 확정 뒤에는 비울 수 없음",
    sql: `CREATE TRIGGER "PurchaseOrderLine_update_guard" BEFORE UPDATE ON "PurchaseOrderLine"
BEGIN
SELECT CASE
  WHEN NEW."purchaseOrderId" IS NOT OLD."purchaseOrderId" OR NEW."lineNo" IS NOT OLD."lineNo" OR NEW."skuId" IS NOT OLD."skuId" OR NEW."createdAt" IS NOT OLD."createdAt"
    THEN RAISE(ABORT, 'PurchaseOrderLine_fixed: 발주 줄의 발주·SKU·순번은 바꿀 수 없습니다')
  WHEN (NEW."qtyOrdered" IS NOT OLD."qtyOrdered" OR NEW."unitCost" IS NOT OLD."unitCost") AND (SELECT p."status" FROM "PurchaseOrder" p WHERE p."id" = NEW."purchaseOrderId") <> 'DRAFT'
    THEN RAISE(ABORT, 'PurchaseOrderLine_fixed: 발주를 보낸 뒤에는 수량·단가를 바꿀 수 없습니다')
  WHEN NEW."qtyReceived" IS NOT (SELECT COALESCE(SUM(r."qtyGood" + r."qtyDefect"), 0) FROM "InboundReceiptLine" r WHERE r."purchaseOrderLineId" = NEW."id")
    THEN RAISE(ABORT, 'PurchaseOrderLine_received_guard: 입고 수량은 입고 전표로만 바뀝니다')
  WHEN NEW."expectedAt" IS NOT OLD."expectedAt" AND (SELECT p."status" FROM "PurchaseOrder" p WHERE p."id" = NEW."purchaseOrderId") NOT IN ('DRAFT', ${PO_OPEN.slice(1, -1)})
    THEN RAISE(ABORT, 'PurchaseOrderLine_fixed: 끝난 발주의 예정일은 바꿀 수 없습니다')
  WHEN NEW."expectedAt" IS NULL AND OLD."expectedAt" IS NOT NULL AND (SELECT p."status" FROM "PurchaseOrder" p WHERE p."id" = NEW."purchaseOrderId") <> 'DRAFT'
    THEN RAISE(ABORT, 'PurchaseOrderLine_fixed: 보낸 발주의 예정일은 비울 수 없습니다 (날짜를 바꾸세요)')
END;
END;`,
  },
  {
    table: "PurchaseOrderLine",
    name: "PurchaseOrderLine_delete_guard",
    why: "작성 중인 발주의 줄만 삭제 가능",
    sql: `CREATE TRIGGER "PurchaseOrderLine_delete_guard" BEFORE DELETE ON "PurchaseOrderLine"
WHEN (SELECT p."status" FROM "PurchaseOrder" p WHERE p."id" = OLD."purchaseOrderId") IS NOT 'DRAFT'
BEGIN ${raise("PurchaseOrderLine_delete_guard", "보낸 발주의 줄은 지울 수 없습니다")} END;`,
  },
  ...appendOnly("PurchaseOrderEvent"),

  // --- 입고 전표
  {
    table: "InboundReceipt",
    name: "InboundReceipt_insert_guard",
    why: "입고는 사용 중인 위치로, 발주가 있으면 진행 중인 발주만",
    sql: `CREATE TRIGGER "InboundReceipt_insert_guard" BEFORE INSERT ON "InboundReceipt"
WHEN NOT EXISTS (SELECT 1 FROM "InventoryLocation" loc WHERE loc."id" = NEW."locationId" AND loc."isActive" = 1 AND loc."type" IN ('WAREHOUSE', 'STORE'))
  OR (NEW."purchaseOrderId" IS NOT NULL AND (SELECT p."status" FROM "PurchaseOrder" p WHERE p."id" = NEW."purchaseOrderId") NOT IN ${PO_OPEN})
BEGIN ${raise("InboundReceipt_insert_guard", "입고할 수 없는 위치이거나 진행 중인 발주가 아닙니다")} END;`,
  },
  {
    table: "InboundReceipt",
    name: "InboundReceipt_no_update",
    why: "입고 전표는 수정 금지 (잘못 입고했으면 조정 원장)",
    sql: `CREATE TRIGGER "InboundReceipt_no_update" BEFORE UPDATE ON "InboundReceipt"
BEGIN ${raise("InboundReceipt_append_only", "입고 전표는 수정할 수 없습니다")} END;`,
  },
  noDelete("InboundReceipt", "입고 전표는 삭제할 수 없습니다", "입고 기록 보관"),
  {
    table: "InboundReceiptLine",
    name: "InboundReceiptLine_insert_guard",
    why: "발주 줄과 같은 발주·SKU, 발주 수량을 넘는 입고 금지, 발주 없는 입고는 발주 줄 없이",
    sql: `CREATE TRIGGER "InboundReceiptLine_insert_guard" BEFORE INSERT ON "InboundReceiptLine"
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
END;`,
  },
  {
    table: "InboundReceiptLine",
    name: "InboundReceiptLine_apply",
    why: "입고 전표 줄을 넣으면 발주 줄의 입고 수량을 자동 반영",
    sql: `CREATE TRIGGER "InboundReceiptLine_apply" AFTER INSERT ON "InboundReceiptLine"
WHEN NEW."purchaseOrderLineId" IS NOT NULL
BEGIN
  UPDATE "PurchaseOrderLine" SET "qtyReceived" = (SELECT COALESCE(SUM(r."qtyGood" + r."qtyDefect"), 0) FROM "InboundReceiptLine" r WHERE r."purchaseOrderLineId" = NEW."purchaseOrderLineId"), "updatedAt" = ${NOW}
  WHERE "id" = NEW."purchaseOrderLineId";
END;`,
  },
  {
    table: "InboundReceiptLine",
    name: "InboundReceiptLine_no_update",
    why: "입고 전표 줄은 수정 금지",
    sql: `CREATE TRIGGER "InboundReceiptLine_no_update" BEFORE UPDATE ON "InboundReceiptLine"
BEGIN ${raise("InboundReceiptLine_append_only", "입고 전표 줄은 수정할 수 없습니다")} END;`,
  },
  noDelete("InboundReceiptLine", "입고 전표 줄은 삭제할 수 없습니다", "입고 기록 보관"),

  // --- 재입고 알림 신청
  {
    table: "RestockSubscription",
    name: "RestockSubscription_insert_guard",
    why: "대기 상태로, 정상 회원만, 같은 SKU에 진행 중인 신청은 1개",
    sql: `CREATE TRIGGER "RestockSubscription_insert_guard" BEFORE INSERT ON "RestockSubscription"
BEGIN
SELECT CASE
  WHEN NEW."status" <> 'WAITING' OR NEW."closedAt" IS NOT NULL
    THEN RAISE(ABORT, 'RestockSubscription_insert_guard: 신청은 대기(WAITING)로 만듭니다')
  WHEN ${customerStatusOf("customerId")} IS NOT 'ACTIVE'
    THEN RAISE(ABORT, 'RestockSubscription_insert_guard: 정상(ACTIVE) 회원만 신청할 수 있습니다')
  WHEN EXISTS (SELECT 1 FROM "RestockSubscription" x WHERE x."customerId" = NEW."customerId" AND x."skuId" = NEW."skuId" AND x."status" IN ('WAITING', 'SCHEDULED'))
    THEN RAISE(ABORT, 'RestockSubscription_duplicate: 이미 재입고 알림을 신청한 상품입니다')
END;
END;`,
  },
  {
    table: "RestockSubscription",
    name: "RestockSubscription_update_guard",
    why: "회원·SKU·신청 시각·만료 시각 고정, 상태는 정해진 길로만",
    sql: `CREATE TRIGGER "RestockSubscription_update_guard" BEFORE UPDATE ON "RestockSubscription"
BEGIN
SELECT CASE
  WHEN NEW."customerId" IS NOT OLD."customerId" OR NEW."skuId" IS NOT OLD."skuId" OR NEW."createdAt" IS NOT OLD."createdAt" OR NEW."expiresAt" IS NOT OLD."expiresAt"
    THEN RAISE(ABORT, 'RestockSubscription_fixed: 신청 내용은 바꿀 수 없습니다')
  WHEN NEW."status" IS NOT OLD."status" AND (OLD."status" || '>' || NEW."status") NOT IN (${inList(RESTOCK_STATUS_CHANGES)})
    THEN RAISE(ABORT, 'RestockSubscription_transition: 허용되지 않은 재입고 알림 상태 변경입니다')
END;
END;`,
  },
  noDelete("RestockSubscription", "재입고 알림 신청 기록은 삭제할 수 없습니다 (취소로 처리)", "알림 근거 보관"),

  // --- 알림
  {
    table: "Notification",
    name: "Notification_update_guard",
    why: "알림 내용은 고정. 발송 상태·횟수·읽은 시각만 바뀌고, 읽은 시각은 한 번만",
    sql: `CREATE TRIGGER "Notification_update_guard" BEFORE UPDATE ON "Notification"
WHEN NEW."customerId" IS NOT OLD."customerId" OR NEW."audience" IS NOT OLD."audience" OR NEW."type" IS NOT OLD."type" OR NEW."channel" IS NOT OLD."channel"
  OR NEW."title" IS NOT OLD."title" OR NEW."body" IS NOT OLD."body" OR NEW."linkUrl" IS NOT OLD."linkUrl" OR NEW."dedupKey" IS NOT OLD."dedupKey" OR NEW."createdAt" IS NOT OLD."createdAt"
  OR (OLD."readAt" IS NOT NULL AND NEW."readAt" IS NOT OLD."readAt")
BEGIN ${raise("Notification_update_guard", "알림 내용은 바꿀 수 없습니다 (읽음 표시·발송 상태만)")} END;`,
  },
  noDelete("Notification", "알림은 삭제할 수 없습니다", "발송 근거 보관"),

  // --- 재주문 필요
  {
    table: "StockAlert",
    name: "StockAlert_insert_guard",
    why: "새 알림은 진행 중(OPEN)으로, SKU·위치마다 진행 중인 알림은 1개",
    sql: `CREATE TRIGGER "StockAlert_insert_guard" BEFORE INSERT ON "StockAlert"
WHEN NEW."status" <> 'OPEN' OR EXISTS (SELECT 1 FROM "StockAlert" a WHERE a."skuId" = NEW."skuId" AND a."locationId" = NEW."locationId" AND a."status" = 'OPEN')
BEGIN ${raise("StockAlert_insert_guard", "이미 진행 중인 재주문 알림이 있습니다")} END;`,
  },
  {
    table: "StockAlert",
    name: "StockAlert_update_guard",
    why: "진행 중 → 해소 한 번만, 발생 정보 고정",
    sql: `CREATE TRIGGER "StockAlert_update_guard" BEFORE UPDATE ON "StockAlert"
WHEN OLD."status" <> 'OPEN' OR NEW."skuId" IS NOT OLD."skuId" OR NEW."locationId" IS NOT OLD."locationId" OR NEW."openedAt" IS NOT OLD."openedAt"
  OR NEW."availableAtOpen" IS NOT OLD."availableAtOpen" OR NEW."reorderPoint" IS NOT OLD."reorderPoint"
BEGIN ${raise("StockAlert_update_guard", "해소된 재주문 알림·발생 정보는 바꿀 수 없습니다")} END;`,
  },
  noDelete("StockAlert", "재주문 알림 기록은 삭제할 수 없습니다", "운영 기록 보관"),

  // --- 반품
  {
    table: "ReturnRequest",
    name: "ReturnRequest_insert_guard",
    why: "반품은 신청(REQUESTED)으로, 결제 완료 주문에만",
    sql: `CREATE TRIGGER "ReturnRequest_insert_guard" BEFORE INSERT ON "ReturnRequest"
WHEN NEW."status" <> 'REQUESTED' OR NEW."approvedAt" IS NOT NULL OR NEW."refundAmount" IS NOT NULL OR NEW."paymentCancelId" IS NOT NULL
  OR ${orderStatusOf(`NEW."orderId"`)} IS NOT 'PAID'
BEGIN ${raise("ReturnRequest_insert_guard", "결제 완료 주문에 신청 상태로만 반품을 만들 수 있습니다")} END;`,
  },
  {
    table: "ReturnRequest",
    name: "ReturnRequest_transition",
    why: "정해진 길로만. 검수 끝은 모든 상품 검수 후, 완료는 환불(결제 취소 완료) 후, 전부 반품 불가일 때만 검수 뒤 거절",
    sql: `CREATE TRIGGER "ReturnRequest_transition" BEFORE UPDATE OF "status" ON "ReturnRequest"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
SELECT CASE
  WHEN (OLD."status" || '>' || NEW."status") NOT IN (${inList(RETURN_STATUS_CHANGES)})
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
END;`,
  },
  {
    table: "ReturnRequest",
    name: "ReturnRequest_fixed",
    why: "반품번호·주문·사유·귀책·신청자·신청 시각 고정, 환불액·반품 배송비는 검수 끝날 때 한 번만 확정",
    sql: `CREATE TRIGGER "ReturnRequest_fixed" BEFORE UPDATE ON "ReturnRequest"
WHEN NEW."returnNo" IS NOT OLD."returnNo" OR NEW."orderId" IS NOT OLD."orderId" OR NEW."reason" IS NOT OLD."reason" OR NEW."fault" IS NOT OLD."fault"
  OR NEW."requestedBy" IS NOT OLD."requestedBy" OR NEW."requestedAt" IS NOT OLD."requestedAt" OR NEW."createdAt" IS NOT OLD."createdAt"
  OR (OLD."refundAmount" IS NOT NULL AND (NEW."refundAmount" IS NOT OLD."refundAmount" OR NEW."returnShippingFee" IS NOT OLD."returnShippingFee"))
  OR (OLD."paymentCancelId" IS NOT NULL AND NEW."paymentCancelId" IS NOT OLD."paymentCancelId")
BEGIN ${raise("ReturnRequest_fixed", "반품 기본 정보·확정된 환불액은 바꿀 수 없습니다")} END;`,
  },
  noDelete("ReturnRequest", "반품 기록은 삭제할 수 없습니다", "반품 기록 보관"),
  {
    table: "ReturnItem",
    name: "ReturnItem_insert_guard",
    why: "신청 중인 반품에, 같은 주문의 배송 완료 상품을, 반품 기간 안(고객 사유 7일·판매자 사유 30일), 줄 수량 전체로, 진행 중인 다른 반품이 없을 때",
    sql: `CREATE TRIGGER "ReturnItem_insert_guard" BEFORE INSERT ON "ReturnItem"
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
      > (SELECT CASE rr."fault" WHEN 'CUSTOMER' THEN ${RETURN_WINDOW_DAYS.CUSTOMER} ELSE ${RETURN_WINDOW_DAYS.SELLER} END FROM "ReturnRequest" rr WHERE rr."id" = NEW."returnRequestId")
    THEN RAISE(ABORT, 'ReturnItem_window: 반품 신청 기간이 지났습니다 (단순 변심·사이즈 7일, 불량·오배송·파손 30일)')
  WHEN EXISTS (SELECT 1 FROM "ReturnItem" x JOIN "ReturnRequest" rr ON rr."id" = x."returnRequestId" WHERE x."orderItemId" = NEW."orderItemId" AND rr."status" NOT IN ('REJECTED', 'CANCELED'))
    THEN RAISE(ABORT, 'ReturnItem_duplicate: 이미 반품이 진행 중이거나 끝난 상품입니다')
END;
END;`,
  },
  {
    table: "ReturnItem",
    name: "ReturnItem_update_guard",
    why: "반품 상품·수량 고정, 검수는 반품센터 도착 뒤 한 번만",
    sql: `CREATE TRIGGER "ReturnItem_update_guard" BEFORE UPDATE ON "ReturnItem"
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
END;`,
  },
  noDelete("ReturnItem", "반품 상품 기록은 삭제할 수 없습니다", "반품 기록 보관"),
  {
    table: "InventoryLedger",
    name: "InventoryLedger_return_guard",
    why: "반품 재고 이동은 실제 단계대로: 도착(반품센터 +)은 도착한 반품에 한 번, 검수 이동·반송은 검수 결과에 맞게, 수량은 반품 수량",
    sql: `CREATE TRIGGER "InventoryLedger_return_guard" BEFORE INSERT ON "InventoryLedger"
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
END;`,
  },
];


// ---------------------------------------------------------------
// ⑬ 쿠폰 (B안: 정책 · 발급 · 사용 분리)
//  - 앱은 쿠폰 상태를 직접 바꾸지 않음: 주문 상태 → OrderCoupon → CustomerCoupon 순서로 트리거가 바꿈
//  - 선착순 수량·1인 한도·등급·발급 기간·사용 기간·본인 쿠폰·주문당 1장·적용 대상은 DB가 최종 판정
// ---------------------------------------------------------------
const COUPON_TARGET_SHAPE = [
  `("targetType" = 'ALL'      AND "categoryId" IS NULL     AND "seasonId" IS NULL     AND "gender" IS NULL     AND "styleId" IS NULL)`,
  `("targetType" = 'CATEGORY' AND "categoryId" IS NOT NULL AND "seasonId" IS NULL     AND "gender" IS NULL     AND "styleId" IS NULL)`,
  `("targetType" = 'SEASON'   AND "categoryId" IS NULL     AND "seasonId" IS NOT NULL AND "gender" IS NULL     AND "styleId" IS NULL)`,
  `("targetType" = 'GENDER'   AND "categoryId" IS NULL     AND "seasonId" IS NULL     AND "gender" IS NOT NULL AND "styleId" IS NULL)`,
  `("targetType" = 'STYLE'    AND "categoryId" IS NULL     AND "seasonId" IS NULL     AND "gender" IS NULL     AND "styleId" IS NOT NULL)`,
].join(" OR ");

const COUPON_CHECKS: CheckConstraint[] = [
  {
    table: "CouponPolicy",
    name: "CouponPolicy_values_ck",
    expr: `${upperCode("code")} AND ${notBlank("name")} AND ${notBlank("displayName")} AND length("displayName") <= 40 AND (${memoOk("description", 500)}) AND ${notBlank("createdBy")}
      AND (${int("discountValue", ">= 0")}) AND (${int("minOrderAmount", ">= 0")}) AND (${intOrNull("maxDiscountAmount", "> 0")})
      AND (("discountType" = 'RATE' AND "discountValue" BETWEEN 1 AND 90) OR ("discountType" = 'AMOUNT' AND "discountValue" > 0) OR ("discountType" = 'FREE_SHIPPING' AND "discountValue" = 0 AND "kind" = 'SHIPPING'))
      AND ("kind" <> 'SHIPPING' OR "discountType" IN ('FREE_SHIPPING', 'AMOUNT'))
      AND ("maxDiscountAmount" IS NULL OR "discountType" = 'RATE')`,
    why: "정률 1~90%, 정액 > 0, 무료배송은 배송비 쿠폰만, 배송비 쿠폰은 무료배송·정액만, 최대 할인은 정률에만",
  },
  {
    table: "CouponPolicy",
    name: "CouponPolicy_issue_ck",
    expr: `("issueMethod" = 'AUTO') = ("autoTrigger" IS NOT NULL) AND "issueEndAt" > "issueStartAt"
      AND (${intOrNull("totalQuantity", "> 0")}) AND (${int("issuedCount", ">= 0")}) AND ("totalQuantity" IS NULL OR "issuedCount" <= "totalQuantity")
      AND (${intOrNull("perCustomerLimit", ">= 1")})
      AND ("autoTrigger" IS NOT 'SIGNUP' OR "perCustomerLimit" = 1)
      AND ("autoTrigger" NOT IN ('BIRTHDAY', 'GRADE_MONTHLY') OR "perCustomerLimit" IS NULL)
      AND (("validDays" IS NOT NULL AND "useStartAt" IS NULL AND "useEndAt" IS NULL AND "validDays" BETWEEN 1 AND 365)
        OR ("validDays" IS NULL AND "useStartAt" IS NOT NULL AND "useEndAt" > "useStartAt" AND "issueEndAt" <= "useEndAt"))
      AND ${dates(["issueStartAt", false], ["issueEndAt", false], ["useStartAt", true], ["useEndAt", true], ["statusChangedAt", false], ["createdAt", false], ["updatedAt", false])}`,
    why: "자동 발급은 조건 필수, 발급 수는 총수량 이하, 가입 쿠폰은 1인 1장, 생일·등급 쿠폰은 주기별 1장(평생 한도 없음), 사용 기간은 고정 또는 N일(1~365) 중 하나, 고정 기간이면 발급 종료가 사용 종료보다 늦지 않음",
  },
  { table: "CouponPolicyTarget", name: "CouponPolicyTarget_shape_ck", expr: COUPON_TARGET_SHAPE, why: "대상 종류에 맞는 칸 하나만 채움" },
  { table: "CouponCode", name: "CouponCode_ck", expr: `length("code") BETWEEN 4 AND 20 AND "code" NOT GLOB '*[^A-Z0-9]*'`, why: "코드는 대문자·숫자 4~20자 (입력은 대문자로 바꿔 찾음)" },
  { table: "CouponCodeAttempt", name: "CouponCodeAttempt_ck", expr: dates(["createdAt", false]), why: "날짜 형식" },
  {
    table: "CustomerCoupon",
    name: "CustomerCoupon_values_ck",
    expr: `length("couponNo") = 12 AND "couponNo" GLOB 'CP*' AND "couponNo" NOT GLOB '*[^A-Z0-9]*' AND "validTo" > "validFrom" AND ${notBlank("issuedBy")}
      AND ("issueMethod" = 'CODE') = ("couponCodeId" IS NOT NULL) AND ("issueKey" IS NULL OR length("issueKey") BETWEEN 1 AND 40) AND (${memoOk("statusReason", 200)})
      AND ${dates(["issuedAt", false], ["validFrom", false], ["validTo", false], ["statusChangedAt", false], ["expiryNotifiedAt", true], ["createdAt", false], ["updatedAt", false])}`,
    why: "쿠폰번호 CP+10자, 사용 종료 > 시작, 코드로 받았으면 코드 필수",
  },
  { table: "CustomerCouponHistory", name: "CustomerCouponHistory_ck", expr: `${dates(["changedAt", false])} AND (${memoOk("reason", 200)})`, why: "날짜 형식" },
  {
    table: "OrderCoupon",
    name: "OrderCoupon_values_ck",
    expr: `(${int("discountAmount", "> 0")}) AND ${notBlank("couponName")} AND ${dates(["appliedAt", true], ["releasedAt", true], ["canceledAt", true], ["createdAt", false], ["updatedAt", false])}
      AND (("status" = 'RESERVED' AND "appliedAt" IS NULL AND "releasedAt" IS NULL AND "canceledAt" IS NULL)
        OR ("status" = 'APPLIED' AND "appliedAt" IS NOT NULL AND "releasedAt" IS NULL AND "canceledAt" IS NULL)
        OR ("status" = 'RELEASED' AND "appliedAt" IS NULL AND "releasedAt" IS NOT NULL AND "canceledAt" IS NULL)
        OR ("status" = 'CANCELED' AND "appliedAt" IS NOT NULL AND "releasedAt" IS NULL AND "canceledAt" IS NOT NULL))`,
    why: "할인액 1원 이상, 상태별 시각 (사용=사용 시각, 해제=해제 시각, 결제 후 취소=사용·취소 시각)",
  },
  { table: "OrderItemCoupon", name: "OrderItemCoupon_amount_ck", expr: int("amount", ">= 0"), why: "배분액은 0 이상의 정수 (장바구니 쿠폰은 대상 줄 전부 기록: 금액이 아주 작은 줄은 0원일 수 있음. 상품 쿠폰은 주문 쿠폰 할인액 > 0으로 보장)" },
];

const POLICY_STATUS_CHANGES = ["DRAFT>ACTIVE", "DRAFT>ENDED", "ACTIVE>PAUSED", "PAUSED>ACTIVE", "ACTIVE>ENDED", "PAUSED>ENDED"];
const COUPON_STATUS_CHANGES = ["AVAILABLE>IN_USE", "IN_USE>USED", "IN_USE>AVAILABLE", "IN_USE>EXPIRED", "USED>AVAILABLE", "USED>EXPIRED", "AVAILABLE>EXPIRED", "AVAILABLE>REVOKED"];
const ORDER_COUPON_STATUS_CHANGES = ["RESERVED>APPLIED", "RESERVED>RELEASED", "APPLIED>CANCELED"];
const POLICY_RULE_COLS = ["code", "kind", "discountType", "discountValue", "maxDiscountAmount", "minOrderAmount", "applyToSaleItems", "issueMethod", "autoTrigger", "issueStartAt", "perCustomerLimit", "useStartAt", "useEndAt", "validDays", "createdBy", "createdAt"];
const policyOf = (col: string, policyRef: string) => `(SELECT p."${col}" FROM "CouponPolicy" p WHERE p."id" = ${policyRef})`;
const LIVE_ORDER_COUPON = `('RESERVED', 'APPLIED')`;
/** 발급일 포함 N일: 발급일(KST) + N일의 0시(KST) 직전까지 → UTC 문자열 (lib/coupon.ts couponValidTo와 같은 계산) */
const validToDaysSql = (issuedRef: string, daysRef: string) =>
  `strftime('%Y-%m-%dT%H:%M:%f+00:00', date(${issuedRef}, '+9 hours', '+' || ${daysRef} || ' days'), '-9 hours')`;
/** 상품 줄(i)이 쿠폰 정책(policyRef)의 대상인지: 제외가 포함보다 우선, 카테고리는 하위 포함, 할인 행사 상품 제외 옵션 */
const couponEligible = (policyRef: string, itemRef: string) => {
  const style = `(SELECT st."id" FROM "Sku" k JOIN "StyleColor" sc ON sc."id" = k."styleColorId" JOIN "Style" st ON st."id" = sc."styleId" WHERE k."id" = (SELECT oi."skuId" FROM "OrderItem" oi WHERE oi."id" = ${itemRef}))`;
  const match = `(t."targetType" = 'ALL'
      OR (t."targetType" = 'CATEGORY' AND (SELECT c."path" FROM "Category" c WHERE c."id" = (SELECT st2."categoryId" FROM "Style" st2 WHERE st2."id" = ${style})) LIKE '%/' || t."categoryId" || '/%')
      OR (t."targetType" = 'SEASON' AND t."seasonId" = (SELECT st2."seasonId" FROM "Style" st2 WHERE st2."id" = ${style}))
      OR (t."targetType" = 'GENDER' AND t."gender" = (SELECT st2."gender" FROM "Style" st2 WHERE st2."id" = ${style}))
      OR (t."targetType" = 'STYLE' AND t."styleId" = ${style}))`;
  return `(EXISTS (SELECT 1 FROM "CouponPolicyTarget" t WHERE t."policyId" = ${policyRef} AND t."mode" = 'INCLUDE' AND ${match})
    AND NOT EXISTS (SELECT 1 FROM "CouponPolicyTarget" t WHERE t."policyId" = ${policyRef} AND t."mode" = 'EXCLUDE' AND ${match})
    AND (${policyOf("applyToSaleItems", policyRef)} = 1 OR (SELECT oi."discountAmount" FROM "OrderItem" oi WHERE oi."id" = ${itemRef}) = 0))`;
};
const draftOnly = (table: string, policyCol: string, op: "INSERT" | "DELETE"): TriggerConstraint => ({
  table,
  name: `${table}_draft_only_${op === "INSERT" ? "ins" : "del"}`,
  why: "활성화한 쿠폰은 대상·등급을 바꿀 수 없음 (이미 받은 고객과 약속이 달라짐)",
  sql: `CREATE TRIGGER "${table}_draft_only_${op === "INSERT" ? "ins" : "del"}" BEFORE ${op} ON "${table}"
WHEN ${policyOf("status", `${op === "INSERT" ? "NEW" : "OLD"}."${policyCol}"`)} IS NOT 'DRAFT'
BEGIN ${raise(`${table}_draft_only`, "작성 중(DRAFT)인 쿠폰만 대상·등급을 바꿀 수 있습니다")} END;`,
});
const noUpdate = (table: string, message: string): TriggerConstraint => ({
  table,
  name: `${table}_no_update`,
  why: "만든 뒤 수정 금지",
  sql: `CREATE TRIGGER "${table}_no_update" BEFORE UPDATE ON "${table}"
BEGIN ${raise(`${table}_no_update`, message)} END;`,
});

const COUPON_TRIGGERS: TriggerConstraint[] = [
  // --- 정책
  {
    table: "CouponPolicy",
    name: "CouponPolicy_insert_draft",
    why: "쿠폰은 작성 중으로 만들고 대상·등급을 채운 뒤 활성화",
    sql: `CREATE TRIGGER "CouponPolicy_insert_draft" BEFORE INSERT ON "CouponPolicy"
WHEN NEW."status" <> 'DRAFT' OR NEW."issuedCount" <> 0
BEGIN ${raise("CouponPolicy_insert_draft", "쿠폰은 작성 중(DRAFT)·발급 0장으로만 만들 수 있습니다")} END;`,
  },
  {
    table: "CouponPolicy",
    name: "CouponPolicy_transition",
    why: "정해진 길로만. 상품·장바구니 쿠폰은 포함 대상이 있어야, 코드 쿠폰은 코드가 있어야 활성화",
    sql: `CREATE TRIGGER "CouponPolicy_transition" BEFORE UPDATE OF "status" ON "CouponPolicy"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
SELECT CASE
  WHEN (OLD."status" || '>' || NEW."status") NOT IN (${inList(POLICY_STATUS_CHANGES)})
    THEN RAISE(ABORT, 'CouponPolicy_transition: 허용되지 않은 쿠폰 상태 변경입니다')
  WHEN NEW."statusChangedAt" < OLD."statusChangedAt"
    THEN RAISE(ABORT, 'CouponPolicy_transition: 상태 변경 시각이 이전보다 앞설 수 없습니다')
  WHEN NEW."status" = 'ACTIVE' AND NEW."kind" <> 'SHIPPING' AND NOT EXISTS (SELECT 1 FROM "CouponPolicyTarget" t WHERE t."policyId" = NEW."id" AND t."mode" = 'INCLUDE')
    THEN RAISE(ABORT, 'CouponPolicy_transition: 상품·장바구니 쿠폰은 적용 대상(포함)이 있어야 활성화할 수 있습니다')
  WHEN NEW."status" = 'ACTIVE' AND NEW."issueMethod" = 'CODE' AND NOT EXISTS (SELECT 1 FROM "CouponCode" c WHERE c."policyId" = NEW."id" AND c."isActive" = 1)
    THEN RAISE(ABORT, 'CouponPolicy_transition: 코드 쿠폰은 코드가 있어야 활성화할 수 있습니다')
END;
END;`,
  },
  {
    table: "CouponPolicy",
    name: "CouponPolicy_rules_fixed",
    why: "활성화 후에는 할인·조건·발급 방식·사용 기간을 바꿀 수 없음 (이름·설명·상태·발급 종료·총수량만)",
    sql: `CREATE TRIGGER "CouponPolicy_rules_fixed" BEFORE UPDATE OF ${POLICY_RULE_COLS.map(q).join(", ")} ON "CouponPolicy"
WHEN OLD."status" <> 'DRAFT' AND (${POLICY_RULE_COLS.map((c) => `NEW."${c}" IS NOT OLD."${c}"`).join(" OR ")})
BEGIN ${raise("CouponPolicy_rules_fixed", "활성화한 쿠폰은 할인 규칙·조건·사용 기간을 바꿀 수 없습니다 (새 쿠폰으로 만드세요)")} END;`,
  },
  {
    table: "CouponPolicy",
    name: "CouponPolicy_issued_count",
    why: "발급 수는 실제 발급된 쿠폰 수와 같아야 함 (트리거만 바꿈)",
    sql: `CREATE TRIGGER "CouponPolicy_issued_count" BEFORE UPDATE OF "issuedCount" ON "CouponPolicy"
WHEN NEW."issuedCount" IS NOT (SELECT COUNT(*) FROM "CustomerCoupon" cc WHERE cc."policyId" = NEW."id")
BEGIN ${raise("CouponPolicy_issued_count", "발급 수는 발급된 쿠폰으로만 바뀝니다")} END;`,
  },
  noDelete("CouponPolicy", "쿠폰 정책은 삭제할 수 없습니다 (종료로 처리)", "발급·사용 기록 보관"),
  draftOnly("CouponPolicyTarget", "policyId", "INSERT"),
  draftOnly("CouponPolicyTarget", "policyId", "DELETE"),
  noUpdate("CouponPolicyTarget", "쿠폰 대상은 수정할 수 없습니다 (작성 중에 지우고 다시 추가)"),
  draftOnly("CouponPolicyGrade", "policyId", "INSERT"),
  draftOnly("CouponPolicyGrade", "policyId", "DELETE"),
  noUpdate("CouponPolicyGrade", "쿠폰 등급은 수정할 수 없습니다 (작성 중에 지우고 다시 추가)"),
  {
    table: "CouponCode",
    name: "CouponCode_insert_guard",
    why: "코드는 코드 발급 쿠폰에만, 종료된 쿠폰에는 추가 불가",
    sql: `CREATE TRIGGER "CouponCode_insert_guard" BEFORE INSERT ON "CouponCode"
WHEN ${policyOf("issueMethod", `NEW."policyId"`)} IS NOT 'CODE' OR ${policyOf("status", `NEW."policyId"`)} = 'ENDED'
BEGIN ${raise("CouponCode_insert_guard", "코드는 진행 중인 코드 발급 쿠폰에만 추가할 수 있습니다")} END;`,
  },
  fixedColumns("CouponCode", "CouponCode_fixed", ["policyId", "code", "createdAt"], "쿠폰 코드는 바꿀 수 없습니다 (사용 중지만 가능)", "코드 고정"),
  noDelete("CouponCode", "쿠폰 코드는 삭제할 수 없습니다 (사용 중지로 처리)", "발급 기록 보관"),
  ...appendOnly("CouponCodeAttempt"),

  // --- 발급
  {
    table: "CustomerCoupon",
    name: "CustomerCoupon_issue_guard",
    why: "선착순 수량·1인 한도·발급 기간·정상 회원·대상 등급·발급 방식·코드·사용 기간을 DB가 최종 판정 (동시에 받아도 정확)",
    sql: `CREATE TRIGGER "CustomerCoupon_issue_guard" BEFORE INSERT ON "CustomerCoupon"
BEGIN
SELECT CASE
  WHEN NEW."status" <> 'AVAILABLE'
    THEN RAISE(ABORT, 'CustomerCoupon_issue_guard: 쿠폰은 사용 가능 상태로 발급합니다')
  WHEN ${policyOf("status", `NEW."policyId"`)} IS NOT 'ACTIVE'
    THEN RAISE(ABORT, 'CustomerCoupon_not_active: 지금 발급할 수 없는 쿠폰입니다 (작성 중·중지·종료)')
  WHEN NEW."issuedAt" < ${policyOf("issueStartAt", `NEW."policyId"`)} OR NEW."issuedAt" >= ${policyOf("issueEndAt", `NEW."policyId"`)}
    THEN RAISE(ABORT, 'CustomerCoupon_issue_period: 발급 기간이 아닙니다')
  WHEN ${policyOf("totalQuantity", `NEW."policyId"`)} IS NOT NULL AND ${policyOf("issuedCount", `NEW."policyId"`)} >= ${policyOf("totalQuantity", `NEW."policyId"`)}
    THEN RAISE(ABORT, 'CustomerCoupon_sold_out: 선착순 수량이 모두 발급되었습니다')
  WHEN ${policyOf("perCustomerLimit", `NEW."policyId"`)} IS NOT NULL
      AND (SELECT COUNT(*) FROM "CustomerCoupon" cc WHERE cc."policyId" = NEW."policyId" AND cc."customerId" = NEW."customerId") >= ${policyOf("perCustomerLimit", `NEW."policyId"`)}
    THEN RAISE(ABORT, 'CustomerCoupon_limit: 이미 받은 쿠폰입니다 (1인 발급 한도)')
  WHEN ${customerStatusOf("customerId")} IS NOT 'ACTIVE'
    THEN RAISE(ABORT, 'CustomerCoupon_customer: 정상 회원만 쿠폰을 받을 수 있습니다')
  WHEN EXISTS (SELECT 1 FROM "CouponPolicyGrade" g WHERE g."policyId" = NEW."policyId")
      AND NOT EXISTS (SELECT 1 FROM "CouponPolicyGrade" g WHERE g."policyId" = NEW."policyId" AND g."gradeId" = (SELECT c."gradeId" FROM "Customer" c WHERE c."id" = NEW."customerId"))
    THEN RAISE(ABORT, 'CustomerCoupon_grade: 받을 수 있는 등급이 아닙니다')
  WHEN NEW."issueMethod" <> 'ADMIN' AND NEW."issueMethod" IS NOT ${policyOf("issueMethod", `NEW."policyId"`)}
    THEN RAISE(ABORT, 'CustomerCoupon_issue_guard: 쿠폰의 발급 방식과 다릅니다')
  WHEN NEW."couponCodeId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "CouponCode" k WHERE k."id" = NEW."couponCodeId" AND k."policyId" = NEW."policyId" AND k."isActive" = 1)
    THEN RAISE(ABORT, 'CustomerCoupon_issue_guard: 사용할 수 없는 쿠폰 코드입니다')
  WHEN NEW."issueMethod" = 'AUTO' AND ${policyOf("autoTrigger", `NEW."policyId"`)} IN ('BIRTHDAY', 'GRADE_MONTHLY') AND NEW."issueKey" IS NULL
    THEN RAISE(ABORT, 'CustomerCoupon_issue_guard: 주기 발급 쿠폰은 주기 키(issueKey)가 필요합니다')
  WHEN ${policyOf("validDays", `NEW."policyId"`)} IS NULL
      AND (NEW."validFrom" IS NOT ${policyOf("useStartAt", `NEW."policyId"`)} OR NEW."validTo" IS NOT ${policyOf("useEndAt", `NEW."policyId"`)})
    THEN RAISE(ABORT, 'CustomerCoupon_validity: 사용 기간이 쿠폰 정책(고정 기간)과 다릅니다')
  WHEN ${policyOf("validDays", `NEW."policyId"`)} IS NOT NULL
      AND (NEW."validFrom" IS NOT NEW."issuedAt" OR NEW."validTo" IS NOT ${validToDaysSql(`NEW."issuedAt"`, policyOf("validDays", `NEW."policyId"`))})
    THEN RAISE(ABORT, 'CustomerCoupon_validity: 사용 기간이 발급일 기준 N일과 다릅니다')
END;
END;`,
  },
  {
    table: "CustomerCoupon",
    name: "CustomerCoupon_after_issue",
    why: "발급 수 +1, 이력 첫 줄",
    sql: `CREATE TRIGGER "CustomerCoupon_after_issue" AFTER INSERT ON "CustomerCoupon"
BEGIN
  UPDATE "CouponPolicy" SET "issuedCount" = (SELECT COUNT(*) FROM "CustomerCoupon" cc WHERE cc."policyId" = NEW."policyId") WHERE "id" = NEW."policyId";
  INSERT INTO "CustomerCouponHistory" ("customerCouponId", "fromStatus", "toStatus", "orderId", "reason", "changedAt")
  VALUES (NEW."id", NULL, NEW."status", NULL, 'ISSUED:' || NEW."issueMethod", NEW."issuedAt");
END;`,
  },
  fixedColumns(
    "CustomerCoupon",
    "CustomerCoupon_fixed",
    ["couponNo", "policyId", "customerId", "issueMethod", "couponCodeId", "issueKey", "issuedBy", "issuedAt", "validFrom", "validTo", "createdAt"],
    "발급된 쿠폰의 주인·사용 기간은 바꿀 수 없습니다",
    "발급 정보 고정",
  ),
  {
    table: "CustomerCoupon",
    name: "CustomerCoupon_transition",
    why: "정해진 길로만. 사용 중·사용됨은 주문 쿠폰 기록과 반드시 맞아야 하고(앱이 직접 못 바꿈), 만료는 기간이 지난 뒤에만, 회수는 사유 필수",
    sql: `CREATE TRIGGER "CustomerCoupon_transition" BEFORE UPDATE OF "status" ON "CustomerCoupon"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
SELECT CASE
  WHEN (OLD."status" || '>' || NEW."status") NOT IN (${inList(COUPON_STATUS_CHANGES)})
    THEN RAISE(ABORT, 'CustomerCoupon_transition: 허용되지 않은 쿠폰 상태 변경입니다')
  WHEN NEW."statusChangedAt" < OLD."statusChangedAt"
    THEN RAISE(ABORT, 'CustomerCoupon_transition: 상태 변경 시각이 이전보다 앞설 수 없습니다')
  WHEN NEW."status" = 'IN_USE' AND NOT EXISTS (SELECT 1 FROM "OrderCoupon" oc WHERE oc."customerCouponId" = NEW."id" AND oc."status" = 'RESERVED')
    THEN RAISE(ABORT, 'CustomerCoupon_order_sync: 사용 중 상태는 주문 쿠폰 예약으로만 바뀝니다')
  WHEN NEW."status" = 'USED' AND NOT EXISTS (SELECT 1 FROM "OrderCoupon" oc WHERE oc."customerCouponId" = NEW."id" AND oc."status" = 'APPLIED')
    THEN RAISE(ABORT, 'CustomerCoupon_order_sync: 사용됨 상태는 결제 완료로만 바뀝니다')
  WHEN NEW."status" NOT IN ('IN_USE', 'USED') AND EXISTS (SELECT 1 FROM "OrderCoupon" oc WHERE oc."customerCouponId" = NEW."id" AND oc."status" IN ${LIVE_ORDER_COUPON})
    THEN RAISE(ABORT, 'CustomerCoupon_order_sync: 주문에 쓰인 쿠폰은 주문이 끝나야 돌려받거나 만료됩니다')
  WHEN OLD."status" = 'AVAILABLE' AND NEW."status" = 'EXPIRED' AND NEW."validTo" > NEW."statusChangedAt"
    THEN RAISE(ABORT, 'CustomerCoupon_transition: 사용 기간이 남은 쿠폰은 만료 처리할 수 없습니다')
  WHEN NEW."status" = 'REVOKED' AND NEW."statusReason" IS NULL
    THEN RAISE(ABORT, 'CustomerCoupon_transition: 회수 사유가 필요합니다')
END;
END;`,
  },
  {
    table: "CustomerCoupon",
    name: "CustomerCoupon_history_upd",
    why: "상태가 바뀔 때마다 이력 (주문 때문이면 주문 번호도)",
    sql: `CREATE TRIGGER "CustomerCoupon_history_upd" AFTER UPDATE OF "status" ON "CustomerCoupon"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
  INSERT INTO "CustomerCouponHistory" ("customerCouponId", "fromStatus", "toStatus", "orderId", "reason", "changedAt")
  VALUES (NEW."id", OLD."status", NEW."status",
    CASE WHEN NEW."status" IN ('IN_USE', 'USED') OR OLD."status" IN ('IN_USE', 'USED')
      THEN (SELECT oc."orderId" FROM "OrderCoupon" oc WHERE oc."customerCouponId" = NEW."id" ORDER BY oc."id" DESC LIMIT 1) END,
    NEW."statusReason", NEW."statusChangedAt");
END;`,
  },
  noDelete("CustomerCoupon", "발급된 쿠폰은 삭제할 수 없습니다 (회수로 처리)", "발급·사용 기록 보관"),
  ...appendOnly("CustomerCouponHistory"),
  {
    table: "Customer",
    name: "Customer_coupon_revoke",
    why: "탈퇴하면 남은 쿠폰 소멸 (사용한 쿠폰 기록은 그대로)",
    sql: `CREATE TRIGGER "Customer_coupon_revoke" AFTER UPDATE OF "status" ON "Customer"
WHEN NEW."status" = 'WITHDRAWN' AND OLD."status" IS NOT 'WITHDRAWN'
BEGIN
  UPDATE "CustomerCoupon" SET "status" = 'REVOKED', "statusReason" = 'WITHDRAWN', "statusChangedAt" = MAX("statusChangedAt", NEW."statusChangedAt"), "updatedAt" = ${NOW}
  WHERE "customerId" = NEW."id" AND "status" = 'AVAILABLE';
END;`,
  },

  // --- 주문에 사용
  {
    table: "OrderCoupon",
    name: "OrderCoupon_insert_guard",
    why: "결제 대기 회원 주문에, 본인의 사용 가능한 쿠폰만, 주문 시각이 사용 기간 안, 중지된 쿠폰 불가, 쿠폰은 종류와 관계없이 주문당 1장(중복 사용 불가), 할인액이 규칙을 넘지 않음",
    sql: `CREATE TRIGGER "OrderCoupon_insert_guard" BEFORE INSERT ON "OrderCoupon"
BEGIN
SELECT CASE
  WHEN NEW."status" <> 'RESERVED'
    THEN RAISE(ABORT, 'OrderCoupon_insert_guard: 주문 쿠폰은 예약 상태로 만듭니다')
  WHEN ${orderStatusOf(`NEW."orderId"`)} IS NOT 'PENDING'
    THEN RAISE(ABORT, 'OrderCoupon_insert_guard: 결제 대기 주문에만 쿠폰을 쓸 수 있습니다')
  WHEN (SELECT o."customerId" FROM "Order" o WHERE o."id" = NEW."orderId") IS NOT (SELECT cc."customerId" FROM "CustomerCoupon" cc WHERE cc."id" = NEW."customerCouponId")
    THEN RAISE(ABORT, 'OrderCoupon_owner: 본인 쿠폰만 쓸 수 있습니다')
  WHEN (SELECT cc."status" FROM "CustomerCoupon" cc WHERE cc."id" = NEW."customerCouponId") IS NOT 'AVAILABLE'
      OR EXISTS (SELECT 1 FROM "OrderCoupon" oc WHERE oc."customerCouponId" = NEW."customerCouponId" AND oc."status" IN ${LIVE_ORDER_COUPON})
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
END;`,
  },
  {
    table: "OrderCoupon",
    name: "OrderCoupon_after_insert",
    why: "예약하면 쿠폰은 '사용 중' (같은 쿠폰을 다른 주문에 못 씀)",
    sql: `CREATE TRIGGER "OrderCoupon_after_insert" AFTER INSERT ON "OrderCoupon"
BEGIN
  UPDATE "CustomerCoupon" SET "status" = 'IN_USE', "statusReason" = 'ORDER_RESERVED', "statusChangedAt" = MAX("statusChangedAt", NEW."createdAt"), "updatedAt" = ${NOW}
  WHERE "id" = NEW."customerCouponId";
END;`,
  },
  {
    table: "OrderCoupon",
    name: "OrderCoupon_transition",
    why: "주문 상태와 맞게만: 사용 = 결제 완료, 해제 = 결제 안 되고 끝남, 결제 후 취소 = 주문 취소 (트리거가 주문을 따라 바꿈)",
    sql: `CREATE TRIGGER "OrderCoupon_transition" BEFORE UPDATE OF "status" ON "OrderCoupon"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
SELECT CASE
  WHEN (OLD."status" || '>' || NEW."status") NOT IN (${inList(ORDER_COUPON_STATUS_CHANGES)})
    THEN RAISE(ABORT, 'OrderCoupon_transition: 허용되지 않은 주문 쿠폰 상태 변경입니다')
  WHEN NEW."status" = 'APPLIED' AND ${orderStatusOf(`NEW."orderId"`)} IS NOT 'PAID'
    THEN RAISE(ABORT, 'OrderCoupon_order_sync: 결제 완료된 주문의 쿠폰만 사용 처리됩니다')
  WHEN NEW."status" = 'RELEASED' AND ${orderStatusOf(`NEW."orderId"`)} NOT IN ('CANCELED', 'EXPIRED')
    THEN RAISE(ABORT, 'OrderCoupon_order_sync: 끝난 주문의 쿠폰만 돌려줍니다')
  WHEN NEW."status" = 'CANCELED' AND ${orderStatusOf(`NEW."orderId"`)} IS NOT 'CANCELED'
    THEN RAISE(ABORT, 'OrderCoupon_order_sync: 취소된 주문의 쿠폰만 취소 처리됩니다')
END;
END;`,
  },
  fixedColumns("OrderCoupon", "OrderCoupon_fixed", ["orderId", "customerCouponId", "kind", "couponName", "discountAmount", "createdAt"], "주문에 쓴 쿠폰 기록은 바꿀 수 없습니다", "주문 금액 근거 고정"),
  noDelete("OrderCoupon", "주문 쿠폰 기록은 삭제할 수 없습니다", "주문 금액 근거 보관"),
  {
    table: "OrderCoupon",
    name: "OrderCoupon_after_status",
    why: "주문 쿠폰이 사용·해제·취소되면 고객 쿠폰을 따라 바꿈 (돌려줄 때 기간이 지났으면 만료)",
    sql: `CREATE TRIGGER "OrderCoupon_after_status" AFTER UPDATE OF "status" ON "OrderCoupon"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
  UPDATE "CustomerCoupon" SET "status" = 'USED', "statusReason" = 'ORDER_PAID', "statusChangedAt" = MAX("statusChangedAt", NEW."appliedAt"), "updatedAt" = ${NOW}
  WHERE "id" = NEW."customerCouponId" AND NEW."status" = 'APPLIED';
  UPDATE "CustomerCoupon" SET
    "status" = CASE WHEN "validTo" > NEW."releasedAt" THEN 'AVAILABLE' ELSE 'EXPIRED' END,
    "statusReason" = 'ORDER_NOT_PAID', "statusChangedAt" = MAX("statusChangedAt", NEW."releasedAt"), "updatedAt" = ${NOW}
  WHERE "id" = NEW."customerCouponId" AND NEW."status" = 'RELEASED';
  UPDATE "CustomerCoupon" SET
    "status" = CASE WHEN "validTo" > NEW."canceledAt" THEN 'AVAILABLE' ELSE 'EXPIRED' END,
    "statusReason" = 'ORDER_CANCELED', "statusChangedAt" = MAX("statusChangedAt", NEW."canceledAt"), "updatedAt" = ${NOW}
  WHERE "id" = NEW."customerCouponId" AND NEW."status" = 'CANCELED';
END;`,
  },
  {
    table: "Order",
    name: "Order_coupon_cascade",
    why: "주문 결제 → 쿠폰 사용, 결제 없이 끝남(이탈·만료·대체) → 쿠폰 돌려줌, 결제 후 전체 취소 → 기간이 남았으면 돌려줌",
    sql: `CREATE TRIGGER "Order_coupon_cascade" AFTER UPDATE OF "status" ON "Order"
WHEN NEW."status" IS NOT OLD."status"
BEGIN
  UPDATE "OrderCoupon" SET "status" = 'APPLIED', "appliedAt" = NEW."statusChangedAt", "updatedAt" = ${NOW}
  WHERE "orderId" = NEW."id" AND "status" = 'RESERVED' AND NEW."status" = 'PAID';
  UPDATE "OrderCoupon" SET "status" = 'RELEASED', "releasedAt" = NEW."statusChangedAt", "updatedAt" = ${NOW}
  WHERE "orderId" = NEW."id" AND "status" = 'RESERVED' AND NEW."status" IN ('CANCELED', 'EXPIRED');
  UPDATE "OrderCoupon" SET "status" = 'CANCELED', "canceledAt" = NEW."statusChangedAt", "updatedAt" = ${NOW}
  WHERE "orderId" = NEW."id" AND "status" = 'APPLIED' AND NEW."status" = 'CANCELED';
END;`,
  },
  {
    table: "OrderItemCoupon",
    name: "OrderItemCoupon_insert_guard",
    why: "같은 주문의 줄에만, 결제 대기 중에만, 배송비 쿠폰은 배분 없음, 줄 금액 이하, 상품 쿠폰은 줄 1개·줄당 1장·최소 금액, 적용 대상(제외 우선·하위 카테고리·행사 상품 제외 옵션)",
    sql: `CREATE TRIGGER "OrderItemCoupon_insert_guard" BEFORE INSERT ON "OrderItemCoupon"
BEGIN
SELECT CASE
  WHEN (SELECT oi."orderId" FROM "OrderItem" oi WHERE oi."id" = NEW."orderItemId") IS NOT (SELECT oc."orderId" FROM "OrderCoupon" oc WHERE oc."id" = NEW."orderCouponId")
    THEN RAISE(ABORT, 'OrderItemCoupon_insert_guard: 같은 주문의 상품에만 배분할 수 있습니다')
  WHEN (SELECT oc."status" FROM "OrderCoupon" oc WHERE oc."id" = NEW."orderCouponId") IS NOT 'RESERVED'
      OR ${orderStatusOf(`(SELECT oc."orderId" FROM "OrderCoupon" oc WHERE oc."id" = NEW."orderCouponId")`)} IS NOT 'PENDING'
    THEN RAISE(ABORT, 'OrderItemCoupon_insert_guard: 결제 대기 주문의 예약 쿠폰만 배분할 수 있습니다')
  WHEN (SELECT oc."kind" FROM "OrderCoupon" oc WHERE oc."id" = NEW."orderCouponId") = 'SHIPPING'
    THEN RAISE(ABORT, 'OrderItemCoupon_insert_guard: 배송비 쿠폰은 상품에 배분하지 않습니다')
  WHEN NEW."amount" > (SELECT oi."lineTotal" FROM "OrderItem" oi WHERE oi."id" = NEW."orderItemId")
    THEN RAISE(ABORT, 'OrderItemCoupon_insert_guard: 상품 금액보다 많이 할인할 수 없습니다')
  WHEN (SELECT oc."kind" FROM "OrderCoupon" oc WHERE oc."id" = NEW."orderCouponId") = 'PRODUCT' AND (
      EXISTS (SELECT 1 FROM "OrderItemCoupon" x WHERE x."orderCouponId" = NEW."orderCouponId")
      OR EXISTS (SELECT 1 FROM "OrderItemCoupon" x JOIN "OrderCoupon" oc ON oc."id" = x."orderCouponId" WHERE x."orderItemId" = NEW."orderItemId" AND oc."kind" = 'PRODUCT' AND oc."status" IN ${LIVE_ORDER_COUPON}))
    THEN RAISE(ABORT, 'OrderItemCoupon_product_one: 상품 쿠폰은 상품 1개에 1장만 씁니다')
  WHEN (SELECT oc."kind" FROM "OrderCoupon" oc WHERE oc."id" = NEW."orderCouponId") = 'PRODUCT'
      AND (SELECT oi."lineTotal" FROM "OrderItem" oi WHERE oi."id" = NEW."orderItemId") < ${policyOf("minOrderAmount", `(SELECT cc."policyId" FROM "CustomerCoupon" cc JOIN "OrderCoupon" oc ON oc."customerCouponId" = cc."id" WHERE oc."id" = NEW."orderCouponId")`)}
    THEN RAISE(ABORT, 'OrderCoupon_min_order: 상품 금액이 쿠폰의 최소 구매 금액보다 적습니다')
  WHEN NOT ${couponEligible(`(SELECT cc."policyId" FROM "CustomerCoupon" cc JOIN "OrderCoupon" oc ON oc."customerCouponId" = cc."id" WHERE oc."id" = NEW."orderCouponId")`, `NEW."orderItemId"`)}
    THEN RAISE(ABORT, 'OrderItemCoupon_target: 쿠폰 적용 대상이 아닌 상품입니다')
END;
END;`,
  },
  noUpdate("OrderItemCoupon", "쿠폰 배분은 바꿀 수 없습니다"),
  noDelete("OrderItemCoupon", "쿠폰 배분은 삭제할 수 없습니다", "환불 기준 보관"),
  {
    table: "Payment",
    name: "Payment_coupon_ready",
    why: "결제 시작 전 마지막 검사: 쿠폰 할인 합계 = 주문 금액 구성, 줄 배분 합계 = 줄의 쿠폰 할인, 상품 쿠폰은 줄 1개, 장바구니 쿠폰은 최소 금액·정률 한도",
    sql: `CREATE TRIGGER "Payment_coupon_ready" BEFORE INSERT ON "Payment"
WHEN NEW."status" = 'IN_PROGRESS'
BEGIN
SELECT CASE
  WHEN (SELECT o."couponDiscountTotal" FROM "Order" o WHERE o."id" = NEW."orderId")
      IS NOT (SELECT COALESCE(SUM(oc."discountAmount"), 0) FROM "OrderCoupon" oc WHERE oc."orderId" = NEW."orderId" AND oc."kind" <> 'SHIPPING' AND oc."status" IN ${LIVE_ORDER_COUPON})
    OR (SELECT o."shippingDiscount" FROM "Order" o WHERE o."id" = NEW."orderId")
      IS NOT (SELECT COALESCE(SUM(oc."discountAmount"), 0) FROM "OrderCoupon" oc WHERE oc."orderId" = NEW."orderId" AND oc."kind" = 'SHIPPING' AND oc."status" IN ${LIVE_ORDER_COUPON})
    THEN RAISE(ABORT, 'Payment_coupon_ready: 쿠폰 할인 합계가 주문 금액과 다릅니다')
  WHEN EXISTS (SELECT 1 FROM "OrderItem" i WHERE i."orderId" = NEW."orderId"
      AND i."couponAllocated" IS NOT (SELECT COALESCE(SUM(x."amount"), 0) FROM "OrderItemCoupon" x JOIN "OrderCoupon" oc ON oc."id" = x."orderCouponId" WHERE x."orderItemId" = i."id" AND oc."status" IN ${LIVE_ORDER_COUPON}))
    THEN RAISE(ABORT, 'Payment_coupon_ready: 상품별 쿠폰 배분 합계가 상품의 쿠폰 할인과 다릅니다')
  WHEN EXISTS (SELECT 1 FROM "OrderCoupon" oc WHERE oc."orderId" = NEW."orderId" AND oc."kind" <> 'SHIPPING' AND oc."status" IN ${LIVE_ORDER_COUPON}
      AND (oc."discountAmount" IS NOT (SELECT SUM(x."amount") FROM "OrderItemCoupon" x WHERE x."orderCouponId" = oc."id")
        OR (oc."kind" = 'PRODUCT' AND (SELECT COUNT(*) FROM "OrderItemCoupon" x WHERE x."orderCouponId" = oc."id") <> 1)))
    THEN RAISE(ABORT, 'Payment_coupon_ready: 쿠폰 할인액과 상품 배분이 맞지 않습니다 (상품 쿠폰은 상품 1개)')
  WHEN EXISTS (SELECT 1 FROM "OrderCoupon" oc JOIN "CustomerCoupon" cc ON cc."id" = oc."customerCouponId" JOIN "CouponPolicy" p ON p."id" = cc."policyId"
      WHERE oc."orderId" = NEW."orderId" AND oc."status" IN ${LIVE_ORDER_COUPON} AND oc."kind" IN ('PRODUCT', 'ORDER') AND (
        (SELECT SUM(i."lineTotal" - CASE WHEN oc."kind" = 'ORDER' THEN COALESCE((SELECT SUM(y."amount") FROM "OrderItemCoupon" y JOIN "OrderCoupon" pc ON pc."id" = y."orderCouponId" WHERE y."orderItemId" = i."id" AND pc."kind" = 'PRODUCT' AND pc."status" IN ${LIVE_ORDER_COUPON}), 0) ELSE 0 END)
           FROM "OrderItem" i WHERE i."id" IN (SELECT x."orderItemId" FROM "OrderItemCoupon" x WHERE x."orderCouponId" = oc."id")) < p."minOrderAmount"
        OR (p."discountType" = 'RATE' AND oc."discountAmount" * 100 >
          (SELECT SUM(i."lineTotal" - CASE WHEN oc."kind" = 'ORDER' THEN COALESCE((SELECT SUM(y."amount") FROM "OrderItemCoupon" y JOIN "OrderCoupon" pc ON pc."id" = y."orderCouponId" WHERE y."orderItemId" = i."id" AND pc."kind" = 'PRODUCT' AND pc."status" IN ${LIVE_ORDER_COUPON}), 0) ELSE 0 END)
             FROM "OrderItem" i WHERE i."id" IN (SELECT x."orderItemId" FROM "OrderItemCoupon" x WHERE x."orderCouponId" = oc."id")) * p."discountValue")))
    THEN RAISE(ABORT, 'Payment_coupon_ready: 쿠폰 최소 구매 금액이 모자라거나 정률 할인이 한도를 넘었습니다')
END;
END;`,
  },
];

export const TRIGGERS: TriggerConstraint[] = [
  ...INVENTORY_TRIGGERS,
  ...CUSTOMER_TRIGGERS,
  ...PAYMENT_TRIGGERS,
  ...ORDER_TRIGGERS,
  ...INV2_TRIGGERS,
  ...COUPON_TRIGGERS,
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
