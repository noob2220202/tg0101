import { AccountList, AccountRow } from "@/components/AccountList";
import { prisma } from "@/lib/db";
import { isMockMode } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const accounts = await prisma.account.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { memberships: true } },
    },
  });

  const pendingCounts = await prisma.joinTask.groupBy({
    by: ["accountId"],
    where: { status: "PENDING" },
    _count: { _all: true },
  });
  const pendingMap = new Map(pendingCounts.map((row) => [row.accountId, row._count._all]));

  const rows: AccountRow[] = accounts.map((account) => ({
    id: account.id,
    label: account.label,
    phone: account.phone,
    status: account.status,
    hasSession: Boolean(account.sessionString),
    joinIntervalSec: account.joinIntervalSec,
    dailyJoinLimit: account.dailyJoinLimit,
    collectEnabled: account.collectEnabled,
    cooldownUntil: account.cooldownUntil?.toISOString() ?? null,
    cooldownReason: account.cooldownReason,
    lastJoinAt: account.lastJoinAt?.toISOString() ?? null,
    joinedRooms: account._count.memberships,
    pendingTasks: pendingMap.get(account.id) ?? 0,
  }));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[17px] font-semibold">계정</h1>
        <p className="mt-1 text-[12px] text-ink-muted">
          입장을 실행하는 텔레그램 계정입니다. 계정마다 페이싱 간격이 따로 적용되며, 텔레그램이 대기를 요구하면 해당 계정만 멈춥니다.
        </p>
      </header>

      <AccountList accounts={rows} mockMode={isMockMode()} />
    </div>
  );
}
