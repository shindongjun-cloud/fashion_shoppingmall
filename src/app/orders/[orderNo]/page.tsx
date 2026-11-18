import { redirect } from "next/navigation";
import { getCurrentCustomer } from "@/lib/current-customer";
import { loginPath } from "@/lib/safe-redirect";
import OrderDetailView from "@/components/OrderDetailView";
import { cancelOrderAction, changeAddressAction, changeAddressDirectAction, confirmPurchaseAction, requestReturnAction, cancelReturnAction } from "../actions";

export const dynamic = "force-dynamic";

// 회원 주문 상세 (내 주문만). 예: /orders/20261118-48213907
export default async function OrderDetailPage({ params, searchParams }: PageProps<"/orders/[orderNo]">) {
  const { orderNo } = await params;
  const { notice, e } = await searchParams;
  const customer = await getCurrentCustomer();
  if (!customer) redirect(loginPath(`/orders/${orderNo}`));
  return (
    <OrderDetailView
      owner={{ customerId: customer.id }}
      orderNo={orderNo}
      notice={notice}
      flashId={e}
      actions={{ cancel: cancelOrderAction, confirm: confirmPurchaseAction, changeAddress: changeAddressAction, changeAddressDirect: changeAddressDirectAction, requestReturn: requestReturnAction, cancelReturn: cancelReturnAction }}
    />
  );
}
