// 토스 웹훅 수신 (상점관리자 > 개발 정보 > 웹훅에 https://<도메인>/api/payments/webhook 등록)
// - 받자마자 저장 → 토스 조회 API로 다시 확인한 값만 반영 (웹훅 내용은 그대로 믿지 않음)
// - 같은 알림이 다시 와도 한 번만 처리 (dedupKey)
// - 10초 안에 200을 돌려줘야 토스가 재전송하지 않음. 처리 실패는 우리 정기 작업이 다시 시도하므로 200으로 응답
// ⚠️ localhost는 토스가 접근할 수 없어 개발 중에는 웹훅이 오지 않습니다 (배포 후 확인)
import { receiveWebhook } from "@/lib/payment";

export async function POST(request: Request) {
  const raw = await request.text();
  const result = await receiveWebhook(raw, {
    transmissionId: request.headers.get("tosspayments-webhook-transmission-id"),
    retriedCount: request.headers.get("tosspayments-webhook-transmission-retried-count"),
  });
  return new Response(null, { status: result.httpStatus });
}
