// 19000 → "19,000원" 처럼 가격을 보기 좋게 바꿔줍니다.
export function formatPrice(price: number) {
  return `${price.toLocaleString("ko-KR")}원`;
}
