import { prisma } from "../db";

/** Small typed wrapper over the key/value Setting table. */

export const SettingKeys = {
  workerLastTickAt: "worker.lastTickAt",
  workerLastTickCount: "worker.lastTickCount",
  defaultJoinInterval: "pacing.defaultJoinIntervalSec",
} as const;

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

/** Heartbeat so the dashboard can say when the worker last ran. */
export async function recordWorkerTick(executed: number): Promise<void> {
  await setSetting(SettingKeys.workerLastTickAt, new Date().toISOString());
  await setSetting(SettingKeys.workerLastTickCount, String(executed));
}

export async function readWorkerHeartbeat(): Promise<{ lastTickAt: Date | null; lastTickCount: number }> {
  const [at, count] = await Promise.all([
    getSetting(SettingKeys.workerLastTickAt),
    getSetting(SettingKeys.workerLastTickCount),
  ]);
  return {
    lastTickAt: at ? new Date(at) : null,
    lastTickCount: Number(count ?? 0),
  };
}
