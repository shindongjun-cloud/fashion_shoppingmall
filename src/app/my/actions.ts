"use server";

// 내 정보 화면의 서버 액션. 로그인 고객만, 실제 처리는 lib/customer.ts
// 결과는 주소의 ?ok= / ?error= 로 돌려줘서 화면 위쪽에 안내 문구를 보여 줍니다.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { CustomerGender, Fit, WithdrawalReason } from "@/generated/prisma/client";
import { getCurrentCustomer } from "@/lib/current-customer";
import { loginPath } from "@/lib/safe-redirect";
import {
  addAddress,
  cancelWithdrawal,
  CustomerError,
  deleteAddress,
  requestWithdrawal,
  saveBodyProfile,
  setDefaultAddress,
  updateProfile,
} from "@/lib/customer";

const GENDERS: CustomerGender[] = ["FEMALE", "MALE", "OTHER", "UNDISCLOSED"];
const FITS: Fit[] = ["SLIM", "REGULAR", "RELAXED", "OVERSIZED"];
const REASONS: WithdrawalReason[] = ["LOW_USAGE", "PRIVACY", "PRODUCT", "DELIVERY", "SERVICE", "REJOIN", "OTHER"];

const text = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};
const optionalInt = (form: FormData, key: string) => {
  const v = text(form, key).trim();
  if (!v) return null;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new CustomerError("숫자를 정확히 입력해 주세요.");
  return n;
};

/** 로그인 고객으로 작업을 실행하고, 결과 문구와 함께 돌아갑니다 */
async function run(back: string, okMessage: string, work: (customerId: number) => Promise<unknown>) {
  const customer = await getCurrentCustomer();
  if (!customer) redirect(loginPath(back));
  let target = `${back}?ok=${encodeURIComponent(okMessage)}`;
  try {
    await work(customer.id);
  } catch (e) {
    if (!(e instanceof CustomerError)) throw e; // 예상하지 못한 오류는 숨기지 않고 오류 화면으로
    target = `${back}?error=${encodeURIComponent(e.message)}`;
  }
  revalidatePath("/my");
  redirect(target);
}

export async function saveProfileAction(form: FormData) {
  const gender = text(form, "gender") as CustomerGender;
  await run("/my", "프로필을 저장했어요.", (id) =>
    updateProfile(id, {
      name: text(form, "name"),
      phone: text(form, "phone"),
      birthDate: text(form, "birthDate"),
      gender: GENDERS.includes(gender) ? gender : "UNDISCLOSED",
      contactEmail: text(form, "contactEmail"),
    }),
  );
}

export async function saveBodyAction(form: FormData) {
  const fit = text(form, "preferredFit") as Fit;
  await run("/my", "체형 정보를 저장했어요.", (id) =>
    saveBodyProfile(id, {
      heightCm: optionalInt(form, "heightCm"),
      weightKg: optionalInt(form, "weightKg"),
      topSize: text(form, "topSize"),
      bottomSize: text(form, "bottomSize"),
      shoeSizeMm: optionalInt(form, "shoeSizeMm"),
      preferredFit: FITS.includes(fit) ? fit : null,
      showInReviews: form.get("showInReviews") === "on",
    }),
  );
}

export async function addAddressAction(form: FormData) {
  await run("/my", "배송지를 추가했어요.", (id) =>
    addAddress(id, {
      label: text(form, "label"),
      recipient: text(form, "recipient"),
      phone: text(form, "phone"),
      zipCode: text(form, "zipCode"),
      address1: text(form, "address1"),
      address2: text(form, "address2"),
      deliveryMemo: text(form, "deliveryMemo"),
      makeDefault: form.get("makeDefault") === "on",
    }),
  );
}

export async function setDefaultAddressAction(form: FormData) {
  await run("/my", "기본 배송지를 바꿨어요.", (id) => setDefaultAddress(id, Number(text(form, "addressId"))));
}

export async function deleteAddressAction(form: FormData) {
  await run("/my", "배송지를 삭제했어요.", (id) => deleteAddress(id, Number(text(form, "addressId"))));
}

export async function requestWithdrawalAction(form: FormData) {
  const reason = text(form, "reasonCode") as WithdrawalReason;
  if (form.get("confirm") !== "on") redirect(`/my/withdraw?error=${encodeURIComponent("안내 사항 확인에 체크해 주세요.")}`);
  await run("/my/withdraw", "탈퇴를 신청했어요. 7일 안에는 철회할 수 있어요.", (id) =>
    requestWithdrawal(id, { reasonCode: REASONS.includes(reason) ? reason : "OTHER", reasonText: text(form, "reasonText") }),
  );
}

export async function cancelWithdrawalAction() {
  await run("/my/withdraw", "탈퇴 신청을 철회했어요.", (id) => cancelWithdrawal(id));
}
