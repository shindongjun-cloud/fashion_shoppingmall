import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // next/image로 GitHub 프로필 사진을 불러올 수 있게 허용
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
  // 토스페이먼츠 권장: 결제창(팝업)이 차단되지 않도록 COOP를 "same-origin-allow-popups"로
  // (docs.tosspayments.com/reference/using-api/authorization "팝업 차단 에러 방지하기")
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" }] }];
  },
};

export default nextConfig;
