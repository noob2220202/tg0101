"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { ErrorNote } from "./Modal";
import { apiRequest } from "@/lib/client/api";

/** Sign-in, or first-run admin creation when there are no operators yet. */
export function LoginForm({ firstRun }: { firstRun: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiRequest("/api/auth/login", {
        body: firstRun ? { action: "setup", email, password, name } : { action: "login", email, password },
      });
      // A full navigation so server components re-read the new cookie.
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      {firstRun ? (
        <div>
          <label className="mb-1.5 block text-[13px] font-medium">이름</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
        </div>
      ) : null}

      <div>
        <label className="mb-1.5 block text-[13px] font-medium">이메일</label>
        <input
          type="email"
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </div>

      <div>
        <label className="mb-1.5 block text-[13px] font-medium">비밀번호</label>
        <input
          type="password"
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={firstRun ? "new-password" : "current-password"}
          required
        />
        {firstRun ? <p className="mt-1.5 text-[12px] text-ink-muted">8자 이상, 영문자와 숫자를 포함하세요.</p> : null}
      </div>

      <ErrorNote message={error} />

      <button type="submit" className="btn btn-primary w-full py-2" disabled={busy}>
        {busy ? "확인 중…" : firstRun ? "관리자 계정 만들기" : "로그인"}
      </button>
    </form>
  );
}
