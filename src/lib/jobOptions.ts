import { z } from "zod";

/**
 * The toggles on the "입장 예약" dialog. Persisted as JSON text on JoinJob so
 * the worker reads exactly what the operator saw when they queued the batch.
 */
export const jobOptionsSchema = z.object({
  /** 이미 입장한 선행 채널은 건너뛰기 */
  skipJoined: z.boolean().default(true),
  /** 선행 채널 자동 인식 */
  autoPrereq: z.boolean().default(true),
  /** 말을 걸어 숨은 선행 채널 찾기 */
  probeHidden: z.boolean().default(false),
  /** 홍보 링크 자동 수집 */
  autoCollect: z.boolean().default(false),
  /** 자동으로 보관처리(아카이브) */
  autoArchive: z.boolean().default(true),
  /** 알림 받지 않음으로 설정 */
  autoMute: z.boolean().default(true),
});

export type JobOptions = z.infer<typeof jobOptionsSchema>;

export const DEFAULT_JOB_OPTIONS: JobOptions = jobOptionsSchema.parse({});

export function parseJobOptions(raw: string | null | undefined): JobOptions {
  if (!raw) return DEFAULT_JOB_OPTIONS;
  try {
    return jobOptionsSchema.parse(JSON.parse(raw));
  } catch {
    return DEFAULT_JOB_OPTIONS;
  }
}

export function serializeJobOptions(options: JobOptions): string {
  return JSON.stringify(options);
}

/**
 * Lower bound for a batch, shown in the dialog's blue note. Only counts the
 * pacing gap — Telegram-imposed waits stretch it further.
 *
 * Rounded up to a whole minute so the note reads "최소 17분 이상" rather than
 * quoting a false precision the queue cannot honour anyway.
 */
export function estimateMinimumSeconds(count: number, intervalSec: number): number {
  if (count <= 0) return 0;
  return Math.ceil((count * intervalSec) / 60) * 60;
}
