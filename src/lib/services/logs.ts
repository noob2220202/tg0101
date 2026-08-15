import { prisma } from "../db";
import { LogLevel } from "../enums";

/** Write one entry into the "최근 입장 기록" feed. */
export async function writeLog(params: {
  accountId: string;
  targetId?: string | null;
  targetLabel?: string | null;
  level?: LogLevel;
  message: string;
  taskId?: string | null;
}) {
  return prisma.joinLog.create({
    data: {
      accountId: params.accountId,
      targetId: params.targetId ?? null,
      targetLabel: params.targetLabel ?? null,
      level: params.level ?? "INFO",
      message: params.message,
      taskId: params.taskId ?? null,
    },
  });
}

/**
 * The feed is unbounded otherwise — a busy account writes thousands of rows a
 * day and only the recent ones are ever shown.
 */
export async function trimLogs(keep = 2000): Promise<number> {
  const cutoff = await prisma.joinLog.findMany({
    select: { createdAt: true },
    orderBy: { createdAt: "desc" },
    skip: keep,
    take: 1,
  });
  if (cutoff.length === 0) return 0;

  const { count } = await prisma.joinLog.deleteMany({
    where: { createdAt: { lt: cutoff[0].createdAt } },
  });
  return count;
}
