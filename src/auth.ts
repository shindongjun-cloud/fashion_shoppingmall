// 로그인(Auth.js) 설정 파일입니다.
// 여기서 내보내는 함수들을 다른 파일에서 가져다 씁니다.
//   auth()    : 지금 로그인한 사람 정보 가져오기 (없으면 null)
//   signIn()  : 로그인 시작
//   signOut() : 로그아웃
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  // 회원, 로그인 상태를 우리 데이터베이스(User, Account, Session 표)에 저장합니다.
  adapter: PrismaAdapter(prisma),
  // GitHub 로그인. 키는 .env의 AUTH_GITHUB_ID, AUTH_GITHUB_SECRET에서 자동으로 읽습니다.
  providers: [GitHub],
  callbacks: {
    // 화면에서 session.user.id로 회원 번호를 쓸 수 있게 넣어줍니다.
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});
