// 데이터베이스에 접속하는 Prisma Client를 만듭니다.
// 다른 파일에서는 import { prisma } from "@/lib/prisma"; 로 가져다 씁니다.
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

function createPrismaClient() {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  });
  return new PrismaClient({ adapter });
}

// 개발 중에는 파일을 저장할 때마다 코드가 다시 불러와지는데,
// 그때마다 새 접속을 만들지 않도록 하나를 재사용합니다.
const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
