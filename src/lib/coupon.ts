// 쿠폰 (서버 전용, ⑬ B안: 정책 · 발급 · 사용 분리)
//
//  발급:   downloadCoupon (고객 [쿠폰 받기]) / redeemCouponCode (코드 입력) / issueSignupCoupons (가입) /
//          issueBirthdayCoupons·issueGradeCoupons (정기 작업) / adminIssueCoupon (CS 보상)
//  주문:   couponOptionsFor (결제 화면 후보 + 대상 SKU) → lib/coupon-rules.ts로 계산 → reserveOrderCoupons (주문 만들 때)
//          이후 사용·해제·복원은 주문 상태를 따라 DB 트리거가 처리 (앱이 쿠폰 상태를 직접 바꾸지 않음)
//  정기:   expireCoupons (기간 지난 쿠폰 만료 표시) / notifyExpiringCoupons (7일 전 안내)
//  관리:   createCouponPolicy / setPolicyStatus / addCouponCode / revokeCoupon
//
// ⚠️ 선착순 수량·1인 한도·등급·발급 기간·사용 기간·본인 쿠폰·주문당 1장·적용 대상은 DB 트리거가 최종 판정합니다.
//    여기서 미리 확인하는 것은 친절한 안내용이고, 동시에 들어와도 DB가 한 명만 통과시킵니다.
import { randomInt } from "crypto";
import type { CouponAutoTrigger, CouponDiscountType, CouponIssueMethod, CouponKind, CouponPolicyStatus, Gender, Prisma, PromotionTargetType, TargetMode } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isBusyError, isConstraintError, withBusyRetry } from "@/lib/inventory";
import { notify } from "@/lib/notification";
import { COUPON_NOTICE, couponBenefitText, couponValidTo, type CalcLine, type CouponApplied, type CouponNoticeCode, type CouponOption } from "@/lib/coupon-rules";
import { formatDate } from "@/lib/format";

type Db = Prisma.TransactionClient | typeof prisma;

/** 고객 안내용 오류. code로 화면 문구를 고름 (URL에는 code만 → 문구를 URL에 넣지 않음) */
export class CouponError extends Error {
  constructor(
    readonly code: CouponNoticeCode,
    message: string = COUPON_NOTICE[code],
  ) {
    super(message);
  }
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 헷갈리는 0/O, 1/I 제외
export function generateCouponNo() {
  let s = "CP";
  for (let i = 0; i < 10; i++) s += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return s;
}

/** 한국 날짜 기준 연·월 (생일·등급 쿠폰 주기) */
function kstYearMonth(now: Date) {
  const k = new Date(now.getTime() + 9 * 3600_000);
  return { year: k.getUTCFullYear(), month: k.getUTCMonth() + 1 };
}

/** DB 트리거 오류 → 고객 안내 문구 */
function friendlyIssueError(e: unknown): CouponError | null {
  const map: [string, CouponNoticeCode][] = [
    ["CustomerCoupon_sold_out", "SOLD_OUT"],
    ["CustomerCoupon_limit", "ALREADY"],
    ["CustomerCoupon_policyId_customerId_issueKey_key", "ALREADY"],
    ["CustomerCoupon_grade", "GRADE"],
    ["CustomerCoupon_issue_period", "PERIOD"],
    ["CustomerCoupon_not_active", "INACTIVE"],
    ["CustomerCoupon_customer", "CUSTOMER"],
  ];
  for (const [key, code] of map) if (isConstraintError(e, key)) return new CouponError(code);
  if ((e as { code?: string }).code === "P2002" && isConstraintError(e, "issueKey")) return new CouponError("ALREADY");
  if (isBusyError(e)) return new CouponError("BUSY");
  return null;
}

// ---------------------------------------------------------------
// 발급 (공통)
// ---------------------------------------------------------------
export type IssueInput = {
  policyId: number;
  customerId: number;
  method: CouponIssueMethod; // 정책의 방식 또는 ADMIN
  issuedBy: string; // CUSTOMER / SYSTEM / ADMIN:아이디
  issueKey?: string | null;
  couponCodeId?: number | null;
};

/** 쿠폰 1장 발급 (트랜잭션 안에서도 사용 가능). 실패하면 CouponError(안내 문구) */
export async function issueCoupon(db: Db, input: IssueInput, now = new Date()) {
  const policy = await db.couponPolicy.findUniqueOrThrow({ where: { id: input.policyId } });
  const validFrom = policy.validDays === null ? policy.useStartAt! : now;
  const validTo = policy.validDays === null ? policy.useEndAt! : couponValidTo(now, policy.validDays);
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.customerCoupon.create({
        data: {
          couponNo: generateCouponNo(),
          policyId: policy.id,
          customerId: input.customerId,
          issueMethod: input.method,
          couponCodeId: input.couponCodeId ?? null,
          issueKey: input.issueKey ?? null,
          issuedBy: input.issuedBy,
          issuedAt: now,
          validFrom,
          validTo,
          statusChangedAt: now,
          createdAt: now,
        },
      });
    } catch (e) {
      if (attempt < 3 && isConstraintError(e, "couponNo")) continue; // 쿠폰번호가 우연히 겹침
      throw friendlyIssueError(e) ?? e;
    }
  }
}

