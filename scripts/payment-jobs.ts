// 결제 정기 작업 (배포 후 크론으로 실행할 예정)
//   npm run payments:jobs -- reconcile   결과를 모르는 결제(응답 끊김·오래된 승인 중)를 토스에 물어 확정 (1~5분마다)
//   npm run payments:jobs -- deposits    입금 기한이 지난 가상계좌 확인 → 만료 + 재고 해제 (10분마다)
//   npm run payments:jobs -- cancels     응답을 못 받은 취소를 같은 멱등키로 다시 요청 (5분마다)
//   npm run payments:jobs -- webhooks    처리 못 한 웹훅 다시 처리 (5분마다)
//   npm run payments:jobs -- stale-orders 결제창을 열지 않고 떠난 1시간 지난 결제 대기 주문 취소 (매시간)
//   npm run payments:jobs -- api-logs    1년 지난 API 기록 삭제 (매일)
//   npm run payments:jobs -- all
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { closeStalePendingOrders, expireOverdueDeposits, purgeOldApiLogs, reconcileOpenPayments, retryOpenCancels, retryWebhooks } from "../src/lib/payment";
import { getTossConfigProblem } from "../src/lib/toss";

const jobs: Record<string, () => Promise<string>> = {
  reconcile: async () => `결제 확인 ${await reconcileOpenPayments()}건`,
  deposits: async () => `입금 기한 만료 ${await expireOverdueDeposits()}건`,
  cancels: async () => `취소 재요청 ${await retryOpenCancels()}건`,
  webhooks: async () => `웹훅 재처리 ${await retryWebhooks()}건`,
  "stale-orders": async () => `방치된 결제 대기 주문 취소 ${await closeStalePendingOrders()}건`,
  "api-logs": async () => `API 기록 삭제 ${await purgeOldApiLogs()}건`,
};

async function main() {
  const name = process.argv[2] ?? "all";
  const selected = name === "all" ? Object.keys(jobs) : [name];
  const config = getTossConfigProblem();
  if (config && selected.some((j) => j !== "api-logs" && j !== "stale-orders")) {
    console.error(`결제 설정 오류: ${config}`);
    process.exitCode = 1;
    return;
  }
  for (const job of selected) {
    if (!jobs[job]) {
      console.error(`알 수 없는 작업: ${job} (가능: ${Object.keys(jobs).join(", ")}, all)`);
      process.exitCode = 1;
      return;
    }
    console.log(`[${job}] ${await jobs[job]()}`);
  }
}

main().finally(() => prisma.$disconnect());
