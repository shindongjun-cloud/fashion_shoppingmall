// 토스페이먼츠 "결제 승인" API를 호출합니다. (서버에서만 사용)
// 결제창에서 구매자가 결제를 마쳐도, 이 승인 요청을 보내야 실제로 결제가 완료돼요.
// 시크릿 키가 필요하므로 절대 브라우저 코드("use client")에서 import하면 안 됩니다.

type ConfirmResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

export async function confirmPayment(params: {
  paymentKey: string;
  orderId: string;
  amount: number;
}): Promise<ConfirmResult> {
  // 인증 방식: "시크릿키:" 를 base64로 인코딩해서 Basic 헤더에 넣습니다.
  const secretKey = process.env.TOSS_SECRET_KEY ?? "";
  const encoded = Buffer.from(`${secretKey}:`).toString("base64");

  const response = await fetch(
    "https://api.tosspayments.com/v1/payments/confirm",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${encoded}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    return {
      ok: false,
      code: error.code ?? "UNKNOWN_ERROR",
      message: error.message ?? "결제 승인 중 오류가 발생했어요.",
    };
  }

  return { ok: true };
}
