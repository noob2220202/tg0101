import { Prisma } from "@prisma/client";

import { CollectedList, CollectedRow } from "@/components/CollectedList";
import { Card } from "@/components/ui";
import { prisma } from "@/lib/db";
import { getOwner } from "@/lib/owner";
import { formatNumber, relativeTime } from "@/lib/format";
import { getCollectionSummary } from "@/lib/services/stats";
import { getPolicy } from "@/lib/services/policy";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 200;

export default async function CollectedPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; score?: string; type?: string }>;
}) {
  const owner = await getOwner();
  const { status = "PENDING", q = "", score = "", type = "" } = await searchParams;

  const where: Prisma.CollectedLinkWhereInput = {
    ownerId: owner.id,
    ...(status === "ALL" ? {} : { status }),
    ...(q ? { OR: [{ key: { contains: q } }, { title: { contains: q } }, { reason: { contains: q } }] } : {}),
    ...(score ? { score: { gte: Number(score) } } : {}),
    ...(type ? { entityType: type } : {}),
  };

  const [links, summary, policy, accounts] = await Promise.all([
    prisma.collectedLink.findMany({
      where,
      orderBy: [{ score: "desc" }, { lastSeenAt: "desc" }],
      take: PAGE_SIZE,
      include: {
        // The busiest source room is shown as the link's provenance.
        sources: { orderBy: { count: "desc" }, take: 1 },
      },
    }),
    getCollectionSummary(owner.id),
    getPolicy(owner.id),
    prisma.account.findMany({
      where: { ownerId: owner.id, status: { not: "DISABLED" } },
      orderBy: { label: "asc" },
      select: { id: true, label: true },
    }),
  ]);

  const rows: CollectedRow[] = links.map((link) => ({
    id: link.id,
    key: link.key,
    url: link.url,
    title: link.title,
    entityType: link.entityType,
    score: link.score,
    reason: link.reason,
    status: link.status,
    roomCount: link.roomCount,
    seenCount: link.seenCount,
    lastSeenAt: link.lastSeenAt.toISOString(),
    topSource: link.sources[0]?.sourceLabel ?? null,
  }));

  return (
    <div className="space-y-4">
      <Card className="flex divide-x divide-line">
        <Stat
          label="수집 중인 계정"
          value={formatNumber(summary.collectingAccounts.length)}
          hint={summary.collectingAccounts.join(", ") || "없음"}
        />
        <Stat label="감시 중인 방" value={formatNumber(summary.watchedRooms)} hint="입장해 있는 방 전체" />
        <Stat
          label="한 번 이상 읽음"
          value={formatNumber(summary.scannedRooms)}
          hint={summary.scannedRooms === summary.watchedRooms ? "모두 최신" : "일부 대기 중"}
        />
        <Stat label="다음 수집" value={relativeTime(summary.nextScanAt)} hint="가장 빠른 예정" />
      </Card>

      <CollectedList
        rows={rows}
        counts={summary.counts}
        activeStatus={status}
        query={q}
        minScore={score}
        entityType={type}
        accounts={accounts}
        policy={{
          enabled: policy.enabled,
          autoRegister: policy.autoRegister,
          minScore: policy.minScore,
          dailyLimit: policy.dailyLimit,
          joinAccountId: policy.joinAccountId,
          chainCollect: policy.chainCollect,
          collectGroups: policy.collectGroups,
          collectChannels: policy.collectChannels,
          collectBots: policy.collectBots,
          collectUsers: policy.collectUsers,
          minMembers: policy.minMembers,
          requiredKeywords: policy.requiredKeywords,
          excludedKeywords: policy.excludedKeywords,
        }}
      />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="min-w-0 flex-1 px-5 py-4">
      <p className="text-[12px] text-ink-muted">{label}</p>
      <p className="tnum mt-1.5 text-[22px] leading-none font-semibold">{value}</p>
      <p className="mt-2 truncate text-[12px] text-ink-faint">{hint}</p>
    </div>
  );
}
