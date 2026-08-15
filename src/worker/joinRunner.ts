import { prisma } from "../lib/db";
import { startOfToday } from "../lib/format";
import { JobOptions, parseJobOptions } from "../lib/jobOptions";
import { detectPrerequisites, PROBE_MESSAGE } from "../lib/prerequisites";
import { extractLinks } from "../lib/links";
import { getSession } from "../lib/telegram";
import { toTelegramError } from "../lib/telegram/errors";
import { ERROR_MESSAGE_KO, TelegramSession } from "../lib/telegram/types";
import { refreshJobProgress } from "../lib/services/jobs";
import { recordCollectedLink } from "../lib/services/collect";
import { upsertTarget } from "../lib/services/targets";
import { writeLog } from "../lib/services/logs";

/** How many messages to read when looking for a prerequisite notice. */
const PREREQ_READ_LIMIT = 15;
/** Backoff for transient failures, by attempt number. */
const RETRY_BACKOFF_SEC = [30, 120, 600];
/** Prerequisites jump the queue. */
const PREREQ_PRIORITY = 50;
/** A target waiting on its prerequisites sits between them and normal work. */
const DEFERRED_PRIORITY = 70;

type TaskWithRelations = Awaited<ReturnType<typeof loadTask>>;

async function loadTask(taskId: string) {
  return prisma.joinTask.findUniqueOrThrow({
    where: { id: taskId },
    include: { target: true, job: true, account: true },
  });
}

/**
 * Accounts that may run right now: active, off cooldown, under their daily cap,
 * and past their pacing interval.
 */
export async function eligibleAccountIds(now = new Date()): Promise<string[]> {
  // Wake anyone whose Telegram-imposed wait has elapsed. Identify them first —
  // after the update they are indistinguishable from accounts that never waited.
  const woken = await prisma.account.findMany({
    where: { status: "COOLDOWN", cooldownUntil: { lte: now } },
    select: { id: true },
  });
  if (woken.length > 0) {
    await prisma.account.updateMany({
      where: { id: { in: woken.map((a) => a.id) } },
      data: { status: "ACTIVE", cooldownUntil: null, cooldownSeconds: null, cooldownReason: null },
    });
    for (const account of woken) {
      await writeLog({ accountId: account.id, message: "대기시간이 끝나 입장을 재개합니다.", level: "INFO" });
    }
  }

  const accounts = await prisma.account.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, joinIntervalSec: true, dailyJoinLimit: true, lastJoinAt: true },
  });

  const ready: string[] = [];
  for (const account of accounts) {
    // Pacing: "현재 페이싱 설정(간격 20초)" from the reservation dialog.
    if (account.lastJoinAt) {
      const nextAllowed = account.lastJoinAt.getTime() + account.joinIntervalSec * 1000;
      if (nextAllowed > now.getTime()) continue;
    }

    if (account.dailyJoinLimit > 0) {
      const usedToday = await prisma.joinTask.count({
        where: {
          accountId: account.id,
          status: { in: ["SUCCESS", "WAITING_APPROVAL"] },
          finishedAt: { gte: startOfToday(now) },
        },
      });
      if (usedToday >= account.dailyJoinLimit) continue;
    }
    ready.push(account.id);
  }
  return ready;
}

