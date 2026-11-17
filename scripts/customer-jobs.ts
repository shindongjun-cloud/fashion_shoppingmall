// 고객 정기 작업 (배포 후 크론으로 실행할 예정)
//   npm run customer:jobs -- withdrawals   유예 기간이 지난 탈퇴 신청 처리 (매일)
//   npm run customer:jobs -- dormant       1년 미접속 고객 휴면 전환 (매일)
//   npm run customer:jobs -- grades        등급 재산정 (매월 1일)
//   npm run customer:jobs -- login-history 3개월 지난 로그인 기록 삭제 (매일)
//   npm run customer:jobs -- all
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { markDormantCustomers, processDueWithdrawals, purgeOldLoginHistory, recalculateGrades } from "../src/lib/customer";

const jobs: Record<string, () => Promise<string>> = {
  withdrawals: async () => `탈퇴 처리 ${await processDueWithdrawals()}건`,
  dormant: async () => `휴면 전환 ${await markDormantCustomers()}명`,
  grades: async () => `등급 변경 ${await recalculateGrades()}명`,
  "login-history": async () => `로그인 기록 삭제 ${await purgeOldLoginHistory()}건`,
};

async function main() {
  const name = process.argv[2] ?? "all";
  const selected = name === "all" ? Object.keys(jobs) : [name];
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
