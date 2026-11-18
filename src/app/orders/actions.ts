"use server";

// 주문 상세 화면의 서버 액션 (회원 /orders/[주문번호], 비회원 /guest/orders/[주문번호] 공통. 실제 처리는 lib/order.ts)
// 주인 확인: mode=member → 로그인한 회원, mode=guest → 비회원 출입증 쿠키 (mode는 "어떤 증명을 볼지"만 고름 — 권한은 서버가 확인)
// 결과: 정해진 안내는 주소의 ?notice=코드, 오류 문구는 1분짜리 쿠키(플래시)로 전달
// ⚠️ 오류 문구를 주소(?error=문구)에 싣지 않음: 누구나 가짜 안내 문구를 넣은 링크를 만들어 보낼 수 있기 때문
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentCustomer } from "@/lib/current-customer";
import { getGuestOrderId } from "@/lib/current-owner";
import { loginPath } from "@/lib/safe-redirect";
import { cancelPaidOrder, changeOrderAddress, changeOrderAddressDirect, confirmPurchase, OrderError } from "@/lib/order";
import { ORDER_NO_PATTERN, type OrderOwner } from "@/lib/order-rules";
import { cancelReturn, requestReturn, ReturnError, type ReturnRequestInput } from "@/lib/returns";

const text = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
};

const FLASH_COOKIE = "order-flash"; // ("use server" 파일은 async 함수만 export 가능 → 상세 화면에도 같은 이름을 씀)
/**
 * 오류 문구를 "이번 이동"에서만 보이도록 저장 (1분).
 * 주소에는 무작위 번호만(?e=번호) 싣고, 쿠키의 번호와 같을 때만 화면에 보여 줌
 * → 나중에 같은 주문 상세를 다시 열어도 지난 오류가 다시 뜨지 않음
 */
async function flashError(back: string, message: string) {
  const id = randomUUID().slice(0, 8);
  (await cookies()).set(FLASH_COOKIE, `${id}:${encodeURIComponent(message.slice(0, 200))}`, { path: back, maxAge: 60, httpOnly: true, sameSite: "lax" });
  return `${back}?e=${id}`;
}

/** 주인 확인 + 주문번호 형식 확인 → 상세 화면 주소 */
async function start(form: FormData): Promise<{ owner: OrderOwner; orderNo: string; back: string }> {
  const orderNo = text(form, "orderNo");
  const guest = text(form, "mode") === "guest";
  if (!ORDER_NO_PATTERN.test(orderNo)) redirect(guest ? "/guest/orders" : "/orders");
  if (guest) {
    const back = `/guest/orders/${orderNo}`;
    const guestOrderId = await getGuestOrderId();
    // 출입증이 없거나 만료 → 다시 조회 (출입증의 주문과 이 주문번호가 다르면 lib/order가 "없음"으로 처리)
    if (guestOrderId === null) redirect(`/guest/orders?orderNo=${orderNo}&expired=1`);
    return { owner: { guestOrderId }, orderNo, back };
  }
  const back = `/orders/${orderNo}`;
  const customer = await getCurrentCustomer();
  if (!customer) redirect(loginPath(back));
  return { owner: { customerId: customer.id }, orderNo, back };
}

/** 고객 주문 취소 (입금 전 가상계좌 / 결제 완료 후 상품 준비 전) */
export async function cancelOrderAction(form: FormData) {
  const { owner, orderNo, back } = await start(form);
  const bankCode = text(form, "bankCode");
  const accountNumber = text(form, "accountNumber").replace(/[\s-]/g, "");
  const holderName = text(form, "holderName");
  if ((bankCode || accountNumber || holderName) && (!bankCode || !/^\d{6,20}$/.test(accountNumber) || !holderName || holderName.length > 30)) {
    redirect(await flashError(back, "환불 계좌(은행·숫자 계좌번호·예금주)를 정확히 입력해 주세요."));
  }
  const code = await cancelPaidOrder(owner, orderNo, {
    reason: text(form, "reason").slice(0, 100),
    refundAccount: bankCode ? { bankCode, accountNumber, holderName } : undefined,
  });
  revalidatePath("/orders");
  redirect(`${back}?notice=${code}`);
}

async function run(form: FormData, okNotice: string, work: (owner: OrderOwner, orderNo: string) => Promise<unknown>) {
  const { owner, orderNo, back } = await start(form);
  let target = `${back}?notice=${okNotice}`;
  try {
    await work(owner, orderNo);
  } catch (e) {
    if (!(e instanceof OrderError) && !(e instanceof ReturnError)) throw e;
    target = await flashError(back, e.message);
  }
  revalidatePath("/orders");
  redirect(target);
}

/** 배송지 변경 (회원: 주소록에서 선택) */
export async function changeAddressAction(form: FormData) {
  await run(form, "ADDRESS_CHANGED", (owner, orderNo) => changeOrderAddress(owner, orderNo, Number(text(form, "addressId"))));
}

/** 배송지 변경 (직접 입력: 비회원) */
export async function changeAddressDirectAction(form: FormData) {
  await run(form, "ADDRESS_CHANGED", (owner, orderNo) =>
    changeOrderAddressDirect(owner, orderNo, {
      recipient: text(form, "recipient"),
      phone: text(form, "phone"),
      zipCode: text(form, "zipCode"),
      address1: text(form, "address1"),
      address2: text(form, "address2"),
      deliveryMemo: text(form, "deliveryMemo"),
    }),
  );
}

/** 구매확정 (상품 줄 하나) */
export async function confirmPurchaseAction(form: FormData) {
  await run(form, "CONFIRMED", (owner, orderNo) => confirmPurchase(owner, orderNo, Number(text(form, "orderItemId"))));
}


/** 반품 신청 (배송 완료 상품, 사유별 기간·배송비는 lib/returns.ts) */
export async function requestReturnAction(form: FormData) {
  await run(form, "RETURN_REQUESTED", (owner, orderNo) => {
    const bankCode = text(form, "bankCode");
    const accountNumber = text(form, "accountNumber").replace(/[\s-]/g, "");
    const holderName = text(form, "holderName");
    if (bankCode && (!/^\d{6,20}$/.test(accountNumber) || !holderName || holderName.length > 30)) throw new ReturnError("환불 계좌(은행·숫자 계좌번호·예금주)를 정확히 입력해 주세요.");
    return requestReturn(owner, orderNo, {
      orderItemIds: form.getAll("orderItemId").map(Number).filter((n) => Number.isInteger(n) && n > 0),
      reason: text(form, "reason") as ReturnRequestInput["reason"],
      reasonText: text(form, "reasonText"),
      refundAccount: bankCode ? { bankCode, accountNumber, holderName } : undefined,
    });
  });
}

/** 반품 철회 (회수 전) */
export async function cancelReturnAction(form: FormData) {
  await run(form, "RETURN_CANCELED", (owner) => cancelReturn(owner, text(form, "returnNo")));
}
