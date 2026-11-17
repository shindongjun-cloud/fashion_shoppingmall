// DB 제약조건 테스트
// 앱을 거치지 않고 SQL로 직접 잘못된 값을 넣어 봐서 "DB가 마지막 방어선으로 막는지" 확인합니다.
// 모든 쓰기는 트랜잭션 안에서 하고 마지막에 롤백하므로 dev.db 데이터는 바뀌지 않습니다.
// 전제: npm run db:seed 로 샘플 데이터가 들어 있어야 합니다.
// 실행: npm test
import "dotenv/config";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";

class Rollback extends Error {}
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

function errorText(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const extra = e as Error & { meta?: unknown; cause?: unknown };
  return `${e.message} ${JSON.stringify(extra.meta ?? {})} ${extra.cause ? errorText(extra.cause) : ""}`;
}

/** SQL을 실행했을 때 expected(제약 이름 등)를 포함한 오류로 막혀야 함 */
async function rejects(sqls: string | string[], expected: string) {
  let err: unknown = null;
  try {
    await prisma.$transaction(async (tx) => {
      for (const s of [sqls].flat()) await tx.$executeRawUnsafe(s);
      throw new Rollback();
    });
  } catch (e) {
    err = e;
  }
  assert.ok(!(err instanceof Rollback), `막혀야 하는데 통과됨 (기대: ${expected})`);
  assert.ok(errorText(err).includes(expected), `다른 이유로 실패함. 기대: ${expected}\n실제: ${errorText(err)}`);
}

/** 정상 작업은 통과해야 함 (확인 후 롤백) */
async function succeeds(fn: (tx: Tx) => Promise<void>) {
  let err: unknown = null;
  try {
    await prisma.$transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof Rollback, `통과해야 하는데 막힘: ${errorText(err)}`);
}

// seed 데이터에서 테스트에 쓸 id들
const ids: Record<string, number> = {};
const one = async (sql: string) => Number(Object.values((await prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql))[0])[0]);

before(async () => {
  ids.jacket = await one(`SELECT id FROM "Style" WHERE "styleCode" = 'JK26F001'`);
  ids.shirt = await one(`SELECT id FROM "Style" WHERE "styleCode" = 'SH26S002'`);
  ids.jacketBK = await one(`SELECT id FROM "StyleColor" WHERE "code" = 'JK26F001-BK'`);
  ids.shirtWH = await one(`SELECT id FROM "StyleColor" WHERE "code" = 'SH26S002-WH'`);
  ids.size100 = await one(`SELECT z.id FROM "Size" z JOIN "SizeGroup" g ON g.id = z."sizeGroupId" WHERE g.code = 'TOP_KR' AND z.code = '100'`);
  ids.size270 = await one(`SELECT z.id FROM "Size" z JOIN "SizeGroup" g ON g.id = z."sizeGroupId" WHERE g.code = 'SHOES_MM' AND z.code = '270'`);
  ids.shoesGroup = await one(`SELECT id FROM "SizeGroup" WHERE code = 'SHOES_MM'`);
  ids.sku = await one(`SELECT id FROM "Sku" WHERE "skuCode" = 'JK26F001-BK-100'`);
  ids.promo = await one(`SELECT id FROM "PricePromotion" WHERE code = 'SS26_SEASON_OFF'`);
  ids.outer = await one(`SELECT id FROM "Category" WHERE code = 'OUTER'`);
  ids.jacketCat = await one(`SELECT id FROM "Category" WHERE code = 'OUTER_JACKET'`);
  ids.material = await one(`SELECT id FROM "StyleMaterial" ORDER BY id LIMIT 1`);
  ids.sneakers = await one(`SELECT id FROM "Style" WHERE "styleCode" = 'SN26S005'`);
});
after(() => prisma.$disconnect());

const NOW = `'2026-11-17T00:00:00.000+00:00'`;

