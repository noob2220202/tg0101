import { prisma } from "../lib/db";
import { getSession } from "../lib/telegram";
import { toTelegramError } from "../lib/telegram/errors";
import { rescore, runAutoRegistration } from "../lib/services/collect";
import { allPolicies, PolicyRow } from "../lib/services/policy";
import { writeLog } from "../lib/services/logs";
import { collectFromRoom, nextScanTime } from "./joinRunner";

/**
 * The background promo-link collector.
 *
 * It sweeps rooms the accounts are already in, on a slow rotation, and files
 * every t.me link it finds. This runs independently of the join queue —
 * "입장 큐와 무관하게 상시로 모이며".
 */

/** Rooms swept per tick. Kept low so the collector never crowds out joins. */
const SCANS_PER_TICK = 3;
const MESSAGES_PER_SCAN = 40;
/** Unresolved links looked up per tick. */
const RESOLVES_PER_TICK = 5;

/**
 * Make sure every room an account is in has a scan schedule.
 *
 * `chainCollect` decides whether rooms that the collector itself found are
 * swept in turn — with it off, collection stops at the manually curated set.
 */
export async function syncRoomScans(): Promise<number> {
  let created = 0;
  for (const policy of await allPolicies()) {
    created += await syncRoomScansFor(policy);
  }
  return created;
}

async function syncRoomScansFor(policy: PolicyRow): Promise<number> {
  const memberships = await prisma.membership.findMany({
    where: {
      left: false,
      account: { ownerId: policy.ownerId, collectEnabled: true, status: { not: "DISABLED" } },
      ...(policy.chainCollect ? {} : { target: { source: "MANUAL" } }),
    },
    select: { accountId: true, targetId: true },
  });

  let created = 0;
  for (const membership of memberships) {
    const existing = await prisma.roomScan.findUnique({
      where: { accountId_targetId: { accountId: membership.accountId, targetId: membership.targetId } },
    });
    if (existing) continue;

    await prisma.roomScan.create({
      data: {
        accountId: membership.accountId,
        targetId: membership.targetId,
        // Stagger first scans so a fresh install does not sweep everything at once.
        nextScanAt: new Date(Date.now() + Math.random() * 30 * 60_000),
      },
    });
    created += 1;
  }
  return created;
}

/** Sweep a few due rooms. Returns how many links were recorded. */
export async function runCollectorTick(now = new Date()): Promise<number> {
  let collected = 0;
  for (const policy of await allPolicies()) {
    collected += await collectForPolicy(policy, now);
  }
  return collected;
}

async function collectForPolicy(policy: PolicyRow, now: Date): Promise<number> {
  const due = await prisma.roomScan.findMany({
    where: {
      nextScanAt: { lte: now },
      account: { ownerId: policy.ownerId, status: "ACTIVE", collectEnabled: true },
      ...(policy.chainCollect ? {} : { target: { source: "MANUAL" } }),
    },
    orderBy: { nextScanAt: "asc" },
    take: SCANS_PER_TICK,
    include: { target: true },
  });

  let collected = 0;

  for (const scan of due) {
    try {
      const session = await getSession(scan.accountId);
      const label = scan.target.title ?? scan.target.key;
      const found = await collectFromRoom(
        session,
        policy.ownerId,
        scan.targetId,
        scan.target.key,
        label,
        MESSAGES_PER_SCAN,
      );
      collected += found;

      await prisma.roomScan.update({
        where: { id: scan.id },
        data: { lastScanAt: now, scanCount: { increment: 1 }, nextScanAt: nextScanTime(now.getTime()) },
      });
      await prisma.account.update({ where: { id: scan.accountId }, data: { lastCollectAt: now } });
    } catch (err) {
      const error = toTelegramError(err);

      // A wait during collection must not disturb the join queue's schedule
      // beyond what the account already owes.
      if (error.code === "FLOOD_WAIT") {
        const seconds = error.waitSeconds ?? 60;
        await prisma.roomScan.update({
          where: { id: scan.id },
          data: { nextScanAt: new Date(now.getTime() + seconds * 1000) },
        });
        continue;
      }

      // Left the room, or it was deleted — stop scanning it.
      if (error.permanent) {
        await prisma.roomScan.delete({ where: { id: scan.id } }).catch(() => {});
        await writeLog({
          accountId: scan.accountId,
          targetId: scan.targetId,
          targetLabel: scan.target.title ?? scan.target.key,
          level: "WARN",
          message: `수집 중단: ${error.message}`,
        });
        continue;
      }

      await prisma.roomScan.update({
        where: { id: scan.id },
        data: { nextScanAt: new Date(now.getTime() + 15 * 60_000) },
      });
    }
  }

  await resolvePendingLinks(policy);
  await runAutoRegistration(policy);
  return collected;
}

/**
 * Ask Telegram what a harvested link actually is.
 *
 * Until this runs a link is just a string, and the policy's type and member
 * filters have nothing to work with — so scores stay low and nothing is
 * auto-registered. Resolving fills in the title, entity type and member count,
 * then re-scores against the current policy.
 */
export async function resolvePendingLinks(policy: PolicyRow): Promise<number> {
  const account = await prisma.account.findFirst({
    where: { ownerId: policy.ownerId, status: "ACTIVE", collectEnabled: true },
    orderBy: { lastCollectAt: "asc" },
    select: { id: true },
  });
  if (!account) return 0;

  const links = await prisma.collectedLink.findMany({
    where: { ownerId: policy.ownerId, resolvedAt: null, status: "PENDING" },
    orderBy: [{ roomCount: "desc" }, { firstSeenAt: "asc" }],
    take: RESOLVES_PER_TICK,
  });
  if (links.length === 0) return 0;

  let resolved = 0;
  for (const link of links) {
    try {
      const session = await getSession(account.id);
      const entity = await session.resolve(link.key);

      if (!entity) {
        // Marked resolved so a dead link is not retried on every tick.
        await prisma.collectedLink.update({
          where: { id: link.id },
          data: { resolvedAt: new Date(), status: "EXCLUDED", reason: "존재하지 않거나 접근할 수 없는 링크" },
        });
        continue;
      }

      await prisma.collectedLink.update({
        where: { id: link.id },
        data: {
          title: entity.title,
          entityType: entity.entityType,
          memberCount: entity.memberCount,
          resolvedAt: new Date(),
        },
      });
      await rescore(link.id, policy);
      resolved += 1;
    } catch (err) {
      const error = toTelegramError(err);
      // A wait here is the account's problem, not the link's — try again later.
      if (error.code === "FLOOD_WAIT" || error.code === "NETWORK") break;

      await prisma.collectedLink.update({
        where: { id: link.id },
        data: { resolvedAt: new Date(), status: "EXCLUDED", reason: error.message.slice(0, 120) },
      });
    }
  }
  return resolved;
}
