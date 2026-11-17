// 제약 주입 스크립트 테스트
// - 같은 파일에 여러 번 실행해도 결과가 같아야 함 (예전에 실행할 때마다 트리거 블록이 늘어나는 버그가 있었음)
// - Prisma가 테이블을 다시 만드는 마이그레이션에서, 그 테이블을 "읽는" 다른 테이블의 트리거도 먼저 지워야 함
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { TRIGGERS } from "../prisma/db-constraints";

const root = path.join(__dirname, "..");
const script = path.join(root, "scripts", "inject-constraints.ts");
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");

function inject(file: string) {
  const r = spawnSync(process.execPath, [tsxCli, script, file], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
}
function tmpCopy(content: string) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "inject-")), "migration.sql");
  fs.writeFileSync(file, content);
  return file;
}

test("여러 번 실행해도 결과가 같음 (트리거가 중복으로 쌓이지 않음)", () => {
  const migration = fs.readFileSync(path.join(root, "prisma/migrations/20261117120000_product_price_v2/migration.sql"), "utf8");
  const file = tmpCopy(migration);
  inject(file);
  const once = fs.readFileSync(file, "utf8");
  inject(file);
  inject(file);
  assert.equal(fs.readFileSync(file, "utf8"), once);
  // 같은 트리거가 두 번 들어가지 않음 (예전 버그: 실행할 때마다 블록이 늘어남)
  const names = [...once.matchAll(/CREATE TRIGGER "(\w+)"/g)].map((m) => m[1]);
  assert.ok(names.length > 0);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.every((n) => TRIGGERS.some((t) => t.name === n)));
});

test("Sku를 다시 만드는 마이그레이션: Sku에 붙은 트리거 + Sku를 읽는 다른 테이블 트리거를 먼저 지우고 끝에 다시 만듦", () => {
  // Prisma가 컬럼 기본값을 바꿀 때 만드는 SQL 모양
  const file = tmpCopy(`PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Sku" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "skuCode" TEXT NOT NULL
);
INSERT INTO "new_Sku" ("id", "skuCode") SELECT "id", "skuCode" FROM "Sku";
DROP TABLE "Sku";
ALTER TABLE "new_Sku" RENAME TO "Sku";
PRAGMA foreign_keys=ON;
`);
  inject(file);
  const sql = fs.readFileSync(file, "utf8");
  const dropAt = (name: string) => sql.indexOf(`DROP TRIGGER IF EXISTS "${name}";`);
  const createAt = (name: string) => sql.indexOf(`CREATE TRIGGER "${name}"`);
  const tableDrop = sql.indexOf(`DROP TABLE "Sku"`);

  // Sku 자체의 CHECK가 new_Sku에 들어감
  assert.ok(sql.includes(`CONSTRAINT "Sku_code_ck" CHECK`));
  // Sku를 읽는 Style·Size의 트리거는 테이블을 지우기 "전"에 제거되고, 끝에서 다시 만들어짐
  for (const name of ["Style_size_group_change", "Style_sale_ready_upd", "Size_code_fixed", "Sku_code_match_ins"]) {
    assert.ok(dropAt(name) >= 0 && dropAt(name) < tableDrop, `${name}: 먼저 지워야 함`);
    assert.ok(createAt(name) > tableDrop, `${name}: 끝에서 다시 만들어야 함`);
  }
  // Sku와 상관없는 트리거는 건드리지 않음
  assert.equal(createAt("Category_path_fill"), -1);
});