describe("값 범위 · 형식 (CHECK)", () => {
  // 재고는 Sku에서 InventoryBalance로 옮겨짐. onHand·reserved는 트리거가 먼저 막으므로 safetyStock으로 CHECK 확인
  test("안전재고 음수 금지", () => rejects(`UPDATE "InventoryBalance" SET "safetyStock" = -5 WHERE "skuId" = ${ids.sku}`, "InventoryBalance_qty_ck"));
  test("안전재고에 글자 금지 (SQLite는 INTEGER 칸에 글자도 넣어 줌)", () => rejects(`UPDATE "InventoryBalance" SET "safetyStock" = 'abc' WHERE "skuId" = ${ids.sku}`, "InventoryBalance_qty_ck"));
  test("enum에 없는 값 금지", () => rejects(`UPDATE "Style" SET status = 'HELLO' WHERE id = ${ids.jacket}`, "Style_status_enum_ck"));
  test("Boolean은 0/1만", () => rejects(`UPDATE "Style" SET "isDisplayed" = 2 WHERE id = ${ids.jacket}`, "Style_isDisplayed_bool_ck"));
  // (기존 자켓의 품번을 바꾸면 Style_code_fixed 트리거가 먼저 막으므로, 새 DRAFT 스타일로 확인)
  test("품번 형식", () =>
    rejects(`INSERT INTO "Style" ("styleCode",name,description,gender,"categoryId","sizeGroupId",status,"isDisplayed","createdAt","updatedAt")
             VALUES ('jk-1','테스트','설명','MEN',${ids.jacketCat},(SELECT "sizeGroupId" FROM "Style" WHERE id = ${ids.jacket}),'DRAFT',0,${NOW},${NOW})`, "Style_code_ck"));
  test("컬러칩 #RRGGBB", () => rejects(`UPDATE "Color" SET hex = 'black' WHERE code = 'BK'`, "Color_hex_ck"));
  test("혼용률 1~100%", () => rejects(`UPDATE "StyleMaterial" SET percent = 900 WHERE id = ${ids.material}`, "StyleMaterial_percent_ck"));
  test("고시 정보는 비어 있지 않은 JSON 배열", async () => {
    await rejects(`UPDATE "StyleNotice" SET content = '{}' WHERE "styleId" = ${ids.jacket}`, "StyleNotice_content_ck");
    await rejects(`UPDATE "StyleNotice" SET content = '[]' WHERE "styleId" = ${ids.jacket}`, "StyleNotice_content_ck");
  });
  test("TEXT 블록은 본문 필수", () => rejects(`UPDATE "StyleDetailBlock" SET body = NULL WHERE type = 'TEXT' AND "styleId" = ${ids.jacket}`, "StyleDetailBlock_type_fields_ck"));
  test("정가 0원 금지", () => rejects(`UPDATE "StylePrice" SET "listPrice" = 0 WHERE "styleId" = ${ids.shirt}`, "StylePrice_amount_ck"));
  test("정률 할인 500% 금지 / 100% 금지", async () => {
    await rejects(`UPDATE "PricePromotion" SET "discountValue" = 500 WHERE id = ${ids.promo}`, "PricePromotion_value_ck");
    await rejects(`UPDATE "PricePromotion" SET "discountValue" = 100 WHERE id = ${ids.promo}`, "PricePromotion_value_ck");
  });
  test("행사 종료가 시작보다 빠르면 금지", () => rejects(`UPDATE "PricePromotion" SET "endAt" = '2020-01-01T00:00:00.000+00:00' WHERE id = ${ids.promo}`, "PricePromotion_period_ck"));
  test("날짜 형식이 다르면 금지 (CURRENT_TIMESTAMP 형식 → 비교가 깨짐)", () => rejects(`UPDATE "PricePromotion" SET "startAt" = '2026-11-17 06:06:50' WHERE id = ${ids.promo}`, "PricePromotion_dates_ck"));
  test("끝자리 단위는 1/10/100/1000", () => rejects(`UPDATE "PricePromotion" SET "roundingUnit" = 7 WHERE id = ${ids.promo}`, "PricePromotion_rounding_ck"));
  test("확정(APPROVED) 행사는 승인 시각 필수", () => rejects(`UPDATE "PricePromotion" SET "approvedAt" = NULL WHERE id = ${ids.promo}`, "PricePromotion_approval_ck"));
  test("대상 종류와 채워진 칸 일치 (CATEGORY인데 styleId)", () =>
    rejects(`INSERT INTO "PricePromotionTarget" ("promotionId","targetType","mode","styleId","createdAt") VALUES (${ids.promo},'CATEGORY','INCLUDE',${ids.jacket},${NOW})`, "PricePromotionTarget_shape_ck"));
  test("제외 대상에는 할인값 덮어쓰기 금지", () =>
    rejects(`INSERT INTO "PricePromotionTarget" ("promotionId","targetType","mode","styleId","discountValueOverride","createdAt") VALUES (${ids.promo},'STYLE','EXCLUDE',${ids.jacket},10,${NOW})`, "PricePromotionTarget_override_ck"));
  test("주문 항목: 판매가 = 정가 − 할인", async () => {
    await rejects([
      `INSERT INTO "Customer" (id, "customerNo", status, "gradeId", "joinChannel", "joinedAt", "statusReason", "statusChangedAt", "createdAt", "updatedAt") VALUES (900001, 'C9000000001', 'ACTIVE', (SELECT id FROM "CustomerGrade" WHERE code = 'WELCOME'), 'WEB', ${NOW}, 'SIGNUP', ${NOW}, ${NOW}, ${NOW})`,
      `INSERT INTO "Order" (id, "paymentOrderId", "orderName", "totalPrice", status, "createdAt", "customerId") VALUES (900001, 'order_t', 't', 1000, 'PENDING', ${NOW}, 900001)`,
      `INSERT INTO "OrderItem" ("orderId","skuId",quantity,"listPrice","discountAmount",price,"styleCode","skuCode","styleName","colorName","sizeName") VALUES (900001, ${ids.sku}, 1, 10000, 1000, 5000, 'X','X','X','X','X')`,
    ], "OrderItem_price_math_ck");
  });
  test("주문 항목: 할인이 있으면 행사명 필수", async () => {
    await rejects([
      `INSERT INTO "Customer" (id, "customerNo", status, "gradeId", "joinChannel", "joinedAt", "statusReason", "statusChangedAt", "createdAt", "updatedAt") VALUES (900001, 'C9000000001', 'ACTIVE', (SELECT id FROM "CustomerGrade" WHERE code = 'WELCOME'), 'WEB', ${NOW}, 'SIGNUP', ${NOW}, ${NOW}, ${NOW})`,
      `INSERT INTO "Order" (id, "paymentOrderId", "orderName", "totalPrice", status, "createdAt", "customerId") VALUES (900001, 'order_t', 't', 1000, 'PENDING', ${NOW}, 900001)`,
      `INSERT INTO "OrderItem" ("orderId","skuId",quantity,"listPrice","discountAmount",price,"styleCode","skuCode","styleName","colorName","sizeName") VALUES (900001, ${ids.sku}, 1, 10000, 1000, 9000, 'X','X','X','X','X')`,
    ], "OrderItem_promotion_ck");
  });
});

