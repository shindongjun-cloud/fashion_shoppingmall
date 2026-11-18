// 주문 처리 (서버 전용): 결제 이후 주문의 일생
//
//   결제 완료 ─(고객) 취소─▶ 토스 전액 취소 → 할당 해제 → 주문·상품 취소          cancelPaidOrder
//      │       (배송지 변경: 상품 준비 전까지, 배송비가 같은 지역으로)              changeOrderAddress
//      ▼ (관리자) 상품 준비                                                       prepareOrder
//   상품 준비중 ─(관리자) 취소─▶ (송장 취소) → 토스 전액 취소 → 할당 해제          adminCancelOrder
//      ▼ (관리자) 송장 등록 → 출고 = 상품 배송중 + 재고 확정(실재고 감소)          registerShipment / shipShipment
//   배송중 ─(관리자·택배 조회) 배송 완료 → 자동 구매확정 예정일 = +7일            deliverShipment
//      ▼ (고객) 구매확정 버튼 (배송중부터) / (작업) 7일 뒤 자동                     confirmPurchase / autoConfirmDeliveredItems
//   구매확정 (끝: ⑭ 포인트 적립·⑮ 리뷰 기준)
//
// 상태 변경의 "규칙"은 DB 트리거가 최종으로 지킵니다(prisma/db-constraints.ts). 여기서는 미리 확인해 친절한 안내를 하고,
// 트리거가 막은 경우(동시에 일어난 일 등)도 안내 문구로 바꿉니다.
import type { OrderActor, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { guestAddressSnapshot, recipientPhoneHash, type GuestAddressInput } from "@/lib/checkout";
import { isBusyError, isConstraintError, withBusyRetry } from "@/lib/inventory";
import { findZone, itemStatusData, OrderError, ORDER_NO_PATTERN, ownerRef, ownsOrder, piiPurgeCutoff, toOwner, type OwnerArg } from "@/lib/order-rules";
import { cancelWaitingDepositOrder, defaultPaymentDeps, PaymentError, requestPaymentCancel, type PaymentDeps } from "@/lib/payment";

export { OrderError } from "@/lib/order-rules";

/** DB 트리거가 막은 이유 → 고객·관리자에게 보여 줄 문구 */
const CONSTRAINT_MESSAGES: [string, string][] = [
  ["PaymentCancel_customer_preparing", "상품 준비가 시작되어 직접 취소할 수 없어요. 고객센터로 문의해 주세요."],
  ["PaymentCancel_shipped", "이미 출고된 상품이 있어 취소할 수 없어요. 상품을 받은 뒤 반품을 신청해 주세요."],
  ["OrderItem_prepare_guard", "결제 취소가 처리 중이거나 재고가 할당되지 않은 주문이에요."],
  ["OrderItem_order_paid", "결제 완료 상태의 주문만 처리할 수 있어요."],
  ["OrderShippingAddress_locked", "상품 준비가 시작되어 배송지를 바꿀 수 없어요. 고객센터로 문의해 주세요."],
  ["OrderShippingAddress_fee_changed", "배송비가 달라지는 지역(제주·도서산간)으로는 바꿀 수 없어요. 고객센터로 문의해 주세요."],
  ["Shipment_tracking_format", "택배사 송장번호 자릿수가 맞지 않아요."],
  ["Shipment_courierId_trackingNo_key", "이미 등록된 송장번호예요."],
  ["courierId", "이미 등록된 송장번호예요."],
  ["ShipmentItem_one_box", "이미 다른 출고 상자에 담긴 상품이 있어요."],
  ["Shipment_transition", "출고할 수 없는 상태예요. (상품 준비·재고 할당 확인)"],
];
function friendly(e: unknown): never {
  for (const [name, message] of CONSTRAINT_MESSAGES) if (isConstraintError(e, name)) throw new OrderError(message);
  if (isBusyError(e)) throw new OrderError("처리가 몰려 실패했어요. 잠시 후 다시 시도해 주세요.");
  if (e instanceof PaymentError) throw new OrderError(e.message);
  throw e;
}

/** 주인(회원 또는 비회원 출입증)의 주문만. 남의 주문은 "없음"과 똑같이 (존재 여부도 알려 주지 않음) */
async function findCustomerOrder(owner: OwnerArg, orderNo: string) {
  if (!ORDER_NO_PATTERN.test(orderNo)) return null;
  const order = await prisma.order.findUnique({ where: { orderNo }, include: { items: true } });
  return order && ownsOrder(owner, order) ? order : null;
}
async function findOrderByNo(orderNo: string) {
  if (!ORDER_NO_PATTERN.test(orderNo)) throw new OrderError("주문번호 형식이 올바르지 않아요. (예: 20261118-48213907)");
  const order = await prisma.order.findUnique({ where: { orderNo }, include: { items: true, payments: true } });
  if (!order) throw new OrderError(`주문을 찾을 수 없어요: ${orderNo}`);
  return order;
}
/** 결제 취소에 쓸 결제 (완료·부분 취소된 결제 = 돈이 걸린 결제) */
function moneyPayment<P extends { status: string; balanceAmount: number }>(payments: P[]) {
  return payments.find((p) => p.status === "DONE" || p.status === "PARTIAL_CANCELED");
}

// ---------------------------------------------------------------
// 고객: 결제 후 출고 전 취소
// ---------------------------------------------------------------
export type RefundAccountInput = { bankCode: string; accountNumber: string; holderName: string };
export type CustomerCancelCode = "DONE" | "NOT_FOUND" | "NOT_CANCELABLE" | "PREPARING" | "NEED_REFUND_ACCOUNT" | "RESULT_PENDING" | "FAILED";

/**
 * 고객이 직접 주문 취소. 입금 대기는 기존 입금 전 취소, 결제 완료는 모든 상품이 "결제 완료"(준비 전)일 때만.
 * 토스 전액 취소가 끝나면 settleOrder가 할당을 풀고 주문·상품을 취소로 바꿈.
 */
export async function cancelPaidOrder(
  owner: OwnerArg,
  orderNo: string,
  input: { reason: string; refundAccount?: RefundAccountInput },
  deps: PaymentDeps = defaultPaymentDeps,
): Promise<CustomerCancelCode> {
  const order = await findCustomerOrder(owner, orderNo);
  if (!order) return "NOT_FOUND";
  if (order.status === "WAITING_DEPOSIT") {
    const code = await cancelWaitingDepositOrder(owner, order.id, deps);
    return code === "DONE" ? "DONE" : code === "RESULT_PENDING" ? "RESULT_PENDING" : code === "NOT_FOUND" ? "NOT_FOUND" : "FAILED";
  }
  if (order.status !== "PAID") return "NOT_CANCELABLE";
  if (order.items.some((i) => i.status !== "PAID" && i.status !== "CANCELED")) return "PREPARING";
  const payment = moneyPayment(await prisma.payment.findMany({ where: { orderId: order.id } }));
  if (!payment) return "NOT_CANCELABLE";
  if (payment.method === "VIRTUAL_ACCOUNT" && !input.refundAccount) return "NEED_REFUND_ACCOUNT";
  const reason = input.reason.trim().slice(0, 100) || "고객 요청";
  try {
    const r = await requestPaymentCancel(
      payment.id,
      { reasonCode: "CUSTOMER_REQUEST", reasonText: `고객 요청: ${reason}`, requestedBy: "CUSTOMER", requestedByRef: ownerRef(owner), refundAccount: input.refundAccount },
      deps,
    );
    if (r.status === "DONE") return "DONE";
    if (r.status === "UNKNOWN") return "RESULT_PENDING"; // 응답 못 받음 → 정기 작업이 토스에 확인 (그동안 재고 할당 유지)
    return "FAILED";
  } catch (e) {
    if (isConstraintError(e, "PaymentCancel_customer_preparing") || isConstraintError(e, "PaymentCancel_shipped")) return "PREPARING"; // 그 사이 관리자가 준비 시작
    if (e instanceof PaymentError) return "FAILED";
    throw e;
  }
}

// ---------------------------------------------------------------
// 고객: 배송지 변경 (주소록에서 골라 복사)
// ---------------------------------------------------------------
/** 배송지 변경 공통: 준비 전·같은 추가 배송비 지역만, 버전 확인 */
async function applyAddressChange(
  owner: OwnerArg,
  orderNo: string,
  next: { sourceAddressId: number | null; recipientEnc: string; phoneEnc: string; phoneHash: string | null; zipCode: string; address1Enc: string; address2Enc: string | null; deliveryMemoEnc: string | null },
  reason: string,
  now: Date,
) {
  const order = await findCustomerOrder(owner, orderNo);
  if (!order) throw new OrderError("주문을 찾을 수 없어요.");
  if (!["PENDING", "WAITING_DEPOSIT", "PAID"].includes(order.status)) throw new OrderError("취소·만료된 주문의 배송지는 바꿀 수 없어요.");
  if (order.items.some((i) => ["PREPARING", "SHIPPED", "DELIVERED", "CONFIRMED"].includes(i.status))) {
    throw new OrderError("상품 준비가 시작되어 배송지를 바꿀 수 없어요. 고객센터로 문의해 주세요.");
  }
  const current = await prisma.orderShippingAddress.findUnique({ where: { orderId: order.id } });
  if (!current) throw new OrderError("이 주문에는 배송지 기록이 없어요. (배송지 저장 전 주문) 고객센터로 문의해 주세요.");
  const zone = await findZone(prisma, order.shippingPolicyId, next.zipCode);
  if ((zone?.extraFee ?? 0) !== order.shippingExtraFee) {
    throw new OrderError("배송비가 달라지는 지역(제주·도서산간)으로는 바꿀 수 없어요. 고객센터로 문의해 주세요.");
  }
  try {
    await withBusyRetry(() =>
      prisma.orderShippingAddress.update({
        where: { id: current.id, version: current.version }, // 동시에 두 번 바꾸면 한쪽만 (버전 확인)
        data: { ...next, region: zone?.region ?? "NORMAL", version: current.version + 1, changedBy: "CUSTOMER", changeReason: reason, updatedAt: now },
      }),
    );
  } catch (e) {
    if ((e as { code?: string }).code === "P2025") throw new OrderError("다른 곳에서 배송지가 먼저 바뀌었어요. 새로고침해 주세요.");
    friendly(e);
  }
}

/** 회원: 주소록에서 골라 변경 */
export async function changeOrderAddress(owner: OwnerArg, orderNo: string, addressId: number, now = new Date()) {
  const o = toOwner(owner);
  if (o.customerId === undefined) throw new OrderError("주소록은 회원만 쓸 수 있어요.");
  const address = await prisma.customerAddress.findFirst({ where: { id: addressId, customerId: o.customerId } });
  if (!address) throw new OrderError("선택한 배송지를 찾을 수 없어요.");
  await applyAddressChange(
    owner,
    orderNo,
    {
      sourceAddressId: address.id,
      recipientEnc: address.recipientEnc,
      phoneEnc: address.phoneEnc,
      phoneHash: recipientPhoneHash(address.phoneEnc),
      zipCode: address.zipCode,
      address1Enc: address.address1Enc,
      address2Enc: address.address2Enc,
      deliveryMemoEnc: address.deliveryMemoEnc,
    },
    "고객이 주문 상세에서 변경",
    now,
  );
}

/** 비회원(또는 회원): 직접 입력해서 변경 */
export async function changeOrderAddressDirect(owner: OwnerArg, orderNo: string, input: GuestAddressInput, now = new Date()) {
  const snap = guestAddressSnapshot(input);
  if ("error" in snap) throw new OrderError(snap.error);
  await applyAddressChange(owner, orderNo, snap, "고객이 주문 상세에서 직접 입력해 변경", now);
}

// ---------------------------------------------------------------
// 고객: 구매확정 (배송중·배송 완료 상품)
// ---------------------------------------------------------------
export async function confirmPurchase(owner: OwnerArg, orderNo: string, orderItemId: number, now = new Date()) {
  const order = await findCustomerOrder(owner, orderNo);
  const item = order?.items.find((i) => i.id === orderItemId);
  if (!order || !item) throw new OrderError("주문 상품을 찾을 수 없어요.");
  if (item.status === "CONFIRMED") return; // 이미 확정 (두 번 눌러도 같은 결과)
  if (item.status !== "SHIPPED" && item.status !== "DELIVERED") throw new OrderError("배송이 시작된 상품만 구매확정할 수 있어요.");
  try {
    await withBusyRetry(() =>
      prisma.orderItem.update({
        where: { id: item.id, status: item.status },
        data: { ...itemStatusData("CONFIRMED", now, "CUSTOMER", "고객 구매확정"), confirmedAt: now, confirmType: "MANUAL" },
      }),
    );
  } catch (e) {
    if ((e as { code?: string }).code === "P2025") return; // 그 사이 자동 확정됨
    friendly(e);
  }
}

// ---------------------------------------------------------------
// 관리자 (관리자 화면은 로드맵 6단계 — 지금은 scripts/orders-ship.ts 명령어로)
// ---------------------------------------------------------------
/** 상품 준비 시작: 결제 완료 상품 → 상품 준비중 (이때부터 고객 직접 취소·배송지 변경 불가) */
export async function prepareOrder(orderNo: string, by: string, now = new Date()) {
  const order = await findOrderByNo(orderNo);
  if (order.status !== "PAID") throw new OrderError(`결제 완료 주문만 준비할 수 있어요 (현재: ${order.status})`);
  const targets = order.items.filter((i) => i.status === "PAID");
  if (targets.length === 0) throw new OrderError("준비할 상품이 없어요. (이미 준비중이거나 출고됨)");
  try {
    await withBusyRetry(() =>
      prisma.$transaction(async (tx) => {
        for (const i of targets) {
          await tx.orderItem.update({ where: { id: i.id, status: "PAID" }, data: { ...itemStatusData("PREPARING", now, "ADMIN", by), preparingAt: now } });
        }
      }),
    );
  } catch (e) {
    friendly(e);
  }
  return targets.length;
}

/** 송장 등록: 준비중 상품을 출고 상자 1개에 담음 (lineNos를 주면 그 상품만 → 나눠 보내기) */
export async function registerShipment(
  orderNo: string,
  input: { courierCode: string; trackingNo: string; lineNos?: number[]; memo?: string },
  by: string,
  now = new Date(),
) {
  const order = await findOrderByNo(orderNo);
  const courier = await prisma.courier.findUnique({ where: { code: input.courierCode.toUpperCase() } });
  if (!courier || !courier.isActive) throw new OrderError(`사용할 수 없는 택배사예요: ${input.courierCode}`);
  const trackingNo = input.trackingNo.replace(/[\s-]/g, ""); // 하이픈·공백은 빼고 저장
  if (!/^\d+$/.test(trackingNo)) throw new OrderError("송장번호는 숫자만 입력해 주세요.");
  const location = await prisma.inventoryLocation.findFirst({ where: { isOnlineSellable: true, isActive: true }, orderBy: { priority: "asc" } });
  if (!location) throw new OrderError("출고 창고가 없어요.");

  const busy = await prisma.shipmentItem.findMany({ where: { orderItem: { orderId: order.id }, shipment: { type: "OUTBOUND", status: { not: "CANCELED" } } }, select: { orderItemId: true } });
  const boxed = new Set(busy.map((b) => b.orderItemId));
  const targets = order.items.filter((i) => i.status === "PREPARING" && !boxed.has(i.id) && (!input.lineNos || input.lineNos.includes(i.lineNo)));
  if (input.lineNos && targets.length !== input.lineNos.length) throw new OrderError("상품 준비중이 아니거나 이미 상자에 담긴 상품이 있어요.");
  if (targets.length === 0) throw new OrderError("상자에 담을 상품이 없어요. (상품 준비를 먼저 하세요)");
  try {
    return await withBusyRetry(() =>
      prisma.shipment.create({
        data: {
          orderId: order.id,
          locationId: location.id,
          courierId: courier.id,
          trackingNo,
          statusChangedAt: now,
          createdBy: by,
          memo: input.memo?.trim() || null,
          createdAt: now,
          items: { create: targets.map((i) => ({ orderItemId: i.id, qty: i.quantity })) },
        },
      }),
    );
  } catch (e) {
    friendly(e);
  }
}

async function moveShipment(shipmentId: number, to: "SHIPPED" | "DELIVERED" | "CANCELED", now: Date) {
  const s = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!s) throw new OrderError(`출고를 찾을 수 없어요: ${shipmentId}`);
  if (s.status === to) return s; // 이미 처리됨 (두 번 실행해도 같은 결과)
  const time = to === "SHIPPED" ? { shippedAt: now } : to === "DELIVERED" ? { deliveredAt: now } : { canceledAt: now };
  try {
    // 상자 상태를 바꾸면 트리거가 상품 상태·재고 확정(판매 원장)까지 함께 바꿈 (한 번에 성공하거나 전부 취소)
    return await withBusyRetry(() => prisma.shipment.update({ where: { id: s.id, status: s.status }, data: { status: to, statusChangedAt: now, ...time } }));
  } catch (e) {
    if ((e as { code?: string }).code === "P2025") throw new OrderError("다른 곳에서 먼저 처리됐어요. 다시 확인해 주세요.");
    friendly(e);
  }
}
/** 출고 (택배사 인계): 상품 배송중 + 재고 확정 → 실재고 감소 */
export const shipShipment = (shipmentId: number, now = new Date()) => moveShipment(shipmentId, "SHIPPED", now);
/** 배송 완료: 상품 배송 완료 + 자동 구매확정 예정일 */
export const deliverShipment = (shipmentId: number, now = new Date()) => moveShipment(shipmentId, "DELIVERED", now);
/** 송장 취소 (출고 전에만): 상품은 준비중으로 남음 */
export const cancelShipment = (shipmentId: number, now = new Date()) => moveShipment(shipmentId, "CANCELED", now);

