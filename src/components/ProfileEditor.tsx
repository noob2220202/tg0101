"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ErrorNote } from "./Modal";
import { Badge } from "./ui";
import { apiRequest } from "@/lib/client/api";
import { absoluteTime } from "@/lib/format";
import { riskLabel } from "@/lib/health";

type Profile = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  phone: string | null;
  about: string | null;
  hasPhoto: boolean;
};

type Authorization = {
  hash: string;
  deviceModel: string;
  platform: string;
  appName: string;
  ip: string;
  country: string;
  dateActive: string | null;
  current: boolean;
};

type SpamResult = { status: string; message: string; restrictedUntil: string | null };

/**
 * Edit one Telegram account's own profile — name, username, bio, photo — plus
 * its active logins and spam status. Everything here mutates the real account,
 * so each section commits on its own rather than as one big save.
 */
export function ProfileEditor({
  accountId,
  accountLabel,
  gatewayUp,
  health,
}: {
  accountId: string;
  accountLabel: string;
  gatewayUp: boolean;
  health: { riskScore: number; riskReason: string; spamStatus: string; checkedAt: string | null } | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [about, setAbout] = useState("");
  const [username, setUsername] = useState("");

  const [sessions, setSessions] = useState<Authorization[] | null>(null);
  const [spam, setSpam] = useState<SpamResult | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!gatewayUp) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const data = await apiRequest<Profile>("/api/profile", { body: { action: "get", accountId } });
        setProfile(data);
        setFirstName(data.firstName ?? "");
        setLastName(data.lastName ?? "");
        setAbout(data.about ?? "");
        setUsername(data.username ?? "");
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [accountId, gatewayUp]);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const saveProfile = () =>
    run("profile", async () => {
      const updated = await apiRequest<Profile>("/api/profile", {
        body: { action: "update", accountId, firstName, lastName, about },
      });
      setProfile(updated);
      setNotice("프로필을 저장했습니다.");
      router.refresh();
    });

  const saveUsername = () =>
    run("username", async () => {
      const updated = await apiRequest<Profile>("/api/profile", {
        body: { action: "username", accountId, username },
      });
      setProfile(updated);
      setNotice("아이디를 변경했습니다.");
      router.refresh();
    });

  const uploadPhoto = (file: File) =>
    run("photo", async () => {
      const buffer = await file.arrayBuffer();
      // btoa needs a binary string; chunking avoids blowing the call stack on
      // multi-megabyte images.
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      await apiRequest("/api/profile", {
        body: { action: "photo", accountId, dataBase64: btoa(binary), fileName: file.name },
      });
      setProfile((current) => (current ? { ...current, hasPhoto: true } : current));
      setNotice("프로필 사진을 변경했습니다.");
    });

  const deletePhoto = () =>
    run("deletePhoto", async () => {
      await apiRequest("/api/profile", { body: { action: "deletePhoto", accountId } });
      setProfile((current) => (current ? { ...current, hasPhoto: false } : current));
      setNotice("프로필 사진을 삭제했습니다.");
    });

  const loadSessions = () =>
    run("sessions", async () => {
      setSessions(await apiRequest<Authorization[]>("/api/profile", { body: { action: "sessions", accountId } }));
    });

  const resetSession = (hash: string) =>
    run(`reset-${hash}`, async () => {
      await apiRequest("/api/profile", { body: { action: "resetSession", accountId, hash } });
      setSessions((current) => current?.filter((s) => s.hash !== hash) ?? null);
      setNotice("해당 기기의 로그인을 종료했습니다.");
    });

  const checkSpam = () =>
    run("spam", async () => {
      setSpam(await apiRequest<SpamResult>("/api/profile", { body: { action: "checkSpam", accountId } }));
      router.refresh();
    });

  if (!gatewayUp) {
    return (
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-wait">
        워커가 실행 중이 아니라 프로필을 불러올 수 없습니다. <code className="font-mono">npm run worker</code> 를 실행하세요.
      </p>
    );
  }

  if (loading) return <p className="text-[12px] text-ink-faint">불러오는 중…</p>;

  const risk = health ? riskLabel(health.riskScore) : null;

  return (
    <div className="space-y-4">
      <ErrorNote message={error} />
      {notice ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-ok">{notice}</p>
      ) : null}

      {/* ---- health ---------------------------------------------------------- */}
      <section className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="card-title">계정 건강도</h2>
            <p className="card-sub mt-1">{health?.riskReason || "아직 평가되지 않았습니다."}</p>
          </div>
          <div className="flex items-center gap-4">
            {risk ? (
              <div className="text-right">
                <Badge tone={risk.tone}>{risk.label}</Badge>
                <p className="tnum mt-1 text-[18px] font-semibold">{health!.riskScore}</p>
              </div>
            ) : null}
            <button type="button" className="btn" onClick={checkSpam} disabled={busy === "spam"}>
              {busy === "spam" ? "확인 중…" : "스팸 상태 확인"}
            </button>
          </div>
        </div>

        {spam || health?.spamStatus ? (
          <p className="mt-3 rounded-md border border-line bg-stone-50 px-3 py-2 text-[12px] text-ink-muted">
            <strong className="font-medium text-ink">
              {(spam?.status ?? health?.spamStatus) === "LIMITED"
                ? "제한됨"
                : (spam?.status ?? health?.spamStatus) === "OK"
                  ? "제한 없음"
                  : "미확인"}
            </strong>
            {spam?.message ? ` — ${spam.message}` : ""}
            {health?.checkedAt && !spam ? ` · ${absoluteTime(health.checkedAt)} 확인` : ""}
          </p>
        ) : null}
      </section>

      {/* ---- profile --------------------------------------------------------- */}
      <section className="card space-y-4 p-4">
        <div>
          <h2 className="card-title">프로필</h2>
          <p className="card-sub mt-1">
            텔레그램에 표시되는 이름과 소개입니다. 저장하면 실제 계정에 즉시 반영됩니다.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block text-[13px] font-medium">이름</label>
            <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-medium">성</label>
            <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium">소개</label>
          <input className="input" value={about} maxLength={70} onChange={(e) => setAbout(e.target.value)} />
          <p className="mt-1.5 text-[12px] text-ink-muted">{about.length}/70자</p>
        </div>

        <div className="flex justify-end">
          <button type="button" className="btn btn-primary" onClick={saveProfile} disabled={busy === "profile"}>
            {busy === "profile" ? "저장 중…" : "프로필 저장"}
          </button>
        </div>
      </section>

      {/* ---- username -------------------------------------------------------- */}
      <section className="card space-y-3 p-4">
        <div>
          <h2 className="card-title">아이디 (@username)</h2>
          <p className="card-sub mt-1">영문으로 시작하는 5~32자. 아이디가 있으면 링크로 검색될 수 있습니다.</p>
        </div>
        <div className="flex gap-2">
          <input
            className="input"
            value={username}
            placeholder="myaccount"
            onChange={(e) => setUsername(e.target.value)}
          />
          <button type="button" className="btn" onClick={saveUsername} disabled={busy === "username"}>
            {busy === "username" ? "변경 중…" : "변경"}
          </button>
        </div>
      </section>

      {/* ---- photo ----------------------------------------------------------- */}
      <section className="card space-y-3 p-4">
        <div>
          <h2 className="card-title">프로필 사진</h2>
          <p className="card-sub mt-1">
            {profile?.hasPhoto ? "현재 사진이 설정되어 있습니다." : "설정된 사진이 없습니다."} JPG·PNG 4MB 이하.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadPhoto(file);
              event.target.value = "";
            }}
          />
          <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={busy === "photo"}>
            {busy === "photo" ? "올리는 중…" : "사진 올리기"}
          </button>
          {profile?.hasPhoto ? (
            <button type="button" className="btn" onClick={deletePhoto} disabled={busy === "deletePhoto"}>
              사진 삭제
            </button>
          ) : null}
        </div>
      </section>

      {/* ---- active logins ---------------------------------------------------- */}
      <section className="card p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="card-title">활성 세션</h2>
            <p className="card-sub mt-1">이 계정에 로그인되어 있는 기기 목록입니다.</p>
          </div>
          <button type="button" className="btn" onClick={loadSessions} disabled={busy === "sessions"}>
            {busy === "sessions" ? "불러오는 중…" : sessions ? "새로고침" : "불러오기"}
          </button>
        </div>

        {sessions ? (
          <table className="mt-3 w-full border-t border-line">
            <thead>
              <tr className="border-b border-line">
                <th className="th">기기</th>
                <th className="th w-[24%]">앱</th>
                <th className="th w-[20%]">위치</th>
                <th className="th w-[16%]">최근 활동</th>
                <th className="th w-[10%] text-right" />
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.hash} className="border-b border-line last:border-0">
                  <td className="td">
                    <span className="flex items-center gap-1.5">
                      <span className="font-medium">{session.deviceModel || "알 수 없음"}</span>
                      {session.current ? <Badge tone="ok">현재</Badge> : null}
                    </span>
                    <p className="mt-0.5 text-ink-muted">{session.platform}</p>
                  </td>
                  <td className="td text-ink-muted">{session.appName}</td>
                  <td className="td text-ink-muted">
                    {session.country || "-"}
                    <br />
                    <span className="text-[11px]">{session.ip}</span>
                  </td>
                  <td className="td text-ink-muted">{absoluteTime(session.dateActive)}</td>
                  <td className="td text-right">
                    {session.current ? (
                      <span className="text-ink-faint">-</span>
                    ) : (
                      <button
                        type="button"
                        className="btn-ghost rounded-md px-2 py-1 text-[12px] text-bad hover:bg-red-50"
                        onClick={() => resetSession(session.hash)}
                        disabled={busy === `reset-${session.hash}`}
                      >
                        종료
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <p className="text-[12px] text-ink-faint">
        {accountLabel} · 전화번호 {profile?.phone ?? "미확인"}
      </p>
    </div>
  );
}
