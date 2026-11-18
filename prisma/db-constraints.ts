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
    ].join(" OR ") + `) AND (("status" = 'CONFIRMED') = ("confirmType" IS NOT NULL)) AND ("autoConfirmAt" IS NULL OR "status" IN ('DELIVERED', 'CONFIRMED')) AND ("status" <> 'DELIVERED' OR "autoConfirmAt" IS NOT NULL)`,
    why: "단계별 시각: 그 단계까지 거친 시각은 필수, 아직 안 간 단계는 비어 있음. 구매확정이면 확정 방식, 배송 완료면 자동확정 예정일 필수",
  },
  { table: "OrderItem", name: "OrderItem_dates_ck", expr: `(${memoOk("statusMemo")}) AND ${dates(["statusChangedAt", false], ["paidAt", true], ["preparingAt", true], ["shippedAt", true], ["deliveredAt", true], ["confirmedAt", true], ["canceledAt", true], ["autoConfirmAt", true], ["createdAt", false])}`, why: "날짜 형식, 상태 사유 200자 이내" },

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

export function allChecks(schemaText: string): CheckConstraint[] {
  return [...autoChecks(schemaText), ...MANUAL_CHECKS, ...PAYMENT_CHECKS, ...ORDER_CHECKS];
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
WHEN ${customerStatusOf("customerId")} IS NOT 'ACTIVE'
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
    ["totalPrice", "paymentOrderId", "customerId", "orderNo", "channel", "itemsListTotal", "itemsDiscountTotal", "itemsTotal", "couponDiscountTotal", "shippingBaseFee", "shippingExtraFee", "shippingFee", "shippingDiscount", "pointUsed", "shippingPolicyId", "freeShippingThreshold", "createdAt"],
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
  WHEN NEW."status" = 'CANCELED' AND EXISTS (SELECT 1 FROM "OrderItem" i WHERE i."orderId" = NEW."id" AND i."status" IN ('SHIPPED', 'DELIVERED', 'CONFIRMED'))
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
];
const SHIPMENT_STATUS_CHANGES = ["READY>SHIPPED", "READY>CANCELED", "SHIPPED>DELIVERED"];
/** 개인정보 보관 기간 (전자상거래법: 계약·대금결제 기록 5년) */
const PII_RETENTION_DAYS = 365 * 5;
const orderStatusOf = (orderRef: string) => `(SELECT o."status" FROM "Order" o WHERE o."id" = ${orderRef})`;
/** 주문의 상품 상태들 → 진행 요약 (취소된 상품은 빼고 판단) */
export const FULFILLMENT_OF = (orderRef: string) => {
  const has = (cond: string) => `EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = ${orderRef} AND ${cond})`;
  return `(CASE
    WHEN NOT ${has(`fi."status" <> 'CANCELED'`)} THEN 'CANCELED'
    WHEN ${has(`fi."status" = 'AWAITING_PAYMENT'`)} THEN 'UNPAID'
    WHEN NOT ${has(`fi."status" NOT IN ('CONFIRMED', 'CANCELED')`)} THEN 'CONFIRMED'
    WHEN NOT ${has(`fi."status" NOT IN ('DELIVERED', 'CONFIRMED', 'CANCELED')`)} THEN 'DELIVERED'
    WHEN NOT ${has(`fi."status" IN ('PAID', 'PREPARING')`)} THEN 'SHIPPED'
    WHEN ${has(`fi."status" IN ('SHIPPED', 'DELIVERED', 'CONFIRMED')`)} THEN 'PARTIALLY_SHIPPED'
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
  WHEN EXISTS (SELECT 1 FROM "OrderItem" i WHERE i."orderId" = (SELECT p."orderId" FROM "Payment" p WHERE p."id" = NEW."paymentId") AND i."status" IN ('SHIPPED', 'DELIVERED', 'CONFIRMED'))
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

export const TRIGGERS: TriggerConstraint[] = [
  ...INVENTORY_TRIGGERS,
  ...CUSTOMER_TRIGGERS,
  ...PAYMENT_TRIGGERS,
  ...ORDER_TRIGGERS,
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
