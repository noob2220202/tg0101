import { Prisma } from "@prisma/client";

import { QueueList, QueueRow } from "@/components/QueueList";
import { prisma } from "@/lib/db";
import { getOwner } from "@/lib/owner";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 200;

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const owner = await getOwner();
  const { status = "PENDING" } = await searchParams;

  const scope: Prisma.JoinTaskWhereInput = { job: { ownerId: owner.id } };
  const where: Prisma.JoinTaskWhereInput = status === "ALL" ? scope : { ...scope, status };

  const [tasks, grouped] = await Promise.all([
    prisma.joinTask.findMany({
      where,
      orderBy: [{ priority: "asc" }, { nextAttemptAt: "asc" }],
      take: PAGE_SIZE,
      include: {
        target: { select: { key: true, title: true } },
        account: { select: { label: true } },
        job: { select: { id: true, name: true } },
      },
    }),
    prisma.joinTask.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
  ]);

  const counts: Record<string, number> = { ALL: 0 };
  for (const row of grouped) {
    counts[row.status] = row._count._all;
    counts.ALL += row._count._all;
  }

  const rows: QueueRow[] = tasks.map((task) => ({
    id: task.id,
    status: task.status,
    targetKey: task.target.key,
    targetTitle: task.target.title,
    accountLabel: task.account.label,
    jobId: task.job.id,
    jobName: task.job.name,
    isPrereq: task.isPrereq,
    attempts: task.attempts,
    maxAttempts: task.maxAttempts,
    nextAttemptAt: task.nextAttemptAt.toISOString(),
    lastError: task.lastError,
  }));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[17px] font-semibold">입장 큐</h1>
        <p className="mt-1 text-[12px] text-ink-muted">
          워커가 계정별 페이싱 간격에 맞춰 하나씩 처리합니다. 실패한 작업은 선택해 다시 시도할 수 있습니다.
        </p>
      </header>

      <QueueList rows={rows} counts={counts} activeStatus={status} />
    </div>
  );
}
