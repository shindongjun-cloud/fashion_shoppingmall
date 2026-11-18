"use server";

// 쿠폰 받기·코드 등록 (회원만). 결과는 URL의 code로만 전달 → 화면이 문구를 고름 (문구를 URL에 넣지 않음)
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentCustomer } from "@/lib/current-customer";
import { CouponError, downloadCoupon, redeemCouponCode } from "@/lib/coupon";
import { COUPON_NOTICE, type CouponNoticeCode } from "@/lib/coupon-rules";
import { loginPath, safeReturnPath } from "@/lib/safe-redirect";

function withNotice(back: string, code: CouponNoticeCode) {
  const [path, query = ""] = back.split("?");
  const params = new URLSearchParams(query);
  params.set("coupon", code);
  return `${path}?${params.toString()}`;
}

async function run(back: string, fn: (customerId: number) => Promise<CouponNoticeCode>) {
  const customer = await getCurrentCustomer();
  if (!customer) redirect(loginPath(back));
  let code: CouponNoticeCode;
  try {
    code = await fn(customer.id);
  } catch (e) {
    if (!(e instanceof CouponError)) throw e;
    code = e.code;
  }
  revalidatePath(back.split("?")[0]);
  revalidatePath("/my/coupons");
  redirect(withNotice(back, code));
}

/** [쿠폰 받기] (상품 화면·쿠폰함) */
export async function downloadCouponAction(form: FormData) {
  const back = safeReturnPath(form.get("back"));
  const policyId = Number(form.get("policyId"));
  await run(back, async (customerId) => {
    if (!Number.isInteger(policyId) || policyId < 1) throw new CouponError("NOT_DOWNLOADABLE");
    await downloadCoupon(customerId, policyId);
    return "OK";
  });
}

/** 쿠폰 코드 등록 (쿠폰함) */
export async function redeemCodeAction(form: FormData) {
  const back = safeReturnPath(form.get("back"));
  await run(back, async (customerId) => {
    await redeemCouponCode(customerId, String(form.get("code") ?? ""));
    return "CODE_OK";
  });
}

/** 결제 화면에서 코드 등록 (화면을 떠나지 않음: 결과 문구만 돌려주고 화면이 새로고침) */
export async function redeemCodeAtCheckout(code: string): Promise<{ ok: boolean; message: string }> {
  const customer = await getCurrentCustomer();
  if (!customer) return { ok: false, message: "로그인이 필요해요." };
  try {
    await redeemCouponCode(customer.id, String(code ?? ""));
    revalidatePath("/my/coupons");
    return { ok: true, message: COUPON_NOTICE.CODE_OK };
  } catch (e) {
    if (e instanceof CouponError) return { ok: false, message: e.message };
    throw e;
  }
}
