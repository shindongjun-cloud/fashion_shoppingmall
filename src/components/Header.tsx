import Link from "next/link";
import CartLink from "@/components/CartLink";
import UserMenu from "@/components/UserMenu";

// 모든 페이지 위쪽에 나오는 헤더입니다.
export default function Header() {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Link href="/" className="shrink-0 whitespace-nowrap text-xl font-bold text-gray-900">
          My Shop
        </Link>
        {/* 휴대폰(375px)에서도 메뉴 글자가 두 줄로 쪼개지지 않게: 줄바꿈 금지 + 좁은 간격·작은 글자 */}
        <nav className="flex items-center gap-7 whitespace-nowrap text-xs sm:gap-8 sm:text-sm">
          <CartLink />
          <UserMenu />
        </nav>
      </div>
    </header>
  );
}
