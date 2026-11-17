import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // next/image로 GitHub 프로필 사진을 불러올 수 있게 허용
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
};

export default nextConfig;
