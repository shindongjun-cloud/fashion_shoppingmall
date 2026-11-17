// 주문 생성 → 결제 승인 흐름 (서버 전용)
// 서버 액션(app/checkout/actions.ts)과 결제 승인 라우트(app/api/payments/confirm)가 이 파일을 씁니다.
// 로그인 확인(auth)은 호출하는 쪽에서 하고, 여기서는 customerId(쇼핑몰 고객)를 받습니다. → 테스트에서 직접 호출할 수 있음
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { getCartSkus } from "@/lib/catalog";
import { findQtyLimitViolation } from "@/lib/cart-rules";
import { confirmOrder, ensureOrderReserved, InsufficientStockError, isBusyError, isConstraintError, releaseOrder, reserveOrder, withBusyRetry } from "@/lib/inventory";
import { cancelPayment, confirmPayment } from "@/lib/toss";

export type PlaceOrderResult =
  | { paymentOrderId: string; orderName: string; amount: number }
  | { error: string };

type CartLine = { skuId: number; quantity: number };

// ---------------------------------------------------------------
// 1) 주문 생성 + 재고 예약 (한 트랜잭션)
// ---------------------------------------------------------------
export async function placeOrder(customerId: number, items: CartLine[], now = new Date()): Promise<PlaceOrderResult> {
  // ⚠️ 브라우저에서 온 값은 사용자가 마음대로 바꿀 수 있으니 전부 검사합니다.
  const valid =
    Array.isArray(items) &&
    items.length > 0 &&
    items.length <= 50 &&
    items.every(
      (item) => Number.isInteger(item.skuId) && Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 99,
    );
  const skuIds = valid ? items.map((item) => item.skuId) : [];
  if (!valid || new Set(skuIds).size !== skuIds.length) {
    return { error: "장바구니 정보가 올바르지 않아요." };
  }

  const skus = await getCartSkus(skuIds);
  if (skus.length !== skuIds.length) {
    return { error: "판매하지 않는 상품이 장바구니에 있어요." };
  }
  const lines = items.map((item) => ({ sku: skus.find((s) => s.id === item.skuId)!, quantity: item.quantity }));

  // 판매 상태·재고 사전 확인 (안내용. 실제로 재고를 지키는 것은 아래 예약 + DB 트리거)
  for (const { sku, quantity } of lines) {
    const label = `${sku.styleName} (${sku.colorName}/${sku.sizeName})`;
    if (!sku.sellable) return { error: `${label}은 판매가 중지됐어요.` };
    if (sku.stock < quantity) return { error: `${label} 재고가 부족해요. (남은 수량 ${sku.stock}개)` };
  }
  const overLimit = findQtyLimitViolation(lines);
  if (overLimit) {
    return { error: `${overLimit.styleName}은 1회 주문 시 ${overLimit.maxQtyPerOrder}개까지 살 수 있어요.` };
  }

  // ⚠️ 금액은 반드시 서버에서, DB에 있는 가격으로 계산합니다. (sku.price = 지금 시각 기준 판매가)
  const amount = lines.reduce((sum, { sku, quantity }) => sum + sku.price * quantity, 0);
  const firstName = lines[0].sku.styleName;
  const orderName = lines.length > 1 ? `${firstName} 외 ${lines.length - 1}건` : firstName;
  const paymentOrderId = `order_${randomUUID()}`;

  try {
    // 동시에 들어온 다른 주문과 DB 잠금이 충돌하면 다시 시도 (다시 하면 상대 예약을 보고 정상 처리 or 재고 부족)
    await withBusyRetry(() => prisma.$transaction(async (tx) => {
      // 같은 고객의 이전 "결제 대기" 주문이 잡고 있던 재고는 풉니다.
      // (결제하기를 여러 번 누르거나 결제창을 닫고 다시 시도하면 주문이 여러 개 생겨 재고를 계속 묶기 때문)
      const previous = await tx.order.findMany({ where: { customerId, status: "PENDING" }, select: { id: true } });
      for (const p of previous) await releaseOrder(tx, p.id, "SUPERSEDED", now);

      const order = await tx.order.create({
        data: {
          paymentOrderId,
          orderName,
          totalPrice: amount,
          customerId,
          items: {
            create: lines.map(({ sku, quantity }) => ({
              skuId: sku.id,
              quantity,
              listPrice: sku.listPrice,
              discountAmount: sku.discountAmount,
              price: sku.price,
              promotionId: sku.promotionId,
              promotionName: sku.promotionName,
              styleCode: sku.styleCode,
              skuCode: sku.skuCode,
              styleName: sku.styleName,
              colorName: sku.colorName,
              sizeName: sku.sizeName,
              imageUrl: sku.imageUrl,
            })),
          },
        },
      });
      // 재고 예약: 하나라도 부족하면 예외 → 트랜잭션 전체 취소 (주문도 안 만들어짐)
      await reserveOrder(tx, order.id, lines.map(({ sku, quantity }) => ({ skuId: sku.id, qty: quantity })), now);
    }));
  } catch (e) {
    if (isConstraintError(e, "Order_customer_active")) {
      return { error: "주문할 수 없는 회원 상태예요. (탈퇴 신청·정지·휴면 회원)" };
    }
    if (isBusyError(e)) {
      return { error: "주문이 몰려 처리하지 못했어요. 잠시 후 다시 시도해 주세요." };
    }
    if (e instanceof InsufficientStockError) {
      const sku = skus.find((s) => s.id === e.skuId)!;
      return { error: `${sku.styleName} (${sku.colorName}/${sku.sizeName}) 재고가 부족해요. 방금 다른 고객이 구매했어요.` };
    }
    throw e;
  }

  return { paymentOrderId, orderName, amount };
}