async function notifyIssued(customerId: number, policy: { displayName: string }, coupon: { couponNo: string; validTo: Date }, now: Date) {
  await notify(
    prisma,
    {
      customerId,
      type: "COUPON_ISSUED",
      title: "쿠폰이 발급됐어요",
      body: `${policy.displayName} 쿠폰이 쿠폰함에 들어왔어요. ${formatDate(new Date(coupon.validTo.getTime() - 1))}까지 쓸 수 있어요.`,
      linkUrl: "/my/coupons",
      dedupKey: `coupon-issued:${coupon.couponNo}`,
    },
    now,
  );
}

/** 고객: [쿠폰 받기] */
export async function downloadCoupon(customerId: number, policyId: number, now = new Date()) {
  const policy = await prisma.couponPolicy.findUnique({ where: { id: policyId } });
  if (!policy || policy.issueMethod !== "DOWNLOAD") throw new CouponError("NOT_DOWNLOADABLE");
  return withBusyRetry(() => issueCoupon(prisma, { policyId, customerId, method: "DOWNLOAD", issuedBy: "CUSTOMER" }, now));
}

// ---------------------------------------------------------------
// 코드 입력 (무차별 대입 방지: 1시간에 10번 틀리면 막음)
// ---------------------------------------------------------------
export const CODE_FAIL_LIMIT = 10;
const CODE_WINDOW_MS = 60 * 60 * 1000;

export async function redeemCouponCode(customerId: number, rawCode: string, now = new Date()) {
  const code = String(rawCode ?? "").trim().toUpperCase().replace(/[\s-]/g, "");
  const fails = await prisma.couponCodeAttempt.count({ where: { customerId, success: false, createdAt: { gt: new Date(now.getTime() - CODE_WINDOW_MS) } } });
  if (fails >= CODE_FAIL_LIMIT) throw new CouponError("LOCKED");
  const found = /^[A-Z0-9]{4,20}$/.test(code)
    ? await prisma.couponCode.findUnique({ where: { code }, include: { policy: true } })
    : null;
  if (!found || !found.isActive || found.policy.status !== "ACTIVE") {
    await prisma.couponCodeAttempt.create({ data: { customerId, success: false, createdAt: now } });
    throw new CouponError("BAD_CODE");
  }
  // "이미 받은 쿠폰"처럼 코드는 맞은 경우의 실패는 시도 횟수에 넣지 않음 (대입 공격이 아니므로)
  const coupon = await withBusyRetry(() =>
    issueCoupon(prisma, { policyId: found.policyId, customerId, method: "CODE", issuedBy: "CUSTOMER", couponCodeId: found.id }, now),
  );
  await prisma.couponCodeAttempt.create({ data: { customerId, success: true, createdAt: now } });
  return { coupon, policy: found.policy };
}

// ---------------------------------------------------------------
// 자동 발급 (가입·생일·등급)
// ---------------------------------------------------------------
async function activeAutoPolicies(trigger: CouponAutoTrigger, now: Date) {
  return prisma.couponPolicy.findMany({
    where: { status: "ACTIVE", issueMethod: "AUTO", autoTrigger: trigger, issueStartAt: { lte: now }, issueEndAt: { gt: now } },
    include: { grades: true },
    orderBy: { id: "asc" },
  });
}

