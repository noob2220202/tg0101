import Link from "next/link";

import { Badge, Card, CardHeader, EmptyState, LevelDot, Progress, StatCell } from "@/components/ui";
import { getDashboardData } from "@/lib/services/stats";
import { getOwner } from "@/lib/owner";
import { absoluteTime, formatNumber, relativeTime } from "@/lib/format";
import { JOB_STATUS_LABEL, JobStatus } from "@/lib/enums";

// The dashboard reflects worker activity, so it must never be cached.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const owner = await getOwner();
  const data = await getDashboardData(owner.id);
  const { stats, cooldownAccounts, runningJobs, recentLogs, accounts, collection, heartbeat, now } = data;

  return (
    <div className="space-y-4">
      {/* ---- metric strip -------------------------------------------------- */}
      <Card className="flex divide-x divide-line">
        <StatCell label="오늘 입장 완료" value={formatNumber(stats.doneToday)} hint="자정 기준 누적" />
        <StatCell
          label="대기 중 작업"
          value={formatNumber(stats.pendingTasks)}
          hint="큐 보기"
          href="/queue"
        />
        <StatCell
          label="승인 대기"
          value={formatNumber(stats.waitingApproval)}
          hint="관리자 수락 필요"
          tone={stats.waitingApproval > 0 ? "wait" : "default"}
        />
        <StatCell
          label="실패"
          value={formatNumber(stats.failedTasks)}
          hint="재시도 가능"
          tone={stats.failedTasks > 0 ? "bad" : "default"}
        />
      </Card>

      {/* ---- accounts serving a Telegram-imposed wait ---------------------- */}
      {cooldownAccounts.length > 0 ? (
        <Card>
          <CardHeader
            title="대기시간이 적용된 계정"
            subtitle="텔레그램이 요구한 대기시간입니다. 시간이 지나면 워커가 자동으로 입장을 재개합니다."
            right={<Badge tone="wait">{cooldownAccounts.length}개</Badge>}
          />
          <table className="w-full border-t border-line">
            <thead>
              <tr className="border-b border-line">
                <th className="th w-[18%]">계정</th>
                <th className="th">사유</th>
                <th className="th w-[26%]">재개 예정</th>
                <th className="th w-[12%] text-right">대기 중 작업</th>
              </tr>
            </thead>
            <tbody>
              {cooldownAccounts.map((account) => (
                <tr key={account.id} className="border-b border-line last:border-0">
                  <td className="td font-medium">{account.label}</td>
                  <td className="td text-ink-muted">{account.cooldownReason ?? "-"}</td>
                  <td className="td">
                    <span className="flex items-center gap-2">
                      <Badge tone="wait">{relativeTime(account.cooldownUntil, now)}</Badge>
                      <span className="tnum text-ink-muted">{absoluteTime(account.cooldownUntil)}</span>
                    </span>
                  </td>
                  <td className="td tnum text-right">{formatNumber(account.pendingCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      {/* ---- running jobs + activity feed ---------------------------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_minmax(360px,42%)]">
        <Card className="flex flex-col">
          <CardHeader
            title="진행 중인 작업"
            subtitle="계정별 입장 예약 배치"
            right={
              <Link href="/queue" className="btn">
                전체 보기
              </Link>
            }
          />
          {runningJobs.length === 0 ? (
            <EmptyState>진행 중인 작업이 없습니다.</EmptyState>
          ) : (
            <table className="w-full border-t border-line">
              <thead>
                <tr className="border-b border-line">
                  <th className="th">작업</th>
                  <th className="th w-[22%]">계정</th>
                  <th className="th w-[16%]">진행</th>
                  <th className="th w-[18%]">다음 시도</th>
                  <th className="th w-[10%] text-right" />
                </tr>
              </thead>
              <tbody>
                {runningJobs.map((job) => (
                  <tr key={job.id} className="border-b border-line last:border-0">
                    <td className="td">
                      <span className="flex items-center gap-2">
                        <Badge tone={job.status === "PAUSED" ? "neutral" : "ok"}>
                          {JOB_STATUS_LABEL[job.status as JobStatus] ?? job.status}
                        </Badge>
                        <span className="font-medium">{job.name}</span>
                      </span>
                    </td>
                    <td className="td text-ink-muted">{job.account.label}</td>
                    <td className="td">
                      <Progress done={job.doneCount} total={job.totalCount} />
                    </td>
                    <td className="td text-ink-muted">{relativeTime(job.nextAttemptAt, now)}</td>
                    <td className="td text-right">
                      <Link href={`/jobs/${job.id}`} className="text-ink-muted hover:text-ink">
                        상세
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="flex flex-col">
          <CardHeader
            title="최근 입장 기록"
            subtitle={
              <>
                마지막 워커 실행 {heartbeat.lastTickAt ? absoluteTime(heartbeat.lastTickAt) : "기록 없음"} · 처리{" "}
                {formatNumber(heartbeat.lastTickCount)}건
              </>
            }
          />
          {recentLogs.length === 0 ? (
            <EmptyState>아직 기록이 없습니다.</EmptyState>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {recentLogs.map((log) => (
                <li key={log.id} className="flex items-start gap-2.5 px-4 py-2.5">
                  <LevelDot level={log.level} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium">{log.account.label}</p>
                    <p className="truncate text-[12px] text-ink-muted">
                      {log.targetLabel ? `${log.targetLabel} · ` : ""}
                      {log.message}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-ink-faint">{relativeTime(log.createdAt, now)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* ---- account health ------------------------------------------------ */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-6 px-4 py-4">
          <div>
            <h2 className="card-title">계정 상태</h2>
            <p className="card-sub mt-1">입장을 실행하는 텔레그램 계정 현황입니다.</p>
          </div>
          <div className="flex items-center gap-8">
            <MiniStat label="활성" value={accounts.active} />
            <MiniStat label="대기 중" value={accounts.cooldown} tone="wait" />
            <MiniStat label="점검 필요" value={accounts.needsCheck} tone={accounts.needsCheck ? "bad" : "default"} />
            <Link href="/accounts" className="btn">
              계정 관리
            </Link>
          </div>
        </div>
      </Card>

      {/* ---- collector summary --------------------------------------------- */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-6 px-4 py-4">
          <div>
            <h2 className="card-title">홍보 링크 수집</h2>
            <p className="card-sub mt-1">
              자동 입장한 방이 소개하는 다른 홍보방의 링크를 모아 둔 곳입니다. 감시 중인 방{" "}
              {formatNumber(collection.watchedRooms)}개.
            </p>
          </div>
          <div className="flex items-center gap-8">
            <MiniStat label="검토 대기" value={collection.pendingLinks} />
            <MiniStat label="오늘 등록됨" value={collection.registeredToday} />
            <Link href="/collected" className="btn">
              수집함 열기
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "wait" | "bad";
}) {
  return (
    <div className="text-right">
      <p className="text-[11px] text-ink-muted">{label}</p>
      <p
        className={
          "tnum mt-0.5 text-[18px] font-semibold " +
          (tone === "wait" ? "text-wait" : tone === "bad" ? "text-bad" : "text-ink")
        }
      >
        {formatNumber(value)}
      </p>
    </div>
  );
}