// ---------------------------------------------------------------
// 2) 결제를 진행하지 않기로 한 주문의 재고 풀기 (가격 변경으로 중단, 결제창 실패)
// ---------------------------------------------------------------
export async function abandonOrder(customerId: number, paymentOrderId: string, reason: "PRICE_CHANGED" | "PAYMENT_FAILED") {
  const order = await prisma.order.findUnique({ where: { paymentOrderId } });
  if (!order || order.customerId !== customerId || order.status !== "PENDING") return false;
  await releaseOrder(prisma, order.id, reason);
  return true;
}

// ---------------------------------------------------------------
// 3) 결제 승인
//    ① 예약 확인(필요하면 다시 잡기) → ② 토스 승인 → ③ 주문 PAID + 예약 확정
//    ③에서 실패하면 돈만 나가고 주문이 없는 상태가 되므로 토스 결제를 취소합니다(보상 처리).
// ---------------------------------------------------------------
export type PaymentDeps = {
  confirmPayment: typeof confirmPayment;
  cancelPayment: typeof cancelPayment;
  /** ③ 단계. 테스트에서 실패를 흉내 낼 수 있도록 바꿔 끼울 수 있게 했습니다. */
  finalize: (orderId: number, paymentKey: string, now: Date) => Promise<void>;
  now: () => Date;
};

async function defaultFinalize(orderId: number, paymentKey: string, now: Date) {
  // 잠금 충돌로 실패하면 결제가 취소(보상)되어 버리므로, 여기서는 꼭 다시 시도합니다.
  await withBusyRetry(() =>
    prisma.$transaction(async (tx) => {
      await confirmOrder(tx, orderId, now); // 예약 확정 → 트리거가 판매 원장 생성, 실재고 감소
      const order = await tx.order.update({ where: { id: orderId }, data: { status: "PAID", paymentKey } });
      await tx.customer.update({ where: { id: order.customerId }, data: { lastOrderAt: now } }); // 휴면·등급 산정 참고
    }),
  );
}

export const defaultPaymentDeps: PaymentDeps = { confirmPayment, cancelPayment, finalize: defaultFinalize, now: () => new Date() };

export type ConfirmResult = { ok: true; orderId: number } | { ok: false; message: string };

export async function confirmOrderPayment(
  input: { customerId: number; paymentOrderId: string; paymentKey: string; amount: number },
  deps: PaymentDeps = defaultPaymentDeps,
): Promise<ConfirmResult> {
  const order = await prisma.order.findUnique({ where: { paymentOrderId: input.paymentOrderId } });
  if (!order || order.customerId !== input.customerId) return { ok: false, message: "주문을 찾을 수 없어요." };
  // 새로고침 등으로 다시 들어온 경우: 이미 완료된 주문 (토스에 다시 승인 요청하지 않음)
  if (order.status === "PAID") return { ok: true, orderId: order.id };
  if (order.status !== "PENDING") return { ok: false, message: "이미 취소된 주문이에요." };
  // ⚠️ 결제된 금액이 서버가 계산한 주문 금액과 같은지 확인 (조작 방지)
  if (input.amount !== order.totalPrice) return { ok: false, message: "결제 금액이 주문 금액과 달라요." };

  // ① 승인 전에 재고 확인: 재고가 없으면 토스에 승인을 요청하지 않음 → 고객 돈이 나가지 않음
  const reserved = await ensureOrderReserved(order.id, deps.now());
  if (!reserved.ok) return { ok: false, message: reserved.message };

  // ② 토스 결제 승인
  const result = await deps.confirmPayment({ paymentKey: input.paymentKey, orderId: input.paymentOrderId, amount: order.totalPrice });
  if (!result.ok) {
    await releaseOrder(prisma, order.id, "PAYMENT_FAILED", deps.now());
    return { ok: false, message: result.message };
  }

  // ③ 주문 완료 + 재고 확정
  try {
    await deps.finalize(order.id, input.paymentKey, deps.now());
    return { ok: true, orderId: order.id };
  } catch (error) {
    // 돈은 나갔는데 주문을 완료하지 못함 → 결제 취소(보상)
    console.error(`[결제 보상] 주문 ${order.id} 완료 처리 실패 → 결제 취소 시도`, error);
    const cancel = await deps.cancelPayment({ paymentKey: input.paymentKey, cancelReason: "주문 처리 오류로 자동 취소" });
    await releaseOrder(prisma, order.id, "COMPENSATED", deps.now());
    await prisma.order.update({
      where: { id: order.id },
      // 취소에도 실패하면 사람이 확인해야 하므로 상태를 따로 남깁니다.
      data: { status: cancel.ok ? "CANCELED" : "CANCEL_FAILED", paymentKey: input.paymentKey },
    });
    if (!cancel.ok) console.error(`[결제 보상 실패] 주문 ${order.id} 결제 취소 실패 — 수동 환불 필요`, cancel);
    return {
      ok: false,
      message: cancel.ok
        ? "주문을 완료하지 못해 결제를 자동으로 취소했어요. 다시 시도해 주세요."
        : "주문 처리 중 문제가 생겼어요. 고객센터에서 확인 후 환불해 드릴게요.",
    };
  }
}
