import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { decryptOrNull, maskName, maskPhone } from "@/lib/crypto";
import { listAddresses } from "@/lib/customer";
import { formatDate, formatDateTime, formatPrice } from "@/lib/format";
import { findZone, ORDER_NO_PATTERN, ownsOrder, type OrderOwner } from "@/lib/order-rules";
import { CUSTOMER_CANCEL_NOTICE, formatTrackingNo, FULFILLMENT_LABEL, ITEM_STATUS_LABEL, REGION_LABEL, trackingUrl } from "@/lib/order-labels";
import { BANK_OPTIONS, ORDER_STATUS_LABEL } from "@/lib/payment-labels";
import { mainPayment, paymentInclude, toPaymentView } from "@/lib/payment-view";
import { loginPath } from "@/lib/safe-redirect";
import OrderAmounts from "@/components/OrderAmounts";
import PaymentSummary from "@/components/PaymentSummary";

type FormAction = (form: FormData) => Promise<void>;
export type OrderDetailActions = { cancel: FormAction; confirm: FormAction; changeAddress: FormAction; changeAddressDirect: FormAction };

// 주문 상세 (회원 /orders/[주문번호], 비회원 /guest/orders/[주문번호] 공통)
// 상품별 상태·배송조회·구매확정, 금액 구성, 결제 정보, 배송지(준비 전까지 변경), 취소(준비 전까지)
// 주인이 아니면 "없는 주문"과 똑같이 404 (주문번호가 존재하는지도 알려 주지 않음)
export default async function OrderDetailView({
  owner,
  orderNo,
  notice,
  flashId,
  actions,
}: {
  owner: OrderOwner;
  orderNo: string;
  notice?: string | string[];
  flashId?: string | string[];
  actions: OrderDetailActions;
}) {
  const guest = owner.guestOrderId !== undefined;
  if (!ORDER_NO_PATTERN.test(orderNo)) notFound();
  const order = await prisma.order.findUnique({
    where: { orderNo },
    include: {
      items: { orderBy: { lineNo: "asc" }, include: { shipmentItems: { include: { shipment: { include: { courier: true } } } } } },
      payments: { include: paymentInclude },
      shippingAddress: true,
      statusHistory: { orderBy: { id: "asc" } },
    },
  });
  if (!order || !ownsOrder(owner, order)) notFound();

  const payment = mainPayment(order.payments);
  const addr = order.shippingAddress;
  const activeItems = order.items.filter((i) => i.status !== "CANCELED");
  const beforePreparing = order.items.every((i) => i.status === "AWAITING_PAYMENT" || i.status === "PAID" || i.status === "CANCELED");
  const canCancel = (order.status === "PAID" && beforePreparing && activeItems.length > 0) || order.status === "WAITING_DEPOSIT";
  const needsRefundAccount = order.status === "PAID" && payment?.method === "VIRTUAL_ACCOUNT";
  const canChangeAddress = Boolean(addr && !addr.piiPurgedAt) && ["PENDING", "WAITING_DEPOSIT", "PAID"].includes(order.status) && beforePreparing;
  // 회원: 주소록 중 배송비(제주·도서산간 추가 배송비)가 지금 주문과 같은 곳만 고를 수 있음 → 다른 곳은 이유와 함께 비활성
  const addressBook =
    canChangeAddress && owner.customerId !== undefined
      ? await Promise.all(
          (await listAddresses(owner.customerId)).map(async (a) => ({
            ...a,
            sameFee: ((await findZone(prisma, order.shippingPolicyId, a.zipCode))?.extraFee ?? 0) === order.shippingExtraFee,
          })),
        )
      : [];
  const statusText =
    order.status === "PAID" ? FULFILLMENT_LABEL[order.fulfillmentStatus] : order.status === "PENDING" ? "결제 확인 중" : (ORDER_STATUS_LABEL[order.status] ?? order.status);
  const noticeText = typeof notice === "string" ? CUSTOMER_CANCEL_NOTICE[notice] : undefined;
  // 서버 액션이 남긴 오류 문구 (주소가 아니라 쿠키로 받음 — 가짜 문구 링크 방지)
  const flash = (await cookies()).get("order-flash")?.value ?? "";
  const sep = flash.indexOf(":");
  const errorText = typeof flashId === "string" && sep > 0 && flash.slice(0, sep) === flashId ? decodeURIComponent(flash.slice(sep + 1)).slice(0, 200) : undefined;
  const claimHref = loginPath(`/orders/claim?orderNo=${order.orderNo}`);
  const input = "min-w-0 rounded-lg border border-gray-300 px-2 py-2";
  const box = "mt-6 rounded-xl border border-gray-200 bg-white p-4";

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <Link href={guest ? "/guest/orders" : "/orders"} className="text-sm text-gray-500 underline">
        {guest ? "← 비회원 주문 조회" : "← 주문 내역"}
      </Link>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold text-gray-900">주문 상세</h1>
        <span className={order.status === "CANCEL_FAILED" ? "font-bold text-red-600" : "font-medium text-gray-800"}>{statusText}</span>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        주문번호 {order.orderNo} · {formatDateTime(order.createdAt)}
      </p>
      {noticeText && <p className="mt-4 rounded-lg bg-gray-100 p-3 text-sm text-gray-800">{noticeText}</p>}
      {errorText && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorText}</p>}
      {order.status === "CANCEL_FAILED" && (
        <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">주문 처리 중 문제가 생겨 환불을 확인하고 있어요. 확인 후 환불해 드릴게요.</p>
      )}

      {/* 상품별 상태 */}
      <ul className={`${box} divide-y divide-gray-100 p-0`}>
        {order.items.map((item) => {
          const shipment = item.shipmentItems.map((si) => si.shipment).find((s) => s.status !== "CANCELED");
          return (
            <li key={item.id} className="flex gap-3 p-4">
              {item.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg bg-gray-100 object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="text-gray-900">
                    {item.styleName}
                    <span className="text-sm text-gray-500"> ({item.colorName} / {item.sizeName}) × {item.quantity}</span>
                  </p>
                  <span className={`text-sm font-medium ${item.status === "CANCELED" ? "text-gray-400" : "text-blue-700"}`}>{ITEM_STATUS_LABEL[item.status]}</span>
                </div>
                <p className="mt-1 text-sm text-gray-700">
                  {formatPrice(item.lineTotal)}
                  {item.lineDiscountTotal > 0 && (
                    <span className="ml-2 text-xs text-gray-400 line-through">{formatPrice(item.lineListTotal)}</span>
                  )}
                  {item.promotionName && item.lineDiscountTotal > 0 && <span className="ml-2 text-xs text-red-600">{item.promotionName}</span>}
                </p>
                {shipment && shipment.status !== "READY" && (
                  <p className="mt-1 text-sm text-gray-600">
                    {shipment.courier.name} {formatTrackingNo(shipment.trackingNo)}{" "}
                    <a href={trackingUrl(shipment.courier.trackingUrlTemplate, shipment.trackingNo)} target="_blank" rel="noopener noreferrer" className="underline">
                      배송조회
                    </a>
                  </p>
                )}
                {item.status === "DELIVERED" && item.autoConfirmAt && (
                  <p className="mt-1 text-xs text-gray-500">{formatDate(item.autoConfirmAt)}에 자동으로 구매확정돼요.</p>
                )}
                {item.status === "CONFIRMED" && item.confirmedAt && (
                  <p className="mt-1 text-xs text-gray-500">
                    {formatDate(item.confirmedAt)} 구매확정{item.confirmType === "AUTO" ? " (자동)" : ""}
                  </p>
                )}
                {(item.status === "SHIPPED" || item.status === "DELIVERED") && order.status === "PAID" && (
                  <form action={actions.confirm} className="mt-2">
                    <input type="hidden" name="orderNo" value={order.orderNo} />
              <input type="hidden" name="mode" value={guest ? "guest" : "member"} />
                    <input type="hidden" name="orderItemId" value={item.id} />
                    <button className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50">구매확정</button>
                    <span className="ml-2 text-xs text-gray-500">확정하면 반품·교환을 신청할 수 없어요.</span>
                  </form>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* 금액 구성 (주문 당시 값) */}
      <section className={box}>
        <h2 className="mb-2 font-bold text-gray-900">결제 금액</h2>
        <OrderAmounts order={order} totalLabel={order.status === "WAITING_DEPOSIT" ? "입금할 금액" : "결제 금액"} />
        {payment && (
          <div className="mt-3 border-t border-gray-100 pt-3">
            <PaymentSummary view={toPaymentView(payment)} orderStatus={order.status} />
          </div>
        )}
      </section>

      {/* 배송지 (주문 당시 복사본. 주소록을 바꿔도 그대로) */}
      <section className={box}>
        <h2 className="font-bold text-gray-900">배송지</h2>
        {!addr ? (
          <p className="mt-2 text-sm text-gray-500">배송지 기록이 없는 이전 주문이에요.</p>
        ) : addr.piiPurgedAt ? (
          <p className="mt-2 text-sm text-gray-500">보관 기간(5년)이 지나 배송지 정보를 파기했어요.</p>
        ) : (
          <p className="mt-2 text-sm text-gray-700">
            {decryptOrNull(addr.recipientEnc)} · {maskPhone(decryptOrNull(addr.phoneEnc) ?? "")}
            <br />({addr.zipCode}) {decryptOrNull(addr.address1Enc)} {decryptOrNull(addr.address2Enc)}
            {addr.region !== "NORMAL" && <span className="ml-1 text-xs text-amber-700">[{REGION_LABEL[addr.region]}]</span>}
            {addr.deliveryMemoEnc && <span className="block text-xs text-gray-500">메모: {decryptOrNull(addr.deliveryMemoEnc)}</span>}
          </p>
        )}
        {canChangeAddress && !guest && addressBook.length > 0 && (
          <form action={actions.changeAddress} className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 text-sm">
            <input type="hidden" name="orderNo" value={order.orderNo} />
              <input type="hidden" name="mode" value={guest ? "guest" : "member"} />
            <select name="addressId" className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-2" defaultValue={addr?.sourceAddressId ?? undefined}>
              {addressBook.map((a) => (
                <option key={a.id} value={a.id} disabled={!a.sameFee}>
                  [{a.label}] {a.recipient} · ({a.zipCode}) {a.address1}
                  {a.sameFee ? "" : " — 배송비가 달라 선택 불가"}
                </option>
              ))}
            </select>
            <button className="rounded-lg border border-gray-300 px-3 py-2 text-gray-800 hover:bg-gray-50">배송지 변경</button>
            <p className="w-full text-xs text-gray-500">상품 준비가 시작되기 전까지 바꿀 수 있어요. 배송비가 달라지는 지역(제주·도서산간)으로는 바꿀 수 없어요.</p>
          </form>
        )}
        {canChangeAddress && guest && (
          <details className="mt-3 border-t border-gray-100 pt-3 text-sm">
            <summary className="cursor-pointer text-gray-800 underline">배송지 변경</summary>
            <form action={actions.changeAddressDirect} className="mt-2 grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="orderNo" value={order.orderNo} />
              <input type="hidden" name="mode" value={guest ? "guest" : "member"} />
              <input name="recipient" required maxLength={30} placeholder="받는 분" className={input} />
              <input name="phone" required inputMode="tel" placeholder="휴대폰 (010-0000-0000)" className={input} />
              <input name="zipCode" required inputMode="numeric" pattern="[0-9]{5}" maxLength={5} placeholder="우편번호 5자리" className={input} />
              <input name="address1" required maxLength={100} placeholder="주소" className={input} />
              <input name="address2" maxLength={100} placeholder="상세 주소" className={input} />
              <input name="deliveryMemo" maxLength={100} placeholder="배송 메모 (선택)" className={input} />
              <button className="rounded-lg border border-gray-300 px-3 py-2 text-gray-800 hover:bg-gray-50 sm:col-span-2">배송지 변경</button>
              <p className="text-xs text-gray-500 sm:col-span-2">상품 준비가 시작되기 전까지 바꿀 수 있어요. 배송비가 달라지는 지역(제주·도서산간)으로는 바꿀 수 없어요.</p>
            </form>
          </details>
        )}
        {order.ordererNameEnc && (
          <p className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-500">주문자 {maskName(decryptOrNull(order.ordererNameEnc) ?? "")}</p>
        )}
      </section>

      {/* 취소 */}
      {canCancel ? (
        <section className={box}>
          <h2 className="font-bold text-gray-900">주문 취소</h2>
          <form action={actions.cancel} className="mt-2 space-y-2 text-sm">
            <input type="hidden" name="orderNo" value={order.orderNo} />
              <input type="hidden" name="mode" value={guest ? "guest" : "member"} />
            {order.status === "PAID" && (
              <select name="reason" className="w-full rounded-lg border border-gray-300 px-2 py-2" defaultValue="단순 변심">
                <option>단순 변심</option>
                <option>다른 상품으로 다시 주문</option>
                <option>배송이 늦어짐</option>
                <option>기타</option>
              </select>
            )}
            {needsRefundAccount && (
              <div className="grid gap-2 sm:grid-cols-3">
                <select name="bankCode" required className="rounded-lg border border-gray-300 px-2 py-2" defaultValue="">
                  <option value="" disabled>
                    환불 은행
                  </option>
                  {BANK_OPTIONS.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <input name="accountNumber" required inputMode="numeric" placeholder="계좌번호 (숫자만)" className="rounded-lg border border-gray-300 px-2 py-2" />
                <input name="holderName" required placeholder="예금주" maxLength={30} className="rounded-lg border border-gray-300 px-2 py-2" />
              </div>
            )}
            <button className="w-full rounded-lg border border-red-300 py-2 font-medium text-red-700 hover:bg-red-50">
              {order.status === "WAITING_DEPOSIT" ? "입금 전 주문 취소" : `주문 취소 (${formatPrice(payment?.balanceAmount ?? order.totalPrice)} 환불)`}
            </button>
            <p className="text-xs text-gray-500">상품 준비가 시작되면 직접 취소할 수 없어요.</p>
          </form>
        </section>
      ) : (
        order.status === "PAID" &&
        order.items.some((i) => i.status === "PREPARING") && (
          <p className="mt-6 text-sm text-gray-500">상품 준비가 시작되어 직접 취소할 수 없어요. 취소를 원하시면 고객센터로 문의해 주세요.</p>
        )
      )}

      {/* 진행 기록 */}
      <section className={box}>
        <h2 className="font-bold text-gray-900">주문 진행 기록</h2>
        <ol className="mt-2 space-y-1 text-sm text-gray-600">
          {order.statusHistory.map((h) => (
            <li key={h.id}>
              {formatDateTime(h.changedAt)} · {h.toStatus === "PENDING" ? "주문 접수" : (ORDER_STATUS_LABEL[h.toStatus] ?? h.toStatus)}
              {h.memo && <span className="text-gray-400"> ({h.memo})</span>}
            </li>
          ))}
        </ol>
      </section>

      {guest && order.status !== "PENDING" && (
        <section className={box}>
          <h2 className="font-bold text-gray-900">회원이신가요?</h2>
          <p className="mt-1 text-sm text-gray-600">로그인하면 이 주문을 내 계정의 주문 내역으로 가져올 수 있어요. (비회원으로 산 주문이라 쿠폰·포인트 혜택은 소급되지 않아요)</p>
          <Link href={claimHref} className="mt-3 inline-block rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
            로그인하고 내 주문으로 가져오기
          </Link>
        </section>
      )}
    </main>
  );
}