describe("여러 행·여러 테이블 규칙 (트리거)", () => {
  test("정가 기간 겹침 금지 (현재 정가가 2개가 되는 것도 포함)", () =>
    rejects(`INSERT INTO "StylePrice" ("styleId","listPrice",currency,"validFrom",reason,"createdAt") VALUES (${ids.shirt}, 99000, 'KRW', ${NOW}, 'REPRICE', ${NOW})`, "StylePrice_no_overlap"));
  test("정가 기간을 수정해서 겹치게 만드는 것도 금지", () =>
    rejects(`UPDATE "StylePrice" SET "validTo" = NULL WHERE "styleId" = ${ids.shirt} AND "listPrice" = 75000`, "StylePrice_no_overlap"));
  test("상의 자켓에 신발 사이즈(270) SKU 금지", () =>
    rejects(`INSERT INTO "Sku" ("styleColorId","sizeId","skuCode",status,"createdAt","updatedAt") VALUES (${ids.jacketBK}, ${ids.size270}, 'JK26F001-BK-270', 'ON_SALE', ${NOW}, ${NOW})`, "Sku_size_group"));
  test("SKU를 수정해서 다른 체계의 사이즈로 바꾸는 것도 금지", () =>
    rejects(`UPDATE "Sku" SET "sizeId" = ${ids.size270} WHERE id = ${ids.sku}`, "Sku_size_group"));
  test("실측 사이즈도 스타일의 체계만", () =>
    rejects(`INSERT INTO "SizeMeasurement" ("styleId","sizeId",item,"valueCm") VALUES (${ids.jacket}, ${ids.size270}, 'LENGTH', 10)`, "SizeMeasurement_size_group"));
  test("모델 착용 컬러는 같은 스타일의 컬러만", () =>
    rejects(`INSERT INTO "ModelWear" ("styleId","styleColorId","sizeId","heightCm") VALUES (${ids.jacket}, ${ids.shirtWH}, ${ids.size100}, 180)`, "ModelWear_consistency"));
  test("SKU가 있는 스타일의 사이즈 체계 변경 금지", () =>
    rejects(`UPDATE "Style" SET "sizeGroupId" = ${ids.shoesGroup} WHERE id = ${ids.jacket}`, "Style_size_group_change"));
  test("컬러를 다른 스타일로 옮기기 금지", () =>
    rejects(`UPDATE "StyleColor" SET "styleId" = ${ids.shirt} WHERE id = ${ids.jacketBK}`, "StyleColor_style_fixed"));
  test("정률 행사의 대상별 할인값 150% 금지", () =>
    rejects(`INSERT INTO "PricePromotionTarget" ("promotionId","targetType","mode","categoryId","discountValueOverride","createdAt") VALUES (${ids.promo},'CATEGORY','INCLUDE',${ids.outer},150,${NOW})`, "PricePromotionTarget_rate_override"));
  test("카테고리 path 직접 수정 금지", () =>
    rejects(`UPDATE "Category" SET path = '/999/' WHERE id = ${ids.jacketCat}`, "Category_path_guard"));
  test("카테고리 부모 변경 금지", () =>
    rejects(`UPDATE "Category" SET "parentId" = NULL WHERE id = ${ids.jacketCat}`, "Category_parent_fixed"));
});