/** 가입 축하 쿠폰 (가입 직후 1번. 실패해도 가입은 계속) */
export async function issueSignupCoupons(customerId: number, now = new Date()) {
  let issued = 0;
  for (const policy of await activeAutoPolicies("SIGNUP", now)) {
    try {
      const c = await withBusyRetry(() => issueCoupon(prisma, { policyId: policy.id, customerId, method: "AUTO", issuedBy: "SYSTEM", issueKey: "SIGNUP" }, now));
      await notifyIssued(customerId, policy, c, now);
      issued++;
    } catch (e) {
      if (!(e instanceof CouponError)) console.error("[쿠폰] 가입 쿠폰 발급 실패", e);
    }
  }
  return issued;
}

/** 대상 고객들에게 주기 쿠폰 발급 (같은 주기는 issueKey 유일 → 여러 번 돌려도 1장) */
async function issuePeriodic(trigger: CouponAutoTrigger, issueKey: string, customerWhere: (policy: { grades: { gradeId: number }[] }) => Prisma.CustomerWhereInput, now: Date) {
  let issued = 0;
  let skipped = 0;
  for (const policy of await activeAutoPolicies(trigger, now)) {
    const customers = await prisma.customer.findMany({ where: { status: "ACTIVE", ...customerWhere(policy) }, select: { id: true } });
    const already = new Set(
      (await prisma.customerCoupon.findMany({ where: { policyId: policy.id, issueKey }, select: { customerId: true } })).map((c) => c.customerId),
    );
    for (const { id } of customers) {
      if (already.has(id)) continue;
      try {
        const c = await withBusyRetry(() => issueCoupon(prisma, { policyId: policy.id, customerId: id, method: "AUTO", issuedBy: "SYSTEM", issueKey }, now));
        await notifyIssued(id, policy, c, now);
        issued++;
      } catch (e) {
        if (!(e instanceof CouponError)) throw e;
        skipped++; // 등급이 바뀌었거나 수량 소진 등
      }
    }
  }
  return { issued, skipped };
}

/** 생일 쿠폰: 이번 달(한국 날짜)이 생일 월인 정상 회원에게 해마다 1장 */
export function issueBirthdayCoupons(now = new Date()) {
  const { year, month } = kstYearMonth(now);
  return issuePeriodic("BIRTHDAY", `BIRTHDAY:${year}`, (p) => ({ profile: { birthMonth: month }, ...(p.grades.length ? { gradeId: { in: p.grades.map((g) => g.gradeId) } } : {}) }), now);
}

/** 등급 쿠폰: 대상 등급 회원에게 매달 1장 */
export function issueGradeCoupons(now = new Date()) {
  const { year, month } = kstYearMonth(now);
  return issuePeriodic("GRADE_MONTHLY", `GRADE:${year}${String(month).padStart(2, "0")}`, (p) => (p.grades.length ? { gradeId: { in: p.grades.map((g) => g.gradeId) } } : {}), now);
}

// ---------------------------------------------------------------
// 만료
// ---------------------------------------------------------------
/** 기간 지난 사용 가능 쿠폰을 "만료"로 표시 (표시용. 사용 가능 여부는 항상 기간으로 판단하므로 늦어도 안전) */
export async function expireCoupons(now = new Date()) {
  const r = await prisma.customerCoupon.updateMany({
    where: { status: "AVAILABLE", validTo: { lte: now } },
    data: { status: "EXPIRED", statusReason: "EXPIRED", statusChangedAt: now },
  });
  return r.count;
}

export const EXPIRY_NOTICE_DAYS = 7;
/** 만료 7일 전 안내 (쿠폰마다 1번) */
export async function notifyExpiringCoupons(now = new Date()) {
  const soon = await prisma.customerCoupon.findMany({
    where: { status: "AVAILABLE", expiryNotifiedAt: null, validTo: { gt: now, lte: new Date(now.getTime() + EXPIRY_NOTICE_DAYS * 86400_000) } },
    include: { policy: { select: { displayName: true } } },
  });
  for (const c of soon) {
    await notify(
      prisma,
      {
        customerId: c.customerId,
        type: "COUPON_EXPIRING",
        title: "쿠폰이 곧 만료돼요",
        body: `${c.policy.displayName} 쿠폰이 ${formatDate(new Date(c.validTo.getTime() - 1))}에 만료돼요.`,
        linkUrl: "/my/coupons",
        dedupKey: `coupon-expiring:${c.couponNo}`,
      },
      now,
    );
    await prisma.customerCoupon.update({ where: { id: c.id }, data: { expiryNotifiedAt: now } });
  }
  return soon.length;
}

