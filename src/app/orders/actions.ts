"use server";

// 주문 상세 화면의 서버 액션 (로그인 고객만, 실제 처리는 lib/order.ts)
// 결과: 정해진 안내는 주소의 ?notice=코드, 오류 문구는 1분짜리 쿠키(플래시)로 전달
// ⚠️ 오류 문구를 주소(?error=문구)에 싣지 않음: 누구나 가짜 안내 문구를 넣은 링크를 만들어 보낼 수 있기 때문
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentCustomer } from "@/lib/current-customer";
import { loginPath } from "@/lib/safe-redirect";
import { cancelPaidOrder, changeOrderAddress, confirmPurchase, OrderError } from "@/lib/order";
import { ORDER_NO_PATTERN } from "@/lib/order-rules";

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

/** 로그인 확인 + 주문번호 형식 확인 → 상세 화면 주소 */
async function start(form: FormData) {
  const orderNo = text(form, "orderNo");
  const back = ORDER_NO_PATTERN.test(orderNo) ? `/orders/${orderNo}` : "/orders";
  const customer = await getCurrentCustomer();
  if (!customer) redirect(loginPath(back));
  if (back === "/orders") redirect("/orders");
  return { customer, orderNo, back };
}

/** 고객 주문 취소 (입금 전 가상계좌 / 결제 완료 후 상품 준비 전) */
export async function cancelOrderAction(form: FormData) {
  const { customer, orderNo, back } = await start(form);
  const bankCode = text(form, "bankCode");
  const accountNumber = text(form, "accountNumber").replace(/[\s-]/g, "");
  const holderName = text(form, "holderName");
  if ((bankCode || accountNumber || holderName) && (!bankCode || !/^\d{6,20}$/.test(accountNumber) || !holderName || holderName.length > 30)) {
    redirect(await flashError(back, "환불 계좌(은행·숫자 계좌번호·예금주)를 정확히 입력해 주세요."));
  }
  const code = await cancelPaidOrder(customer.id, orderNo, {
    reason: text(form, "reason").slice(0, 100),
    refundAccount: bankCode ? { bankCode, accountNumber, holderName } : undefined,
  });
  revalidatePath("/orders");
  redirect(`${back}?notice=${code}`);
}

/** 배송지 변경 (주소록에서 선택) */
export async function changeAddressAction(form: FormData) {
  const { customer, orderNo, back } = await start(form);
  let target = `${back}?notice=ADDRESS_CHANGED`;
  try {
    await changeOrderAddress(customer.id, orderNo, Number(text(form, "addressId")));
  } catch (e) {
    if (!(e instanceof OrderError)) throw e;
    target = await flashError(back, e.message);
  }
  redirect(target);
}

/** 구매확정 (상품 줄 하나) */
export async function confirmPurchaseAction(form: FormData) {
  const { customer, orderNo, back } = await start(form);
  let target = `${back}?notice=CONFIRMED`;
  try {
    await confirmPurchase(customer.id, orderNo, Number(text(form, "orderItemId")));
  } catch (e) {
    if (!(e instanceof OrderError)) throw e;
    target = await flashError(back, e.message);
  }
  revalidatePath("/orders");
  redirect(target);
}
