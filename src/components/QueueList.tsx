"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";

import { ErrorNote } from "./Modal";
import { Badge } from "./ui";
import { apiRequest } from "@/lib/client/api";
import { relativeTime } from "@/lib/format";
import { TASK_STATUS_LABEL, TaskStatus } from "@/lib/enums";

export type QueueRow = {
  id: string;
  status: string;
  targetKey: string;
  targetTitle: string | null;
  accountLabel: string;
  jobId: string;
  jobName: string | null;
  isPrereq: boolean;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastError: string | null;
};

const TABS: Array<{ value: string; label: string }> = [
  { value: "PENDING", label: "대기" },
  { value: "WAITING_APPROVAL", label: "승인 대기" },
  { value: "FAILED", label: "실패" },
  { value: "SUCCESS", label: "완료" },
  { value: "ALL", label: "전체" },
];

const TONE: Record<string, "neutral" | "ok" | "bad" | "wait"> = {
  PENDING: "neutral",
  RUNNING: "neutral",
  WAITING_APPROVAL: "wait",
  SUCCESS: "ok",
  FAILED: "bad",
  SKIPPED: "neutral",
};

/** The queue screen — inspect, retry and cancel individual join attempts. */
export function QueueList({
  rows,
  counts,
  activeStatus,
}: {
  rows: QueueRow[];
  counts: Record<string, number>;
  activeStatus: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));

  function navigate(status: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (status === "PENDING") params.delete("status");
    else params.set("status", status);
    startTransition(() => router.push(`/queue?${params.toString()}`));
  }

  async function act(action: "retry" | "cancel") {
    setBusy(true);
    setError(null);
    try {
      await apiRequest("/api/tasks", { body: { taskIds: [...selected], action } });
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="card">
        <div className="flex items-center gap-1 px-3">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => navigate(tab.value)}
              className={clsx(
                "-mb-px border-b-2 px-3 py-2.5 text-[12px] transition-colors",
                activeStatus === tab.value
                  ? "border-ink font-medium text-ink"
                  : "border-transparent text-ink-muted hover:text-ink",
              )}
            >
              {tab.label} <span className="tnum ml-1 text-ink-faint">{counts[tab.value] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {selected.size > 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-card px-4 py-2.5">
          <span className="text-[12px] font-medium">{selected.size}개 선택됨</span>
          <button type="button" className="text-[12px] text-ink-muted underline underline-offset-2" onClick={() => setSelected(new Set())}>
            선택 해제
          </button>
          <div className="ml-auto flex gap-2">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act("retry")}>
              다시 시도
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => act("cancel")}>
              취소
            </button>
          </div>
        </div>
      ) : null}

      <ErrorNote message={error} />

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <th className="th w-10">
                <input
                  type="checkbox"
                  className="checkbox mt-0"
                  checked={allSelected}
                  onChange={() =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (allSelected) rows.forEach((row) => next.delete(row.id));
                      else rows.forEach((row) => next.add(row.id));
                      return next;
                    })
                  }
                />
              </th>
              <th className="th">대상</th>
              <th className="th w-[16%]">작업 / 계정</th>
              <th className="th w-[10%]">상태</th>
              <th className="th w-[8%]">시도</th>
              <th className="th w-[13%]">다음 시도</th>
              <th className="th w-[22%]">최근 메시지</th>
            </tr>
          </thead>
          <tbody className={isPending ? "opacity-50" : undefined}>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="td py-12 text-center text-ink-faint">
                  해당 상태의 작업이 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-line last:border-0">
                  <td className="td">
                    <input
                      type="checkbox"
                      className="checkbox mt-0"
                      checked={selected.has(row.id)}
                      onChange={() =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (next.has(row.id)) next.delete(row.id);
                          else next.add(row.id);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td className="td">
                    <span className="flex items-center gap-1.5">
                      <span className="font-medium">{row.targetKey}</span>
                      {row.isPrereq ? <Badge tone="wait">선행</Badge> : null}
                    </span>
                    <p className="mt-0.5 truncate text-ink-muted">{row.targetTitle ?? "제목 미확인"}</p>
                  </td>
                  <td className="td">
                    <p className="truncate">{row.jobName ?? "-"}</p>
                    <p className="mt-0.5 truncate text-ink-muted">{row.accountLabel}</p>
                  </td>
                  <td className="td">
                    <Badge tone={TONE[row.status] ?? "neutral"}>
                      {TASK_STATUS_LABEL[row.status as TaskStatus] ?? row.status}
                    </Badge>
                  </td>
                  <td className="td tnum text-ink-muted">
                    {row.attempts}/{row.maxAttempts}
                  </td>
                  <td className="td text-ink-muted">
                    {row.status === "PENDING" ? relativeTime(row.nextAttemptAt) : "-"}
                  </td>
                  <td className="td text-ink-muted">
                    <span className="line-clamp-2">{row.lastError ?? "-"}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
