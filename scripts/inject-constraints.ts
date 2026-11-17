// 마이그레이션 SQL에 DB 제약조건(CHECK·트리거)을 주입합니다.
//
// 사용법:  npm run db:constraints -- prisma/migrations/<이름>/migration.sql
//
// - CREATE TABLE "X" / "new_X"(Prisma가 테이블을 다시 만들 때 쓰는 이름) 안에 CHECK를 끼워 넣습니다.
// - 이 마이그레이션이 만들거나 다시 만든 테이블의 트리거를 파일 끝에 붙입니다.
// - 여러 번 실행해도 결과가 같습니다(이미 들어간 제약은 건너뜀).
//
// 새 마이그레이션 순서: migrate diff로 SQL 생성 → 이 스크립트 → SQL 검토 → migrate deploy → npm run db:verify
import fs from "node:fs";
import path from "node:path";
import { allChecks, TRIGGERS, validateConstraints } from "../prisma/db-constraints";

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error("사용법: npm run db:constraints -- prisma/migrations/<이름>/migration.sql");
  process.exit(1);
}

const schema = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
// 제약 정의가 없는 컬럼·테이블을 가리키면 주입하지 않고 멈춥니다 (SQLite는 이런 실수를 오류 없이 넘어가므로)
const problems = validateConstraints(schema);
if (problems.length > 0) {
  console.error("제약 정의 오류 — prisma/db-constraints.ts를 고친 뒤 다시 실행하세요:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
const checks = allChecks(schema);
let sql = fs.readFileSync(file, "utf8");

const TOP_START = "-- >>> db-constraints: 영향받는 트리거 먼저 제거 (prisma/db-constraints.ts에서 생성, 직접 수정 금지)";
const TOP_END = "-- <<< db-constraints-top";
const BLOCK_START = "-- >>> db-constraints: 트리거 (prisma/db-constraints.ts에서 생성, 직접 수정 금지)";
const BLOCK_END = "-- <<< db-constraints";
// 다시 실행할 때를 대비해 예전에 붙인 블록은 (몇 개든) 전부 지우고 새로 붙입니다.
// ⚠️ 표시 문구에 괄호 같은 정규식 특수문자가 있으므로 반드시 escape 합니다.
//    (escape 하지 않으면 옛 블록을 못 찾아서, 실행할 때마다 트리거 블록이 하나씩 늘어나는 버그가 있었음)
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
sql = sql.replace(new RegExp(`${escapeRe(TOP_START)}[\\s\\S]*?${escapeRe(TOP_END)}\\n*`, "g"), "");
sql = sql.replace(new RegExp(`\\n*${escapeRe(BLOCK_START)}[\\s\\S]*?${escapeRe(BLOCK_END)}\\n?`, "g"), "\n");

// 이 마이그레이션이 만들거나·다시 만들거나·지우거나·고치는 테이블
const touched = new Set<string>();
for (const m of sql.matchAll(/(?:DROP TABLE|ALTER TABLE|CREATE TABLE) "(?:new_)?(\w+)"/g)) touched.add(m[1]);

let added = 0;
sql = sql.replace(/CREATE TABLE "(new_)?(\w+)" \(([\s\S]*?)\n\);/g, (whole, _prefix, table: string, body: string) => {
  const mine = checks.filter((c) => c.table === table && !body.includes(`CONSTRAINT "${c.name}"`));
  if (mine.length === 0) return whole;
  added += mine.length;
  const lines = mine.map((c) => `    CONSTRAINT "${c.name}" CHECK (${c.expr})`).join(",\n");
  return whole.replace(/\n\);$/, `,\n${lines}\n);`);
});

// 영향받는 트리거 = 바뀌는 테이블에 "붙어 있는" 트리거 + 바뀌는 테이블을 "읽는" 다른 테이블의 트리거
// ⚠️ 두 번째가 중요합니다. Prisma가 Sku를 다시 만들 때(DROP Sku → new_Sku를 Sku로 RENAME),
//    Style에 붙은 트리거가 Sku를 읽고 있으면 RENAME 순간 SQLite가 "no such table: main.Sku"로
//    마이그레이션을 중간에 멈춥니다(Sku 테이블이 사라진 채로). 그래서 시작 전에 지우고 끝에 다시 만듭니다.
const tableNames = new Set([...schema.matchAll(/^model\s+(\w+)/gm)].map((m) => m[1]));
const readsTables = (triggerSql: string) =>
  new Set([...triggerSql.matchAll(/"(\w+)"/g)].map((m) => m[1]).filter((n) => tableNames.has(n)));
const triggers = TRIGGERS.filter(
  (t) => touched.has(t.table) || [...readsTables(t.sql)].some((n) => touched.has(n)),
);
if (triggers.length > 0) {
  const top = [TOP_START, ...triggers.map((t) => `DROP TRIGGER IF EXISTS "${t.name}";`), TOP_END].join("\n");
  sql = `${top}\n\n${sql.trimStart()}`;
  const block = [
    BLOCK_START,
    ...triggers.map((t) => `-- ${t.why}\nDROP TRIGGER IF EXISTS "${t.name}";\n${t.sql}`),
    BLOCK_END,
  ].join("\n\n");
  sql = `${sql.trimEnd()}\n\n${block}\n`;
}

// 제약이 없는 테이블도 알려 줍니다 (빠뜨린 것은 아닌지 확인용)
const tablesWithChecks = new Set(checks.map((c) => c.table));
const noChecks = [...touched].filter((t) => !tablesWithChecks.has(t));

fs.writeFileSync(file, sql);
console.log(`주입 완료: ${file}`);
console.log(`- 이 마이그레이션이 만든 테이블: ${[...touched].join(", ") || "(없음)"}`);
console.log(`- CHECK 추가: ${added}개 / 트리거: ${triggers.length}개`);
if (noChecks.length) console.log(`- CHECK 정의가 없는 테이블: ${noChecks.join(", ")}`);
