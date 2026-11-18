// 재고 운영 명령어 (관리자 화면 대신 — 로드맵 6단계에서 화면으로)
//
// 발주·입고
//   npm run inventory:ops -- po-create <거래처코드> <SKU:수량> [SKU:수량 ...]     발주 작성 (DRAFT)
//   npm run inventory:ops -- po-order <발주번호>                                  거래처에 발주 (날짜 미정)
//   npm run inventory:ops -- po-confirm <발주번호> <YYYY-MM-DD> [SKU=YYYY-MM-DD ...] 입고 날짜 확정 → 재입고 예정 안내
//   npm run inventory:ops -- po-date <발주번호> <SKU> <YYYY-MM-DD>               입고 예정일 변경 → 변경 안내
//   npm run inventory:ops -- po-cancel <발주번호> "<사유>"                         발주 취소 → 일정 취소 안내
//   npm run inventory:ops -- receive <발주번호> <SKU:정상[:불량]> ...              입고 → 재입고 안내
//   npm run inventory:ops -- po-close <발주번호>                                  일부 입고 후 잔량 마감
//   npm run inventory:ops -- po-show <발주번호>
// 재주문
//   npm run inventory:ops -- reorder-set <SKU> <재주문점> <권장수량>
//   npm run inventory:ops -- alerts                                              관리자 알림(재주문 필요 등)
// 반품
//   npm run inventory:ops -- return-show <반품번호>
//   npm run inventory:ops -- return-approve <반품번호> | return-reject <반품번호> "<사유>"
//   npm run inventory:ops -- return-pickup <반품번호> <택배사> <회수송장>
//   npm run inventory:ops -- return-receive <반품번호>                           반품센터 도착 (검수 전 재고)
//   npm run inventory:ops -- return-inspect <반품번호> <순번:RESELLABLE|DEFECTIVE|NOT_RETURNABLE[:메모]> ...  검수 → 재고 이동 → 환불
//   npm run inventory:ops -- return-refund <반품번호>                            환불 다시 시도
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { adminNotifications } from "../src/lib/notification";
import { cancelPurchaseOrder, changeExpectedDate, closePurchaseOrder, confirmPurchaseOrder, createPurchaseOrder, orderPurchaseOrder, PurchasingError, receivePurchaseOrder, setReorderPoint } from "../src/lib/purchasing";
import { approveReturn, inspectReturn, receiveReturn, refundReturn, registerReturnPickup, rejectReturn, ReturnError } from "../src/lib/returns";
import { restockDates } from "../src/lib/restock";
import { formatDate, formatPrice } from "../src/lib/format";
import { RETURN_INSPECTION_LABEL, RETURN_REASON_LABEL, RETURN_STATUS_LABEL } from "../src/lib/order-labels";
import type { ReturnInspection } from "../src/generated/prisma/client";

const BY = `ADMIN:${process.env.USERNAME ?? process.env.USER ?? "cli"}`;

async function showPo(poNo: string) {
  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { poNo }, include: { supplier: true, lines: { include: { sku: true }, orderBy: { lineNo: "asc" } }, events: { orderBy: { id: "asc" } } } });
  console.log(`발주 ${po.poNo}  ${po.supplier.name}  상태=${po.status}`);
  const dates = await restockDates(po.lines.map((l) => l.skuId));
  for (const l of po.lines) console.log(`  ${l.lineNo}. ${l.sku.skuCode} 발주 ${l.qtyOrdered} / 입고 ${l.qtyReceived}  예정일 ${l.expectedAt ? formatDate(l.expectedAt) : "-"}  (상품 화면 재입고 예정: ${dates.get(l.skuId) ? formatDate(dates.get(l.skuId)!) : "없음"})`);
  for (const e of po.events) console.log(`  · ${e.type}${e.toDate ? ` → ${formatDate(e.toDate)}` : ""}${e.memo ? ` (${e.memo})` : ""}`);
}
async function showReturn(returnNo: string) {
  const r = await prisma.returnRequest.findUniqueOrThrow({ where: { returnNo }, include: { items: { include: { orderItem: true } }, order: true } });
  console.log(`반품 ${r.returnNo}  주문 ${r.order.orderNo}  ${RETURN_STATUS_LABEL[r.status]}  사유=${RETURN_REASON_LABEL[r.reason]}(${r.fault === "CUSTOMER" ? "고객" : "판매자"} 사유)`);
  for (const i of r.items) console.log(`  ${i.orderItem.lineNo}. ${i.orderItem.styleName} (${i.orderItem.colorName}/${i.orderItem.sizeName}) ×${i.qty}  상품상태=${i.orderItem.status}  검수=${i.inspection ? RETURN_INSPECTION_LABEL[i.inspection] : "-"}`);
  if (r.refundAmount !== null) console.log(`  반품 배송비 ${formatPrice(r.returnShippingFee)}  환불액 ${formatPrice(r.refundAmount)}`);
}