// ---------------------------------------------------------------
// 적용 대상 (할인 행사와 같은 규칙: 제외 우선, 카테고리는 하위 포함)
// ---------------------------------------------------------------
type StyleInfo = { id: number; gender: Gender; seasonId: number | null; categoryPath: string };
type TargetRow = { targetType: PromotionTargetType; mode: TargetMode; categoryId: number | null; seasonId: number | null; gender: Gender | null; styleId: number | null };

function targetMatches(t: TargetRow, s: StyleInfo) {
  switch (t.targetType) {
    case "ALL":
      return true;
    case "CATEGORY":
      return t.categoryId !== null && s.categoryPath.includes(`/${t.categoryId}/`);
    case "SEASON":
      return t.seasonId !== null && t.seasonId === s.seasonId;
    case "GENDER":
      return t.gender === s.gender;
    case "STYLE":
      return t.styleId === s.id;
  }
}
export function isTargetStyle(targets: TargetRow[], s: StyleInfo) {
  const matched = targets.filter((t) => targetMatches(t, s));
  return !matched.some((t) => t.mode === "EXCLUDE") && matched.some((t) => t.mode === "INCLUDE");
}

async function styleInfoOfSkus(skuIds: number[]) {
  const skus = await prisma.sku.findMany({
    where: { id: { in: skuIds } },
    select: { id: true, styleColor: { select: { style: { select: { id: true, gender: true, seasonId: true, category: { select: { path: true } } } } } } },
  });
  return new Map(skus.map((k) => [k.id, { id: k.styleColor.style.id, gender: k.styleColor.style.gender, seasonId: k.styleColor.style.seasonId, categoryPath: k.styleColor.style.category.path }]));
}

const optionInclude = { policy: { include: { targets: true } } } satisfies Prisma.CustomerCouponInclude;
type CouponWithPolicy = Prisma.CustomerCouponGetPayload<{ include: typeof optionInclude }>;

/**
 * 지금 쓸 수 있는 내 쿠폰 (사용 가능 + 사용 기간 안 + 사용 중지 아님)
 * + 내 "결제 대기" 주문이 잡고 있는 쿠폰: 새 주문을 만들면 그 주문은 "새 주문으로 대체"되어 쿠폰이 풀리므로 다시 쓸 수 있음
 *   (결제창을 닫고 다시 주문하는 흔한 경우. 단, 결제 승인이 진행 중인 주문은 대체되지 않으므로 제외 — lib/checkout.ts와 같은 조건)
 */
export async function usableCoupons(customerId: number, now = new Date()) {
  return prisma.customerCoupon.findMany({
    where: {
      customerId,
      validFrom: { lte: now },
      validTo: { gt: now },
      policy: { status: { in: ["ACTIVE", "ENDED"] } },
      OR: [
        { status: "AVAILABLE" },
        {
          status: "IN_USE",
          uses: { some: { status: "RESERVED", order: { customerId, status: "PENDING", payments: { none: { status: { in: ["IN_PROGRESS", "UNKNOWN"] } } } } } },
        },
      ],
    },
    include: optionInclude,
    orderBy: [{ validTo: "asc" }, { id: "asc" }],
  });
}

/**
 * 결제 화면·주문 생성용 쿠폰 후보: 각 쿠폰이 어떤 SKU에 쓸 수 있는지까지 서버가 계산
 * skus: 대상 판단할 SKU (판매가 할인 여부 포함 — 행사 상품 제외 쿠폰)
 */
