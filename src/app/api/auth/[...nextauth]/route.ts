// /api/auth/... 로 오는 요청(로그인, 로그아웃, GitHub에서 돌아오기 등)을 Auth.js가 처리합니다.
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
