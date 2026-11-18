import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { auth, signOut } from "@/auth";
import { getCurrentCustomer } from "@/lib/current-customer";
import { unreadCount } from "@/lib/notification";
import { BROWSER_COOKIE } from "@/lib/auth-session";

// 헤더 오른쪽: 로그인했으면 프로필 + 로그아웃, 아니면 로그인 버튼
// 서버 컴포넌트라서 auth()로 로그인 정보를 바로 읽을 수 있습니다.
export default async function UserMenu() {
  const session = await auth();

  if (!session?.user) {
    return (
      // 비회원 주문조회 + 로그인 화면(로그인 상태 유지 체크박스)으로 이동
      <div className="flex items-center gap-3">
        <Link href="/guest/orders" className="text-gray-600 hover:text-gray-900">
          비회원 주문조회
        </Link>
        <Link href="/login" className="rounded-lg bg-gray-900 px-3 py-1.5 text-white hover:bg-gray-700">
          로그인
        </Link>
      </div>
    );
  }

  // 안 읽은 알림 수 (재입고·반품 진행)
  const customer = await getCurrentCustomer();
  const unread = customer ? await unreadCount(customer.id) : 0;

  return (
    <div className="flex items-center gap-3">
      <Link href="/my/notifications" className="relative text-gray-700 hover:text-gray-900">
        알림
        {unread > 0 && <span className="absolute -right-3 -top-2 rounded-full bg-red-500 px-1.5 text-xs text-white">{unread > 99 ? "99+" : unread}</span>}
      </Link>
      <Link href="/orders" className="text-gray-700 hover:text-gray-900">
        주문내역
      </Link>
      <Link
        href="/my"
        className="flex items-center gap-2 text-gray-700 hover:text-gray-900"
      >
        {session.user.image && (
          <Image
            src={session.user.image}
            alt=""
            width={28}
            height={28}
            className="rounded-full"
          />
        )}
        <span className="hidden sm:inline">{session.user.name}</span>
      </Link>
      <form
        action={async () => {
          "use server";
          (await cookies()).delete(BROWSER_COOKIE); // 브라우저 세션 쿠키도 정리
          await signOut({ redirectTo: "/" });
        }}
      >
        <button className="text-gray-500 hover:text-gray-900">로그아웃</button>
      </form>
    </div>
  );
}
