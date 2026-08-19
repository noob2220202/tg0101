"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";

import { ErrorNote } from "./Modal";
import { PolicyDialog, PolicyForm } from "./PolicyDialog";
import { Badge, ScoreBar } from "./ui";
import { apiRequest } from "@/lib/client/api";
import { relativeTime } from "@/lib/format";
import { ENTITY_TYPE_LABEL, EntityType, LINK_STATUS_LABEL, LinkStatus } from "@/lib/enums";

export type CollectedRow = {
  id: string;
  key: string;
  url: string;
  title: string | null;
  entityType: string;
  score: number;
  reason: string;
  status: string;
  roomCount: number;
  seenCount: number;
  lastSeenAt: string;
  topSource: string | null;
};

const TABS: Array<{ status: LinkStatus | "ALL"; label: string }> = [
  { status: "PENDING", label: "검토 대기" },
  { status: "APPROVED", label: "승인됨" },
  { status: "REGISTERED", label: "등록됨" },
  { status: "EXCLUDED", label: "제외됨" },
  { status: "ALL", label: "전체" },
];

/** How often the screen re-reads the list while collection runs live. */
const LIVE_REFRESH_MS = 15_000;

const STATUS_TONE: Record<string, "neutral" | "ok" | "bad" | "wait"> = {
  PENDING: "neutral",
  APPROVED: "wait",
  REGISTERED: "ok",
  EXCLUDED: "bad",
};

/**
 * The 수집된 링크 screen: review what the collector found and decide what gets
 * promoted into the real target list.
 */