describe("코드 일치 (⭐ 보강)", () => {
  test("시즌 코드와 구분 불일치 금지 (26FW인데 SS)", () =>
    rejects(`UPDATE "Season" SET term = 'SS' WHERE code = '26FW'`, "Season_code_term_ck"));
  test("시즌 코드와 연도 불일치 금지 (26FW인데 2027년)", () =>
    rejects(`UPDATE "Season" SET year = 2027 WHERE code = '26FW'`, "Season_code_term_ck"));
  test("컬러 품번은 스타일코드-컬러코드 (자켓에 SH26S002-NV 금지)", () =>
    rejects(`INSERT INTO "StyleColor" ("styleId","colorId",code,status,"isDisplayed","sortOrder") VALUES (${ids.jacket}, (SELECT id FROM "Color" WHERE code = 'NV'), 'SH26S002-NV', 'ON_SALE', 1, 9)`, "StyleColor_code_match"));
  test("컬러 품번을 다른 컬러 코드로 수정 금지", () =>
    rejects(`UPDATE "StyleColor" SET code = 'JK26F001-NV' WHERE id = ${ids.jacketBK}`, "StyleColor_code_match"));
  test("SKU 코드는 컬러품번-사이즈코드 (JK26F001-BK-999 금지)", () =>
    rejects(`UPDATE "Sku" SET "skuCode" = 'JK26F001-BK-999' WHERE id = ${ids.sku}`, "Sku_code_match"));
  test("컬러가 있는 스타일의 품번 변경 금지", () =>
    rejects(`UPDATE "Style" SET "styleCode" = 'JK26F009' WHERE id = ${ids.jacket}`, "Style_code_fixed"));
  test("상품에 쓰인 컬러 코드 변경 금지", () =>
    rejects(`UPDATE "Color" SET code = 'BL' WHERE code = 'BK'`, "Color_code_fixed"));
  test("SKU에 쓰인 사이즈 코드 변경 금지", () =>
    rejects(`UPDATE "Size" SET code = '101' WHERE id = ${ids.size100}`, "Size_code_fixed"));
  test("올바른 코드로 컬러·SKU 추가는 통과", () =>
    succeeds(async (tx) => {
      await tx.$executeRawUnsafe(`INSERT INTO "StyleColor" ("styleId","colorId",code,status,"isDisplayed","sortOrder") VALUES (${ids.jacket}, (SELECT id FROM "Color" WHERE code = 'NV'), 'JK26F001-NV', 'ON_SALE', 1, 9)`);
      await tx.$executeRawUnsafe(`INSERT INTO "Sku" ("styleColorId","sizeId","skuCode",status,"createdAt","updatedAt") VALUES ((SELECT id FROM "StyleColor" WHERE code = 'JK26F001-NV'), ${ids.size100}, 'JK26F001-NV-100', 'ON_SALE', ${NOW}, ${NOW})`);
    }));
});

