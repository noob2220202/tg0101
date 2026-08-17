import { prisma } from "../db";
import { extractLinks } from "../links";
import type { ChatMessageDto } from "../telegram/chatTypes";
import { recordCollectedLink } from "./collect";
import { getPolicy } from "./policy";

/**
 * Real-time promo-link collection.
 *
 * The gateway already holds one live subscription per account for the chat
 * screen; every message that arrives on it passes through here first. A link is
 * therefore filed the moment it is posted, instead of waiting for the room's
 * next sweep — which is now only a gap-filler for the stretches the gateway was
 * not connected.
 *
 * This runs on every inbound message across every account, so the cheap checks
 * come first: a message with no t.me link in it never touches the database.
 */

export async function collectFromLiveMessage(
  accountId: string,
  ownerId: string,
  message: ChatMessageDto,
): Promise<number> {
  // Our own postings are not somebody else's advertisement.
  if (message.outgoing) return 0;

  const links = extractLinks(message.text);
  if (links.length === 0) return 0;

  const policy = await getPolicy(ownerId);
  if (!policy.enabled) return 0;

  // A cooled-down account may not join, but reading costs it nothing.
  const account = await prisma.account.findFirst({
    where: { id: accountId, ownerId, collectEnabled: true, status: { not: "DISABLED" } },
    select: { id: true },
  });
  if (!account) return 0;

  const room = await resolveSourceRoom(accountId, ownerId, message.peerId);
  if (!room) return 0;

  // 연쇄 수집 off — collect only from the manually curated set.
  if (!policy.chainCollect && room.source !== "MANUAL") return 0;

  let recorded = 0;
  for (const link of links) {
    if (link.key === room.key.toLowerCase()) continue;
    await recordCollectedLink(
      {
        ownerId,
        link,
        sourceTargetId: room.id,
        sourceLabel: room.label,
        sourceMessageId: message.id,
      },
      policy,
    );
    recorded += 1;
  }
  return recorded;
}

type SourceRoom = { id: string; key: string; label: string | null; source: string };

/**
 * Work out which tracked room a live message came from.
 *
 * Returns null for anything we do not track — direct messages above all, which
 * carry plenty of links and none of them worth a room's worth of credit.
 */
async function resolveSourceRoom(
  accountId: string,
  ownerId: string,
  peerId: string,
): Promise<SourceRoom | null> {
  const chatIds = peerIdCandidates(peerId);

  const membership = await prisma.membership.findFirst({
    where: { accountId, left: false, chatId: { in: chatIds }, target: { ownerId } },
    include: { target: true },
  });
  if (membership) return asRoom(membership.target);

  // A membership recorded before Telegram handed us a chat id has none to match
  // on. Fall back to the dialog's username, then backfill so the next message
  // from this room is a single lookup again.
  const dialog = await prisma.dialog.findUnique({
    where: { accountId_peerId: { accountId, peerId } },
    select: { username: true },
  });
  if (!dialog?.username) return null;

  const target = await prisma.target.findUnique({
    where: { ownerId_key: { ownerId, key: dialog.username.toLowerCase() } },
  });
  if (!target) return null;

  await prisma.membership.updateMany({
    where: { accountId, targetId: target.id, chatId: null },
    data: { chatId: chatIds[0] },
  });
  return asRoom(target);
}

function asRoom(target: { id: string; key: string; title: string | null; source: string }): SourceRoom {
  return { id: target.id, key: target.key, label: target.title ?? target.key, source: target.source };
}

/**
 * Marked peer id -> the raw entity ids it could stand for, which is the form
 * `Membership.chatId` holds.
 *
 *   "-1001234567890" (channel/supergroup) -> ["1234567890", "1001234567890"]
 *   "-1234567890"    (legacy group)       -> ["1234567890"]
 *   "1234567890"     (user)               -> ["1234567890"]
 *
 * A leading "-100" almost always marks a channel, but a legacy group whose id
 * happens to start with 100 is written the same way. Both readings are returned
 * rather than guessed between — the lookup is already scoped to one account, so
 * the extra candidate cannot collide with anything in practice.
 */
export function peerIdCandidates(peerId: string): string[] {
  const trimmed = peerId.trim();
  if (!trimmed.startsWith("-")) return [trimmed];

  const unsigned = trimmed.slice(1);
  if (!unsigned.startsWith("100")) return [unsigned];
  return [unsigned.slice(3), unsigned];
}