export async function couponOptionsFor(customerId: number, skus: { id: number; discountAmount: number }[], now = new Date(), coupons?: CouponWithPolicy[]): Promise<CouponOption[]> {
  const list = coupons ?? (await usableCoupons(customerId, now));
  const info = await styleInfoOfSkus(skus.map((s) => s.id));
  return list.map((c) => ({
    id: c.id,
    couponNo: c.couponNo,
    name: c.policy.displayName,
    kind: c.policy.kind,
    discountType: c.policy.discountType,
    discountValue: c.policy.discountValue,
    maxDiscountAmount: c.policy.maxDiscountAmount,
    minOrderAmount: c.policy.minOrderAmount,
    validTo: c.validTo.toISOString(),
    eligibleSkuIds: c.policy.kind === "SHIPPING" ? [] : skus.filter((s) => isTarget(c, s) && (c.policy.applyToSaleItems || s.discountAmount === 0)).map((s) => s.id),
    saleExcludedSkuIds: c.policy.kind === "SHIPPING" || c.policy.applyToSaleItems ? [] : skus.filter((s) => isTarget(c, s) && s.discountAmount > 0).map((s) => s.id),
  }));
  function isTarget(c: CouponWithPolicy, s: { id: number }) {
    const st = info.get(s.id);
    return st !== undefined && isTargetStyle(c.policy.targets, st);
  }
}

/** 주문을 만드는 트랜잭션 안에서: 주문 쿠폰(예약) + 줄별 배분 기록. 쿠폰 상태는 트리거가 '사용 중'으로 바꿈 */
export async function reserveOrderCoupons(
  tx: Prisma.TransactionClient,
  orderId: number,
  items: { id: number }[], // 줄 순서대로 (lineNo 순)
  applied: CouponApplied,
  options: CouponOption[],
  now: Date,
) {
  const name = (id: number) => options.find((o) => o.id === id)!.name;
  for (const p of applied.product) {
    const oc = await tx.orderCoupon.create({ data: { orderId, customerCouponId: p.couponId, kind: "PRODUCT", couponName: name(p.couponId), discountAmount: p.amount, createdAt: now } });
    await tx.orderItemCoupon.create({ data: { orderCouponId: oc.id, orderItemId: items[p.lineIndex].id, amount: p.amount } });
  }
  if (applied.order) {
    const o = applied.order;
    const oc = await tx.orderCoupon.create({ data: { orderId, customerCouponId: o.couponId, kind: "ORDER", couponName: name(o.couponId), discountAmount: o.amount, createdAt: now } });
    // 대상 줄 전부 기록 (배분 0원인 줄도: DB가 최소 금액·정률 한도를 대상 줄 기준으로 다시 검사)
    for (const a of o.allocations) await tx.orderItemCoupon.create({ data: { orderCouponId: oc.id, orderItemId: items[a.lineIndex].id, amount: a.amount } });
  }
  if (applied.shipping) {
    await tx.orderCoupon.create({ data: { orderId, customerCouponId: applied.shipping.couponId, kind: "SHIPPING", couponName: name(applied.shipping.couponId), discountAmount: applied.shipping.amount, createdAt: now } });
  }
}

/** 쿠폰 사용이 막히면 (결제 직전 재확인): 이 주문에 쓴 쿠폰 중 사용 중지된 것 */
export async function pausedCouponsOf(orderId: number) {
  return prisma.orderCoupon.findMany({
    where: { orderId, status: { in: ["RESERVED", "APPLIED"] }, customerCoupon: { policy: { status: { notIn: ["ACTIVE", "ENDED"] } } } },
    select: { couponName: true },
  });
}

/** 쿠폰 계산에 넘길 줄 */
export const calcLines = (lines: { skuId: number; lineTotal: number }[]): CalcLine[] => lines.map((l) => ({ skuId: l.skuId, lineTotal: l.lineTotal }));

// ---------------------------------------------------------------
// 화면 조회
// ---------------------------------------------------------------
/** 쿠폰함: 사용 가능 / 지난 쿠폰 (사용·만료·회수) */
export async function listMyCoupons(customerId: number, now = new Date()) {
  const all = await prisma.customerCoupon.findMany({
    where: { customerId },
    include: { policy: true, uses: { where: { status: { in: ["RESERVED", "APPLIED"] } }, include: { order: { select: { orderNo: true } } } } },
    orderBy: [{ validTo: "asc" }, { id: "desc" }],
  });
  const usable = all.filter((c) => (c.status === "AVAILABLE" || c.status === "IN_USE") && c.validTo > now);
  const past = all.filter((c) => !usable.includes(c)).sort((a, b) => b.statusChangedAt.getTime() - a.statusChangedAt.getTime()).slice(0, 50);
  const view = (c: (typeof all)[number]) => ({
    id: c.id,
    couponNo: c.couponNo,
    name: c.policy.displayName,
    description: c.policy.description,
    kind: c.policy.kind,
    benefit: couponBenefitText(c.policy),
    status: c.status === "AVAILABLE" && c.validTo <= now ? ("EXPIRED" as const) : c.status,
    validTo: c.validTo,
    daysLeft: Math.ceil((c.validTo.getTime() - now.getTime()) / 86400_000),
    orderNo: c.uses[0]?.order.orderNo ?? null,
    paused: c.policy.status === "PAUSED",
  });
  return { usable: usable.map(view), past: past.map(view) };
}

