// 반품 (서버 전용): 배송 완료 후 반품 신청 → 승인 → 회수 → 반품센터 도착 → 검수 → 환불
//
// 재고는 "실제 물건 위치"를 따라갑니다:
//   도착        반품센터 +수량 (RETURN_IN, 판매 불가 위치)
//   검수 정상   반품센터 −, 물류센터 + (TRANSFER, 다시 판매 가능 → 품절이었으면 재입고 알림)
//   검수 불량   반품센터 −, 불량 창고 + (TRANSFER, 판매 안 함 — 환불은 함)
//   반품 불가   반품센터 − (RETURN_REJECT_OUT, 고객에게 다시 보냄 — 환불 없음)
// 환불 = 검수 통과 상품 실결제액 − 반품 배송비(고객 사유) [+ 판매자 사유로 남는 상품이 없으면 처음 배송비]
//   반품 배송비 = 편도(기본 배송비 + 제주·도서산간 추가) [+ 무료배송 기준이 이번 반품으로 깨지면 처음 배송비 편도]
// 환불은 토스 부분 취소. 응답이 없거나 실패하면 검수 완료(INSPECTED)로 남고 정기 작업이 다시 시도
import type { OrderActor, Prisma, ReturnInspection, ReturnReason } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureBalance, isConstraintError, recordMovement, withBusyRetry } from "@/lib/inventory";
import { itemStatusData, ORDER_NO_PATTERN, ownsOrder, type OwnerArg } from "@/lib/order-rules";
import { defaultPaymentDeps, PaymentError, refundAccountData, requestPaymentCancel, retryOpenCancels, type PaymentDeps } from "@/lib/payment";
import { notify } from "@/lib/notification";
import { syncRestock } from "@/lib/restock";
import { formatPrice } from "@/lib/format";
import { isCustomerFault, RETURN_INSPECTION_LABEL, RETURN_WINDOW_DAYS } from "@/lib/order-labels";

type Tx = Prisma.TransactionClient;
const DAY = 24 * 60 * 60 * 1000;
export class ReturnError extends Error {}

const ACTIVE_RETURN = ["REQUESTED", "APPROVED", "COLLECTING", "RECEIVED", "INSPECTED"] as const;

async function findReturn(returnNo: string) {
  const r = await prisma.returnRequest.findUnique({ where: { returnNo }, include: { items: { include: { orderItem: true } }, order: true } });
  if (!r) throw new ReturnError(`반품을 찾을 수 없어요: ${returnNo}`);
  return r;
}
/** 반품 진행 알림 (회원만 — 비회원은 주문 조회에서 확인) */
async function tellCustomer(tx: Tx, order: { customerId: number | null; orderNo: string }, returnNo: string, step: string, body: string, now: Date) {
  if (order.customerId === null) return;
  await notify(tx, { customerId: order.customerId, type: "RETURN_UPDATE", title: `반품 ${step}`, body, linkUrl: `/orders/${order.orderNo}`, dedupKey: `return:${returnNo}:${step}` }, now);
}
/** 반품 상품들의 상태를 한 번에 (트리거가 반품 단계와 맞는지 확인) */
async function moveItems(tx: Tx, orderItemIds: number[], status: "RETURN_REQUESTED" | "RETURN_COLLECTING" | "DELIVERED", now: Date, by: OrderActor, memo: string) {
  for (const id of orderItemIds) await tx.orderItem.update({ where: { id }, data: itemStatusData(status, now, by, memo) });
}

// ---------------------------------------------------------------
// 고객: 반품 신청·철회
// ---------------------------------------------------------------
export type ReturnRequestInput = {
  orderItemIds: number[];
  reason: ReturnReason;
  reasonText?: string;
  /** 가상계좌로 결제한 주문은 환불받을 계좌 필수 */
  refundAccount?: { bankCode: string; accountNumber: string; holderName: string };
};

