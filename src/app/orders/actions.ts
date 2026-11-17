"use server";

import { redirect } from "next/navigation";
import { getCurrentCustomer } from "@/lib/current-customer";
import { cancelWaitingDepositOrder } from "@/lib/payment";

// 입금 대기(가상계좌) 주문 취소 → 결과 코드를 주소에 담아 주문 내역으로 (문구는 코드로 고름)
export async function cancelDepositOrder(formData: FormData) {
  const customer = await getCurrentCustomer();
  if (!customer) redirect("/api/auth/signin?callbackUrl=/orders");
  const orderId = Number(formData.get("orderId"));
  const code = Number.isInteger(orderId) && orderId > 0 ? await cancelWaitingDepositOrder(customer.id, orderId) : "NOT_FOUND";
  redirect(`/orders?notice=${code}`);
}
