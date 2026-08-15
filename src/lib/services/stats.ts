import { prisma } from "../db";
import { startOfToday } from "../format";
import { readWorkerHeartbeat } from "./settings";

/** Every query behind the dashboard, in one place. */

export async function getDashboardData() {
  const now = new Date();
  const today = startOfToday(now);

  const [
    doneToday,
    pendingTasks,
    waitingApproval,
    failedTasks,
    cooldownAccounts,
    runningJobs,
    recentLogs,
    accountCounts,
    pendingLinks,
    registeredToday,
    heartbeat,
    watchedRooms,
  ] = await Promise.all([
    // 오늘 입장 완료 — 자정 기준 누적
    prisma.joinTask.count({ where: { status: "SUCCESS", finishedAt: { gte: today } } }),

    // 대기 중 작업
    prisma.joinTask.count({ where: { status: { in: ["PENDING", "RUNNING"] }, job: { status: "RUNNING" } } }),

    // 승인 대기 — 관리자 수락 필요
    prisma.joinTask.count({ where: { status: "WAITING_APPROVAL" } }),

    // 실패 — 재시도 가능
    prisma.joinTask.count({ where: { status: "FAILED" } }),

    prisma.account.findMany({
      where: { status: "COOLDOWN" },
      orderBy: { cooldownUntil: "asc" },
      select: { id: true, label: true, cooldownUntil: true, cooldownSeconds: true, cooldownReason: true },
    }),

    prisma.joinJob.findMany({
      where: { status: { in: ["RUNNING", "PAUSED"] } },
      orderBy: { createdAt: "desc" },
      take: 12,
      include: {
        account: { select: { id: true, label: true } },
      },
    }),

    prisma.joinLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 24,
      include: { account: { select: { label: true } } },
    }),

    prisma.account.groupBy({ by: ["status"], _count: { _all: true } }),

    prisma.collectedLink.count({ where: { status: "PENDING" } }),

    prisma.collectedLink.count({ where: { status: "REGISTERED", lastSeenAt: { gte: today } } }),

    readWorkerHeartbeat(),

    prisma.roomScan.count(),
  ]);

  // Pending task counts per cooling-down account, for the wait table.
  const pendingByAccount = await prisma.joinTask.groupBy({
    by: ["accountId"],
    where: {
      accountId: { in: cooldownAccounts.map((a) => a.id) },
      status: "PENDING",
    },
    _count: { _all: true },
  });
  const pendingMap = new Map(pendingByAccount.map((row) => [row.accountId, row._count._all]));

  // Next scheduled attempt per running job, for the "다음 시도" column.
  const nextAttempts = await prisma.joinTask.groupBy({
    by: ["jobId"],
    where: { jobId: { in: runningJobs.map((j) => j.id) }, status: "PENDING" },
    _min: { nextAttemptAt: true },
  });
  const nextMap = new Map(nextAttempts.map((row) => [row.jobId, row._min.nextAttemptAt]));

  const statusCount = (status: string) =>
    accountCounts.find((row) => row.status === status)?._count._all ?? 0;

  return {
    now,
    stats: {
      doneToday,
      pendingTasks,
      waitingApproval,
      failedTasks,
    },
    cooldownAccounts: cooldownAccounts.map((account) => ({
      ...account,
      pendingCount: pendingMap.get(account.id) ?? 0,
    })),
    runningJobs: runningJobs.map((job) => ({
      ...job,
      nextAttemptAt: nextMap.get(job.id) ?? null,
    })),
    recentLogs,
    accounts: {
      active: statusCount("ACTIVE"),
      cooldown: statusCount("COOLDOWN"),
      needsCheck: statusCount("NEEDS_CHECK"),
      disabled: statusCount("DISABLED"),
    },
    collection: {
      pendingLinks,
      registeredToday,
      watchedRooms,
    },
    heartbeat,
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;

/** Header numbers for the 수집된 링크 screen. */
export async function getCollectionSummary() {
  const [collectingAccounts, watchedRooms, scannedRooms, lastScan, counts] = await Promise.all([
    prisma.account.findMany({
      where: { collectEnabled: true, status: { not: "DISABLED" } },
      select: { label: true },
    }),
    prisma.roomScan.count(),
    prisma.roomScan.count({ where: { scanCount: { gt: 0 } } }),
    prisma.roomScan.findFirst({
      where: { nextScanAt: { not: undefined } },
      orderBy: { nextScanAt: "asc" },
      select: { nextScanAt: true },
    }),
    prisma.collectedLink.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const byStatus = (status: string) => counts.find((c) => c.status === status)?._count._all ?? 0;

  return {
    collectingAccounts: collectingAccounts.map((a) => a.label),
    watchedRooms,
    scannedRooms,
    nextScanAt: lastScan?.nextScanAt ?? null,
    counts: {
      pending: byStatus("PENDING"),
      approved: byStatus("APPROVED"),
      registered: byStatus("REGISTERED"),
      excluded: byStatus("EXCLUDED"),
      total: counts.reduce((sum, c) => sum + c._count._all, 0),
    },
  };
}
