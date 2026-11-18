// 주문 정기 작업 (배포 후 크론으로 실행할 예정)
//   npm run orders:jobs -- auto-confirm   배송 완료 7일 지난 상품 자동 구매확정 (매시간)
//   npm run orders:jobs -- purge          주문 5년 지난 주문자·배송지 개인정보 파기 (매일)
//   npm run orders:jobs -- all
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { autoConfirmDeliveredItems, purgeExpiredOrderPii } from "../src/lib/order";

const jobs: Record<string, () => Promise<string>> = {
  "auto-confirm": async () => `자동 구매확정 ${await autoConfirmDeliveredItems()}건`,
  purge: async () => `개인정보 파기 ${await purgeExpiredOrderPii()}건`,
};

async function main() {
  const name = process.argv[2] ?? "all";
  for (const job of name === "all" ? Object.keys(jobs) : [name]) {
    if (!jobs[job]) {
      console.error(`알 수 없는 작업: ${job} (가능: ${Object.keys(jobs).join(", ")}, all)`);
      process.exitCode = 1;
      return;
    }
    console.log(`[${job}] ${await jobs[job]()}`);
  }
}

main().finally(() => prisma.$disconnect());