export async function requestReturn(owner: OwnerArg, orderNo: string, input: ReturnRequestInput, now = new Date()) {
  if (!ORDER_NO_PATTERN.test(orderNo)) throw new ReturnError("주문을 찾을 수 없어요.");
  const order = await prisma.order.findUnique({ where: { orderNo }, include: { items: true, payments: true, returns: true } });
  if (!order || !ownsOrder(owner, order)) throw new ReturnError("주문을 찾을 수 없어요.");
  if (order.status !== "PAID") throw new ReturnError("결제 완료된 주문만 반품할 수 있어요.");
  const ids = [...new Set(input.orderItemIds)];
  if (ids.length === 0) throw new ReturnError("반품할 상품을 골라 주세요.");
  if (!["CHANGE_OF_MIND", "SIZE", "DEFECT", "WRONG_ITEM", "DAMAGED"].includes(input.reason)) throw new ReturnError("반품 사유를 골라 주세요.");
  const fault = isCustomerFault(input.reason) ? "CUSTOMER" : "SELLER";
  const windowDays = RETURN_WINDOW_DAYS[fault];
  for (const id of ids) {
    const item = order.items.find((i) => i.id === id);
    if (!item) throw new ReturnError("주문 상품을 찾을 수 없어요.");
    if (item.status === "CONFIRMED") throw new ReturnError(`${item.styleName}: 구매확정한 상품은 반품할 수 없어요.`);
    if (item.status !== "DELIVERED") throw new ReturnError(`${item.styleName}: 배송 완료된 상품만 반품할 수 있어요.`);
    if (now.getTime() - item.deliveredAt!.getTime() > windowDays * DAY) {
      throw new ReturnError(`${item.styleName}: 반품 신청 기간(배송 완료 후 ${windowDays}일)이 지났어요.${fault === "CUSTOMER" ? " 불량·오배송이라면 해당 사유로 신청해 주세요 (30일)." : ""}`);
    }
  }
  const payment = order.payments.find((p) => p.status === "DONE" || p.status === "PARTIAL_CANCELED");
  if (!payment) throw new ReturnError("환불할 결제를 찾을 수 없어요. 고객센터로 문의해 주세요.");
  if (payment.method === "VIRTUAL_ACCOUNT" && !input.refundAccount) throw new ReturnError("가상계좌로 결제한 주문은 환불받을 계좌를 입력해 주세요.");
  const returnNo = `R${order.orderNo}-${order.returns.length + 1}`;
  try {
    return await withBusyRetry(() =>
      prisma.$transaction(async (tx) => {
        const account = input.refundAccount ? await tx.paymentRefundAccount.create({ data: refundAccountData(payment.id, input.refundAccount) }) : null;
        const r = await tx.returnRequest.create({
          data: {
            returnNo,
            orderId: order.id,
            reason: input.reason,
            reasonText: input.reasonText?.trim().slice(0, 500) || null,
            fault,
            requestedBy: "CUSTOMER",
            refundAccountId: account?.id ?? null,
            statusChangedAt: now,
            requestedAt: now,
            createdAt: now,
            items: { create: ids.map((id) => ({ orderItemId: id, qty: order.items.find((i) => i.id === id)!.quantity })) },
          },
        });
        await moveItems(tx, ids, "RETURN_REQUESTED", now, "CUSTOMER", `반품 신청 ${returnNo}`);
        await tellCustomer(tx, order, returnNo, "신청 접수", `반품(${returnNo})을 신청했어요. 확인 후 회수해 드릴게요.`, now);
        return r;
      }),
    );
  } catch (e) {
    if (isConstraintError(e, "ReturnItem_window")) throw new ReturnError("반품 신청 기간이 지났어요.");
    if (isConstraintError(e, "ReturnItem_duplicate")) throw new ReturnError("이미 반품이 진행 중인 상품이 있어요.");
    if (isConstraintError(e, "ReturnItem_status_guard")) throw new ReturnError("배송 완료된 상품만 반품할 수 있어요.");
    throw e;
  }
}

