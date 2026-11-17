import Link from "next/link";
import CartLink from "@/components/CartLink";
import UserMenu from "@/components/UserMenu";

// 모든 페이지 위쪽에 나오는 헤더입니다.
export default function Header() {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Link href="/" className="text-xl font-bold text-gray-900">
          My Shop
        </Link>
        <nav className="flex items-center gap-8 text-sm">
          <CartLink />
          <UserMenu />
        </nav>
      </div>
    </header>
  );
}