describe("판매 시작 검사 (⭐ 보강)", () => {
  // 자켓을 판매 중지(SUSPENDED)한 뒤 필요한 정보를 하나 빼고 다시 판매 시작(ON_SALE)을 시도합니다.
  const suspend = () => `UPDATE "Style" SET status = 'SUSPENDED' WHERE id = ${ids.jacket}`;
  const reopen = () => `UPDATE "Style" SET status = 'ON_SALE' WHERE id = ${ids.jacket}`;

  test("처음부터 ON_SALE로 등록 금지", () =>
    rejects(`INSERT INTO "Style" ("styleCode",name,description,gender,"categoryId","sizeGroupId",status,"isDisplayed","createdAt","updatedAt")
             VALUES ('TS26F999','테스트','설명','MEN',${ids.jacketCat},(SELECT "sizeGroupId" FROM "Style" WHERE id = ${ids.jacket}),'ON_SALE',1,${NOW},${NOW})`, "Style_sale_ready"));
  test("앱(Prisma) 경로로 ON_SALE 등록해도 DB가 막음", async () => {
    let err: unknown = null;
    try {
      await prisma.$transaction(async (tx) => {
        const jacket = await tx.style.findUniqueOrThrow({ where: { id: ids.jacket } });
        await tx.style.create({
          data: { styleCode: "TS26F998", name: "테스트", description: "설명", gender: "MEN", categoryId: jacket.categoryId, sizeGroupId: jacket.sizeGroupId, status: "ON_SALE" },
        });
        throw new Rollback();
      });
    } catch (e) {
      err = e;
    }
    assert.ok(!(err instanceof Rollback), "막혀야 함");
    assert.ok(errorText(err).includes("Style_sale_ready"), errorText(err));
  });
  test("지금 유효한 정가가 없으면 판매 시작 금지", () =>
    rejects([suspend(), `DELETE FROM "StylePrice" WHERE "styleId" = ${ids.jacket} AND "validFrom" <= ${NOW}`, reopen()], "정가"));
  test("고시 정보가 없으면 판매 시작 금지 (법적 의무)", () =>
    rejects([suspend(), `DELETE FROM "StyleNotice" WHERE "styleId" = ${ids.jacket}`, reopen()], "상품정보제공고시"));
  test("판매 중인 컬러가 없으면 판매 시작 금지", () =>
    rejects([suspend(), `UPDATE "StyleColor" SET status = 'SUSPENDED' WHERE "styleId" = ${ids.jacket}`, reopen()], "판매 중인 컬러"));
  test("대표 이미지가 없는 판매 컬러가 있으면 판매 시작 금지", () =>
    rejects([suspend(), `DELETE FROM "StyleColorImage" WHERE "styleColorId" = ${ids.jacketBK} AND type = 'MAIN'`, reopen()], "대표(MAIN) 이미지"));
  test("혼용률 합계가 100%가 아니면 판매 시작 금지 (울 70→60, 합계 90%)", () =>
    rejects([suspend(), `UPDATE "StyleMaterial" SET percent = 60 WHERE "styleId" = ${ids.jacket} AND percent = 70`, reopen()], "혼용률 합계"));
  test("혼용률이 아예 없으면 판매 시작 금지", () =>
    rejects([suspend(), `DELETE FROM "StyleMaterial" WHERE "styleId" = ${ids.jacket}`, reopen()], "혼용률(StyleMaterial)이 없어"));
  test("판매 중인 상품의 고시 정보 삭제 금지", () =>
    rejects(`DELETE FROM "StyleNotice" WHERE "styleId" = ${ids.jacket}`, "StyleNotice_on_sale_delete"));
  test("정보가 다 있으면 판매 중지 → 재개 통과", () =>
    succeeds(async (tx) => {
      await tx.$executeRawUnsafe(suspend());
      await tx.$executeRawUnsafe(reopen());
    }));
  test("판매 중지 상태에서 혼용률을 70/30 → 60/40으로 고친 뒤 재개 통과 (한 줄씩 고쳐도 됨)", () =>
    succeeds(async (tx) => {
      await tx.$executeRawUnsafe(suspend());
      await tx.$executeRawUnsafe(`UPDATE "StyleMaterial" SET percent = 60 WHERE "styleId" = ${ids.jacket} AND percent = 70`);
      await tx.$executeRawUnsafe(`UPDATE "StyleMaterial" SET percent = 40 WHERE "styleId" = ${ids.jacket} AND percent = 30`);
      await tx.$executeRawUnsafe(reopen());
    }));
});

