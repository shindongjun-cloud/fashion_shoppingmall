"use client";

import { useEffect } from "react";

// 몇 초 뒤 지정한 주소로 이동합니다 ("결제 확인 중" 화면에서 결과를 다시 확인할 때 사용)
export default function AutoRefresh({ href, seconds }: { href: string; seconds: number }) {
  useEffect(() => {
    const timer = setTimeout(() => window.location.assign(href), seconds * 1000);
    return () => clearTimeout(timer);
  }, [href, seconds]);
  return null;
}
