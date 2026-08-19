import { prisma } from "../lib/db";
import { getChatSession } from "../lib/telegram";
import type { ChatMessageDto } from "../lib/telegram/chatTypes";
import { compileRule, matchRules } from "../lib/keywords";
import { collectFromLiveMessage } from "../worker/liveCollector";

/**
 * Live update fan-out.
 *
 * One subscription per connected account. Messages are pushed to any listening
 * browser, evaluated against the operator's keyword rules, and scanned for
 * promo links; only rules that match cause a database write, which is what
 * keeps hundreds of promo rooms from filling the disk.
 */

type Broadcast = (ownerId: string, payload: unknown) => void;
type Ingest = (accountId: string, ownerId: string, message: ChatMessageDto) => Promise<void>;

/** Unsubscribe callbacks by account id. */
const watching = new Map<string, () => void>();
let sweepTimer: NodeJS.Timeout | undefined;

/**
 * Attach to every active account, and keep checking for accounts that come
 * online later (a newly connected account has no session at startup).
 */
export async function startWatching(broadcast: Broadcast, ingest: Ingest): Promise<void> {
  await syncSubscriptions(broadcast, ingest);

  sweepTimer = setInterval(() => {
    void syncSubscriptions(broadcast, ingest).catch(() => {});
  }, 60_000);
  sweepTimer.unref?.();
}

export async function stopWatching(): Promise<void> {
  if (sweepTimer) clearInterval(sweepTimer);
  for (const [accountId, unsubscribe] of watching) {
    try {
      unsubscribe();
    } catch {
      // Already gone.
    }
    watching.delete(accountId);
  }
}

async function syncSubscriptions(broadcast: Broadcast, ingest: Ingest): Promise<void> {
  const accounts = await prisma.account.findMany({
    where: { status: { in: ["ACTIVE", "COOLDOWN"] } },
    select: { id: true, ownerId: true },
  });
  const live = new Set(accounts.map((a) => a.id));

  // Drop subscriptions for accounts that were disabled or deleted.
  for (const [accountId, unsubscribe] of watching) {
    if (live.has(accountId)) continue;
    try {
      unsubscribe();
    } catch {
      // Nothing to do.
    }
    watching.delete(accountId);
  }

  for (const account of accounts) {
    if (watching.has(account.id)) continue;
    try {
      const session = await getChatSession(account.id);
      const unsubscribe = session.onNewMessage((message) => {
        void handleMessage(account.id, account.ownerId, message, broadcast, ingest);
      });
      watching.set(account.id, unsubscribe);
      console.log(`[gateway] watching ${account.id}`);
    } catch (err) {
      // An account whose session will not open simply is not watched; the
      // sweep will try again next minute.
      console.log(`[gateway] cannot watch ${account.id}: ${(err as Error).message}`);
    }
  }
}

async function handleMessage(
  accountId: string,
  ownerId: string,
  message: ChatMessageDto,
  broadcast: Broadcast,
  ingest: Ingest,
): Promise<void> {
  try {
    await ingest(accountId, ownerId, message);
  } catch {
    // Persistence failures must not stop the browser from seeing the message.
  }

  const hits = await evaluateRules(accountId, ownerId, message);
  broadcast(ownerId, { type: "message", accountId, message, keywordHits: hits });

  // Link collection runs last and detached: it must never delay what the
  // browser sees, and a collection failure is not worth losing the message for.
  void collectFromLiveMessage(accountId, ownerId, message).catch(() => {});
}

/** Record and count any keyword rules the message trips. */
async function evaluateRules(
  accountId: string,
  ownerId: string,
  message: ChatMessageDto,
): Promise<string[]> {
  const rules = await prisma.keywordRule.findMany({ where: { ownerId, enabled: true } });
  if (rules.length === 0) return [];

  const matched = matchRules(message.text, accountId, rules.map(compileRule));
  if (matched.length === 0) return [];

  await prisma.keywordRule.updateMany({
    where: { id: { in: matched.map((r) => r.id) } },
    data: { hitCount: { increment: 1 }, lastHitAt: new Date() },
  });

  // A hit is worth keeping even though the conversation was never opened.
  await prisma.chatMessage
    .upsert({
      where: {
        accountId_peerId_messageId: { accountId, peerId: message.peerId, messageId: message.id },
      },
      create: {
        accountId,
        peerId: message.peerId,
        messageId: message.id,
        outgoing: message.outgoing,
        senderId: message.senderId,
        senderName: message.senderName,
        text: message.text,
        mediaType: message.mediaType,
        mediaName: message.mediaName,
        date: message.date,
        keywordHit: true,
      },
      update: { keywordHit: true },
    })
    .catch(() => {});

  return matched.map((r) => r.name);
}

/**
 * Default persistence for an inbound message: update the dialog's preview and
 * unread count, and store the body only for conversations already cached.
 */
export async function ingestMessage(
  accountId: string,
  _ownerId: string,
  message: ChatMessageDto,
): Promise<void> {
  const dialog = await prisma.dialog.findUnique({
    where: { accountId_peerId: { accountId, peerId: message.peerId } },
  });

  if (dialog) {
    await prisma.dialog.update({
      where: { id: dialog.id },
      data: {
        lastMessageId: message.id,
        lastMessageText: message.text.slice(0, 300),
        lastMessageAt: message.date,
        lastMessageOut: message.outgoing,
        unreadCount: message.outgoing ? dialog.unreadCount : dialog.unreadCount + 1,
      },
    });
  }

  // Only keep the body for conversations the operator has actually opened.
  const alreadyCached = await prisma.chatMessage.count({
    where: { accountId, peerId: message.peerId },
  });
  if (alreadyCached === 0) return;

  await prisma.chatMessage
    .upsert({
      where: {
        accountId_peerId_messageId: { accountId, peerId: message.peerId, messageId: message.id },
      },
      create: {
        accountId,
        peerId: message.peerId,
        messageId: message.id,
        outgoing: message.outgoing,
        senderId: message.senderId,
        senderName: message.senderName,
        text: message.text,
        mediaType: message.mediaType,
        mediaName: message.mediaName,
        date: message.date,
      },
      update: {},
    })
    .catch(() => {});
}
