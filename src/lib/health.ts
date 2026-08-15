/**
 * Account risk scoring.
 *
 * Telegram never says "you are about to be limited", so the score is assembled
 * from the things that actually precede a limit: a fast pacing interval, a lot
 * of joins in a short window, recent failures, and — decisively — @SpamBot
 * saying the account is already restricted.
 *
 * 0 is healthy, 100 means stop using this account.
 */

export type HealthInput = {
  /** Seconds between joins. */
  joinIntervalSec: number;
  joins24h: number;
  /** Permanent failures in the last day (bans, private, not-found). */
  failures24h: number;
  /** Times Telegram imposed a wait in the last day. */
  floodWaits24h: number;
  /** OK | LIMITED | UNKNOWN */
  spamStatus: string;
  /** Days since the session was created; young accounts are fragile. */
  accountAgeDays: number;
};

export type HealthResult = {
  score: number;
  reason: string;
};

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

export function scoreHealth(input: HealthInput): HealthResult {
  const parts: string[] = [];
  let score = 0;

  // An account @SpamBot already flagged is not "at risk" — it is limited.
  if (input.spamStatus === "LIMITED") {
    return { score: 100, reason: "스팸 제한이 적용된 상태입니다. 사용을 중지하세요." };
  }

  if (input.joinIntervalSec < 10) {
    score += 30;
    parts.push(`간격 ${input.joinIntervalSec}초 (매우 짧음)`);
  } else if (input.joinIntervalSec < 20) {
    score += 15;
    parts.push(`간격 ${input.joinIntervalSec}초`);
  }

  if (input.joins24h > 100) {
    score += 30;
    parts.push(`24시간 입장 ${input.joins24h}건`);
  } else if (input.joins24h > 50) {
    score += 18;
    parts.push(`24시간 입장 ${input.joins24h}건`);
  } else if (input.joins24h > 20) {
    score += 8;
  }

  // Repeated waits are Telegram telling us directly that we are too fast.
  if (input.floodWaits24h > 0) {
    score += clamp(input.floodWaits24h * 8, 0, 25);
    parts.push(`대기 요구 ${input.floodWaits24h}회`);
  }

  if (input.failures24h > 10) {
    score += 10;
    parts.push(`실패 ${input.failures24h}건`);
  }

  if (input.accountAgeDays < 7) {
    score += 15;
    parts.push("신규 계정");
  } else if (input.accountAgeDays < 30) {
    score += 5;
  }

  if (input.spamStatus === "UNKNOWN") {
    score += 5;
    parts.push("스팸 상태 미확인");
  }

  return {
    score: clamp(Math.round(score)),
    reason: parts.join(" · ") || "위험 신호 없음",
  };
}

/** Bucket for the UI. */
export function riskLabel(score: number): { label: string; tone: "ok" | "wait" | "bad" } {
  if (score >= 70) return { label: "위험", tone: "bad" };
  if (score >= 35) return { label: "주의", tone: "wait" };
  return { label: "양호", tone: "ok" };
}