/** 상품 화면 [쿠폰 받기]: 이 스타일에 쓸 수 있고 지금 받을 수 있는 다운로드 쿠폰 (+ 이미 받았는지) */
export async function downloadableCouponsFor(styleId: number, customerId: number | null, onSale: boolean, now = new Date()) {
  const style = await prisma.style.findUnique({ where: { id: styleId }, select: { id: true, gender: true, seasonId: true, category: { select: { path: true } } } });
  if (!style) return [];
  const info: StyleInfo = { id: style.id, gender: style.gender, seasonId: style.seasonId, categoryPath: style.category.path };
  const customer = customerId ? await prisma.customer.findUnique({ where: { id: customerId }, select: { gradeId: true, status: true } }) : null;
  const policies = await prisma.couponPolicy.findMany({
    where: { status: "ACTIVE", issueMethod: "DOWNLOAD", issueStartAt: { lte: now }, issueEndAt: { gt: now }, kind: { in: ["PRODUCT", "ORDER"] } },
    include: { targets: true, grades: true, issued: customerId ? { where: { customerId }, select: { id: true } } : false },
    orderBy: { id: "asc" },
  });
  return policies
    .filter((p) => isTargetStyle(p.targets, info) && (p.applyToSaleItems || !onSale)) // 행사 상품 제외 쿠폰은 행사 중인 상품에 안 보임
    .filter((p) => !p.grades.length || (customer !== null && p.grades.some((g) => g.gradeId === customer.gradeId)))
    .map((p) => {
      const mine = (p as { issued?: { id: number }[] }).issued?.length ?? 0;
      const soldOut = p.totalQuantity !== null && p.issuedCount >= p.totalQuantity;
      return {
        policyId: p.id,
        name: p.displayName,
        kind: p.kind,
        benefit: couponBenefitText(p),
        remaining: p.totalQuantity === null ? null : Math.max(0, p.totalQuantity - p.issuedCount),
        received: p.perCustomerLimit !== null && mine >= p.perCustomerLimit,
        soldOut,
      };
    });
}

/** 장바구니·결제 화면 상단: 지금 받을 수 있는 배송비·장바구니 다운로드 쿠폰 (대상 상관없이 전체 공개용) */
export async function downloadableGeneralCoupons(customerId: number, now = new Date()) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { gradeId: true } });
  const policies = await prisma.couponPolicy.findMany({
    where: { status: "ACTIVE", issueMethod: "DOWNLOAD", issueStartAt: { lte: now }, issueEndAt: { gt: now } },
    include: { grades: true, issued: { where: { customerId }, select: { id: true } } },
    orderBy: { id: "asc" },
  });
  return policies
    .filter((p) => !p.grades.length || p.grades.some((g) => g.gradeId === customer?.gradeId))
    .filter((p) => (p.perCustomerLimit === null || p.issued.length < p.perCustomerLimit) && (p.totalQuantity === null || p.issuedCount < p.totalQuantity))
    .map((p) => ({ policyId: p.id, name: p.displayName, kind: p.kind, benefit: couponBenefitText(p) }));
}

// ---------------------------------------------------------------
// 관리 (관리자 화면 전까지 scripts/coupon-ops.ts)
// ---------------------------------------------------------------
export type PolicyInput = {
  code: string;
  name: string;
  displayName: string;
  description?: string | null;
  kind: CouponKind;
  discountType: CouponDiscountType;
  discountValue: number;
  maxDiscountAmount?: number | null;
  minOrderAmount?: number;
  applyToSaleItems?: boolean;
  issueMethod: CouponIssueMethod;
  autoTrigger?: CouponAutoTrigger | null;
  issueStartAt: Date;
  issueEndAt: Date;
  totalQuantity?: number | null;
  perCustomerLimit?: number | null;
  useStartAt?: Date | null;
  useEndAt?: Date | null;
  validDays?: number | null;
  targets?: { targetType: PromotionTargetType; mode?: TargetMode; categoryId?: number; seasonId?: number; gender?: Gender; styleId?: number }[];
  gradeCodes?: string[];
  codes?: string[];
  activate?: boolean;
  by: string;
};

