"use server";

// 상품 상세: 품절 사이즈 재입고 알림 신청·취소 (회원만)
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentCustomer } from "@/lib/current-customer";
import { cancelRestock, RestockError, subscribeRestock } from "@/lib/restock";
import { loginPath, safeReturnPath } from "@/lib/safe-redirect";

export async function subscribeRestockAction(form: FormData) {
  const back = safeReturnPath(form.get("back"));
  const customer = await getCurrentCustomer();
  if (!customer) redirect(loginPath(back));
  const sep = back.includes("?") ? "&" : "?";
  let result = "ok";
  try {
    await subscribeRestock(customer.id, Number(form.get("skuId")));
  } catch (e) {
    if (!(e instanceof RestockError)) throw e;
    result = "instock"; // 그 사이 재고가 생김 등
  }
  revalidatePath(back.split("?")[0]);
  redirect(`${back}${sep}restock=${result}`);
}

export async function cancelRestockAction(form: FormData) {
  const customer = await getCurrentCustomer();
  if (!customer) redirect(loginPath("/my/notifications"));
  await cancelRestock(customer.id, Number(form.get("subscriptionId")));
  revalidatePath("/my/notifications");
  redirect("/my/notifications");
}
