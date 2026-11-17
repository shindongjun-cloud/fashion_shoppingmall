import Image from "next/image";
import Link from "next/link";
import { auth, signIn, signOut } from "@/auth";

// 헤더 오른쪽: 로그인했으면 프로필 + 로그아웃, 아니면 로그인 버튼
// 서버 컴포넌트라서 auth()로 로그인 정보를 바로 읽을 수 있습니다.
export default async function UserMenu() {
  const session = await auth();

  if (!session?.user) {
    return (
      // form의 action에 함수를 넣으면 "서버 액션"이 됩니다. 버튼을 누르면 서버에서 실행돼요.
      <form
        action={async () => {
          "use server";
          await signIn("github");
        }}
      >
        <button className="rounded-lg bg-gray-900 px-3 py-1.5 text-white hover:bg-gray-700">
          GitHub로 로그인
        </button>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <Link
        href="/orders"
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
          await signOut({ redirectTo: "/" });
        }}
      >
        <button className="text-gray-500 hover:text-gray-900">로그아웃</button>
      </form>
    </div>
  );
}