async function main() {
  const [cmd, ...a] = process.argv.slice(2);
  switch (cmd) {
    case "po-create": {
      const lines = a.slice(1).map((x) => {
        const [skuCode, qty] = x.split(":");
        return { skuCode, qty: Number(qty) };
      });
      const po = await createPurchaseOrder({ supplierCode: a[0], lines, by: BY });
      return showPo(po.poNo);
    }
    case "po-order":
      await orderPurchaseOrder(a[0], BY);
      return showPo(a[0]);
    case "po-confirm": {
      const bySku = Object.fromEntries(a.slice(2).map((x) => x.split("=")));
      await confirmPurchaseOrder(a[0], { all: a[1], bySku }, BY);
      return showPo(a[0]);
    }
    case "po-date":
      await changeExpectedDate(a[0], a[1], a[2], BY);
      return showPo(a[0]);
    case "po-cancel":
      await cancelPurchaseOrder(a[0], a[1] ?? "", BY);
      return showPo(a[0]);
    case "receive": {
      const lines = a.slice(1).map((x) => {
        const [skuCode, good, defect] = x.split(":");
        return { skuCode, good: Number(good), defect: defect ? Number(defect) : 0 };
      });
      console.log(`입고 전표 ${await receivePurchaseOrder(a[0], lines, BY)}`);
      return showPo(a[0]);
    }
    case "po-close":
      await closePurchaseOrder(a[0], BY);
      return showPo(a[0]);
    case "po-show":
      return showPo(a[0]);
    case "reorder-set":
      await setReorderPoint(a[0], Number(a[1]), Number(a[2]));
      return console.log(`재주문점 설정: ${a[0]} ${a[1]}개 이하면 알림 (권장 ${a[2]}개)`);
    case "alerts":
      for (const n of await adminNotifications(30)) console.log(`${n.createdAt.toISOString()} [${n.type}] ${n.title} — ${n.body}`);
      return;
    case "return-show":
      return showReturn(a[0]);
    case "return-approve":
      await approveReturn(a[0]);
      return showReturn(a[0]);
    case "return-reject":
      await rejectReturn(a[0], a[1] ?? "");
      return showReturn(a[0]);
    case "return-pickup":
      await registerReturnPickup(a[0], a[1], a[2]);
      return showReturn(a[0]);
    case "return-receive":
      await receiveReturn(a[0], BY);
      return showReturn(a[0]);
    case "return-inspect": {
      const r = await prisma.returnRequest.findUniqueOrThrow({ where: { returnNo: a[0] }, include: { items: { include: { orderItem: true } } } });
      const results = a.slice(1).map((x) => {
        const [lineNo, inspection, ...memo] = x.split(":");
        const ri = r.items.find((i) => i.orderItem.lineNo === Number(lineNo));
        if (!ri) throw new ReturnError(`이 반품에 없는 순번이에요: ${lineNo}`);
        return { orderItemId: ri.orderItemId, inspection: inspection as ReturnInspection, memo: memo.join(":") || undefined };
      });
      console.log("결과:", JSON.stringify(await inspectReturn(a[0], results, BY)));
      return showReturn(a[0]);
    }
    case "return-refund":
      console.log("결과:", JSON.stringify(await refundReturn(a[0])));
      return showReturn(a[0]);
    default:
      console.log("사용법: scripts/inventory-ops.ts 맨 위 설명을 보세요.");
      process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    if (e instanceof PurchasingError || e instanceof ReturnError) {
      console.error(`처리 불가: ${e.message}`);
      process.exitCode = 1;
    } else throw e;
  })
  .finally(() => prisma.$disconnect());
