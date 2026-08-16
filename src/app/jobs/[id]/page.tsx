import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge, Card, CardHeader, Progress } from "@/components/ui";
import { JobControls } from "@/components/JobControls";
import { prisma } from "@/lib/db";
import { getOwner } from "@/lib/owner";
import { absoluteTime, relativeTime } from "@/lib/format";
import { parseJobOptions } from "@/lib/jobOptions";
import { JOB_STATUS_LABEL, JobStatus, TASK_STATUS_LABEL, TaskStatus } from "@/lib/enums";

export const dynamic = "force-dynamic";

const TONE: Record<string, "neutral" | "ok" | "bad" | "wait"> = {
  PENDING: "neutral",
  RUNNING: "neutral",
  WAITING_APPROVAL: "wait",
  SUCCESS: "ok",
  FAILED: "bad",
  SKIPPED: "neutral",
};

const OPTION_LABELS: Array<[keyof ReturnType<typeof parseJobOptions>, string]> = [
  ["skipJoined", "이미 입장한 방 건너뛰기"],
  ["autoPrereq", "선행 채널 자동 인식"],
  ["probeHidden", "말을 걸어 숨은 선행 채널 찾기"],
  ["autoCollect", "홍보 링크 자동 수집"],
  ["autoArchive", "자동 보관처리"],
  ["autoMute", "알림 끄기"],
];

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const owner = await getOwner();
  const { id } = await params;

  const job = await prisma.joinJob.findFirst({
    where: { id, ownerId: owner.id },
    include: {
      account: { select: { label: true, joinIntervalSec: true } },
      tasks: {
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
        include: { target: { select: { key: true, title: true } } },
      },
    },
  });

  if (!job) notFound();

  const options = parseJobOptions(job.options);
  const enabled = OPTION_LABELS.filter(([key]) => options[key]).map(([, label]) => label);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/queue" className="text-[12px] text-ink-muted hover:text-ink">
            ← 큐로 돌아가기
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-[17px] font-semibold">
            {job.name}
            <Badge tone={job.status === "DONE" ? "ok" : job.status === "CANCELLED" ? "bad" : "neutral"}>
              {JOB_STATUS_LABEL[job.status as JobStatus] ?? job.status}
            </Badge>
          </h1>
          <p className="mt-1 text-[12px] text-ink-muted">
            {job.account.label} · {absoluteTime(job.createdAt)} 등록 · 간격 {job.account.joinIntervalSec}초
          </p>
        </div>
        <JobControls jobId={job.id} status={job.status} />
      </header>

      <Card>
        <div className="flex flex-wrap items-center gap-8 px-4 py-4">
          <div>
            <p className="text-[11px] text-ink-muted">진행</p>
            <div className="mt-1">
              <Progress done={job.doneCount} total={job.totalCount} />
            </div>
          </div>
          <Metric label="실패" value={job.failedCount} />
          <Metric label="건너뜀" value={job.skippedCount} />
          <div className="min-w-0">
            <p className="text-[11px] text-ink-muted">적용된 옵션</p>
            <p className="mt-1 text-[12px]">{enabled.length ? enabled.join(" · ") : "없음"}</p>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="대상" subtitle={`${job.tasks.length}건 — 선행 채널은 위로 올라옵니다.`} />
        <table className="w-full border-t border-line">
          <thead>
            <tr className="border-b border-line">
              <th className="th">대상</th>
              <th className="th w-[12%]">상태</th>
              <th className="th w-[8%]">시도</th>
              <th className="th w-[14%]">다음 시도</th>
              <th className="th w-[30%]">메시지</th>
            </tr>
          </thead>
          <tbody>
            {job.tasks.map((task) => (
              <tr key={task.id} className="border-b border-line last:border-0">
                <td className="td">
                  <span className="flex items-center gap-1.5">
                    <span className="font-medium">{task.target.key}</span>
                    {task.isPrereq ? <Badge tone="wait">선행</Badge> : null}
                  </span>
                  <p className="mt-0.5 truncate text-ink-muted">{task.target.title ?? "제목 미확인"}</p>
                </td>
                <td className="td">
                  <Badge tone={TONE[task.status] ?? "neutral"}>
                    {TASK_STATUS_LABEL[task.status as TaskStatus] ?? task.status}
                  </Badge>
                </td>
                <td className="td tnum text-ink-muted">
                  {task.attempts}/{task.maxAttempts}
                </td>
                <td className="td text-ink-muted">{task.status === "PENDING" ? relativeTime(task.nextAttemptAt) : "-"}</td>
                <td className="td text-ink-muted">{task.lastError ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[11px] text-ink-muted">{label}</p>
      <p className="tnum mt-1 text-[16px] font-semibold">{value}</p>
    </div>
  );
}