/** 쿠폰 정책 만들기 (작성 중 → 대상·등급·코드 → 활성화). 규칙 위반은 DB가 거부 */
export async function createCouponPolicy(input: PolicyInput, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const policy = await tx.couponPolicy.create({
      data: {
        code: input.code,
        name: input.name,
        displayName: input.displayName,
        description: input.description ?? null,
        kind: input.kind,
        discountType: input.discountType,
        discountValue: input.discountValue,
        maxDiscountAmount: input.maxDiscountAmount ?? null,
        minOrderAmount: input.minOrderAmount ?? 0,
        applyToSaleItems: input.applyToSaleItems ?? true,
        issueMethod: input.issueMethod,
        autoTrigger: input.autoTrigger ?? null,
        issueStartAt: input.issueStartAt,
        issueEndAt: input.issueEndAt,
        totalQuantity: input.totalQuantity ?? null,
        perCustomerLimit: input.perCustomerLimit === undefined ? 1 : input.perCustomerLimit,
        useStartAt: input.useStartAt ?? null,
        useEndAt: input.useEndAt ?? null,
        validDays: input.validDays ?? null,
        statusChangedAt: now,
        createdBy: input.by,
        createdAt: now,
      },
    });
    for (const t of input.targets ?? []) {
      await tx.couponPolicyTarget.create({ data: { policyId: policy.id, targetType: t.targetType, mode: t.mode ?? "INCLUDE", categoryId: t.categoryId, seasonId: t.seasonId, gender: t.gender, styleId: t.styleId, createdAt: now } });
    }
    for (const code of input.gradeCodes ?? []) {
      const grade = await tx.customerGrade.findUniqueOrThrow({ where: { code } });
      await tx.couponPolicyGrade.create({ data: { policyId: policy.id, gradeId: grade.id } });
    }
    for (const code of input.codes ?? []) await tx.couponCode.create({ data: { policyId: policy.id, code: code.toUpperCase(), createdAt: now } });
    if (input.activate) return tx.couponPolicy.update({ where: { id: policy.id }, data: { status: "ACTIVE", statusChangedAt: now } });
    return policy;
  });
}

export async function setPolicyStatus(code: string, status: CouponPolicyStatus, now = new Date()) {
  return prisma.couponPolicy.update({ where: { code }, data: { status, statusChangedAt: now } });
}

export async function addCouponCode(policyCode: string, code: string, now = new Date()) {
  const policy = await prisma.couponPolicy.findUniqueOrThrow({ where: { code: policyCode } });
  return prisma.couponCode.create({ data: { policyId: policy.id, code: code.toUpperCase(), createdAt: now } });
}

/** 관리자 지급 (CS 보상 등): 정책 방식과 관계없이 지급, 발급 수량·한도·기간·등급 규칙은 그대로 적용 */
export async function adminIssueCoupon(policyCode: string, customerNo: string, by: string, now = new Date()) {
  const [policy, customer] = await Promise.all([
    prisma.couponPolicy.findUniqueOrThrow({ where: { code: policyCode } }),
    prisma.customer.findUniqueOrThrow({ where: { customerNo } }),
  ]);
  const c = await issueCoupon(prisma, { policyId: policy.id, customerId: customer.id, method: "ADMIN", issuedBy: by }, now);
  await notifyIssued(customer.id, policy, c, now);
  return c;
}

/** 회수 (사용 가능한 쿠폰만. 사용 중·사용된 쿠폰은 주문을 먼저 처리) */
export async function revokeCoupon(couponNo: string, reason: string, now = new Date()) {
  const c = await prisma.customerCoupon.findUniqueOrThrow({ where: { couponNo } });
  if (c.status !== "AVAILABLE") throw new CouponError("NOT_REVOCABLE", `사용 가능 상태의 쿠폰만 회수할 수 있어요. (지금: ${c.status})`);
  return prisma.customerCoupon.update({ where: { id: c.id }, data: { status: "REVOKED", statusReason: reason.slice(0, 200), statusChangedAt: now } });
}