export function CollectedList({
  rows,
  counts,
  policy,
  accounts,
  activeStatus,
  query,
  minScore,
  entityType,
}: {
  rows: CollectedRow[];
  counts: { pending: number; approved: number; registered: number; excluded: number; total: number };
  policy: PolicyForm;
  accounts: Array<{ id: string; label: string }>;
  activeStatus: string;
  query: string;
  minScore: string;
  entityType: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [policyOpen, setPolicyOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(query);
  const [busy, setBusy] = useState(false);

  // Links now land the moment they are posted, so the list is stale within
  // seconds of loading. Refresh while the tab is in front and idle — a refresh
  // mid-selection would pull the rows out from under the operator.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (busy || policyOpen || selected.size > 0) return;
      router.refresh();
    }, LIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [router, busy, policyOpen, selected.size]);

  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));

  function countFor(status: LinkStatus | "ALL"): number {
    switch (status) {
      case "PENDING":
        return counts.pending;
      case "APPROVED":
        return counts.approved;
      case "REGISTERED":
        return counts.registered;
      case "EXCLUDED":
        return counts.excluded;
      default:
        return counts.total;
    }
  }

  function navigate(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    startTransition(() => router.push(`/collected?${params.toString()}`));
  }

  async function act(action: "approve" | "exclude" | "register" | "reset") {
    setBusy(true);
    setError(null);
    try {
      await apiRequest("/api/collected", { body: { linkIds: [...selected], action } });
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
        <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-3.5">
          <div className="max-w-[560px]">
            <h2 className="card-title">수집된 링크</h2>
            <p className="card-sub mt-1">
              계정이 들어가 있는 방들이 홍보하는 다른 방의 링크입니다. 입장 큐와 무관하게 상시로 모이며, 점수가 높을수록 실제 입장 가능한
              홍보방일 가능성이 큽니다.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-md bg-sky-50 px-2 py-1 text-[11px] text-sky-900">
              {policy.enabled && policy.autoRegister
                ? `자동 등록 켜짐 — ${policy.minScore}점 이상, 하루 최대 ${policy.dailyLimit}건`
                : policy.enabled
                  ? "수집만 함 — 자동 등록 꺼짐"
                  : "수집 꺼짐"}
            </span>
            <button type="button" className="btn" onClick={() => setPolicyOpen(true)}>
              수집 정책
            </button>
          </div>
        </div>

        {/* ---- status tabs ------------------------------------------------- */}
        <div className="flex items-center gap-1 border-t border-line px-3">
          {TABS.map((tab) => {
            const active = activeStatus === tab.status;
            return (
              <button
                key={tab.status}
                type="button"
                onClick={() => navigate({ status: tab.status === "PENDING" ? null : tab.status })}
                className={clsx(
                  "-mb-px border-b-2 px-3 py-2.5 text-[12px] transition-colors",
                  active ? "border-ink font-medium text-ink" : "border-transparent text-ink-muted hover:text-ink",
                )}
              >
                {tab.label} <span className="tnum ml-1 text-ink-faint">{countFor(tab.status)}</span>
              </button>
            );
          })}
        </div>

        {/* ---- filters ------------------------------------------------------ */}
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
          <input
            className="input max-w-[280px]"
            placeholder="링크 · 판정 사유 검색"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") navigate({ q: search || null });
            }}
          />
          <label className="flex items-center gap-2 text-[12px] text-ink-muted">
            종류
            <select className="input w-auto py-1.5" value={entityType} onChange={(event) => navigate({ type: event.target.value || null })}>
              <option value="">전체</option>
              <option value="GROUP">그룹 (홍보·소통방)</option>
              <option value="CHANNEL">채널 (읽기 전용)</option>
              <option value="BOT">봇</option>
              <option value="UNKNOWN">미확인</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-[12px] text-ink-muted">
            최소 점수
            <select className="input w-auto py-1.5" value={minScore} onChange={(event) => navigate({ score: event.target.value || null })}>
              <option value="">전체</option>
              <option value="40">40점 이상</option>
              <option value="60">60점 이상</option>
              <option value="70">70점 이상</option>
              <option value="85">85점 이상</option>
            </select>
          </label>
          <span className="ml-auto text-[12px] text-ink-muted">총 {rows.length}개</span>
        </div>
      </div>

      {/* ---- bulk actions --------------------------------------------------- */}
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card px-4 py-2.5">
          <span className="text-[12px] font-medium">{selected.size}개 선택됨</span>
          <button type="button" className="text-[12px] text-ink-muted underline underline-offset-2" onClick={() => setSelected(new Set())}>
            선택 해제
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act("register")}>
              그룹으로 등록
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => act("approve")}>
              승인
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => act("exclude")}>
              제외
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => act("reset")}>
              검토 대기로
            </button>
          </div>
        </div>
      ) : null}

      <ErrorNote message={error} />

      {/* ---- table ---------------------------------------------------------- */}
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
              <th className="th">링크</th>
              <th className="th w-[10%]">종류</th>
              <th className="th w-[14%]">점수</th>
              <th className="th w-[24%]">수집 출처</th>
              <th className="th w-[10%]">상태</th>
              <th className="th w-[12%]">최근 발견</th>
            </tr>
          </thead>
          <tbody className={isPending ? "opacity-50" : undefined}>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="td py-12 text-center text-ink-faint">
                  조건에 맞는 링크가 없습니다.
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
                      <a href={row.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                        {row.key}
                      </a>
                      <Badge>{row.key.startsWith("+") ? "비공개" : "공개"}</Badge>
                    </span>
                    <p className="mt-0.5 truncate text-ink-muted">{row.title ?? "제목 미확인"}</p>
                  </td>
                  <td className="td text-ink-muted">
                    {ENTITY_TYPE_LABEL[row.entityType as EntityType] ?? row.entityType}
                  </td>
                  <td className="td">
                    <ScoreBar score={row.score} />
                  </td>
                  <td className="td">
                    <p className="truncate">{row.topSource ?? "출처 미상"}</p>
                    <p className="mt-0.5 text-ink-muted">
                      {row.roomCount > 0 ? `${row.roomCount}개 방에서 발견 · ` : ""}
                      {row.seenCount}회 노출
                    </p>
                  </td>
                  <td className="td">
                    <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>
                      {LINK_STATUS_LABEL[row.status as LinkStatus] ?? row.status}
                    </Badge>
                  </td>
                  <td className="td text-ink-muted">{relativeTime(row.lastSeenAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PolicyDialog open={policyOpen} onClose={() => setPolicyOpen(false)} policy={policy} accounts={accounts} />
    </div>
  );
}
