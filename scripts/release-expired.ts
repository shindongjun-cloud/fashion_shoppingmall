// 만료된 재고 예약 일괄 정리:  npm run inventory:release-expired
// 결제창을 띄우고 떠난 주문의 예약은 20분 뒤 만료되지만, 상태를 EXPIRED로 바꿔야 잔고의 예약 수량이 줄어듭니다.
// 평소에는 새 주문·결제 승인 때 해당 SKU만 그때그때 정리하고(lib/inventory.ts),
// 이 스크립트는 전체를 한 번에 정리합니다. 배포 단계에서 Vercel Cron 등으로 주기 실행할 예정입니다.
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { releaseExpired } from "../src/lib/inventory";

async function main() {
  const count = await releaseExpired(prisma, new Date());
  console.log(`만료된 예약 ${count}건을 정리했습니다.`);
}

main().finally(() => prisma.$disconnect());
