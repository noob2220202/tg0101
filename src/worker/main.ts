// Must come first: everything below reads process.env at module scope.
import "./loadEnv";

import { prisma } from "../lib/db";
import { dropAllSessions, isMockMode } from "../lib/telegram";
import { trimLogs } from "../lib/services/logs";
import { recordWorkerTick } from "../lib/services/settings";
import { eligibleAccountIds, nextTaskFor, runTask } from "./joinRunner";
import { runCollectorTick, syncRoomScans } from "./collector";
import { runHealthChecks } from "./health";
import { startGateway } from "../gateway/server";

/**
 * The worker process.
 *
 * One tick does at most one join per account, which is what keeps the pacing
 * interval honest: accounts run in parallel with each other, but strictly
 * serially within themselves.
 *
 *   npm run worker        # watch mode
 *   npm run worker:once   # a single tick, for cron or debugging
 */

const TICK_SECONDS = Number(process.env.WORKER_TICK_SECONDS ?? 5);
/** Housekeeping is cheap but pointless to run every tick. */
const HOUSEKEEPING_EVERY_TICKS = 120;

let stopping = false;
let tickCount = 0;

function log(message: string): void {
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${stamp}] ${message}`);
}

/** Returns the number of tasks executed. */
export async function tick(): Promise<number> {
  const now = new Date();
  const accountIds = await eligibleAccountIds(now);

  let executed = 0;
  for (const accountId of accountIds) {
    if (stopping) break;

    const task = await nextTaskFor(accountId, now);
    if (!task) continue;

    try {
      await runTask(task.id);
      executed += 1;
    } catch (err) {
      // runTask handles its own failures; reaching here means the bookkeeping
      // itself broke, which must not take the loop down.
      log(`task ${task.id} failed hard: ${(err as Error).message}`);
    }
  }

  await runCollectorTick(now).catch((err) => log(`collector: ${(err as Error).message}`));

  await recordWorkerTick(executed).catch(() => {});

  tickCount += 1;
  if (tickCount % HOUSEKEEPING_EVERY_TICKS === 0) {
    await syncRoomScans().catch(() => 0);
    await trimLogs().catch(() => 0);
    await runHealthChecks().catch((err) => log(`health: ${(err as Error).message}`));
  }

  return executed;
}

async function main(): Promise<void> {
  const once = process.argv.includes("--once");

  log(`worker starting — tick=${TICK_SECONDS}s mock=${isMockMode() ? "on" : "off"}`);

  // The worker owns every MTProto session, so it is also the only process that
  // can serve chat. A single --once run skips it: nothing would connect.
  if (!once) startGateway();
  await syncRoomScans().catch((err) => log(`syncRoomScans: ${(err as Error).message}`));

  if (once) {
    const executed = await tick();
    log(`single tick done — ${executed} task(s)`);
    await shutdown();
    return;
  }

  while (!stopping) {
    const started = Date.now();
    try {
      const executed = await tick();
      if (executed > 0) log(`${executed} task(s) executed`);
    } catch (err) {
      log(`tick error: ${(err as Error).message}`);
    }

    const elapsed = Date.now() - started;
    const wait = Math.max(0, TICK_SECONDS * 1000 - elapsed);
    await sleep(wait);
  }
}

async function shutdown(): Promise<void> {
  stopping = true;
  await dropAllSessions().catch(() => {});
  await prisma.$disconnect().catch(() => {});
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log(`${signal} received — finishing current tick`);
    void shutdown().then(() => process.exit(0));
  });
}

main().catch(async (err) => {
  log(`fatal: ${(err as Error).stack ?? (err as Error).message}`);
  await shutdown();
  process.exit(1);
});
