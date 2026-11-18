// 쿠폰 관리 명령 (관리자 화면 전까지)
//   npm run coupons:ops -- list                               정책 목록 (상태·발급 수)
//   npm run coupons:ops -- show <정책코드>                     정책 상세 + 대상·등급·코드 + 사용 현황
//   npm run coupons:ops -- create <정책.json>                  정책 만들기 (JSON: lib/coupon.ts PolicyInput, 날짜는 ISO 문자열)
//   npm run coupons:ops -- activate|pause|resume|end <정책코드> 상태 변경 (pause = 긴급 중지: 발급·사용 모두 멈춤)
//   npm run coupons:ops -- code-add <정책코드> <코드>           입력 코드 추가
//   npm run coupons:ops -- code-off <코드>                     입력 코드 사용 중지
//   npm run coupons:ops -- issue <정책코드> <고객번호>           관리자 지급 (CS 보상 등)
//   npm run coupons:ops -- revoke <쿠폰번호> <사유>             회수 (사용 가능한 쿠폰만)
//   npm run coupons:ops -- customer <고객번호>                 고객의 쿠폰 목록
import "dotenv/config";
import fs from "node:fs";
import { prisma } from "../src/lib/prisma";
import { addCouponCode, adminIssueCoupon, CouponError, createCouponPolicy, revokeCoupon, setPolicyStatus, type PolicyInput } from "../src/lib/coupon";
import { couponBenefitText, COUPON_KIND_LABEL } from "../src/lib/coupon-rules";
import { formatDateTimeLong, formatPrice } from "../src/lib/format"; // 쿠폰 기간은 해를 넘기므로 연도까지

const BY = "ADMIN:cli";

async function show(code: string) {
  const p = await prisma.couponPolicy.findUniqueOrThrow({
    where: { code },
    include: { targets: true, grades: { include: { grade: true } }, codes: true, issued: { select: { status: true } } },
  });
  const used = await prisma.orderCoupon.aggregate({ where: { status: "APPLIED", customerCoupon: { policyId: p.id } }, _sum: { discountAmount: true }, _count: true });
  console.log(`${p.code}  ${p.displayName}  [${COUPON_KIND_LABEL[p.kind]}]  상태=${p.status}`);
  console.log(`  혜택: ${couponBenefitText(p)}${p.applyToSaleItems ? "" : " (행사 상품 제외)"}`);
  console.log(`  발급: ${p.issueMethod}${p.autoTrigger ? `(${p.autoTrigger})` : ""}  ${formatDateTimeLong(p.issueStartAt)} ~ ${formatDateTimeLong(p.issueEndAt)}  발급 ${p.issuedCount}${p.totalQuantity ? `/${p.totalQuantity}` : ""}장  1인 ${p.perCustomerLimit ?? "주기별 1"}장`);
  console.log(`  사용 기간: ${p.validDays ? `발급일 포함 ${p.validDays}일` : `${formatDateTimeLong(p.useStartAt!)} ~ ${formatDateTimeLong(p.useEndAt!)}`}`);
  if (p.targets.length) console.log(`  대상: ${p.targets.map((t) => `${t.mode === "EXCLUDE" ? "제외 " : ""}${t.targetType}${t.categoryId ? `#${t.categoryId}` : t.styleId ? `#${t.styleId}` : t.seasonId ? `#${t.seasonId}` : t.gender ? `:${t.gender}` : ""}`).join(", ")}`);
  if (p.grades.length) console.log(`  등급: ${p.grades.map((g) => g.grade.code).join(", ")}`);
  if (p.codes.length) console.log(`  코드: ${p.codes.map((c) => `${c.code}${c.isActive ? "" : "(중지)"}`).join(", ")}`);
  const by: Record<string, number> = {};
  for (const c of p.issued) by[c.status] = (by[c.status] ?? 0) + 1;
  console.log(`  고객 쿠폰: ${JSON.stringify(by)}  결제 사용 ${used._count}건 · 할인 합계 ${formatPrice(used._sum.discountAmount ?? 0)}`);
}

async function main() {
  const [cmd, a, b, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "list": {
      for (const p of await prisma.couponPolicy.findMany({ orderBy: { id: "asc" } })) {
        console.log(`${p.code.padEnd(14)} ${p.status.padEnd(7)} ${COUPON_KIND_LABEL[p.kind]}  ${p.displayName}  (${couponBenefitText(p)})  발급 ${p.issuedCount}${p.totalQuantity ? `/${p.totalQuantity}` : ""}`);
      }
      return;
    }
    case "show":
      return show(a);
    case "create": {
      const raw = JSON.parse(fs.readFileSync(a, "utf8"));
      for (const k of ["issueStartAt", "issueEndAt", "useStartAt", "useEndAt"]) if (raw[k]) raw[k] = new Date(raw[k]);
      const p = await createCouponPolicy({ ...(raw as PolicyInput), by: BY });
      return show(p.code);
    }
    case "activate":
    case "resume":
      await setPolicyStatus(a, "ACTIVE");
      return show(a);
    case "pause":
      await setPolicyStatus(a, "PAUSED");
      return show(a);
    case "end":
      await setPolicyStatus(a, "ENDED");
      return show(a);
    case "code-add":
      await addCouponCode(a, b);
      return show(a);
    case "code-off": {
      const c = await prisma.couponCode.update({ where: { code: a.toUpperCase() }, data: { isActive: false }, include: { policy: true } });
      return show(c.policy.code);
    }
    case "issue": {
      const c = await adminIssueCoupon(a, b, BY);
      console.log(`지급 완료: ${c.couponNo} (${formatDateTimeLong(c.validTo)} 전까지)`);
      return;
    }
    case "revoke": {
      const c = await revokeCoupon(a, [b, ...rest].join(" ") || "관리자 회수");
      console.log(`회수: ${c.couponNo}`);
      return;
    }
    case "customer": {
      const customer = await prisma.customer.findUniqueOrThrow({ where: { customerNo: a } });
      const list = await prisma.customerCoupon.findMany({ where: { customerId: customer.id }, include: { policy: true }, orderBy: { id: "desc" } });
      for (const c of list) console.log(`${c.couponNo}  ${c.status.padEnd(9)} ${c.policy.displayName}  ~${formatDateTimeLong(c.validTo)}`);
      return;
    }
    default:
      console.error("명령: list | show | create | activate | pause | resume | end | code-add | code-off | issue | revoke | customer");
      process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e instanceof CouponError ? `실패: ${e.message}` : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
