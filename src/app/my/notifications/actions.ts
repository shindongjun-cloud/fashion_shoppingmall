"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentCustomer } from "@/lib/current-customer";
import { markAllRead } from "@/lib/notification";
import { loginPath } from "@/lib/safe-redirect";

// 알림함: 모두 읽음 표시 (화면을 그리는 중에는 DB를 바꾸지 않도록 버튼으로)
export async function markAllReadAction() {
  const customer = await getCurrentCustomer();
  if (!customer) redirect(loginPath("/my/notifications"));
  await markAllRead(customer.id);
  revalidatePath("/my/notifications");
  redirect("/my/notifications");
}
