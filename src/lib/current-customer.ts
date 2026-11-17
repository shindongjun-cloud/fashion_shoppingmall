// 지금 로그인한 사람의 쇼핑몰 고객(Customer) 정보 (서버 전용)
// auth를 부르는 코드는 여기에만 둡니다 (lib/customer.ts와 auth.ts가 서로 부르는 순환 참조 방지)
import { auth } from "@/auth";
import { ensureCustomerForUser } from "@/lib/customer";

/** 로그인 안 했으면 null. 고객 행이 없으면(로그인 이벤트가 실패했던 경우 등) 여기서 만들어 줍니다 */
export async function getCurrentCustomer() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  return ensureCustomerForUser(userId);
}
