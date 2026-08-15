"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { apiRequest } from "@/lib/client/api";

/** Pause / resume / cancel buttons on the job detail screen. */
export function JobControls({ jobId, status }: { jobId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(next: "RUNNING" | "PAUSED" | "CANCELLED") {
    if (next === "CANCELLED" && !confirm("남은 대기 작업을 모두 취소할까요?")) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/jobs/${jobId}`, { method: "PATCH", body: { status: next } });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const finished = status === "DONE" || status === "CANCELLED";

  return (
    <div className="flex items-center gap-2">
      {error ? <span className="text-[12px] text-bad">{error}</span> : null}
      {!finished ? (
        <>
          <button type="button" className="btn" disabled={busy} onClick={() => setStatus(status === "PAUSED" ? "RUNNING" : "PAUSED")}>
            {status === "PAUSED" ? "재개" : "일시중지"}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setStatus("CANCELLED")}>
            작업 취소
          </button>
        </>
      ) : null}
    </div>
  );
}
