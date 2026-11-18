// DB 무결성 점검:  npm run db:verify
//
// 1) 구조: prisma/db-constraints.ts에 정의한 CHECK·트리거가 실제 DB에 "그 내용 그대로" 있는가
//    (Prisma가 테이블을 다시 만들면서 지워졌거나, enum 값이 바뀌었는데 CHECK가 옛날 목록이면 여기서 잡힘)
// 2) 데이터: 이미 들어 있는 행이 CHECK 규칙을 지키는가 (제약을 걸기 전에 들어간 데이터 대비)
// 3) 업무 규칙: CHECK로는 표현할 수 없는 "여러 행에 걸친" 규칙 (혼용률 합계 100%, 판매 중 상품의 필수 정보 등)
//
// 마이그레이션·seed 후, 배포 전에 실행합니다. 오류가 있으면 종료 코드 1.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { allChecks, FULFILLMENT_OF, TRIGGERS, validateConstraints } from "../prisma/db-constraints";

type Row = Record<string, unknown>;
const errors: string[] = [];
const warnings: string[] = [];
// 공백 차이와 끝의 세미콜론은 무시 (SQLite는 트리거 SQL을 저장할 때 마지막 ";"를 빼고 저장함)
const norm = (s: string) => s.replace(/\s+/g, " ").trim().replace(/;$/, "");
const query = (sql: string) => prisma.$queryRawUnsafe<Row[]>(sql);

async function checkStructure() {
  const schema = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
  for (const p of validateConstraints(schema)) errors.push(`[정의] ${p}`);
  const checks = allChecks(schema);
  const tables = new Map(
    (await query(`SELECT name, sql FROM sqlite_master WHERE type = 'table'`)).map((r) => [String(r.name), String(r.sql)]),
  );

  let ok = 0;
  for (const c of checks) {
    const tableSql = tables.get(c.table);
    if (!tableSql) {
      errors.push(`[구조] 테이블 없음: ${c.table}`);
      continue;
    }
    if (tableSql.includes(`CONSTRAINT "${c.name}" CHECK (${c.expr})`)) ok++;
    else if (tableSql.includes(`CONSTRAINT "${c.name}"`)) errors.push(`[구조] CHECK 내용이 정의와 다름: ${c.name} (enum 값이 바뀌었으면 테이블을 다시 만드는 마이그레이션 필요)`);
    else errors.push(`[구조] CHECK 없음: ${c.name} — ${c.why}`);
  }
  console.log(`  CHECK ${ok}/${checks.length}개 확인`);

  const triggers = new Map(
    (await query(`SELECT name, sql FROM sqlite_master WHERE type = 'trigger'`)).map((r) => [String(r.name), String(r.sql)]),
  );
  let tok = 0;
  for (const t of TRIGGERS) {
    const actual = triggers.get(t.name);
    if (!actual) errors.push(`[구조] 트리거 없음: ${t.name} — ${t.why}`);
    else if (norm(actual) !== norm(t.sql)) errors.push(`[구조] 트리거 내용이 정의와 다름: ${t.name}`);
    else tok++;
  }
  console.log(`  트리거 ${tok}/${TRIGGERS.length}개 확인`);

  // 외래키 검사가 켜져 있는지 (꺼져 있으면 FK 제약이 무시됨)
  const fk = await query(`PRAGMA foreign_keys`);
  if (Number(fk[0]?.foreign_keys) !== 1) errors.push("[구조] PRAGMA foreign_keys가 꺼져 있음");

  // 기존 데이터가 CHECK를 지키는지 (CHECK는 "쓸 때"만 검사하므로 제약 이전 데이터는 따로 확인)
  let dataBad = 0;
  for (const c of checks) {
    if (!tables.has(c.table)) continue;
    const [{ n }] = await query(`SELECT count(*) AS n FROM "${c.table}" WHERE NOT (${c.expr})`);
    if (Number(n) > 0) {
      dataBad++;
      errors.push(`[데이터] ${c.name} 위반 ${n}행 — ${c.why}`);
    }
  }
  console.log(`  기존 데이터 CHECK 위반: ${dataBad}건`);
  const fkBad = await query(`PRAGMA foreign_key_check`);
  if (fkBad.length) errors.push(`[데이터] 외래키 위반 ${fkBad.length}행: ${JSON.stringify(fkBad.slice(0, 3), (_, v) => (typeof v === "bigint" ? Number(v) : v))}`);
}

