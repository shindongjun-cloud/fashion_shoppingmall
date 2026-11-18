// 재고 정기 작업 (배포 후 크론)
//   npm run inventory:jobs -- low-stock       재주문점 이하 SKU → 재주문 필요 알림, 회복·발주 진행이면 해소 (매시간)
//   npm run inventory:jobs -- restock         재입고 알림 확인(주문 취소로 재고가 풀린 경우 등) + 90일 지난 신청 만료 (매시간)
//   npm run inventory:jobs -- return-refunds  환불이 끝나지 않은 반품 다시 시도 (10분마다)
//   npm run inventory:jobs -- all
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { checkLowStock } from "../src/lib/purchasing";
import { restockJob } from "../src/lib/restock";
import { retryReturnRefunds } from "../src/lib/returns";

const jobs: Record<string, () => Promise<string>> = {
  "low-stock": async () => `재주문 필요 새 알림 ${await checkLowStock()}건`,
  restock: async () => {
    const r = await restockJob();
    return `재입고 알림 ${r.sent}건 · 만료 ${r.expired}건`;
  },
  "return-refunds": async () => `반품 환불 완료 ${await retryReturnRefunds()}건`,
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