/** 고객 반품 철회 (회수 전까지) */
export async function cancelReturn(owner: OwnerArg, returnNo: string, now = new Date()) {
  const r = await prisma.returnRequest.findUnique({ where: { returnNo }, include: { items: true, order: true } });
  if (!r || !ownsOrder(owner, r.order)) throw new ReturnError("반품을 찾을 수 없어요.");
  if (r.status !== "REQUESTED" && r.status !== "APPROVED") throw new ReturnError("회수가 시작된 반품은 철회할 수 없어요. 고객센터로 문의해 주세요.");
  await withBusyRetry(() =>
    prisma.$transaction(async (tx) => {
      await tx.returnRequest.update({ where: { id: r.id }, data: { status: "CANCELED", closedAt: now, statusChangedAt: now } });
      await moveItems(tx, r.items.map((i) => i.orderItemId), "DELIVERED", now, "CUSTOMER", `반품 철회 ${returnNo}`);
      if (r.refundAccountId) await tx.paymentRefundAccount.update({ where: { id: r.refundAccountId }, data: { accountNumberEnc: null, holderNameEnc: null, wipedAt: now } });
    }),
  );
}

// ---------------------------------------------------------------
// 관리자 (명령어): 승인·거절 → 회수 → 도착 → 검수 → 환불
// ---------------------------------------------------------------
export async function approveReturn(returnNo: string, now = new Date()) {
  const r = await findReturn(returnNo);
  if (r.status !== "REQUESTED") throw new ReturnError(`신청 상태의 반품만 승인할 수 있어요 (현재: ${r.status})`);
  await prisma.$transaction(async (tx) => {
    await tx.returnRequest.update({ where: { id: r.id }, data: { status: "APPROVED", approvedAt: now, statusChangedAt: now } });
    await tellCustomer(tx, r.order, returnNo, "승인", `반품(${returnNo})이 승인되었어요. 택배 기사님이 회수하러 방문할 예정이에요.`, now);
  });
}

export async function rejectReturn(returnNo: string, reason: string, now = new Date()) {
  const r = await findReturn(returnNo);
  if (r.status !== "REQUESTED" && r.status !== "APPROVED") throw new ReturnError(`회수 전 반품만 거절할 수 있어요 (현재: ${r.status})`);
  await prisma.$transaction(async (tx) => {
    await tx.returnRequest.update({ where: { id: r.id }, data: { status: "REJECTED", closedAt: now, statusChangedAt: now, memo: reason.slice(0, 500) || null } });
    await moveItems(tx, r.items.map((i) => i.orderItemId), "DELIVERED", now, "ADMIN", `반품 거절 ${returnNo}`);
    if (r.refundAccountId) await tx.paymentRefundAccount.update({ where: { id: r.refundAccountId }, data: { accountNumberEnc: null, holderNameEnc: null, wipedAt: now } });
    await tellCustomer(tx, r.order, returnNo, "거절", `반품(${returnNo})을 진행할 수 없어요. 사유: ${reason || "고객센터 문의"}`, now);
  });
}

/** 회수 송장 등록 → 회수중 */
export async function registerReturnPickup(returnNo: string, courierCode: string, trackingNo: string, now = new Date()) {
  const r = await findReturn(returnNo);
  if (r.status !== "APPROVED") throw new ReturnError(`승인된 반품만 회수할 수 있어요 (현재: ${r.status})`);
  const courier = await prisma.courier.findUnique({ where: { code: courierCode.toUpperCase() } });
  const no = trackingNo.replace(/[\s-]/g, "");
  if (!courier || !courier.isActive) throw new ReturnError(`사용할 수 없는 택배사예요: ${courierCode}`);
  if (!/^\d+$/.test(no) || no.length < courier.trackingNoMinLength || no.length > courier.trackingNoMaxLength) throw new ReturnError("택배사 송장번호 자릿수가 맞지 않아요.");
  await prisma.$transaction(async (tx) => {
    await tx.returnRequest.update({ where: { id: r.id }, data: { status: "COLLECTING", collectingAt: now, pickupCourierId: courier.id, pickupTrackingNo: no, statusChangedAt: now } });
    await moveItems(tx, r.items.map((i) => i.orderItemId), "RETURN_COLLECTING", now, "ADMIN", `회수 ${courier.name} ${no}`);
    await tellCustomer(tx, r.order, returnNo, "회수 시작", `${courier.name} ${no}로 회수가 시작됐어요.`, now);
  });
}

