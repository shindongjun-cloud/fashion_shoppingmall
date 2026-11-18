"use server";

// 회원: 비회원 주문을 내 계정으로 가져오기 (주문번호 + 주문 비밀번호, 또는 이 브라우저의 비회원 출입증)
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentCustomer } from "@/lib/current-customer";
import { clientIp } from "@/lib/current-owner";
import { claimGuestOrder, GUEST_COOKIE } from "@/lib/guest";
import { loginPath } from "@/lib/safe-redirect";

export async function claimGuestOrderAction(form: FormData) {
  const orderNo = typeof form.get("orderNo") === "string" ? String(form.get("orderNo")).trim() : "";
  const keep = /^\d{8}-\d{8}$/.test(orderNo) ? `&orderNo=${orderNo}` : "";
  const customer = await getCurrentCustomer();
  if (!customer) redirect(loginPath(`/orders/claim?${keep.slice(1)}`));
  const useSession = form.get("useSession") === "1";
  const jar = await cookies();
  const r = await claimGuestOrder({
    customerId: customer.id,
    orderNo,
    password: useSession ? undefined : form.get("password"),
    sessionToken: useSession ? jar.get(GUEST_COOKIE)?.value : null,
    ip: await clientIp(),
  });
  if (r.code !== "DONE") redirect(`/orders/claim?r=${r.code}${keep}`);
  jar.delete(GUEST_COOKIE); // 비회원 출입증은 이제 쓸모없음 (DB에서도 무효 처리됨)
  revalidatePath("/orders");
  redirect(`/orders/${r.orderNo}?notice=CLAIMED`);
}
