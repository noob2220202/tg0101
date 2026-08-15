"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { ErrorNote } from "./Modal";
import { Badge } from "./ui";
import { apiRequest } from "@/lib/client/api";
import { relativeTime } from "@/lib/format";

export type RuleRow = {
  id: string;
  name: string;
  terms: string;
  accountId: string | null;
  accountLabel: string | null;
  enabled: boolean;
  hitCount: number;
  lastHitAt: string | null;
};

/**
 * Keyword rules run against every inbound message on every watched account.
 * With hundreds of rooms joined, this is the only realistic way to notice a
 * specific message.
 */
export function KeywordRules({
  rules,
  accounts,
}: {
  rules: RuleRow[];
  accounts: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [terms, setTerms] = useState("");
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const create = () =>
    run(async () => {
      await apiRequest("/api/keywords", {
        body: { action: "create", name, terms, accountId: accountId || null },
      });
      setName("");
      setTerms("");
      setAccountId("");
    });

  const toggle = (rule: RuleRow) =>
    run(() => apiRequest("/api/keywords", { body: { action: "update", id: rule.id, enabled: !rule.enabled } }));

  const remove = (rule: RuleRow) =>
    run(async () => {
      if (!confirm(`규칙 "${rule.name}" 을(를) 삭제할까요?`)) return;
      await apiRequest("/api/keywords", { body: { action: "delete", id: rule.id } });
    });

  return (
    <div className="space-y-4">
      <section className="card space-y-3 p-4">
        <div>
          <h2 className="card-title">규칙 추가</h2>
          <p className="card-sub mt-1">
            쉼표로 구분한 단어 중 하나라도 들어간 메시지가 오면 채팅 화면에 알림이 뜨고, 해당 메시지는 따로 보관됩니다.
          </p>
        </div>

        <div className="grid grid-cols-[1fr_1.6fr_180px_auto] items-end gap-2">
          <div>
            <label className="mb-1.5 block text-[12px] font-medium">규칙 이름</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="구인 감시" />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-medium">감시할 단어</label>
            <input
              className="input"
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder="구인, 구직, 총판"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-medium">대상 계정</label>
            <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">전체 계정</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn btn-primary" onClick={create} disabled={busy || !name.trim() || !terms.trim()}>
            추가
          </button>
        </div>

        <ErrorNote message={error} />
      </section>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <th className="th">규칙</th>
              <th className="th w-[30%]">단어</th>
              <th className="th w-[14%]">대상</th>
              <th className="th w-[10%]">적중</th>
              <th className="th w-[12%]">최근 적중</th>
              <th className="th w-[14%] text-right">동작</th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr>
                <td colSpan={6} className="td py-10 text-center text-ink-faint">
                  등록된 규칙이 없습니다.
                </td>
              </tr>
            ) : (
              rules.map((rule) => (
                <tr key={rule.id} className="border-b border-line last:border-0">
                  <td className="td">
                    <span className="flex items-center gap-1.5">
                      <span className="font-medium">{rule.name}</span>
                      {rule.enabled ? <Badge tone="ok">켜짐</Badge> : <Badge>꺼짐</Badge>}
                    </span>
                  </td>
                  <td className="td text-ink-muted">{rule.terms}</td>
                  <td className="td text-ink-muted">{rule.accountLabel ?? "전체"}</td>
                  <td className="td tnum">{rule.hitCount}</td>
                  <td className="td text-ink-muted">{rule.lastHitAt ? relativeTime(rule.lastHitAt) : "-"}</td>
                  <td className="td">
                    <div className="flex justify-end gap-1.5">
                      <button type="button" className="btn" onClick={() => toggle(rule)} disabled={busy}>
                        {rule.enabled ? "끄기" : "켜기"}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost rounded-md px-2 py-1.5 text-[12px] text-bad hover:bg-red-50"
                        onClick={() => remove(rule)}
                        disabled={busy}
                      >
                        삭제
                      </button>
                    </div>
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
