// 주문 처리 명령어 (관리자 화면 대신 — 로드맵 6단계에서 화면으로)
//
//   npm run orders:ship -- show <주문번호>                            주문·상품·출고 상태 보기
//   npm run orders:ship -- prepare <주문번호>                         결제 완료 상품 → 상품 준비중 (고객 직접 취소·배송지 변경 막힘)
//   npm run orders:ship -- register <주문번호> <택배사> <송장> [순번,..]  송장 등록 (순번을 주면 그 상품만: 나눠 보내기)
//   npm run orders:ship -- ship <출고id>                              출고 = 상품 배송중 + 재고 차감
//   npm run orders:ship -- deliver <출고id>                           배송 완료 (7일 뒤 자동 구매확정)
//   npm run orders:ship -- cancel-shipment <출고id>                   송장 취소 (출고 전에만)
//   npm run orders:ship -- cancel <주문번호> "<사유>"                  관리자 주문 취소 (출고 전) → 토스 전액 환불
//
// 택배사 코드: CJ, LOTTE, HANJIN, EPOST, LOGEN
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { adminCancelOrder, cancelShipment, deliverShipment, OrderError, prepareOrder, registerShipment, shipShipment } from "../src/lib/order";
import { ITEM_STATUS_LABEL, FULFILLMENT_LABEL } from "../src/lib/order-labels";
import { formatPrice } from "../src/lib/format";

const BY = `ADMIN:${process.env.USERNAME ?? process.env.USER ?? "cli"}`; // 처리자 기록

async function show(orderNo: string) {
  const o = await prisma.order.findUnique({
    where: { orderNo },
    include: { items: { orderBy: { lineNo: "asc" } }, shipments: { include: { courier: true, items: true } }, payments: true },
  });
  if (!o) throw new OrderError(`주문 없음: ${orderNo}`);
  console.log(`주문 ${o.orderNo}  상태=${o.status}  진행=${FULFILLMENT_LABEL[o.fulfillmentStatus]}  결제액=${formatPrice(o.totalPrice)}`);
  for (const i of o.items) console.log(`  ${i.lineNo}. ${i.styleName} (${i.colorName}/${i.sizeName}) ×${i.quantity}  ${ITEM_STATUS_LABEL[i.status]}`);
  for (const s of o.shipments) {
    const lines = s.items.map((si) => o.items.find((i) => i.id === si.orderItemId)?.lineNo).join(",");
    console.log(`  출고#${s.id} ${s.courier.code} ${s.trackingNo} ${s.status} (상품 ${lines})`);
  }
  for (const p of o.payments) console.log(`  결제#${p.id} ${p.status} ${p.method ?? ""} 잔액 ${formatPrice(p.balanceAmount)}`);
}

async function main() {
  const [cmd, a, b, c, d] = process.argv.slice(2);
  switch (cmd) {
    case "show":
      return show(a);
    case "prepare":
      console.log(`상품 준비 시작 ${await prepareOrder(a, BY)}개`);
      return show(a);
    case "register": {
      const lineNos = d ? d.split(",").map(Number) : undefined;
      const s = await registerShipment(a, { courierCode: b, trackingNo: c, lineNos }, BY);
      console.log(`송장 등록: 출고#${s?.id}`);
      return show(a);
    }
    case "ship":
    case "deliver":
    case "cancel-shipment": {
      const id = Number(a);
      const s = cmd === "ship" ? await shipShipment(id) : cmd === "deliver" ? await deliverShipment(id) : await cancelShipment(id);
      const order = await prisma.order.findUniqueOrThrow({ where: { id: s!.orderId } });
      console.log(`출고#${id} → ${s!.status}`);
      return show(order.orderNo);
    }
    case "cancel": {
      const r = await adminCancelOrder(a, b ?? "", BY);
      console.log(`결제 취소 결과: ${r?.status}${r?.message ? ` (${r.message})` : ""}`);
      return show(a);
    }
    default:
      console.log("사용법: npm run orders:ship -- show|prepare|register|ship|deliver|cancel-shipment|cancel ... (scripts/orders-ship.ts 맨 위 설명)");
      process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    if (e instanceof OrderError) {
      console.error(`처리 불가: ${e.message}`);
      process.exitCode = 1;
    } else throw e;
  })
  .finally(() => prisma.$disconnect());
