"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { ReserveAccount, ReserveDialog } from "./ReserveDialog";
import { ErrorNote, Modal } from "./Modal";
import { Badge } from "./ui";
import { apiRequest } from "@/lib/client/api";
import { relativeTime } from "@/lib/format";

export type GroupRow = {
  id: string;
  key: string;
  title: string | null;
  source: string;
  archived: boolean;
  memberCount: number | null;
  createdAt: string;
  lastResult: { status: string; message: string | null; at: string | null } | null;
};

const RESULT_TONE: Record<string, "ok" | "bad" | "wait" | "neutral"> = {
  SUCCESS: "ok",
  FAILED: "bad",
  WAITING_APPROVAL: "wait",
  PENDING: "neutral",
  RUNNING: "neutral",
  SKIPPED: "neutral",
};

const RESULT_LABEL: Record<string, string> = {
  SUCCESS: "입장 완료",
  FAILED: "실패",
  WAITING_APPROVAL: "승인 대기",
  PENDING: "대기",
  RUNNING: "진행 중",
  SKIPPED: "건너뜀",
};

/**
 * The group list: select rows, then reserve joins or archive them.
 *
 * Selection is client state; filtering is a server round-trip via the URL so
 * the list stays consistent with what the reservation dialog will act on.
 */
export function GroupList({
  rows,
  accounts,
  totalMatching,
  query,
  includeArchived,
}: {
  rows: GroupRow[];
  accounts: ReserveAccount[];
  totalMatching: number;
  query: string;
  includeArchived: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reserveOpen, setReserveOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(query);

  const allOnPageSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllOnPage() {
    setSelected((current) => {
      const next = new Set(current);
      if (allOnPageSelected) rows.forEach((row) => next.delete(row.id));
      else rows.forEach((row) => next.add(row.id));
      return next;
    });
  }

  function applyFilters(next: { q?: string; archived?: boolean }) {
    const params = new URLSearchParams(searchParams.toString());
    const q = next.q ?? search;
    const archived = next.archived ?? includeArchived;

    if (q) params.set("q", q);
    else params.delete("q");
    if (archived) params.set("archived", "1");
    else params.delete("archived");

    startTransition(() => router.push(`/groups?${params.toString()}`));
  }

  async function archiveSelected(archived: boolean) {
    setError(null);
    try {
      await apiRequest("/api/targets", {
        method: "PATCH",
        body: { targetIds: [...selected], archived },
      });
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="space-y-3">
      {/* ---- filter bar ---------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          className="input max-w-[320px]"
          placeholder="링크 · 제목 검색"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") applyFilters({ q: search });
          }}
        />
        <button type="button" className="btn" onClick={() => applyFilters({ q: search })}>
          검색
        </button>
        <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-muted">
          <input
            type="checkbox"
            className="checkbox mt-0"
            checked={includeArchived}
            onChange={(event) => applyFilters({ archived: event.target.checked })}
          />
          보관 포함
        </label>

        <div className="ml-auto">
          <button type="button" className="btn btn-primary" onClick={() => setImportOpen(true)}>
            링크 추가
          </button>
        </div>
      </div>

      {/* ---- selection toolbar --------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-card px-4 py-2.5">
        <span className="text-[12px] font-medium">
          {selected.size > 0 ? `${selected.size}개 선택됨` : `총 ${totalMatching}개`}
        </span>
        {selected.size > 0 ? (
          <button type="button" className="text-[12px] text-ink-muted underline underline-offset-2" onClick={() => setSelected(new Set())}>
            선택 해제
          </button>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="btn btn-primary"
            disabled={selected.size === 0 || accounts.length === 0}
            onClick={() => setReserveOpen(true)}
          >
            입장 예약
          </button>
          <button type="button" className="btn" disabled={selected.size === 0} onClick={() => archiveSelected(true)}>
            보관
          </button>
          {includeArchived ? (
            <button type="button" className="btn" disabled={selected.size === 0} onClick={() => archiveSelected(false)}>
              보관 해제
            </button>
          ) : null}
        </div>
      </div>

      <ErrorNote message={error} />
      {accounts.length === 0 ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-wait">
          활성 계정이 없어 입장을 예약할 수 없습니다. 먼저 계정을 연결하세요.
        </p>
      ) : null}

      {/* ---- table ---------------------------------------------------------- */}
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <th className="th w-10">
                <input type="checkbox" className="checkbox mt-0" checked={allOnPageSelected} onChange={toggleAllOnPage} />
              </th>
              <th className="th">링크</th>
              <th className="th w-[20%]">최근 결과</th>
              <th className="th w-[14%]">등록</th>
            </tr>
          </thead>
          <tbody className={isPending ? "opacity-50" : undefined}>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="td py-12 text-center text-ink-faint">
                  조건에 맞는 방이 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-line last:border-0">
                  <td className="td">
                    <input type="checkbox" className="checkbox mt-0" checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
                  </td>
                  <td className="td">
                    <a
                      href={`https://t.me/${row.key.replace("+", "+")}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium hover:underline"
                    >
                      {row.key}
                    </a>
                    <div className="mt-0.5 flex items-center gap-1.5 text-ink-muted">
                      <span className="truncate">{row.title ?? "제목 미확인"}</span>
                      {row.source === "AUTO_COLLECT" ? <Badge>자동수집</Badge> : null}
                      {row.archived ? <Badge>보관됨</Badge> : null}
                    </div>
                  </td>
                  <td className="td">
                    {row.lastResult ? (
                      <span className="flex items-center gap-2">
                        <Badge tone={RESULT_TONE[row.lastResult.status] ?? "neutral"}>
                          {RESULT_LABEL[row.lastResult.status] ?? row.lastResult.status}
                        </Badge>
                        <span className="text-ink-faint">{relativeTime(row.lastResult.at)}</span>
                      </span>
                    ) : (
                      <span className="text-ink-faint">-</span>
                    )}
                  </td>
                  <td className="td text-ink-muted">{relativeTime(row.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ReserveDialog
        open={reserveOpen}
        onClose={() => setReserveOpen(false)}
        targetIds={[...selected]}
        accounts={accounts}
      />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

/** Paste-a-list importer. */
function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const data = await apiRequest<{ created: number; existing: number; invalid: string[] }>("/api/targets", {
        body: { links: value },
      });
      setResult(
        `${data.created}개 추가 · ${data.existing}개는 이미 등록됨` +
          (data.invalid.length ? ` · 인식 불가 ${data.invalid.length}개` : ""),
      );
      setValue("");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="링크 추가"
      description="한 줄에 하나씩 붙여넣으세요. t.me 주소, @아이디, 초대 링크 모두 인식합니다."
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={submitting || !value.trim()}>
            {submitting ? "추가 중…" : "추가"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <textarea
          className="input h-48 resize-none font-mono text-[12px]"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={"https://t.me/example\n@another_group\nhttps://t.me/+AbCdEfGh1234"}
        />
        {result ? <p className="text-[12px] text-ok">{result}</p> : null}
        <ErrorNote message={error} />
      </div>
    </Modal>
  );
}
