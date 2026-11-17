// 임시 상품 이미지 (SVG)
// 아직 실제 사진이 없어서, 컬러 색으로 칠한 그림을 만들어 줍니다.
// 예: /api/placeholder?bg=1A1A1A&icon=🧥&text=BLACK · FRONT
// DB(StyleColorImage.url)에는 이 주소가 들어 있고, 나중에 실제 이미지 주소로 바꾸면 됩니다.

export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const bgParam = searchParams.get("bg") ?? "";
  const bg = /^[0-9a-fA-F]{6}$/.test(bgParam) ? bgParam : "E5E7EB";
  const icon = escapeXml((searchParams.get("icon") ?? "").slice(0, 4));
  const text = escapeXml((searchParams.get("text") ?? "").slice(0, 40));

  // 배경이 어두우면 글자를 밝게, 밝으면 어둡게
  const r = parseInt(bg.slice(0, 2), 16);
  const g = parseInt(bg.slice(2, 4), 16);
  const b = parseInt(bg.slice(4, 6), 16);
  const isDark = 0.299 * r + 0.587 * g + 0.114 * b < 140;
  const fg = isDark ? "#F5F5F4" : "#27272A";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="750" viewBox="0 0 600 750">
  <rect width="600" height="750" fill="#${bg}"/>
  <text x="300" y="400" font-size="180" text-anchor="middle" dominant-baseline="middle">${icon}</text>
  <text x="300" y="690" font-size="28" font-family="sans-serif" letter-spacing="4" text-anchor="middle" fill="${fg}" opacity="0.8">${text}</text>
</svg>`;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
