// 쿠폰 정기 작업 (배포 후 크론)
//   npm run coupons:jobs -- birthday   생일 월 회원에게 생일 쿠폰 (매일 1번. 같은 해에는 1장만)
//   npm run coupons:jobs -- grade      등급 쿠폰 (매일 1번. 같은 달에는 1장만 → 매달 1일에 발급되고, 달 중간에 등급이 오른 회원도 받음)
//   npm run coupons:jobs -- expire     기간 지난 쿠폰을 "만료"로 표시 (매시간. 표시용: 사용 가능 여부는 항상 기간으로 판단)
//   npm run coupons:jobs -- expiring   만료 7일 전 안내 (매일)
//   npm run coupons:jobs -- all
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { expireCoupons, issueBirthdayCoupons, issueGradeCoupons, notifyExpiringCoupons } from "../src/lib/coupon";

const jobs: Record<string, () => Promise<string>> = {
  birthday: async () => {
    const r = await issueBirthdayCoupons();
    return `생일 쿠폰 발급 ${r.issued}장 (건너뜀 ${r.skipped})`;
  },
  grade: async () => {
    const r = await issueGradeCoupons();
    return `등급 쿠폰 발급 ${r.issued}장 (건너뜀 ${r.skipped})`;
  },
  expire: async () => `만료 처리 ${await expireCoupons()}장`,
  expiring: async () => `만료 임박 안내 ${await notifyExpiringCoupons()}건`,
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
