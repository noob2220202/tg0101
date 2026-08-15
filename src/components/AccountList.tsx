"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { CheckboxField, ErrorNote, Modal } from "./Modal";
import { Badge } from "./ui";
import Link from "next/link";

import { apiRequest } from "@/lib/client/api";
import { absoluteTime, relativeTime } from "@/lib/format";
import { riskLabel } from "@/lib/health";
import { ACCOUNT_STATUS_LABEL, AccountStatus } from "@/lib/enums";

export type AccountRow = {
  id: string;
  label: string;
  phone: string | null;
  status: string;
  hasSession: boolean;
  joinIntervalSec: number;
  dailyJoinLimit: number;
  collectEnabled: boolean;
  cooldownUntil: string | null;
  cooldownReason: string | null;
  lastJoinAt: string | null;
  joinedRooms: number;
  pendingTasks: number;
  riskScore: number | null;
  riskReason: string | null;
  spamStatus: string | null;
};

const TONE: Record<string, "neutral" | "ok" | "bad" | "wait"> = {
  ACTIVE: "ok",
  COOLDOWN: "wait",
  NEEDS_CHECK: "bad",
  DISABLED: "neutral",
};

export function AccountList({ accounts, mockMode }: { accounts: AccountRow[]; mockMode: boolean }) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await apiRequest(`/api/accounts/${id}`, { method: "PATCH", body });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string, label: string) {
    if (!confirm(`계정 "${label}" 을(를) 삭제할까요? 입장 기록도 함께 사라집니다.`)) return;
    setBusyId(id);
    setError(null);
    try {
      await apiRequest(`/api/accounts/${id}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-ink-muted">
          {mockMode ? "MOCK_TELEGRAM=1 — 실제 텔레그램에 연결하지 않는 테스트 모드입니다." : "실제 텔레그램 계정에 연결됩니다."}
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>
          계정 연결
        </button>
      </div>

      <ErrorNote message={error} />

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <th className="th">계정</th>
              <th className="th w-[10%]">상태</th>
              <th className="th w-[12%]">건강도</th>
              <th className="th w-[12%]">페이싱</th>
              <th className="th w-[10%]">입장한 방</th>
              <th className="th w-[10%]">대기 작업</th>
              <th className="th w-[14%]">최근 입장</th>
              <th className="th w-[18%] text-right">동작</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr>
                <td colSpan={8} className="td py-12 text-center text-ink-faint">
                  연결된 계정이 없습니다. “계정 연결”로 시작하세요.
                </td>
              </tr>
            ) : (
              accounts.map((account) => (
                <tr key={account.id} className="border-b border-line last:border-0">
                  <td className="td">
                    <Link href={`/accounts/${account.id}`} className="font-medium hover:underline">
                      {account.label}
                    </Link>
                    <p className="mt-0.5 text-ink-muted">
                      {account.phone ?? "번호 미등록"}
                      {account.collectEnabled ? " · 링크 수집 켜짐" : ""}
                      {!account.hasSession ? " · 세션 없음" : ""}
                    </p>
                  </td>
                  <td className="td">
                    <Badge tone={TONE[account.status] ?? "neutral"}>
                      {ACCOUNT_STATUS_LABEL[account.status as AccountStatus] ?? account.status}
                    </Badge>
                    {account.cooldownUntil ? (
                      <p className="mt-1 text-[11px] text-wait" title={account.cooldownReason ?? undefined}>
                        {relativeTime(account.cooldownUntil)} 재개
                      </p>
                    ) : null}
                  </td>
                  <td className="td">
                    {account.riskScore === null ? (
                      <span className="text-ink-faint">-</span>
                    ) : (
                      <span title={account.riskReason ?? undefined}>
                        <Badge tone={riskLabel(account.riskScore).tone}>{riskLabel(account.riskScore).label}</Badge>
                        <span className="tnum ml-1.5 text-ink-muted">{account.riskScore}</span>
                      </span>
                    )}
                    {account.spamStatus === "LIMITED" ? (
                      <p className="mt-0.5 text-[11px] text-bad">스팸 제한</p>
                    ) : null}
                  </td>
                  <td className="td text-ink-muted">
                    {account.joinIntervalSec}초 간격
                    <br />
                    {account.dailyJoinLimit > 0 ? `하루 ${account.dailyJoinLimit}건` : "일일 한도 없음"}
                  </td>
                  <td className="td tnum">{account.joinedRooms}</td>
                  <td className="td tnum">{account.pendingTasks}</td>
                  <td className="td text-ink-muted" title={absoluteTime(account.lastJoinAt)}>
                    {relativeTime(account.lastJoinAt)}
                  </td>
                  <td className="td">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <Link href={`/accounts/${account.id}`} className="btn">
                        프로필
                      </Link>
                      {account.status === "COOLDOWN" ? (
                        <button
                          type="button"
                          className="btn"
                          disabled={busyId === account.id}
                          onClick={() => patch(account.id, { clearCooldown: true })}
                        >
                          대기 해제
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn"
                        disabled={busyId === account.id}
                        onClick={() =>
                          patch(account.id, { status: account.status === "DISABLED" ? "ACTIVE" : "DISABLED" })
                        }
                      >
                        {account.status === "DISABLED" ? "사용" : "중지"}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={busyId === account.id}
                        onClick={() => patch(account.id, { collectEnabled: !account.collectEnabled })}
                      >
                        수집 {account.collectEnabled ? "끄기" : "켜기"}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost rounded-md px-2 py-1.5 text-[12px] text-bad hover:bg-red-50"
                        disabled={busyId === account.id}
                        onClick={() => remove(account.id, account.label)}
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

      <ConnectDialog open={addOpen} onClose={() => setAddOpen(false)} mockMode={mockMode} />
    </div>
  );
}

type Stage = "FORM" | "CODE_REQUIRED" | "PASSWORD_REQUIRED";

/**
 * Telegram sign-in is a conversation: number, then the code it texts you, then
 * a 2FA password if the account has one. Each step is one request against
 * /api/accounts/login, which holds the half-finished client server-side.
 */
function ConnectDialog({ open, onClose, mockMode }: { open: boolean; onClose: () => void; mockMode: boolean }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("FORM");
  const [mode, setMode] = useState<"phone" | "session">("phone");

  const [label, setLabel] = useState("");
  const [phone, setPhone] = useState("");
  const [sessionString, setSessionString] = useState("");
  const [joinIntervalSec, setJoinIntervalSec] = useState(20);
  const [collectEnabled, setCollectEnabled] = useState(true);

  const [loginId, setLoginId] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setStage("FORM");
    setLabel("");
    setPhone("");
    setSessionString("");
    setCode("");
    setPassword("");
    setLoginId("");
    setError(null);
  }

  function close() {
    if (loginId) void apiRequest("/api/accounts/login", { body: { action: "cancel", loginId } }).catch(() => {});
    reset();
    onClose();
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const start = () =>
    run(async () => {
      if (mode === "session") {
        await apiRequest("/api/accounts", {
          body: { label, phone: phone || null, sessionString, joinIntervalSec, collectEnabled },
        });
        reset();
        onClose();
        router.refresh();
        return;
      }

      const result = await apiRequest<{ loginId: string; stage: Stage }>("/api/accounts/login", {
        body: { action: "start", label, phone },
      });
      setLoginId(result.loginId);
      setStage("CODE_REQUIRED");
    });

  const submitValue = (kind: "code" | "password") =>
    run(async () => {
      const result = await apiRequest<{ stage: string; accountId?: string }>("/api/accounts/login", {
        body: {
          action: "submit",
          loginId,
          kind,
          value: kind === "code" ? code : password,
          joinIntervalSec,
          collectEnabled,
        },
      });

      if (result.stage === "PASSWORD_REQUIRED") {
        setStage("PASSWORD_REQUIRED");
        return;
      }
      reset();
      onClose();
      router.refresh();
    });

  return (
    <Modal
      open={open}
      onClose={close}
      title="계정 연결"
      description={
        stage === "FORM"
          ? "입장을 실행할 텔레그램 계정을 연결합니다."
          : stage === "CODE_REQUIRED"
            ? "텔레그램 앱으로 전송된 인증 코드를 입력하세요."
            : "2단계 인증 비밀번호를 입력하세요."
      }
      width="max-w-[520px]"
      footer={
        <>
          <button type="button" className="btn" onClick={close} disabled={busy}>
            취소
          </button>
          {stage === "FORM" ? (
            <button type="button" className="btn btn-primary" onClick={start} disabled={busy || !label.trim()}>
              {busy ? "연결 중…" : mode === "session" ? "추가" : "인증 코드 받기"}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => submitValue(stage === "CODE_REQUIRED" ? "code" : "password")}
              disabled={busy}
            >
              {busy ? "확인 중…" : "확인"}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {stage === "FORM" ? (
          <>
            <div className="flex gap-1 rounded-md bg-stone-100 p-1 text-[12px]">
              {(["phone", "session"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={
                    "flex-1 rounded px-3 py-1.5 transition-colors " +
                    (mode === value ? "bg-white font-medium shadow-sm" : "text-ink-muted")
                  }
                >
                  {value === "phone" ? "전화번호로 로그인" : "세션 문자열 붙여넣기"}
                </button>
              ))}
            </div>

            <div>
              <label className="mb-1.5 block text-[13px] font-medium">계정 이름</label>
              <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="예: 산타산타" />
            </div>

            {mode === "phone" ? (
              <div>
                <label className="mb-1.5 block text-[13px] font-medium">전화번호</label>
                <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+821012345678" />
                {mockMode ? (
                  <p className="mt-1.5 text-[12px] text-ink-muted">테스트 모드에서는 아무 코드나 입력하면 연결됩니다.</p>
                ) : null}
              </div>
            ) : (
              <div>
                <label className="mb-1.5 block text-[13px] font-medium">세션 문자열</label>
                <textarea
                  className="input h-24 resize-none font-mono text-[11px]"
                  value={sessionString}
                  onChange={(e) => setSessionString(e.target.value)}
                  placeholder="기존에 발급받은 StringSession"
                />
                <p className="mt-1.5 text-[12px] text-ink-muted">저장 시 암호화됩니다. SESSION_SECRET 을 바꾸면 복호화할 수 없습니다.</p>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-[13px] font-medium">입장 간격 (초)</label>
              <input
                type="number"
                className="input tnum"
                value={joinIntervalSec}
                onChange={(e) => setJoinIntervalSec(Number(e.target.value))}
              />
              <p className="mt-1.5 text-[12px] text-ink-muted">
                짧을수록 텔레그램이 대기시간을 요구할 가능성이 커집니다. 20초 이상을 권장합니다.
              </p>
            </div>

            <CheckboxField
              checked={collectEnabled}
              onChange={setCollectEnabled}
              label="이 계정으로 홍보 링크 수집"
              description="입장해 있는 방을 주기적으로 훑어 다른 방의 링크를 모읍니다."
            />
          </>
        ) : stage === "CODE_REQUIRED" ? (
          <div>
            <label className="mb-1.5 block text-[13px] font-medium">인증 코드</label>
            <input className="input tnum tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} placeholder="12345" />
          </div>
        ) : (
          <div>
            <label className="mb-1.5 block text-[13px] font-medium">2단계 인증 비밀번호</label>
            <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        )}

        <ErrorNote message={error} />
      </div>
    </Modal>
  );
}