/** 관리자 취소 (출고 전 = 결제 완료·준비중): 등록만 된 송장은 취소하고 토스 전액 취소 → 할당 해제 → 주문 취소 */
export async function adminCancelOrder(orderNo: string, reason: string, by: string, deps: PaymentDeps = defaultPaymentDeps) {
  const order = await findOrderByNo(orderNo);
  if (order.status !== "PAID") throw new OrderError(`결제 완료 주문만 취소할 수 있어요 (현재: ${order.status})`);
  if (order.items.some((i) => ["SHIPPED", "DELIVERED", "CONFIRMED"].includes(i.status))) throw new OrderError("출고된 상품이 있어 취소할 수 없어요. (반품으로 처리)");
  const payment = moneyPayment(order.payments);
  if (!payment) throw new OrderError("취소할 결제가 없어요.");
  if (payment.method === "VIRTUAL_ACCOUNT") throw new OrderError("가상계좌 결제는 환불 계좌가 필요해요. 고객에게 계좌를 받아 처리하세요.");
  const ready = await prisma.shipment.findMany({ where: { orderId: order.id, status: "READY" } });
  for (const s of ready) await cancelShipment(s.id, deps.now());
  try {
    const r = await requestPaymentCancel(payment.id, { reasonCode: "ADMIN", reasonText: reason.trim().slice(0, 200) || "관리자 취소", requestedBy: "ADMIN", requestedByRef: by }, deps);
    return r;
  } catch (e) {
    friendly(e);
  }
}