/** 반품센터 도착 → 반품센터 재고 + (판매 불가, 검수 전) */
export async function receiveReturn(returnNo: string, by: string, now = new Date()) {
  const r = await findReturn(returnNo);
  if (r.status !== "COLLECTING") throw new ReturnError(`회수중인 반품만 도착 처리할 수 있어요 (현재: ${r.status})`);
  const rc = await prisma.inventoryLocation.findFirst({ where: { type: "RETURN_CENTER", isActive: true } });
  if (!rc) throw new ReturnError("반품센터 위치가 없어요.");
  await withBusyRetry(() =>
    prisma.$transaction(async (tx) => {
      await tx.returnRequest.update({ where: { id: r.id }, data: { status: "RECEIVED", receivedAt: now, statusChangedAt: now } });
      for (const ri of r.items) {
        await ensureBalance(tx, ri.orderItem.skuId, rc.id);
        await recordMovement(tx, { skuId: ri.orderItem.skuId, locationId: rc.id, type: "RETURN_IN", qty: ri.qty, refType: "RETURN", refId: returnNo, returnItemId: ri.id, createdBy: by, occurredAt: now, memo: "반품 도착 (검수 전)" });
      }
      await tellCustomer(tx, r.order, returnNo, "도착", `반품 상품이 반품센터에 도착했어요. 검수 후 환불해 드릴게요.`, now);
    }),
  );
}

/** 반품 배송비·환불액 계산 (검수 결과가 정해진 뒤) */
export async function computeReturnRefund(
  tx: Tx | typeof prisma,
  r: { id: number; fault: "CUSTOMER" | "SELLER"; orderId: number },
  accepted: { orderItemId: number; payAmount: number }[],
) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: r.orderId }, include: { items: true, shippingPolicy: true } });
  const acceptedIds = new Set(accepted.map((a) => a.orderItemId));
  const itemsRefund = accepted.reduce((n, a) => n + a.payAmount, 0);
  if (accepted.length === 0) return { fee: 0, refund: 0 };
  // 이번 반품 전·후에 고객이 가지고 있는 상품 (취소·이전 반품 완료 제외)
  // ⚠️ 이번 반품 상품은 검수에서 이미 "반품 완료"로 바뀌었을 수 있으므로 "반품 전"에는 넣어서 셈 (빼면 무료배송 기준 깨짐을 놓침)
  const keptBefore = order.items.filter((i) => i.status !== "CANCELED" && (i.status !== "RETURNED" || acceptedIds.has(i.id)));
  const keptAfter = keptBefore.filter((i) => !acceptedIds.has(i.id));
  const totalOf = (xs: typeof keptBefore) => xs.reduce((n, i) => n + i.lineTotal, 0);
  const oneWay = order.shippingPolicy.baseFee;
  if (r.fault === "CUSTOMER") {
    const returnLeg = oneWay + order.shippingExtraFee;
    const threshold = order.freeShippingThreshold;
    // 무료배송으로 받았는데 이번 반품으로 남은 금액이 무료 기준 아래로 → 처음 배송비(편도)도 고객 부담
    const brokeFree = order.shippingBaseFee === 0 && threshold !== null && totalOf(keptBefore) >= threshold && totalOf(keptAfter) < threshold;
    const fee = returnLeg + (brokeFree ? oneWay : 0);
    return { fee, refund: Math.max(0, itemsRefund - fee) };
  }
  // 판매자 사유: 반품 배송비 없음. 남는 상품이 없으면 처음 낸 배송비도 돌려줌
  return { fee: 0, refund: itemsRefund + (keptAfter.length === 0 ? order.shippingFee - order.shippingDiscount : 0) };
}

/**
 * 검수: 상품마다 정상·불량·반품 불가 → 재고 이동 + 상품 상태 + 환불액 확정 (한 트랜잭션)
 * 그다음 환불 시도 (refundReturn)
 */
