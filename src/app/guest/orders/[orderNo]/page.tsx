import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getGuestOrderId } from "@/lib/current-owner";
import OrderDetailView from "@/components/OrderDetailView";
import { cancelOrderAction, changeAddressAction, changeAddressDirectAction, confirmPurchaseAction, requestReturnAction, cancelReturnAction } from "@/app/orders/actions";

export const dynamic = "force-dynamic";

// 비회원 주문 상세 (출입증 쿠키가 이 주문의 것일 때만). 예: /guest/orders/20261118-48213907
export default async function GuestOrderDetailPage({ params, searchParams }: PageProps<"/guest/orders/[orderNo]">) {
  const { orderNo } = await params;
  const { notice, e } = await searchParams;
  const guestOrderId = await getGuestOrderId();
  const order = guestOrderId !== null ? await prisma.order.findUnique({ where: { id: guestOrderId }, select: { orderNo: true } }) : null;
  // 출입증이 없거나 다른 주문의 것이면 → 조회 화면 (이 주문번호가 있는지는 알려 주지 않음)
  if (!order || order.orderNo !== orderNo) redirect(`/guest/orders?orderNo=${encodeURIComponent(orderNo)}&expired=1`);
  return (
    <OrderDetailView
      owner={{ guestOrderId: guestOrderId! }}
      orderNo={orderNo}
      notice={notice}
      flashId={e}
      actions={{ cancel: cancelOrderAction, confirm: confirmPurchaseAction, changeAddress: changeAddressAction, changeAddressDirect: changeAddressDirectAction, requestReturn: requestReturnAction, cancelReturn: cancelReturnAction }}
    />
  );
}
