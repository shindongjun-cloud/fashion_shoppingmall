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
import { allChecks, TRIGGERS, validateConstraints } from "../prisma/db-constraints";

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
  ["재고: 예약 수량 = RESERVED 예약 합계",
    `SELECT b."skuId" AS skuId, b."reserved" AS reserved, COALESCE(SUM(r."qty"), 0) AS reservationSum
     FROM "InventoryBalance" b LEFT JOIN "InventoryReservation" r ON r."skuId" = b."skuId" AND r."locationId" = b."locationId" AND r."status" = 'RESERVED'
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
  ["주문: 결제 완료 주문의 수량 = 확정된 예약 수량 (SKU별)",
    `SELECT o."id" AS orderId, i."skuId" AS skuId, i.q AS ordered, COALESCE(c.q, 0) AS confirmed
     FROM "Order" o
     JOIN (SELECT "orderId", "skuId", SUM("quantity") AS q FROM "OrderItem" GROUP BY "orderId", "skuId") i ON i."orderId" = o."id"
     LEFT JOIN (SELECT "orderId", "skuId", SUM("qty") AS q FROM "InventoryReservation" WHERE "status" = 'CONFIRMED' GROUP BY "orderId", "skuId") c
       ON c."orderId" = o."id" AND c."skuId" = i."skuId"
     WHERE o."status" = 'PAID' AND i.q <> COALESCE(c.q, 0)`, "error"],
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
