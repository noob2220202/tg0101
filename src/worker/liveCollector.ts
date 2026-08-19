import { prisma } from "../lib/db";
import { extractLinks } from "../lib/links";
import { normalizePeerId } from "../lib/peers";
import { recordCollectedLink } from "../lib/services/collect";
import { getPolicy, PolicyRow } from "../lib/services/policy";
import type { ChatMessageDto } from "../lib/telegram/chatTypes";
import { nextScanTime } from "./joinRunner";

/**
 * Real-time promo-link collection.
 *
 * The gateway already holds an open MTProto session per account and receives
 * every message the accounts can see. This files the links out of those
 * messages the moment they are posted, instead of waiting hours for the room's
 * next scheduled sweep — which is what the sweep is now reduced to: a backfill
 * for whatever arrived while the account was offline.
 *
 * Everything here runs on the update stream, so it has to stay cheap: no
 * Telegram calls, one lookup against a cached room index, and a write only when
 * a message actually carries links. Resolving those links and auto-registering
 * them stays on the worker tick, where the flood-wait budget is managed.
 */

/** A room the account is in, indexed by the chat id updates arrive with. */
type Room = {
  targetId: string;
  key: string;
  label: string;
  source: string;
};

type RoomIndex = {
  rooms: Map<string, Room>;
  loadedAt: number;
};

/**
 * How long a room index and a policy stay usable before being re-read.
 *
 * The index TTL is also the worst-case delay before a freshly joined room
 * starts collecting live; the join itself already sweeps the room's history, so
 * nothing is lost in the meantime.
 */
const ROOM_INDEX_TTL_MS = 60_000;
const POLICY_TTL_MS = 15_000;

const roomIndexes = new Map<string, RoomIndex>();
const policyCache = new Map<string, { policy: PolicyRow; loadedAt: number }>();

/**
 * Scan one inbound message and record whatever rooms it advertises.
 * Returns how many links were filed.
 */
export async function collectFromLiveMessage(
  accountId: string,
  ownerId: string,
  message: ChatMessageDto,
): Promise<number> {
  // Our own messages are not somebody else's advertising.
  if (message.outgoing) return 0;

  // Cheapest check first: most traffic in a promo room carries no link at all,
  // and this runs on every message of every account.
  const links = extractLinks(message.text, message.links ?? []);
  if (links.length === 0) return 0;

  const policy = await cachedPolicy(ownerId);
  if (!policy.enabled) return 0;

  const room = await roomFor(accountId, ownerId, message.peerId);
  if (!room) return 0;

  // 연쇄 수집 off: only rooms the operator curated feed the collector.
  if (!policy.chainCollect && room.source !== "MANUAL") return 0;

  let recorded = 0;
  for (const link of links) {
    if (link.key === room.key.toLowerCase()) continue;
    await recordCollectedLink(
      { ownerId, link, sourceTargetId: room.targetId, sourceLabel: room.label },
      policy,
    );
    recorded += 1;
  }

  if (recorded > 0) await markMessageSeen(accountId, room.targetId, message.id);
  return recorded;
}

/** Forget an account's cached rooms — used when memberships change wholesale. */
export function invalidateRoomIndex(accountId?: string): void {
  if (accountId) roomIndexes.delete(accountId);
  else roomIndexes.clear();
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/**
 * Map the peer an update arrived from onto a target.
 *
 * Rooms the account is not a member of — direct messages, or a group joined
 * outside this tool — have no target to attribute links to, so they are
 * skipped rather than filed against nothing.
 */
async function roomFor(accountId: string, ownerId: string, peerId: string): Promise<Room | null> {
  const chatId = normalizePeerId(peerId);
  if (!chatId) return null;

  let index = roomIndexes.get(accountId);
  if (!index || Date.now() - index.loadedAt > ROOM_INDEX_TTL_MS) {
    index = await loadRooms(accountId, ownerId);
  }
  return index.rooms.get(chatId) ?? null;
}

async function loadRooms(accountId: string, ownerId: string): Promise<RoomIndex> {
  const memberships = await prisma.membership.findMany({
    where: {
      accountId,
      left: false,
      chatId: { not: null },
      account: { collectEnabled: true, status: { not: "DISABLED" } },
      target: { ownerId, archived: false },
    },
    select: { chatId: true, target: { select: { id: true, key: true, title: true, source: true } } },
  });

  const rooms = new Map<string, Room>();
  for (const membership of memberships) {
    const chatId = normalizePeerId(membership.chatId);
    if (!chatId) continue;
    rooms.set(chatId, {
      targetId: membership.target.id,
      key: membership.target.key,
      label: membership.target.title ?? membership.target.key,
      source: membership.target.source,
    });
  }

  const index = { rooms, loadedAt: Date.now() };
  roomIndexes.set(accountId, index);
  return index;
}

async function cachedPolicy(ownerId: string): Promise<PolicyRow> {
  const hit = policyCache.get(ownerId);
  if (hit && Date.now() - hit.loadedAt < POLICY_TTL_MS) return hit.policy;

  const policy = await getPolicy(ownerId);
  policyCache.set(ownerId, { policy, loadedAt: Date.now() });
  return policy;
}

/**
 * Remember how far the live stream has read this room.
 *
 * The periodic sweep starts from this id, so a message counted here is not
 * counted a second time hours later — double counting would inflate `seenCount`
 * and with it the score.
 */
async function markMessageSeen(accountId: string, targetId: string, messageId: number): Promise<void> {
  const now = new Date();
  const advanced = await prisma.roomScan.updateMany({
    where: {
      accountId,
      targetId,
      OR: [{ lastMessageId: null }, { lastMessageId: { lt: messageId } }],
    },
    data: { lastMessageId: messageId, lastScanAt: now },
  });
  if (advanced.count > 0) return;

  // No schedule for this room yet: create one so the backfill covers it too.
  await prisma.roomScan
    .create({
      data: { accountId, targetId, lastMessageId: messageId, lastScanAt: now, nextScanAt: nextScanTime() },
    })
    .catch(() => {
      // Either a concurrent create won, or the row exists and is already ahead.
    });
}
