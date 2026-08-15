/** Korean-language formatting helpers shared by every screen. */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "5분 전" / "7시간 후" / "곧". `now` is injectable so server-rendered output
 * stays deterministic in tests.
 */
export function relativeTime(value: Date | string | null | undefined, now: Date = new Date()): string {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  const deltaSec = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(deltaSec);

  if (abs < 45) return "곧";

  const suffix = deltaSec > 0 ? "후" : "전";
  if (abs < HOUR) return `${Math.round(abs / MINUTE)}분 ${suffix}`;
  if (abs < DAY) return `${Math.round(abs / HOUR)}시간 ${suffix}`;
  if (abs < 30 * DAY) return `${Math.round(abs / DAY)}일 ${suffix}`;
  return `${Math.round(abs / (30 * DAY))}개월 ${suffix}`;
}

/** "2026. 08. 15. 10:33" — the absolute stamp next to a relative one. */
export function absoluteTime(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}. ${p(d.getMonth() + 1)}. ${p(d.getDate())}. ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Seconds -> "1시간 26분" for describing Telegram's requested wait. */
export function humanDuration(seconds: number): string {
  if (seconds <= 0) return "0초";
  const d = Math.floor(seconds / DAY);
  const h = Math.floor((seconds % DAY) / HOUR);
  const m = Math.floor((seconds % HOUR) / MINUTE);
  const s = Math.floor(seconds % MINUTE);

  const parts: string[] = [];
  if (d) parts.push(`${d}일`);
  if (h) parts.push(`${h}시간`);
  if (m) parts.push(`${m}분`);
  if (!d && !h && s) parts.push(`${s}초`);
  return parts.slice(0, 2).join(" ");
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  return n.toLocaleString("ko-KR");
}

/** Start of the current local day — used for "오늘" counters. */
export function startOfToday(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** `YYYY-MM-DD` in local time, for the collector's daily-limit counter. */
export function dayKey(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
