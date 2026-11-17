// 테스트용 임시 DB: dev.db를 복사해서 그 복사본에 연결합니다.
// 재고 테스트는 실제로 커밋해야 하는 경우(동시 주문)가 있고, 원장·예약은 삭제할 수 없으므로
// dev.db를 건드리지 않도록 복사본을 씁니다. 반드시 다른 import보다 "먼저" import 하세요.
// (prisma 클라이언트가 만들어지기 전에 DATABASE_URL을 바꿔야 하기 때문)
import "dotenv/config"; // 암호화 키 등 .env 값 (DATABASE_URL은 아래에서 덮어씀)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const source = path.join(__dirname, "..", "..", "dev.db");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "myshop-test-"));
export const TEMP_DB_PATH = path.join(dir, "test.db");
fs.copyFileSync(source, TEMP_DB_PATH);
process.env.DATABASE_URL = `file:${TEMP_DB_PATH.replace(/\\/g, "/")}`;

export function removeTempDb() {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // 윈도우에서 파일이 아직 열려 있으면 실패할 수 있음 (임시 폴더라 무시)
  }
}
