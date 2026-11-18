// 알림 (서버 전용): 사이트 알림함(IN_APP) + 외부 발송 대기열(EMAIL·KAKAO — 발송 서비스는 배포 때 연결)
// 같은 일로 두 번 알리지 않도록 dedupKey가 유일합니다 (이미 있으면 조용히 건너뜀).
import type { NotificationType, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isConstraintError } from "@/lib/inventory";

type Db = Prisma.TransactionClient | typeof prisma;

export type NewNotification = {
  customerId: number | null; // null = 관리자 알림
  type: NotificationType;
  title: string;
  body: string;
  linkUrl?: string;
  dedupKey: string;
};

/** 알림 1건 (알림함). 같은 dedupKey가 이미 있으면 false */
export async function notify(db: Db, n: NewNotification, now: Date): Promise<boolean> {
  if (await db.notification.findUnique({ where: { dedupKey: n.dedupKey.slice(0, 200) }, select: { id: true } })) return false;
  try {
    await db.notification.create({
      data: {
        customerId: n.customerId,
        audience: n.customerId === null ? "ADMIN" : "CUSTOMER",
        type: n.type,
        channel: "IN_APP",
        title: n.title.slice(0, 100),
        body: n.body.slice(0, 1000),
        linkUrl: n.linkUrl ?? null,
        dedupKey: n.dedupKey.slice(0, 200),
        status: "SENT",
        sentAt: now,
        createdAt: now,
      },
    });
    return true;
  } catch (e) {
    // 같은 알림이 이미 있음 (dedupKey 유일) → 보내지 않음. ⚠️ 트랜잭션 안이면 SQLite는 이 실패 뒤에도 계속 쓸 수 있음
    if (isConstraintError(e, "dedupKey") || (e as { code?: string }).code === "P2002") return false;
    throw e;
  }
}

export async function listNotifications(customerId: number, take = 50) {
  return prisma.notification.findMany({ where: { customerId }, orderBy: { id: "desc" }, take });
}
export async function unreadCount(customerId: number) {
  return prisma.notification.count({ where: { customerId, readAt: null } });
}
/** 내 알림 모두 읽음 */
export async function markAllRead(customerId: number, now = new Date()) {
  return (await prisma.notification.updateMany({ where: { customerId, readAt: null }, data: { readAt: now } })).count;
}
export async function adminNotifications(take = 50) {
  return prisma.notification.findMany({ where: { audience: "ADMIN" }, orderBy: { id: "desc" }, take });
}
