import Link from "next/link";

import { KeywordRules, RuleRow } from "@/components/KeywordRules";
import { Badge } from "@/components/ui";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function KeywordsPage() {
  const user = await requireUser();

  const [rules, accounts, recentHits] = await Promise.all([
    prisma.keywordRule.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: "desc" } }),
    prisma.account.findMany({
      where: { ownerId: user.id, status: { not: "DISABLED" } },
      orderBy: { label: "asc" },
      select: { id: true, label: true },
    }),
    prisma.chatMessage.findMany({
      where: { keywordHit: true, account: { ownerId: user.id } },
      orderBy: { date: "desc" },
      take: 30,
      include: { account: { select: { label: true } } },
    }),
  ]);

  const labelById = new Map(accounts.map((a) => [a.id, a.label]));

  const rows: RuleRow[] = rules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    terms: rule.terms,
    accountId: rule.accountId,
    accountLabel: rule.accountId ? (labelById.get(rule.accountId) ?? "삭제된 계정") : null,
    enabled: rule.enabled,
    hitCount: rule.hitCount,
    lastHitAt: rule.lastHitAt?.toISOString() ?? null,
  }));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold">키워드 알림</h1>
          <p className="mt-1 text-[12px] text-ink-muted">
            입장해 있는 모든 방의 새 메시지를 검사합니다. 방이 많을수록 사람이 직접 볼 수 없으니, 놓치면 안 되는 단어를 등록해 두세요.
          </p>
        </div>
        <Link href="/chat" className="btn">
          채팅으로
        </Link>
      </header>

      <KeywordRules rules={rows} accounts={accounts} />

      <section className="card overflow-hidden">
        <div className="px-4 py-3.5">
          <h2 className="card-title">최근 적중 메시지</h2>
          <p className="card-sub mt-1">규칙에 걸린 메시지만 따로 보관됩니다.</p>
        </div>
        {recentHits.length === 0 ? (
          <p className="px-4 py-10 text-center text-[12px] text-ink-faint">아직 적중한 메시지가 없습니다.</p>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {recentHits.map((hit) => (
              <li key={hit.id} className="flex items-start gap-3 px-4 py-2.5">
                <Badge>{hit.account.label}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px]">{hit.text}</p>
                  <p className="mt-0.5 text-[11px] text-ink-muted">
                    {hit.senderName ?? "알 수 없음"} · {hit.peerId}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-ink-faint">{relativeTime(hit.date)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