// 업무 규칙: [설명, 위반 행을 찾는 SQL, 오류/경고]
const NOW = `strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')`;
const SELLABLE_STYLE = `s."status" = 'ON_SALE' AND s."isDisplayed" = 1 AND s."deletedAt" IS NULL`;
const RULES: [string, string, "error" | "warn"][] = [
  ["혼용률: 같은 부위 합계는 100%",
    `SELECT s."styleCode" AS code, m."part" AS part, sum(m."percent") AS total FROM "StyleMaterial" m JOIN "Style" s ON s."id" = m."styleId" GROUP BY m."styleId", m."part" HAVING sum(m."percent") <> 100`, "error"],
  ["카테고리: path·depth가 부모 기준 계산값과 일치",
    `SELECT c."code" AS code, c."path" AS path FROM "Category" c LEFT JOIN "Category" p ON p."id" = c."parentId"
     WHERE c."path" <> COALESCE(p."path", '/') || c."id" || '/' OR c."depth" <> COALESCE(p."depth", 0) + 1`, "error"],
  ["정가: 같은 스타일의 적용 기간이 겹치지 않음",
    `SELECT a."styleId" AS styleId, a."id" AS a, b."id" AS b FROM "StylePrice" a JOIN "StylePrice" b ON a."styleId" = b."styleId" AND a."id" < b."id"
     WHERE a."validFrom" < COALESCE(b."validTo", '9999') AND b."validFrom" < COALESCE(a."validTo", '9999')`, "error"],
  ["SKU: 사이즈가 스타일의 사이즈 체계에 속함",
    `SELECT k."skuCode" AS code FROM "Sku" k JOIN "StyleColor" sc ON sc."id" = k."styleColorId" JOIN "Style" s ON s."id" = sc."styleId" JOIN "Size" z ON z."id" = k."sizeId" WHERE z."sizeGroupId" <> s."sizeGroupId"`, "error"],
  ["판매 중 상품: 지금 유효한 정가가 있음",
    `SELECT s."styleCode" AS code FROM "Style" s WHERE ${SELLABLE_STYLE} AND NOT EXISTS (
       SELECT 1 FROM "StylePrice" p WHERE p."styleId" = s."id" AND p."validFrom" <= ${NOW} AND (p."validTo" IS NULL OR p."validTo" > ${NOW}))`, "error"],
  ["판매 중 상품: 상품정보제공고시가 있음 (전자상거래법 의무)",
    `SELECT s."styleCode" AS code FROM "Style" s WHERE ${SELLABLE_STYLE} AND NOT EXISTS (SELECT 1 FROM "StyleNotice" n WHERE n."styleId" = s."id")`, "error"],
  ["판매 중 상품: 판매 중인 컬러가 1개 이상",
    `SELECT s."styleCode" AS code FROM "Style" s WHERE ${SELLABLE_STYLE} AND NOT EXISTS (
       SELECT 1 FROM "StyleColor" c WHERE c."styleId" = s."id" AND c."status" = 'ON_SALE' AND c."isDisplayed" = 1)`, "error"],
  ["판매 중 컬러: SKU와 대표(MAIN) 이미지가 있음",
    `SELECT c."code" AS code FROM "StyleColor" c JOIN "Style" s ON s."id" = c."styleId"
     WHERE ${SELLABLE_STYLE} AND c."status" = 'ON_SALE' AND c."isDisplayed" = 1
       AND (NOT EXISTS (SELECT 1 FROM "Sku" k WHERE k."styleColorId" = c."id")
         OR NOT EXISTS (SELECT 1 FROM "StyleColorImage" i WHERE i."styleColorId" = c."id" AND i."type" = 'MAIN'))`, "error"],
  ["정률 행사: 대상별 할인값도 1~99%",
    `SELECT p."code" AS code, t."discountValueOverride" AS v FROM "PricePromotionTarget" t JOIN "PricePromotion" p ON p."id" = t."promotionId"
     WHERE p."discountType" = 'RATE' AND t."discountValueOverride" IS NOT NULL AND t."discountValueOverride" NOT BETWEEN 1 AND 99`, "error"],
  ["확정된 행사: 포함(INCLUDE) 대상이 1개 이상 (없으면 아무 상품에도 적용 안 됨)",
    `SELECT p."code" AS code FROM "PricePromotion" p WHERE p."status" = 'APPROVED'
       AND NOT EXISTS (SELECT 1 FROM "PricePromotionTarget" t WHERE t."promotionId" = p."id" AND t."mode" = 'INCLUDE')`, "warn"],
  ["재고: 실재고 = 원장 합계 (위치별)",
    `SELECT b."skuId" AS skuId, b."locationId" AS loc, b."onHand" AS onHand, COALESCE(SUM(l."qty"), 0) AS ledgerSum
     FROM "InventoryBalance" b LEFT JOIN "InventoryLedger" l ON l."skuId" = b."skuId" AND l."locationId" = b."locationId"
     GROUP BY b."skuId", b."locationId" HAVING b."onHand" <> COALESCE(SUM(l."qty"), 0)`, "error"],
  ["재고: 예약 수량 = 결제 대기(RESERVED) + 출고 대기(ALLOCATED) 예약 합계",
    `SELECT b."skuId" AS skuId, b."reserved" AS reserved, COALESCE(SUM(r."qty"), 0) AS reservationSum
     FROM "InventoryBalance" b LEFT JOIN "InventoryReservation" r ON r."skuId" = b."skuId" AND r."locationId" = b."locationId" AND r."status" IN ('RESERVED', 'ALLOCATED')
     GROUP BY b."skuId", b."locationId" HAVING b."reserved" <> COALESCE(SUM(r."qty"), 0)`, "error"],
  ["재고: 원장의 balanceAfter가 누적 합계와 일치 (중간 기록 위조·누락 없음)",
    `SELECT id, "skuId", "balanceAfter", running FROM (
       SELECT l."id", l."skuId", l."balanceAfter", SUM(l."qty") OVER (PARTITION BY l."skuId", l."locationId" ORDER BY l."id") AS running
       FROM "InventoryLedger" l) WHERE "balanceAfter" <> running`, "error"],
  ["재고: 원장·예약이 있는 SKU·위치에는 잔고 행이 있음",
    `SELECT DISTINCT x."skuId" AS skuId, x."locationId" AS loc FROM (
       SELECT "skuId", "locationId" FROM "InventoryLedger" UNION SELECT "skuId", "locationId" FROM "InventoryReservation") x
     LEFT JOIN "InventoryBalance" b ON b."skuId" = x."skuId" AND b."locationId" = x."locationId" WHERE b."skuId" IS NULL`, "error"],
  ["재고: 확정된 예약마다 판매 원장(SALE)이 정확히 1개",
    `SELECT r."id" AS reservationId, count(l."id") AS sales FROM "InventoryReservation" r
     LEFT JOIN "InventoryLedger" l ON l."reservationId" = r."id" AND l."type" = 'SALE'
     WHERE r."status" = 'CONFIRMED' GROUP BY r."id" HAVING count(l."id") <> 1`, "error"],
  ["재고: 판매 원장은 확정된 예약에서만 생김 (수량도 일치)",
    `SELECT l."id" AS ledgerId FROM "InventoryLedger" l LEFT JOIN "InventoryReservation" r ON r."id" = l."reservationId"
     WHERE l."type" = 'SALE' AND (r."id" IS NULL OR r."status" <> 'CONFIRMED' OR -l."qty" <> r."qty")`, "error"],
  ["주문: 결제 완료 주문의 상품마다 할당(출고 전)·확정(출고 후)된 재고가 수량만큼 (상품 줄별)",
    `SELECT o."orderNo", i."lineNo", i."quantity" AS ordered, COALESCE(SUM(r."qty"), 0) AS held
     FROM "Order" o JOIN "OrderItem" i ON i."orderId" = o."id"
     LEFT JOIN "InventoryReservation" r ON r."orderItemId" = i."id" AND r."status" IN ('ALLOCATED', 'CONFIRMED')
     WHERE o."status" = 'PAID' AND i."status" <> 'CANCELED' GROUP BY i."id" HAVING COALESCE(SUM(r."qty"), 0) <> i."quantity"`, "error"],
  ["재고: 출고된 상품만 재고가 확정(차감)됨 (반품 상품도 출고됐던 것), 출고 전 상품은 할당 상태",
    `SELECT o."orderNo", i."lineNo", i."status", r."status" AS reservation FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId"
     JOIN "InventoryReservation" r ON r."orderItemId" = i."id" AND r."status" IN ('ALLOCATED', 'CONFIRMED')
     WHERE (r."status" = 'CONFIRMED') <> (i."status" IN ('SHIPPED', 'DELIVERED', 'CONFIRMED', 'RETURN_REQUESTED', 'RETURN_COLLECTING', 'RETURNED'))`, "error"],
  ["재고: 만료 시각이 지난 RESERVED 예약 없음 (만료 정리 필요: npm run inventory:release-expired)",
    `SELECT r."id" AS reservationId, r."expiresAt" AS expiresAt FROM "InventoryReservation" r WHERE r."status" = 'RESERVED' AND r."expiresAt" <= ${NOW}`, "warn"],
  ["재고: 판매 중인 SKU는 온라인 판매 위치에 잔고 행이 있음",
    `SELECT k."skuCode" AS code FROM "Sku" k JOIN "StyleColor" c ON c."id" = k."styleColorId" JOIN "Style" s ON s."id" = c."styleId"
     WHERE ${SELLABLE_STYLE} AND k."status" = 'ON_SALE' AND NOT EXISTS (
       SELECT 1 FROM "InventoryBalance" b JOIN "InventoryLocation" loc ON loc."id" = b."locationId"
       WHERE b."skuId" = k."id" AND loc."isOnlineSellable" = 1 AND loc."isActive" = 1)`, "warn"],
  ["고객: 탈퇴 고객은 개인정보·배송지·체형·로그인 계정이 모두 없음 (파기 확인)",
    `SELECT c."customerNo" AS no FROM "Customer" c WHERE c."status" = 'WITHDRAWN' AND (
       c."userId" IS NOT NULL
       OR EXISTS (SELECT 1 FROM "CustomerProfile" p WHERE p."customerId" = c."id" AND (p."nameEnc" IS NOT NULL OR p."phoneEnc" IS NOT NULL OR p."phoneHash" IS NOT NULL OR p."birthDateEnc" IS NOT NULL OR p."birthMonth" IS NOT NULL OR p."contactEmailEnc" IS NOT NULL OR p."emailHash" IS NOT NULL))
       OR EXISTS (SELECT 1 FROM "CustomerAddress" a WHERE a."customerId" = c."id")
       OR EXISTS (SELECT 1 FROM "CustomerBodyProfile" b WHERE b."customerId" = c."id"))`, "error"],
  ["고객: 현재 상태 = 상태 이력의 마지막 상태",
    `SELECT c."customerNo" AS no, c."status" AS status, h."toStatus" AS lastHistory FROM "Customer" c
     LEFT JOIN "CustomerStatusHistory" h ON h."id" = (SELECT max(x."id") FROM "CustomerStatusHistory" x WHERE x."customerId" = c."id")
     WHERE h."toStatus" IS NOT c."status"`, "error"],
  ["고객: 현재 등급 = 등급 이력의 마지막 등급",
    `SELECT c."customerNo" AS no FROM "Customer" c
     LEFT JOIN "CustomerGradeHistory" h ON h."id" = (SELECT max(x."id") FROM "CustomerGradeHistory" x WHERE x."customerId" = c."id")
     WHERE h."toGradeId" IS NOT c."gradeId"`, "error"],
  ["고객: 탈퇴 신청 중(WITHDRAW_PENDING)이면 진행 중인 신청이 정확히 1개, 아니면 0개",
    `SELECT c."customerNo" AS no, c."status" AS status, count(w."id") AS openRequests FROM "Customer" c
     LEFT JOIN "CustomerWithdrawal" w ON w."customerId" = c."id" AND w."completedAt" IS NULL AND w."canceledAt" IS NULL
     GROUP BY c."id" HAVING count(w."id") <> CASE WHEN c."status" = 'WITHDRAW_PENDING' THEN 1 ELSE 0 END`, "error"],
  ["고객: 휴대폰 번호(해시) 중복 없음",
    `SELECT "phoneHash" AS hash, count(*) AS n FROM "CustomerProfile" WHERE "phoneHash" IS NOT NULL GROUP BY "phoneHash" HAVING count(*) > 1`, "error"],
  ["고객: 기본 배송지는 고객당 최대 1개",
    `SELECT "customerId", count(*) AS n FROM "CustomerAddress" WHERE "isDefault" = 1 GROUP BY "customerId" HAVING count(*) > 1`, "error"],
  ["고객: 배송지가 있으면 기본 배송지가 있음",
    `SELECT "customerId" FROM "CustomerAddress" GROUP BY "customerId" HAVING max("isDefault") = 0`, "warn"],
  ["고객: 로그인 계정(User)마다 고객이 있음 (없으면 로그인 이벤트 실패 → 다음 접속 때 자동 생성)",
    `SELECT u."id" FROM "User" u LEFT JOIN "Customer" c ON c."userId" = u."id" WHERE c."id" IS NULL`, "warn"],
  ["고객: 처리 예정일이 지난 탈퇴 신청 없음 (npm run customer:jobs -- withdrawals)",
    `SELECT w."id" FROM "CustomerWithdrawal" w WHERE w."completedAt" IS NULL AND w."canceledAt" IS NULL AND w."scheduledAt" <= ${NOW}`, "warn"],
  ["고객: 3개월 지난 로그인 기록 없음 (npm run customer:jobs -- login-history)",
    `SELECT count(*) AS n FROM "CustomerLoginHistory" WHERE julianday(${NOW}) - julianday("loggedInAt") > 91 HAVING count(*) > 0`, "warn"],
  // ----- 결제·주문
  ["결제: 취소 금액 = 완료된 취소(PaymentCancel DONE) 합계",
    `SELECT p."id", p."canceledAmount", (SELECT COALESCE(SUM(c."cancelAmount"), 0) FROM "PaymentCancel" c WHERE c."paymentId" = p."id" AND c."status" = 'DONE') AS sum
     FROM "Payment" p WHERE p."canceledAmount" <> (SELECT COALESCE(SUM(c."cancelAmount"), 0) FROM "PaymentCancel" c WHERE c."paymentId" = p."id" AND c."status" = 'DONE')`, "error"],
  ["결제: 현재 상태 = 마지막 상태 이력",
    `SELECT p."id", p."status" FROM "Payment" p WHERE p."status" IS NOT (SELECT h."toStatus" FROM "PaymentStatusHistory" h WHERE h."paymentId" = p."id" ORDER BY h."id" DESC LIMIT 1)`, "error"],
  ["결제: 한 주문에 진행 중·완료된 결제는 1개 이하",
    `SELECT "orderId", count(*) AS n FROM "Payment" WHERE "status" IN ('IN_PROGRESS', 'UNKNOWN', 'WAITING_FOR_DEPOSIT', 'DONE', 'PARTIAL_CANCELED') GROUP BY "orderId" HAVING count(*) > 1`, "error"],
  ["결제: 결제 금액 = 주문 금액, 토스 주문번호 = 주문의 번호",
    `SELECT p."id" FROM "Payment" p JOIN "Order" o ON o."id" = p."orderId" WHERE p."amount" <> o."totalPrice" OR p."pgOrderId" <> o."paymentOrderId"`, "error"],
  ["주문: 결제 완료 주문에는 같은 금액의 완료된 결제가 있음",
    `SELECT o."id" FROM "Order" o WHERE o."status" = 'PAID'
       AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o."id" AND p."status" IN ('DONE', 'PARTIAL_CANCELED') AND p."amount" = o."totalPrice")`, "error"],
  ["주문: 입금 대기 주문에는 입금 대기 결제(가상계좌)가 있음",
    `SELECT o."id" FROM "Order" o WHERE o."status" = 'WAITING_DEPOSIT' AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o."id" AND p."status" = 'WAITING_FOR_DEPOSIT')`, "error"],
  ["주문: 취소·만료 주문에 돈이 걸린 결제(진행 중·완료·입금 대기)가 없음",
    `SELECT o."id", p."id" AS payment, p."status" FROM "Order" o JOIN "Payment" p ON p."orderId" = o."id"
     WHERE o."status" IN ('CANCELED', 'EXPIRED') AND p."status" IN ('IN_PROGRESS', 'UNKNOWN', 'WAITING_FOR_DEPOSIT', 'DONE', 'PARTIAL_CANCELED')`, "error"],
  ["주문: 결제 완료·취소·만료 주문은 재고를 결제 대기 예약(RESERVED)으로 잡고 있지 않음",
    `SELECT o."id", o."status" FROM "Order" o WHERE o."status" IN ('PAID', 'CANCELED', 'EXPIRED') AND EXISTS (SELECT 1 FROM "InventoryReservation" r WHERE r."orderId" = o."id" AND r."status" = 'RESERVED')`, "error"],
  ["주문: 취소·만료 주문은 출고 대기 재고(ALLOCATED)도 잡고 있지 않음",
    `SELECT o."orderNo", o."status" FROM "Order" o WHERE o."status" IN ('CANCELED', 'EXPIRED') AND EXISTS (SELECT 1 FROM "InventoryReservation" r WHERE r."orderId" = o."id" AND r."status" = 'ALLOCATED')`, "error"],
  // ----- ⑦ 주문
  ["주문: 금액 구성 = 상품 줄 합계 (정가·상품 할인·판매가·쿠폰 몫·포인트 몫)",
    `SELECT o."orderNo" FROM "Order" o WHERE
       o."itemsListTotal" IS NOT (SELECT SUM(i."lineListTotal") FROM "OrderItem" i WHERE i."orderId" = o."id")
       OR o."itemsDiscountTotal" IS NOT (SELECT SUM(i."lineDiscountTotal") FROM "OrderItem" i WHERE i."orderId" = o."id")
       OR o."itemsTotal" IS NOT (SELECT SUM(i."lineTotal") FROM "OrderItem" i WHERE i."orderId" = o."id")
       OR o."couponDiscountTotal" IS NOT (SELECT SUM(i."couponAllocated") FROM "OrderItem" i WHERE i."orderId" = o."id")
       OR o."pointUsed" IS NOT (SELECT SUM(i."pointAllocated") FROM "OrderItem" i WHERE i."orderId" = o."id")`, "error"],
  ["주문: 진행 요약(fulfillmentStatus) = 상품 상태로 계산한 값",
    `SELECT o."orderNo", o."fulfillmentStatus" AS stored, ${FULFILLMENT_OF(`o."id"`)} AS computed FROM "Order" o
     WHERE EXISTS (SELECT 1 FROM "OrderItem" x WHERE x."orderId" = o."id") AND o."fulfillmentStatus" IS NOT ${FULFILLMENT_OF(`o."id"`)}`, "error"],
  ["주문: 상품 상태가 주문(돈) 상태와 맞음 (결제 전 = 결제 대기, 취소·만료 = 취소, 결제 완료 = 결제 대기 없음)",
    `SELECT o."orderNo", o."status", i."lineNo", i."status" AS item FROM "Order" o JOIN "OrderItem" i ON i."orderId" = o."id"
     WHERE (o."status" IN ('PENDING', 'WAITING_DEPOSIT') AND i."status" <> 'AWAITING_PAYMENT')
        OR (o."status" IN ('CANCELED', 'EXPIRED') AND i."status" NOT IN ('CANCELED', 'RETURNED'))
        OR (o."status" = 'PAID' AND i."status" = 'AWAITING_PAYMENT')`, "error"],
  ["주문: 현재 상태 = 상태 이력의 마지막 상태 (주문·상품)",
    `SELECT 'order' AS kind, o."orderNo" AS ref, o."status" FROM "Order" o
       WHERE o."status" IS NOT (SELECT h."toStatus" FROM "OrderStatusHistory" h WHERE h."orderId" = o."id" ORDER BY h."id" DESC LIMIT 1)
     UNION ALL
     SELECT 'item', CAST(i."id" AS TEXT), i."status" FROM "OrderItem" i
       WHERE i."status" IS NOT (SELECT h."toStatus" FROM "OrderItemStatusHistory" h WHERE h."orderItemId" = i."id" ORDER BY h."id" DESC LIMIT 1)`, "error"],
  ["주문: 배송중·배송 완료 상품은 출고된 상자에 담겨 있음",
    `SELECT i."id", i."status" FROM "OrderItem" i WHERE i."status" IN ('SHIPPED', 'DELIVERED') AND NOT EXISTS (
       SELECT 1 FROM "ShipmentItem" si JOIN "Shipment" s ON s."id" = si."shipmentId"
       WHERE si."orderItemId" = i."id" AND s."type" = 'OUTBOUND' AND s."status" IN ('SHIPPED', 'DELIVERED'))`, "error"],
  ["주문: 결제를 시작한 주문에는 배송지가 있음 (배송지 저장 전 도입 이전 주문 제외)",
    `SELECT o."orderNo" FROM "Order" o JOIN "ShippingPolicy" sp ON sp."id" = o."shippingPolicyId"
     WHERE sp."code" <> 'LEGACY-FREE' AND EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o."id" AND p."status" <> 'ABORTED')
       AND NOT EXISTS (SELECT 1 FROM "OrderShippingAddress" a WHERE a."orderId" = o."id")`, "error"],
  // ----- 비회원 주문
  ["비회원 주문: 조회 비밀번호·개인정보 동의 기록(GuestOrderAccess)이 있고, 회원 주문에는 없음",
    `SELECT o."orderNo", o."ordererType" FROM "Order" o LEFT JOIN "GuestOrderAccess" g ON g."orderId" = o."id"
     WHERE (o."ordererType" = 'GUEST') <> (g."orderId" IS NOT NULL)`, "error"],
  ["비회원 주문: 회원으로 가져온 주문은 가져온 회원 = 주문의 회원, 아직이면 둘 다 비어 있음",
    `SELECT o."orderNo" FROM "Order" o JOIN "GuestOrderAccess" g ON g."orderId" = o."id" WHERE g."claimedByCustomerId" IS NOT o."customerId"`, "error"],
  ["비회원 주문: 쿠폰·포인트 사용 없음",
    `SELECT o."orderNo" FROM "Order" o WHERE o."ordererType" = 'GUEST' AND (o."couponDiscountTotal" <> 0 OR o."pointUsed" <> 0 OR o."shippingDiscount" <> 0)`, "error"],
  ["비회원 주문: 회원으로 옮긴 주문의 비회원 출입증은 모두 무효",
    `SELECT s."id" FROM "GuestOrderSession" s JOIN "Order" o ON o."id" = s."orderId" WHERE o."customerId" IS NOT NULL AND s."revokedAt" IS NULL AND s."expiresAt" > ${NOW}`, "error"],
  ["비회원 주문: 지난 출입증·90일 지난 조회 기록이 정리됨 → npm run orders:jobs -- guest-cleanup",
    `SELECT (SELECT count(*) FROM "GuestOrderSession" WHERE julianday(${NOW}) - julianday("expiresAt") > 1) AS sessions,
            (SELECT count(*) FROM "GuestLookupAttempt" WHERE julianday(${NOW}) - julianday("attemptedAt") > 91) AS attempts
     WHERE sessions > 0 OR attempts > 0`, "warn"],
  // ----- 재고 보강: 발주·입고·재입고·반품
  ["발주: 줄의 입고 수량 = 입고 전표 합계 (정상 + 불량)",
    `SELECT l."id", l."qtyReceived", (SELECT COALESCE(SUM(r."qtyGood" + r."qtyDefect"), 0) FROM "InboundReceiptLine" r WHERE r."purchaseOrderLineId" = l."id") AS receipts
     FROM "PurchaseOrderLine" l WHERE l."qtyReceived" <> (SELECT COALESCE(SUM(r."qtyGood" + r."qtyDefect"), 0) FROM "InboundReceiptLine" r WHERE r."purchaseOrderLineId" = l."id")`, "error"],
  ["입고: 전표 줄의 정상·불량 수량 = 원장에 들어간 수량",
    `SELECT r."id", r."qtyGood" + r."qtyDefect" AS qty, (SELECT COALESCE(SUM(l."qty"), 0) FROM "InventoryLedger" l WHERE l."inboundLineId" = r."id") AS ledger
     FROM "InboundReceiptLine" r WHERE r."qtyGood" + r."qtyDefect" <> (SELECT COALESCE(SUM(l."qty"), 0) FROM "InventoryLedger" l WHERE l."inboundLineId" = r."id")`, "error"],
  ["발주: 입고 완료 발주는 모든 줄이 다 들어왔거나 잔량 마감, 일부 입고는 받은 줄이 있음",
    `SELECT p."poNo", p."status" FROM "PurchaseOrder" p WHERE p."status" = 'PARTIALLY_RECEIVED' AND NOT EXISTS (SELECT 1 FROM "PurchaseOrderLine" l WHERE l."purchaseOrderId" = p."id" AND l."qtyReceived" > 0)`, "error"],
  ["반품: 반품센터 실재고 = 도착했지만 아직 검수하지 않은 반품 수량 (SKU별)",
    `SELECT b."skuId", b."onHand", COALESCE(x.q, 0) AS pending FROM "InventoryBalance" b JOIN "InventoryLocation" loc ON loc."id" = b."locationId" AND loc."type" = 'RETURN_CENTER'
     LEFT JOIN (SELECT i."skuId", SUM(ri."qty") AS q FROM "ReturnItem" ri JOIN "OrderItem" i ON i."id" = ri."orderItemId" JOIN "ReturnRequest" rr ON rr."id" = ri."returnRequestId"
                WHERE rr."status" = 'RECEIVED' AND ri."inspection" IS NULL GROUP BY i."skuId") x ON x."skuId" = b."skuId"
     WHERE b."onHand" <> COALESCE(x.q, 0)`, "error"],
  ["반품: 검수 통과 상품은 반품 완료, 반품 불가는 다시 배송 완료(또는 구매확정)",
    `SELECT ri."id", ri."inspection", i."status" FROM "ReturnItem" ri JOIN "OrderItem" i ON i."id" = ri."orderItemId"
     WHERE (ri."inspection" IN ('RESELLABLE', 'DEFECTIVE') AND i."status" <> 'RETURNED') OR (ri."inspection" = 'NOT_RETURNABLE' AND i."status" NOT IN ('DELIVERED', 'CONFIRMED'))`, "error"],
  ["반품: 완료된 반품의 환불액 = 연결된 결제 취소 금액",
    `SELECT rr."returnNo", rr."refundAmount", c."cancelAmount" FROM "ReturnRequest" rr LEFT JOIN "PaymentCancel" c ON c."id" = rr."paymentCancelId"
     WHERE rr."status" = 'COMPLETED' AND rr."refundAmount" > 0 AND (c."id" IS NULL OR c."status" <> 'DONE' OR c."cancelAmount" <> rr."refundAmount")`, "error"],
  ["반품: 검수 끝나고 환불이 1시간 넘게 끝나지 않은 반품 없음 → npm run inventory:jobs -- return-refunds",
    `SELECT "returnNo" FROM "ReturnRequest" WHERE "status" = 'INSPECTED' AND julianday(${NOW}) - julianday("inspectedAt") > 1.0 / 24`, "warn"],
  // ----- ⑬ 쿠폰
  ["쿠폰: 정책의 발급 수 = 실제 발급된 쿠폰 수",
    `SELECT p."code", p."issuedCount", (SELECT COUNT(*) FROM "CustomerCoupon" c WHERE c."policyId" = p."id") AS actual FROM "CouponPolicy" p
     WHERE p."issuedCount" <> (SELECT COUNT(*) FROM "CustomerCoupon" c WHERE c."policyId" = p."id")`, "error"],
  ["쿠폰: 고객 쿠폰 상태 = 주문 쿠폰 기록 (사용 중 ⇔ 예약 1건, 사용됨 ⇔ 사용 1건, 나머지는 살아 있는 기록 없음)",
    `SELECT c."couponNo", c."status",
       (SELECT COUNT(*) FROM "OrderCoupon" oc WHERE oc."customerCouponId" = c."id" AND oc."status" = 'RESERVED') AS reserved,
       (SELECT COUNT(*) FROM "OrderCoupon" oc WHERE oc."customerCouponId" = c."id" AND oc."status" = 'APPLIED') AS applied
     FROM "CustomerCoupon" c
     WHERE (c."status" = 'IN_USE') <> ((SELECT COUNT(*) FROM "OrderCoupon" oc WHERE oc."customerCouponId" = c."id" AND oc."status" = 'RESERVED') = 1)
        OR (c."status" = 'USED') <> ((SELECT COUNT(*) FROM "OrderCoupon" oc WHERE oc."customerCouponId" = c."id" AND oc."status" = 'APPLIED') = 1)
        OR (SELECT COUNT(*) FROM "OrderCoupon" oc WHERE oc."customerCouponId" = c."id" AND oc."status" IN ('RESERVED', 'APPLIED')) > 1`, "error"],
  ["쿠폰: 주문 쿠폰 상태 = 주문 상태 (예약 = 결제 전, 사용 = 결제됨, 해제 = 결제 없이 끝남, 취소 = 결제 후 취소)",
    `SELECT o."orderNo", o."status" AS orderStatus, oc."status" AS couponStatus FROM "OrderCoupon" oc JOIN "Order" o ON o."id" = oc."orderId"
     WHERE NOT ((oc."status" = 'RESERVED' AND o."status" IN ('PENDING', 'WAITING_DEPOSIT', 'CANCEL_FAILED'))
             OR (oc."status" = 'APPLIED' AND o."status" IN ('PAID', 'CANCEL_FAILED'))
             OR (oc."status" = 'RELEASED' AND o."status" IN ('CANCELED', 'EXPIRED') AND o."paidAt" IS NULL)
             OR (oc."status" = 'CANCELED' AND o."status" = 'CANCELED'))`, "error"],
  ["쿠폰: 주문당 쿠폰은 1장 이하 (중복 사용 없음)",
    `SELECT o."orderNo", COUNT(*) AS n FROM "OrderCoupon" oc JOIN "Order" o ON o."id" = oc."orderId" GROUP BY oc."orderId" HAVING COUNT(*) > 1`, "error"],
  ["쿠폰: 주문의 쿠폰 할인 = 주문 쿠폰 합계 (상품·장바구니 = 쿠폰 할인, 배송비 = 배송비 할인)",
    `SELECT o."orderNo", o."couponDiscountTotal", o."shippingDiscount" FROM "Order" o
     WHERE o."couponDiscountTotal" <> (SELECT COALESCE(SUM(oc."discountAmount"), 0) FROM "OrderCoupon" oc WHERE oc."orderId" = o."id" AND oc."kind" <> 'SHIPPING')
        OR o."shippingDiscount" <> (SELECT COALESCE(SUM(oc."discountAmount"), 0) FROM "OrderCoupon" oc WHERE oc."orderId" = o."id" AND oc."kind" = 'SHIPPING')`, "error"],
  ["쿠폰: 상품 줄의 쿠폰 할인 = 줄별 배분 합계, 주문 쿠폰 할인액 = 그 쿠폰의 배분 합계",
    `SELECT 'item' AS kind, i."id" FROM "OrderItem" i WHERE i."couponAllocated" <> (SELECT COALESCE(SUM(x."amount"), 0) FROM "OrderItemCoupon" x WHERE x."orderItemId" = i."id")
     UNION ALL
     SELECT 'coupon', oc."id" FROM "OrderCoupon" oc WHERE oc."kind" <> 'SHIPPING' AND oc."discountAmount" <> (SELECT COALESCE(SUM(x."amount"), 0) FROM "OrderItemCoupon" x WHERE x."orderCouponId" = oc."id")`, "error"],
  ["쿠폰: 사용 기간이 지났는데 아직 '사용 가능'으로 표시된 쿠폰 없음 → npm run coupons:jobs -- expire",
    `SELECT "couponNo" FROM "CustomerCoupon" WHERE "status" = 'AVAILABLE' AND "validTo" <= ${NOW}`, "warn"],
  ["반품: 승인 후 3일 넘게 회수가 시작되지 않은 반품 없음 / 도착 후 2일 넘게 검수하지 않은 반품 없음",
    `SELECT "returnNo", "status" FROM "ReturnRequest" WHERE ("status" = 'APPROVED' AND julianday(${NOW}) - julianday("approvedAt") > 3) OR ("status" = 'RECEIVED' AND julianday(${NOW}) - julianday("receivedAt") > 2)`, "warn"],
  ["재입고 알림: 재고가 있는데 아직 대기 중인 신청 없음 → npm run inventory:jobs -- restock",
    `SELECT s."id", s."skuId" FROM "RestockSubscription" s JOIN "InventoryBalance" b ON b."skuId" = s."skuId" JOIN "InventoryLocation" loc ON loc."id" = b."locationId" AND loc."isOnlineSellable" = 1
     WHERE s."status" IN ('WAITING', 'SCHEDULED') AND b."onHand" - b."reserved" - b."safetyStock" > 0`, "warn"],
  ["발주: 입고 예정일이 지났는데 다 들어오지 않은 발주 없음 (입고 지연 → 예정일 변경으로 고객 안내)",
    `SELECT p."poNo", l."lineNo", l."expectedAt" FROM "PurchaseOrderLine" l JOIN "PurchaseOrder" p ON p."id" = l."purchaseOrderId"
     WHERE p."status" IN ('CONFIRMED', 'PARTIALLY_RECEIVED') AND l."qtyReceived" < l."qtyOrdered" AND l."expectedAt" < ${NOW}`, "warn"],
  ["재주문: 재주문 필요 알림이 열려 있음 (발주가 필요한 SKU) → npm run inventory:ops -- alerts",
    `SELECT a."skuId", a."availableAtOpen", a."reorderPoint" FROM "StockAlert" a WHERE a."status" = 'OPEN'`, "warn"],
  ["배송비 규칙: 지금 적용 중인 규칙이 정확히 1개 (없으면 주문 불가)",
    `SELECT count(*) AS n FROM "ShippingPolicy" WHERE "validFrom" <= ${NOW} AND ("validTo" IS NULL OR "validTo" > ${NOW}) HAVING count(*) <> 1`, "error"],
  ["주문: 출고 후 결제가 전액 취소된 주문 없음 (토스 상점관리자에서 취소?) → 상품 회수·반품 확인 필요",
    `SELECT o."orderNo" FROM "Order" o WHERE o."status" = 'PAID'
       AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o."id" AND p."status" IN ('DONE', 'PARTIAL_CANCELED'))`, "warn"],
  ["배송: 상품 준비중 3일 넘은 주문 없음 (출고 지연 → 고객 안내 필요)",
    `SELECT o."orderNo", min(i."preparingAt") AS since FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId"
     WHERE i."status" = 'PREPARING' AND julianday(${NOW}) - julianday(i."preparingAt") > 3 GROUP BY o."id"`, "warn"],
  ["배송: 출고 후 14일 넘게 배송중인 상자 없음 (배송 완료 처리 누락 또는 배송 사고)",
    `SELECT s."id", s."trackingNo", s."shippedAt" FROM "Shipment" s WHERE s."status" = 'SHIPPED' AND julianday(${NOW}) - julianday(s."shippedAt") > 14`, "warn"],
  ["구매확정: 자동 확정 예정일이 지난 배송 완료 상품 없음 → npm run orders:jobs -- auto-confirm",
    `SELECT i."id", i."autoConfirmAt" FROM "OrderItem" i WHERE i."status" = 'DELIVERED' AND i."autoConfirmAt" <= ${NOW}`, "warn"],
  ["개인정보: 5년 지난 주문의 주문자·배송지가 파기됨 → npm run orders:jobs -- purge",
    `SELECT o."orderNo" FROM "Order" o WHERE o."piiPurgedAt" IS NULL AND julianday(${NOW}) - julianday(o."createdAt") > 365 * 5 + 1`, "warn"],
  ["결제: 결과 확인이 필요한 결제 없음 (응답 끊김·2분 넘은 승인 중) → npm run payments:jobs -- reconcile",
    `SELECT "id", "status", "statusChangedAt" FROM "Payment" WHERE "status" = 'UNKNOWN' OR ("status" = 'IN_PROGRESS' AND julianday(${NOW}) - julianday("statusChangedAt") > 2.0 / 1440)`, "warn"],
  ["가상계좌: 입금 기한이 지난 입금 대기 없음 → npm run payments:jobs -- deposits",
    `SELECT p."id", v."dueDate" FROM "Payment" p JOIN "PaymentVirtualAccount" v ON v."paymentId" = p."id" WHERE p."status" = 'WAITING_FOR_DEPOSIT' AND v."dueDate" <= ${NOW}`, "warn"],
  ["결제 취소: 응답을 못 받은 취소 없음 → npm run payments:jobs -- cancels",
    `SELECT "id", "status" FROM "PaymentCancel" WHERE "status" = 'UNKNOWN' OR ("status" = 'REQUESTED' AND julianday(${NOW}) - julianday("requestedAt") > 1.0 / 1440)`, "warn"],
  ["주문: 환불 확인 중(CANCEL_FAILED) 주문 없음 → 결제 취소 실패. 사람이 확인해 환불해야 함",
    `SELECT "id" FROM "Order" WHERE "status" = 'CANCEL_FAILED'`, "warn"],
  ["웹훅: 처리 못 한 웹훅 없음 → npm run payments:jobs -- webhooks (5번 실패한 것은 사람이 확인)",
    `SELECT "id", "eventType", "attempts", "lastError" FROM "PaymentWebhookEvent" WHERE "status" = 'FAILED' OR ("status" = 'RECEIVED' AND julianday(${NOW}) - julianday("receivedAt") > 5.0 / 1440)`, "warn"],
  ["환불 계좌: 환불이 끝난 계좌의 암호문은 파기됨",
    `SELECT a."id" FROM "PaymentRefundAccount" a WHERE a."accountNumberEnc" IS NOT NULL AND EXISTS (SELECT 1 FROM "PaymentCancel" c WHERE c."refundAccountId" = a."id" AND c."status" = 'DONE')`, "warn"],
  ["주문: 1시간 넘게 방치된 결제 대기 주문 없음 → npm run payments:jobs -- stale-orders",
    `SELECT o."id" FROM "Order" o WHERE o."status" = 'PENDING' AND julianday(${NOW}) - julianday(o."createdAt") > 1.0 / 24
       AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o."id" AND p."status" IN ('IN_PROGRESS', 'UNKNOWN'))`, "warn"],
  ["결제 API 기록: 1년 지난 기록 없음 → npm run payments:jobs -- api-logs",
    `SELECT count(*) AS n FROM "PaymentApiLog" WHERE julianday(${NOW}) - julianday("createdAt") > 366 HAVING count(*) > 0`, "warn"],
  ["결제 API 기록: 가려야 할 값(secret·계좌번호 원문)이 남아 있지 않음",
    `SELECT "id" FROM "PaymentApiLog" WHERE ("requestBody" GLOB '*"accountNumber":"[0-9][0-9][0-9][0-9][0-9]*' OR "responseBody" GLOB '*"secret":"[^[]*' OR "responseBody" GLOB '*"accountNumber":"[0-9][0-9][0-9][0-9][0-9]*')`, "error"],
  ["고시 품목군이 카테고리의 기본 품목군과 같음",
    `SELECT s."styleCode" AS code, n."noticeType" AS notice, c."noticeType" AS category FROM "StyleNotice" n JOIN "Style" s ON s."id" = n."styleId" JOIN "Category" c ON c."id" = s."categoryId"
     WHERE c."noticeType" IS NOT NULL AND n."noticeType" <> c."noticeType"`, "warn"],
];

async function checkRules() {
  for (const [label, sql, level] of RULES) {
    const rows = await query(sql);
    if (rows.length === 0) {
      console.log(`  ✅ ${label}`);
      continue;
    }
    const sample = JSON.stringify(rows.slice(0, 3), (_, v) => (typeof v === "bigint" ? Number(v) : v));
    const msg = `[업무 규칙] ${label} — ${rows.length}건 ${sample}`;
    (level === "error" ? errors : warnings).push(msg);
    console.log(`  ${level === "error" ? "❌" : "⚠️"} ${label} (${rows.length}건)`);
  }
}

async function main() {
  console.log("1) 구조 + 기존 데이터");
  await checkStructure();
  console.log("2) 업무 규칙");
  await checkRules();

  console.log("");
  for (const w of warnings) console.log(`⚠️  ${w}`);
  for (const e of errors) console.log(`❌ ${e}`);
  if (errors.length) {
    console.log(`\n실패: 오류 ${errors.length}건, 경고 ${warnings.length}건`);
    process.exitCode = 1;
  } else {
    console.log(`통과: 오류 0건, 경고 ${warnings.length}건`);
  }
}

main().finally(() => prisma.$disconnect());
