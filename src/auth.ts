// 로그인(Auth.js) 설정 파일입니다.
// 여기서 내보내는 함수들을 다른 파일에서 가져다 씁니다.
//   auth()    : 지금 로그인한 사람 정보 가져오기 (없으면 null)
//   signIn()  : 로그인 시작
//   signOut() : 로그아웃
//
// 로그인 계정(User)과 쇼핑몰 고객(Customer)은 따로입니다. 처음 로그인하면 고객이 자동으로 만들어집니다.
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { headers } from "next/headers";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { ensureCustomerForUser, isRejoinBlocked, recordLogin } from "@/lib/customer";
import { maskIp } from "@/lib/crypto";

// 로그인 요청의 IP(마스킹)·브라우저 정보. 읽을 수 없는 환경이면 비움
async function requestInfo() {
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip");
    return { ipMasked: maskIp(ip), userAgent: h.get("user-agent") };
  } catch {
    return { ipMasked: null, userAgent: null };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // 로그인 계정, 로그인 상태를 우리 데이터베이스(User, Account, Session 표)에 저장합니다.
  adapter: PrismaAdapter(prisma),
  // GitHub 로그인. 키는 .env의 AUTH_GITHUB_ID, AUTH_GITHUB_SECRET에서 자동으로 읽습니다.
  providers: [GitHub],
  pages: {
    error: "/login-blocked", // 로그인이 거부되면 이유를 보여 주는 페이지
  },
  callbacks: {
    // 로그인 허용 여부: 정지 회원, 탈퇴 후 30일이 안 된 같은 계정의 재가입은 막습니다.
    async signIn({ account }) {
      if (!account) return true;
      const linked = await prisma.account.findUnique({
        where: { provider_providerAccountId: { provider: account.provider, providerAccountId: account.providerAccountId } },
        include: { user: { include: { customer: true } } },
      });
      const customer = linked?.user.customer;
      if (customer?.status === "SUSPENDED") {
        await recordLogin(customer.id, { provider: account.provider, result: "BLOCKED_SUSPENDED", ...(await requestInfo()) });
        return "/login-blocked?reason=suspended";
      }
      if (!linked && (await isRejoinBlocked(account.provider, account.providerAccountId))) {
        return "/login-blocked?reason=rejoin";
      }
      return true;
    },
    // 화면에서 session.user.id로 로그인 계정 번호를 쓸 수 있게 넣어줍니다.
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
  events: {
    // 로그인에 성공하면: 고객이 없으면 만들고(가입), 로그인 기록을 남깁니다.
    async signIn({ user, account }) {
      if (!user.id) return;
      const customer = await ensureCustomerForUser(user.id);
      await recordLogin(customer.id, { provider: account?.provider ?? "unknown", ...(await requestInfo()) });
    },
  },
});