export async function inspectReturn(
  returnNo: string,
  results: { orderItemId: number; inspection: ReturnInspection; memo?: string }[],
  by: string,
  deps: PaymentDeps = defaultPaymentDeps,
) {
  const now = deps.now();
  const r = await findReturn(returnNo);
  if (r.status !== "RECEIVED") throw new ReturnError(`반품센터에 도착한 반품만 검수할 수 있어요 (현재: ${r.status})`);
  for (const ri of r.items) if (!results.some((x) => x.orderItemId === ri.orderItemId)) throw new ReturnError(`검수 결과가 빠진 상품이 있어요: ${ri.orderItem.styleName}`);
  const [rc, dc, defect] = await Promise.all([
    prisma.inventoryLocation.findFirstOrThrow({ where: { type: "RETURN_CENTER", isActive: true } }),
    prisma.inventoryLocation.findFirstOrThrow({ where: { type: "WAREHOUSE", isOnlineSellable: true, isActive: true }, orderBy: { priority: "asc" } }),
    prisma.inventoryLocation.findFirstOrThrow({ where: { type: "DEFECT", isActive: true } }),
  ]);
  const accepted = r.items.filter((ri) => results.find((x) => x.orderItemId === ri.orderItemId)!.inspection !== "NOT_RETURNABLE");
  await withBusyRetry(() =>
    prisma.$transaction(async (tx) => {
      for (const ri of r.items) {
        const res = results.find((x) => x.orderItemId === ri.orderItemId)!;
        const ok = res.inspection !== "NOT_RETURNABLE";
        await tx.returnItem.update({ where: { id: ri.id }, data: { inspection: res.inspection, inspectedAt: now, inspectionMemo: res.memo?.slice(0, 500) || null, refundAmount: ok ? ri.orderItem.payAmount : 0 } });
        const base = { skuId: ri.orderItem.skuId, refType: "RETURN" as const, refId: returnNo, returnItemId: ri.id, createdBy: by, occurredAt: now };
        if (ok) {
          const to = res.inspection === "RESELLABLE" ? dc : defect;
          await ensureBalance(tx, ri.orderItem.skuId, to.id);
          await recordMovement(tx, { ...base, locationId: rc.id, type: "TRANSFER_OUT", qty: -ri.qty, memo: `검수 ${RETURN_INSPECTION_LABEL[res.inspection]}` });
          await recordMovement(tx, { ...base, locationId: to.id, type: "TRANSFER_IN", qty: ri.qty, memo: `검수 ${RETURN_INSPECTION_LABEL[res.inspection]}` });
          await tx.orderItem.update({ where: { id: ri.orderItemId }, data: { ...itemStatusData("RETURNED", now, "ADMIN", `반품 완료 ${returnNo}`), returnedAt: now } });
        } else {
          await recordMovement(tx, { ...base, locationId: rc.id, type: "RETURN_REJECT_OUT", qty: -ri.qty, memo: "반품 불가 — 고객에게 반송" });
          await tx.orderItem.update({ where: { id: ri.orderItemId }, data: itemStatusData("DELIVERED", now, "ADMIN", `반품 불가 ${returnNo}: ${res.memo ?? ""}`.trim()) });
        }
      }
      const { fee, refund } = await computeReturnRefund(tx, r, accepted.map((ri) => ({ orderItemId: ri.orderItemId, payAmount: ri.orderItem.payAmount })));
      await tx.returnRequest.update({ where: { id: r.id }, data: { status: "INSPECTED", inspectedAt: now, returnShippingFee: fee, refundAmount: refund, statusChangedAt: now } });
      if (accepted.length === 0) {
        await tx.returnRequest.update({ where: { id: r.id }, data: { status: "REJECTED", closedAt: now, statusChangedAt: now, memo: "검수 결과 반품 불가 — 상품을 다시 보내 드림" } });
        await tellCustomer(tx, r.order, returnNo, "불가", "검수 결과 반품할 수 없는 상태라 상품을 다시 보내 드려요. 자세한 내용은 고객센터로 문의해 주세요.", now);
      } else {
        await tx.order.update({ where: { id: r.orderId }, data: { returnedAt: now, updatedAt: now } });
      }
    }),
  );
  // 정상으로 돌아온 SKU는 품절이었다면 재입고 알림
  for (const ri of r.items) if (results.find((x) => x.orderItemId === ri.orderItemId)!.inspection === "RESELLABLE") await syncRestock(ri.orderItem.skuId, now);
  if (accepted.length > 0) return refundReturn(returnNo, deps);
  return { status: "REJECTED" as const };
}

