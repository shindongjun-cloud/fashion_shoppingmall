// 19000 → "19,000원" 처럼 가격을 보기 좋게 바꿔줍니다.
export function formatPrice(price: number) {
  return `${price.toLocaleString("ko-KR")}원`;
}

// 날짜는 항상 한국 시간으로 보여줍니다.
// ⚠️ timeZone을 안 쓰면 "서버 컴퓨터의 시간대"로 바뀝니다. 내 PC(한국)에서는 맞아 보여도
//    Vercel 서버(UTC)에서는 9시간 이르게 표시됩니다. (11/22 23:00 종료 → 11/22 14:00)
const KST = "Asia/Seoul";

// 2026. 11. 22.
export function formatDate(date: Date) {
  return date.toLocaleDateString("ko-KR", { timeZone: KST });
}

// 11. 22. 오후 11:00
export function formatDateTime(date: Date) {
  return date.toLocaleString("ko-KR", { timeZone: KST, month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// 2026. 11. 22. 오후 11:00 (연도 포함: 입금 기한처럼 날짜가 중요한 곳)
export function formatDateTimeLong(date: Date) {
  return date.toLocaleString("ko-KR", { timeZone: KST, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
}
