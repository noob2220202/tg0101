import { prisma } from "../db";
import { JobOptions, serializeJobOptions } from "../jobOptions";

/**
 * Turning a selection in the UI into a queue of join tasks.
 */

export type CreateJobInput = {
  ownerId: string;
  accountId: string;
  targetIds: string[];
  name?: string | null;
  options: JobOptions;
};

export type CreateJobResult = {
  jobId: string;
  queued: number;
  /** Targets dropped because the account is already in them. */
  skipped: number;
};

export async function createJoinJob(input: CreateJobInput): Promise<CreateJobResult> {
  const targetIds = [...new Set(input.targetIds)];
  if (targetIds.length === 0) throw new Error("입장할 방을 한 개 이상 선택하세요.");

  // Scoped by owner: an operator can only queue work on their own account.
  const account = await prisma.account.findFirst({
    where: { id: input.accountId, ownerId: input.ownerId },
  });
  if (!account) throw new Error("계정을 찾을 수 없습니다.");

  const ownedCount = await prisma.target.count({
    where: { id: { in: targetIds }, ownerId: input.ownerId },
  });
  if (ownedCount !== targetIds.length) throw new Error("선택한 방 중 접근할 수 없는 항목이 있습니다.");

  let eligible = targetIds;
  let skipped = 0;

  if (input.options.skipJoined) {
    const memberships = await prisma.membership.findMany({
      where: { accountId: account.id, targetId: { in: targetIds }, left: false },
      select: { targetId: true },
    });
    const joined = new Set(memberships.map((m) => m.targetId));
    eligible = targetIds.filter((id) => !joined.has(id));
    skipped = targetIds.length - eligible.length;
  }

  if (eligible.length === 0) {
    throw new Error("선택한 방에 이미 모두 입장되어 있습니다.");
  }

  const name = input.name?.trim() || `${eligible.length}개 방 입장`;

  const job = await prisma.joinJob.create({
    data: {
      name,
      ownerId: input.ownerId,
      accountId: account.id,
      status: "RUNNING",
      options: serializeJobOptions(input.options),
      totalCount: eligible.length,
      // `skipped` targets never became tasks and are excluded from totalCount,
      // so they are reported to the caller rather than stored — refreshJobProgress
      // owns this column and only counts SKIPPED tasks.
      tasks: {
        create: eligible.map((targetId) => ({
          accountId: account.id,
          targetId,
          status: "PENDING",
          // Prerequisites get priority 50 so they always run first.
          priority: 100,
        })),
      },
    },
  });

  return { jobId: job.id, queued: eligible.length, skipped };
}

/**
 * Recompute a job's counters from its tasks and close it when nothing is left
 * to run. Called after every task transition.
 */
export async function refreshJobProgress(jobId: string): Promise<void> {
  const grouped = await prisma.joinTask.groupBy({
    by: ["status"],
    where: { jobId },
    _count: { _all: true },
  });

  const counts = Object.fromEntries(grouped.map((g) => [g.status, g._count._all])) as Record<string, number>;
  const done = counts.SUCCESS ?? 0;
  const failed = counts.FAILED ?? 0;
  const skipped = counts.SKIPPED ?? 0;
  const open = (counts.PENDING ?? 0) + (counts.RUNNING ?? 0);

  const job = await prisma.joinJob.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!job) return;

  // WAITING_APPROVAL tasks are finished from our side — an admin has to act.
  const finished = open === 0;

  await prisma.joinJob.update({
    where: { id: jobId },
    data: {
      doneCount: done,
      failedCount: failed,
      skippedCount: skipped,
      ...(finished && job.status === "RUNNING"
        ? { status: "DONE", finishedAt: new Date() }
        : {}),
    },
  });
}

export async function setJobStatus(jobId: string, status: "RUNNING" | "PAUSED" | "CANCELLED"): Promise<void> {
  await prisma.joinJob.update({
    where: { id: jobId },
    data: {
      status,
      ...(status === "CANCELLED" ? { finishedAt: new Date() } : {}),
    },
  });

  if (status === "CANCELLED") {
    // Cancelling only drops work that has not started.
    await prisma.joinTask.updateMany({
      where: { jobId, status: "PENDING" },
      data: { status: "SKIPPED", lastError: "작업이 취소되었습니다." },
    });
    await refreshJobProgress(jobId);
  }
}