describe("UNIQUE · 외래키 · 삭제 규칙", () => {
  test("대표 컬러(정렬 0번) 중복 금지", () =>
    rejects(`UPDATE "StyleColor" SET "sortOrder" = 0 WHERE "styleId" = ${ids.jacket} AND "sortOrder" = 1`, "UNIQUE constraint failed"));
  // (다른 SKU 코드로 바꾸면 Sku_code_match 트리거가 먼저 막으므로, 코드 규칙은 맞지만 이미 있는 SKU를 한 번 더 넣어 확인)
  test("SKU 중복 금지 (같은 컬러·사이즈)", () =>
    rejects(`INSERT INTO "Sku" ("styleColorId","sizeId","skuCode",status,"createdAt","updatedAt") VALUES (${ids.jacketBK}, ${ids.size100}, 'JK26F001-BK-100', 'ON_SALE', ${NOW}, ${NOW})`, "UNIQUE constraint failed"));
  // (StyleColor에는 트리거가 먼저 걸리므로, 트리거가 없는 혼용률 테이블로 외래키만 확인)
  test("없는 스타일을 가리키는 행 금지 (외래키)", () =>
    rejects(`INSERT INTO "StyleMaterial" ("styleId",part,"materialId",percent,"sortOrder") VALUES (99999, '겉감', (SELECT id FROM "Material" LIMIT 1), 50, 0)`, "FOREIGN KEY constraint failed"));
  test("할인 대상(제외 규칙)이 가리키는 스타일은 삭제 거부 → 제외 규칙이 조용히 사라지지 않음", () =>
    rejects(`DELETE FROM "Style" WHERE id = ${ids.sneakers}`, "FOREIGN KEY constraint failed"));
  test("자식이 있는 카테고리 삭제 거부", () =>
    rejects(`DELETE FROM "Category" WHERE id = ${ids.outer}`, "FOREIGN KEY constraint failed"));
});

describe("정상 작업은 통과해야 함", () => {
  test("하위 카테고리를 만들면 path·depth가 자동 계산됨", () =>
    succeeds(async (tx) => {
      await tx.$executeRawUnsafe(`INSERT INTO "Category" ("parentId", code, name, "createdAt", "updatedAt") VALUES (${ids.jacketCat}, 'OUTER_JACKET_BLAZER', '블레이저', ${NOW}, ${NOW})`);
      const [row] = await tx.$queryRawUnsafe<{ path: string; depth: bigint }[]>(`SELECT path, depth FROM "Category" WHERE code = 'OUTER_JACKET_BLAZER'`);
      const [parent] = await tx.$queryRawUnsafe<{ path: string }[]>(`SELECT path FROM "Category" WHERE id = ${ids.jacketCat}`);
      assert.match(row.path, new RegExp(`^${parent.path}\\d+/$`));
      assert.equal(Number(row.depth), 3);
    }));
  test("정가 변경(현재 행 마감 → 새 행 추가)은 통과", () =>
    succeeds(async (tx) => {
      const at = "2027-03-01T00:00:00.000+00:00";
      await tx.$executeRawUnsafe(`UPDATE "StylePrice" SET "validTo" = '${at}' WHERE "styleId" = ${ids.shirt} AND "validTo" IS NULL`);
      await tx.$executeRawUnsafe(`INSERT INTO "StylePrice" ("styleId","listPrice",currency,"validFrom",reason,"createdAt") VALUES (${ids.shirt}, 85000, 'KRW', '${at}', 'REPRICE', ${NOW})`);
    }));
  test("Prisma로 행사 만들기 (앱 경로)는 통과", () =>
    succeeds(async (tx) => {
      await tx.pricePromotion.create({
        data: {
          code: "TEST_OK", name: "테스트", displayName: "테스트", discountType: "RATE", discountValue: 15,
          startAt: new Date("2026-12-01T00:00:00+09:00"), endAt: new Date("2026-12-10T00:00:00+09:00"),
          status: "APPROVED", approvedAt: new Date(), targets: { create: [{ targetType: "ALL" }] },
        },
      });
    }));
});