/** 환불 (검수 완료 → 토스 부분 취소 → 완료). 응답이 없으면 검수 완료로 남고 정기 작업이 다시 */
export async function refundReturn(returnNo: string, deps: PaymentDeps = defaultPaymentDeps) {
  const now = deps.now();
  const r = await findReturn(returnNo);
  if (r.status !== "INSPECTED") return { status: r.status };
  const complete = async (cancelId: number | null) =>
    prisma.$transaction(async (tx) => {
      await tx.returnRequest.update({ where: { id: r.id }, data: { status: "COMPLETED", completedAt: now, paymentCancelId: cancelId, statusChangedAt: now } });
      await tellCustomer(tx, r.order, returnNo, "환불 완료", `반품(${returnNo}) 환불 ${formatPrice(r.refundAmount ?? 0)}이 완료되었어요.${r.returnShippingFee ? ` (반품 배송비 ${formatPrice(r.returnShippingFee)} 차감)` : ""}`, now);
    });
  if ((r.refundAmount ?? 0) === 0) {
    await complete(null);
    return { status: "COMPLETED" as const };
  }
  // 이미 이 반품으로 끝난 취소가 있으면 (지난번 응답을 못 받은 경우) 그것으로 완료
  const done = await prisma.paymentCancel.findFirst({ where: { requestedByRef: returnNo, status: "DONE" } });
  if (done) {
    await complete(done.id);
    return { status: "COMPLETED" as const };
  }
  if (await prisma.paymentCancel.findFirst({ where: { requestedByRef: returnNo, status: { in: ["REQUESTED", "UNKNOWN"] } } })) return { status: "INSPECTED" as const }; // 결과 확인 중 (payments:jobs -- cancels)
  const payment = await prisma.payment.findFirst({ where: { orderId: r.orderId, status: { in: ["DONE", "PARTIAL_CANCELED"] } } });
  if (!payment) throw new ReturnError("환불할 결제가 없어요. 고객센터 확인이 필요해요.");
  try {
    const c = await requestPaymentCancel(
      payment.id,
      { amount: r.refundAmount!, reasonCode: "CUSTOMER_REQUEST", reasonText: `반품 환불 ${returnNo}`, requestedBy: "SYSTEM", requestedByRef: returnNo, existingRefundAccountId: r.refundAccountId ?? undefined },
      deps,
    );
    if (c.status === "DONE") {
      await complete(c.cancelId!);
      return { status: "COMPLETED" as const };
    }
    return { status: "INSPECTED" as const, refund: c.status, message: c.message };
  } catch (e) {
    if (e instanceof PaymentError) return { status: "INSPECTED" as const, refund: "FAILED" as const, message: e.message };
    throw e;
  }
}

/** 정기 작업: 환불이 끝나지 않은 반품 다시 시도 (응답을 못 받은 결제 취소는 먼저 토스에 확인 — 두 번 환불되지 않게) */
export async function retryReturnRefunds(deps: PaymentDeps = defaultPaymentDeps) {
  const pending = await prisma.returnRequest.findMany({ where: { status: "INSPECTED" }, select: { returnNo: true } });
  if (pending.length > 0) await retryOpenCancels(deps);
  let done = 0;
  for (const { returnNo } of pending) if ((await refundReturn(returnNo, deps)).status === "COMPLETED") done++;
  return done;
}

export { ACTIVE_RETURN };