/** The next task an account should attempt, or null when it has nothing to do. */
export async function nextTaskFor(accountId: string, now = new Date()) {
  return prisma.joinTask.findFirst({
    where: {
      accountId,
      status: "PENDING",
      nextAttemptAt: { lte: now },
      job: { status: "RUNNING" },
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
}

/**
 * Run one join task to completion.
 *
 * Returns true when a Telegram join was actually attempted, so the caller can
 * apply pacing only to real network activity (skips are free).
 */
export async function runTask(taskId: string): Promise<boolean> {
  const task = await loadTask(taskId);
  const options = parseJobOptions(task.job.options);
  const label = task.target.title ?? task.target.key;

  // `task` was read before this increment, so its `attempts` is one behind.
  const attemptsNow = task.attempts + 1;
  await prisma.joinTask.update({
    where: { id: task.id },
    data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } },
  });

  try {
    // 1. Already inside? Nothing to do.
    if (options.skipJoined) {
      const membership = await prisma.membership.findUnique({
        where: { accountId_targetId: { accountId: task.accountId, targetId: task.targetId } },
      });
      if (membership && !membership.left) {
        await finishTask(task, "SKIPPED", "이미 입장한 방입니다.");
        return false;
      }
    }

    // 2. Known prerequisites first — learned on a previous run.
    const pending = await pendingPrerequisites(task);
    if (pending.length > 0) {
      // A prerequisite that can never be satisfied (deleted room, permanent
      // ban) would otherwise bounce this task between "defer" and "retry"
      // forever, so deferrals are capped like any other attempt.
      if (attemptsNow > task.maxAttempts) {
        await finishTask(task, "FAILED", `선행 채널 ${pending.length}건을 처리하지 못해 중단했습니다.`);
        return false;
      }
      await enqueuePrerequisites(task, pending.map((p) => p.requiredId));
      await deferTask(task, `선행 채널 ${pending.length}건을 먼저 진행합니다.`);
      return false;
    }

    const session = await getSession(task.accountId);

    // 3. The join itself. Pacing is stamped before the call, not after it:
    // Telegram rate-limits attempts, so a failed join has to open the same gap
    // a successful one does.
    await touchAccountJoin(task.accountId);
    const result = await session.join(task.target.key);

    if (result.entity) {
      await upsertTarget({
        key: task.target.key,
        title: result.entity.title,
        entityType: result.entity.entityType,
        memberCount: result.entity.memberCount,
      });
    }

    if (result.status === "REQUESTED") {
      await prisma.joinTask.update({
        where: { id: task.id },
        data: { status: "WAITING_APPROVAL", finishedAt: new Date(), lastError: null, lastErrorCode: null },
      });
      await writeLog({
        accountId: task.accountId,
        targetId: task.targetId,
        targetLabel: label,
        level: "WARN",
        taskId: task.id,
        message: "입장 요청을 보냈습니다. 관리자 수락이 필요합니다.",
      });
      await refreshJobProgress(task.jobId);
      return true;
    }

    await recordMembership(task.accountId, task.targetId, result.chatId);

    // 4. Post-join housekeeping. Failures here must not fail the join.
    await applyRoomSettings(session, task.target.key, options, task.accountId, task.targetId, label);

    // 5. Prerequisite discovery.
    const discovered = await discoverPrerequisites(session, task, options);
    if (discovered > 0) {
      await deferTask(task, `선행 채널 ${discovered}건을 큐에 추가했습니다.`);
      return true;
    }

    // 6. Promo-link harvesting for this room.
    if (options.autoCollect) {
      await collectFromRoom(session, task.accountId, task.targetId, task.target.key, label);
      await ensureRoomScan(task.accountId, task.targetId);
    }

    await finishTask(
      task,
      "SUCCESS",
      result.status === "ALREADY_MEMBER" ? "이미 입장되어 있어 확인만 했습니다." : "입장 완료",
    );
    return true;
  } catch (err) {
    await handleTaskError(task, err);
    return true;
  }
}

// ---------------------------------------------------------------------------
// Prerequisites
// ---------------------------------------------------------------------------

/** Known prerequisites this account has not satisfied yet. */
async function pendingPrerequisites(task: TaskWithRelations) {
  const prereqs = await prisma.prerequisite.findMany({ where: { targetId: task.targetId } });
  if (prereqs.length === 0) return [];

  const memberships = await prisma.membership.findMany({
    where: { accountId: task.accountId, targetId: { in: prereqs.map((p) => p.requiredId) }, left: false },
    select: { targetId: true },
  });
  const joined = new Set(memberships.map((m) => m.targetId));
  return prereqs.filter((p) => !joined.has(p.requiredId));
}

/**
 * Read the room (and optionally speak up) to find a prerequisite notice.
 * Returns how many new prerequisite tasks were queued.
 */
async function discoverPrerequisites(
  session: TelegramSession,
  task: TaskWithRelations,
  options: JobOptions,
): Promise<number> {
  if (!options.autoPrereq && !options.probeHidden) return 0;

  let detection = null;

  if (options.autoPrereq) {
    const messages = await session.readMessages(task.target.key, PREREQ_READ_LIMIT).catch(() => []);
    detection = detectPrerequisites(messages, task.target.key);
  }

  // Rooms that only reveal the requirement when you try to talk. Once per room.
  if (!detection && options.probeHidden && !task.target.probedAt) {
    await prisma.target.update({ where: { id: task.targetId }, data: { probedAt: new Date() } });
    const replies = await session.probe(task.target.key, PROBE_MESSAGE).catch(() => []);
    detection = detectPrerequisites(replies, task.target.key);
    if (detection) {
      await writeLog({
        accountId: task.accountId,
        targetId: task.targetId,
        targetLabel: task.target.title ?? task.target.key,
        level: "INFO",
        message: "말을 걸어 숨은 선행 채널을 찾았습니다.",
      });
    }
  }

  if (!detection || detection.links.length === 0) return 0;

  const requiredIds: string[] = [];
  for (const link of detection.links) {
    const required = await upsertTarget({ key: link.key, source: "AUTO_COLLECT" });
    if (required.id === task.targetId) continue;

    // Remembered so later jobs skip straight to the prerequisite.
    await prisma.prerequisite.upsert({
      where: { targetId_requiredId: { targetId: task.targetId, requiredId: required.id } },
      create: { targetId: task.targetId, requiredId: required.id, discoveredVia: "AUTO_NOTICE" },
      update: {},
    });

    const membership = await prisma.membership.findUnique({
      where: { accountId_targetId: { accountId: task.accountId, targetId: required.id } },
    });
    if (!membership || membership.left) requiredIds.push(required.id);
  }

  if (requiredIds.length === 0) return 0;

  await enqueuePrerequisites(task, requiredIds);
  await writeLog({
    accountId: task.accountId,
    targetId: task.targetId,
    targetLabel: task.target.title ?? task.target.key,
    level: "INFO",
    message: `선행 채널 ${requiredIds.length}건 인식 — ${detection.evidence.slice(0, 80)}`,
  });
  return requiredIds.length;
}

/** Add prerequisite tasks to the same job, ahead of the task that needs them. */
async function enqueuePrerequisites(task: TaskWithRelations, requiredIds: string[]): Promise<void> {
  for (const requiredId of requiredIds) {
    const existing = await prisma.joinTask.findUnique({
      where: { jobId_targetId: { jobId: task.jobId, targetId: requiredId } },
    });

    if (existing) {
      // Re-open a prerequisite that failed earlier so the parent can proceed.
      if (existing.status === "FAILED" || existing.status === "SKIPPED") {
        await prisma.joinTask.update({
          where: { id: existing.id },
          data: { status: "PENDING", priority: PREREQ_PRIORITY, attempts: 0, nextAttemptAt: new Date() },
        });
      }
      continue;
    }

    await prisma.joinTask.create({
      data: {
        jobId: task.jobId,
        accountId: task.accountId,
        targetId: requiredId,
        status: "PENDING",
        priority: PREREQ_PRIORITY,
        isPrereq: true,
        parentTaskId: task.id,
      },
    });
  }

  const total = await prisma.joinTask.count({ where: { jobId: task.jobId } });
  await prisma.joinJob.update({ where: { id: task.jobId }, data: { totalCount: total } });
}

/** Put a task back in the queue behind its prerequisites. */
async function deferTask(task: TaskWithRelations, message: string): Promise<void> {
  await prisma.joinTask.update({
    where: { id: task.id },
    data: {
      status: "PENDING",
      priority: DEFERRED_PRIORITY,
      // The attempt counter is deliberately left as incremented — see the cap
      // in runTask, which relies on deferrals being counted.
      nextAttemptAt: new Date(Date.now() + 30_000),
      lastError: message,
    },
  });
  await writeLog({
    accountId: task.accountId,
    targetId: task.targetId,
    targetLabel: task.target.title ?? task.target.key,
    level: "INFO",
    taskId: task.id,
    message,
  });
}

// ---------------------------------------------------------------------------
// Post-join actions
// ---------------------------------------------------------------------------

async function applyRoomSettings(
  session: TelegramSession,
  key: string,
  options: JobOptions,
  accountId: string,
  targetId: string,
  label: string,
): Promise<void> {
  if (options.autoMute) {
    await session.mute(key).catch(async (err) => {
      await writeLog({
        accountId,
        targetId,
        targetLabel: label,
        level: "WARN",
        message: `알림 끄기 실패: ${toTelegramError(err).message}`,
      });
    });
  }
  if (options.autoArchive) {
    await session.archive(key).catch(async (err) => {
      await writeLog({
        accountId,
        targetId,
        targetLabel: label,
        level: "WARN",
        message: `보관처리 실패: ${toTelegramError(err).message}`,
      });
    });
  }
}

/** Harvest t.me links advertised in a room we just entered. */
export async function collectFromRoom(
  session: TelegramSession,
  accountId: string,
  targetId: string,
  key: string,
  label: string,
  limit = 40,
): Promise<number> {
  const messages = await session.readMessages(key, limit).catch(() => []);
  const seen = new Set<string>();

  for (const message of messages) {
    for (const link of extractLinks(message.text)) {
      if (link.key === key.toLowerCase() || seen.has(link.key)) continue;
      seen.add(link.key);
      await recordCollectedLink({ link, sourceTargetId: targetId, sourceLabel: label });
    }
  }
  return seen.size;
}

async function ensureRoomScan(accountId: string, targetId: string): Promise<void> {
  await prisma.roomScan.upsert({
    where: { accountId_targetId: { accountId, targetId } },
    create: { accountId, targetId, nextScanAt: nextScanTime() },
    update: {},
  });
}

/** Rooms are re-read every few hours, spread out so scans do not bunch up. */
export function nextScanTime(base = Date.now()): Date {
  const hours = 3 + Math.random() * 3;
  return new Date(base + hours * 3600_000);
}

// ---------------------------------------------------------------------------
// Bookkeeping
// ---------------------------------------------------------------------------

async function recordMembership(accountId: string, targetId: string, chatId: string | null): Promise<void> {
  await prisma.membership.upsert({
    where: { accountId_targetId: { accountId, targetId } },
    create: { accountId, targetId, chatId, left: false },
    update: { left: false, chatId: chatId ?? undefined, joinedAt: new Date() },
  });
}

async function touchAccountJoin(accountId: string): Promise<void> {
  await prisma.account.update({ where: { id: accountId }, data: { lastJoinAt: new Date() } });
}

async function finishTask(
  task: TaskWithRelations,
  status: "SUCCESS" | "SKIPPED" | "FAILED",
  message: string,
): Promise<void> {
  await prisma.joinTask.update({
    where: { id: task.id },
    data: {
      status,
      finishedAt: new Date(),
      lastError: status === "FAILED" ? message : null,
      lastErrorCode: null,
    },
  });
  await writeLog({
    accountId: task.accountId,
    targetId: task.targetId,
    targetLabel: task.target.title ?? task.target.key,
    level: status === "FAILED" ? "ERROR" : "INFO",
    taskId: task.id,
    message,
  });
  await refreshJobProgress(task.jobId);
}

/**
 * Decide what a failure means: sit out a Telegram-imposed wait, retry with
 * backoff, or give up on this target.
 */
async function handleTaskError(task: TaskWithRelations, err: unknown): Promise<void> {
  const error = toTelegramError(err);
  const label = task.target.title ?? task.target.key;
  const message = ERROR_MESSAGE_KO[error.code] ?? error.message;

  // Telegram asked us to wait: park the whole account, not just this task.
  if (error.code === "FLOOD_WAIT") {
    const seconds = error.waitSeconds ?? 60;
    const until = new Date(Date.now() + seconds * 1000);

    await prisma.account.update({
      where: { id: task.accountId },
      data: {
        status: "COOLDOWN",
        cooldownUntil: until,
        cooldownSeconds: seconds,
        cooldownReason: `텔레그램이 ${seconds}초 대기를 요구했습니다. 대기 후 자동으로 재시도합니다.`,
      },
    });
    await prisma.joinTask.update({
      where: { id: task.id },
      data: {
        status: "PENDING",
        nextAttemptAt: until,
        // A wait is Telegram pacing us, not a failed attempt.
        attempts: Math.max(0, task.attempts),
        lastError: `대기 ${seconds}초`,
        lastErrorCode: error.code,
      },
    });
    await writeLog({
      accountId: task.accountId,
      targetId: task.targetId,
      targetLabel: label,
      level: "WARN",
      taskId: task.id,
      message: `텔레그램이 ${seconds}초 대기를 요구했습니다. 대기 후 자동으로 재시도합니다.`,
    });
    return;
  }

  // A dead session stops the account until the operator re-links it.
  if (error.code === "AUTH_INVALID") {
    await prisma.account.update({
      where: { id: task.accountId },
      data: { status: "NEEDS_CHECK", cooldownReason: message },
    });
  }

  const attempts = task.attempts + 1;
  const giveUp = error.permanent || attempts >= task.maxAttempts;

  if (giveUp) {
    await prisma.joinTask.update({
      where: { id: task.id },
      data: { status: "FAILED", finishedAt: new Date(), lastError: message, lastErrorCode: error.code },
    });
    await writeLog({
      accountId: task.accountId,
      targetId: task.targetId,
      targetLabel: label,
      level: "ERROR",
      taskId: task.id,
      message,
    });
    await refreshJobProgress(task.jobId);
    return;
  }

  const backoff = RETRY_BACKOFF_SEC[Math.min(attempts - 1, RETRY_BACKOFF_SEC.length - 1)];
  await prisma.joinTask.update({
    where: { id: task.id },
    data: {
      status: "PENDING",
      nextAttemptAt: new Date(Date.now() + backoff * 1000),
      lastError: message,
      lastErrorCode: error.code,
    },
  });
  await writeLog({
    accountId: task.accountId,
    targetId: task.targetId,
    targetLabel: label,
    level: "ERROR",
    taskId: task.id,
    message,
  });
}