// ---------------------------------------------------------------
// 정기 작업 (배포 후 크론: npm run orders:jobs -- auto-confirm | purge)
// ---------------------------------------------------------------
/** 배송 완료 7일이 지난 상품 자동 구매확정 */
export async function autoConfirmDeliveredItems(now = new Date()) {
  const due = await prisma.orderItem.findMany({ where: { status: "DELIVERED", autoConfirmAt: { lte: now } }, select: { id: true }, take: 1000 });
  let done = 0;
  for (const { id } of due) {
    const r = await withBusyRetry(() =>
      prisma.orderItem.updateMany({
        where: { id, status: "DELIVERED" }, // 그 사이 고객이 확정했으면 건너뜀
        data: { ...itemStatusData("CONFIRMED", now, "SYSTEM", `배송 완료 후 자동 구매확정`), confirmedAt: now, confirmType: "AUTO" },
      }),
    );
    done += r.count;
  }
  return done;
}

/** 주문 5년이 지난 주문자·배송지 개인정보 파기 (주문 기록·금액·상품 스냅샷은 남김) */
export async function purgeExpiredOrderPii(now = new Date()) {
  const cutoff = piiPurgeCutoff(now);
  const orders = await prisma.order.findMany({ where: { createdAt: { lte: cutoff }, piiPurgedAt: null }, select: { id: true }, take: 500 });
  for (const { id } of orders) {
    await withBusyRetry(() =>
      prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.order.update({ where: { id }, data: { ordererNameEnc: null, ordererPhoneEnc: null, ordererPhoneHash: null, ordererEmailEnc: null, piiPurgedAt: now, updatedAt: now } });
        await tx.guestOrderAccess.updateMany({ where: { orderId: id, passwordHash: { not: null } }, data: { passwordHash: null } }); // 비회원 조회도 끝
        await tx.guestOrderSession.updateMany({ where: { orderId: id, revokedAt: null }, data: { revokedAt: now } });
        const a = await tx.orderShippingAddress.findUnique({ where: { orderId: id } });
        if (a && !a.piiPurgedAt) {
          await tx.orderShippingAddress.update({ where: { id: a.id }, data: { recipientEnc: null, phoneEnc: null, phoneHash: null, address1Enc: null, address2Enc: null, deliveryMemoEnc: null, piiPurgedAt: now } });
          await tx.orderShippingAddressHistory.updateMany({ where: { orderShippingAddressId: a.id }, data: { recipientEnc: null, phoneEnc: null, address1Enc: null, address2Enc: null, deliveryMemoEnc: null } });
        }
      }),
    );
  }
  return orders.length;
}

export type { OrderActor };
