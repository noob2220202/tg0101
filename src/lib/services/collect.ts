import { prisma } from "../db";
import { EntityType } from "../enums";
import { ParsedLink } from "../links";
import { scoreLink } from "../scoring";
import { consumeDailyBudget, getPolicy, PolicyRow, remainingDailyBudget, toScorePolicy } from "./policy";
import { createJoinJob } from "./jobs";
import { upsertTarget } from "./targets";
import { DEFAULT_JOB_OPTIONS } from "../jobOptions";

/**
 * Recording and triaging harvested promo links.
 */

export type RecordLinkInput = {
  link: ParsedLink;
  /** The room the link was advertised in. */
  sourceTargetId: string | null;
  sourceLabel: string | null;
};

/**
 * Insert or update one harvested link, re-score it, and return the fresh row.
 *
 * Scoring happens on every sighting because the score depends on how widely the
 * link is advertised, which only grows over time.
 */
export async function recordCollectedLink(input: RecordLinkInput, policy?: PolicyRow) {
  const activePolicy = policy ?? (await getPolicy());
  const { link, sourceTargetId, sourceLabel } = input;

  // Links we already track as targets are not news.
  const existingTarget = await prisma.target.findUnique({ where: { key: link.key }, select: { id: true } });

  const existing = await prisma.collectedLink.findUnique({
    where: { key: link.key },
    include: { sources: true },
  });

  const now = new Date();

  if (!existing) {
    const created = await prisma.collectedLink.create({
      data: {
        key: link.key,
        url: link.url,
        status: existingTarget ? "REGISTERED" : "PENDING",
        registeredTargetId: existingTarget?.id ?? null,
        roomCount: sourceTargetId ? 1 : 0,
        seenCount: 1,
        firstSeenAt: now,
        lastSeenAt: now,
        sources: sourceTargetId
          ? { create: [{ sourceTargetId, sourceLabel, count: 1, lastSeenAt: now }] }
          : undefined,
      },
    });
    return rescore(created.id, activePolicy);
  }

  // Bump the per-room counter, adding the room if this is its first mention.
  if (sourceTargetId) {
    const source = existing.sources.find((s) => s.sourceTargetId === sourceTargetId);
    if (source) {
      await prisma.collectedLinkSource.update({
        where: { id: source.id },
        data: { count: { increment: 1 }, lastSeenAt: now, sourceLabel: sourceLabel ?? source.sourceLabel },
      });
    } else {
      await prisma.collectedLinkSource.create({
        data: { linkId: existing.id, sourceTargetId, sourceLabel, count: 1, lastSeenAt: now },
      });
    }
  }

  await prisma.collectedLink.update({
    where: { id: existing.id },
    data: {
      seenCount: { increment: 1 },
      lastSeenAt: now,
      roomCount: await countDistinctRooms(existing.id, sourceTargetId),
    },
  });

  return rescore(existing.id, activePolicy);
}

async function countDistinctRooms(linkId: string, incomingSourceId: string | null): Promise<number> {
  const rooms = await prisma.collectedLinkSource.count({ where: { linkId, sourceTargetId: { not: null } } });
  // The row for `incomingSourceId` may not be committed yet when this runs.
  return Math.max(rooms, incomingSourceId ? 1 : 0);
}

/** Recompute score/reason/status for one link. */
export async function rescore(linkId: string, policy?: PolicyRow) {
  const activePolicy = policy ?? (await getPolicy());
  const link = await prisma.collectedLink.findUnique({ where: { id: linkId } });
  if (!link) throw new Error("수집된 링크를 찾을 수 없습니다.");

  const result = scoreLink(
    {
      key: link.key,
      title: link.title,
      description: link.description,
      entityType: link.entityType as EntityType,
      memberCount: link.memberCount,
      roomCount: link.roomCount,
      seenCount: link.seenCount,
      resolved: link.resolvedAt !== null,
    },
    toScorePolicy(activePolicy),
  );

  // Operator decisions (APPROVED / REGISTERED) outrank automatic scoring.
  const locked = link.status === "REGISTERED" || link.status === "APPROVED";
  const status = locked ? link.status : result.excluded ? "EXCLUDED" : "PENDING";

  return prisma.collectedLink.update({
    where: { id: link.id },
    data: { score: result.score, reason: result.reason, status },
  });
}

/**
 * Promote a collected link to a real target, optionally queueing a join.
 * Returns null when the link was already registered.
 */
export async function registerCollectedLink(linkId: string, joinAccountId?: string | null) {
  const link = await prisma.collectedLink.findUnique({ where: { id: linkId } });
  if (!link) throw new Error("수집된 링크를 찾을 수 없습니다.");
  if (link.status === "REGISTERED" && link.registeredTargetId) return null;

  const target = await upsertTarget({
    key: link.key,
    title: link.title,
    entityType: link.entityType,
    memberCount: link.memberCount,
    source: "AUTO_COLLECT",
  });

  await prisma.collectedLink.update({
    where: { id: link.id },
    data: { status: "REGISTERED", registeredTargetId: target.id },
  });

  if (joinAccountId) {
    const alreadyMember = await prisma.membership.findUnique({
      where: { accountId_targetId: { accountId: joinAccountId, targetId: target.id } },
    });
    if (!alreadyMember) {
      await createJoinJob({
        accountId: joinAccountId,
        targetIds: [target.id],
        name: `자동 수집 1건`,
        options: { ...DEFAULT_JOB_OPTIONS, autoCollect: true },
      }).catch(() => {
        // A job may already cover this target; not worth failing registration.
      });
    }
  }

  return target;
}

/**
 * Auto-register everything at or above the policy threshold, within today's
 * budget. Returns how many links were promoted.
 */
export async function runAutoRegistration(): Promise<number> {
  const policy = await getPolicy();
  if (!policy.enabled || !policy.autoRegister) return 0;

  const budget = await remainingDailyBudget(policy);
  if (budget <= 0) return 0;

  const candidates = await prisma.collectedLink.findMany({
    where: { status: "PENDING", score: { gte: policy.minScore } },
    orderBy: { score: "desc" },
    take: budget,
  });

  let registered = 0;
  for (const candidate of candidates) {
    const target = await registerCollectedLink(candidate.id, policy.joinAccountId);
    if (target) {
      registered += 1;
      await consumeDailyBudget(policy.id, 1);
    }
  }
  return registered;
}
