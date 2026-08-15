import { Prisma } from "@prisma/client";

import { GroupList, GroupRow } from "@/components/GroupList";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archived?: string }>;
}) {
  const { q = "", archived } = await searchParams;
  const includeArchived = archived === "1";

  const where: Prisma.TargetWhereInput = {
    ...(includeArchived ? {} : { archived: false }),
    ...(q
      ? {
          OR: [
            { key: { contains: q } },
            { title: { contains: q } },
            { note: { contains: q } },
          ],
        }
      : {}),
  };

  const [targets, totalMatching, accounts] = await Promise.all([
    prisma.target.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      include: {
        // Newest attempt per target drives the "최근 결과" column.
        tasks: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: { status: true, lastError: true, finishedAt: true, updatedAt: true },
        },
      },
    }),
    prisma.target.count({ where }),
    prisma.account.findMany({
      where: { status: { in: ["ACTIVE", "COOLDOWN"] } },
      orderBy: { label: "asc" },
      select: { id: true, label: true, joinIntervalSec: true },
    }),
  ]);

  const pendingCounts = await prisma.joinTask.groupBy({
    by: ["accountId"],
    where: { accountId: { in: accounts.map((a) => a.id) }, status: "PENDING" },
    _count: { _all: true },
  });
  const pendingMap = new Map(pendingCounts.map((row) => [row.accountId, row._count._all]));

  const rows: GroupRow[] = targets.map((target) => {
    const task = target.tasks[0];
    return {
      id: target.id,
      key: target.key,
      title: target.title,
      source: target.source,
      archived: target.archived,
      memberCount: target.memberCount,
      createdAt: target.createdAt.toISOString(),
      lastResult: task
        ? {
            status: task.status,
            message: task.lastError,
            at: (task.finishedAt ?? task.updatedAt).toISOString(),
          }
        : null,
    };
  });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[17px] font-semibold">그룹 목록</h1>
        <p className="mt-1 text-[12px] text-ink-muted">
          입장할 그룹·채널 목록입니다. 선택한 방을 계정에 배정해 입장을 예약합니다.
        </p>
      </header>

      <GroupList
        rows={rows}
        totalMatching={totalMatching}
        query={q}
        includeArchived={includeArchived}
        accounts={accounts.map((account) => ({
          id: account.id,
          label: account.label,
          joinIntervalSec: account.joinIntervalSec,
          pendingCount: pendingMap.get(account.id) ?? 0,
        }))}
      />
    </div>
  );
}
