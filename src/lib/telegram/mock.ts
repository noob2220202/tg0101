import { JoinResult, MessageLite, ReadOptions, ResolvedEntity, TelegramError, TelegramSession } from "./types";
import { ChatCapableSession } from "./chatTypes";
import { MockChatSession } from "./mockChat";
import { hash, isJoined, joinedKeys, markJoined, mockChatId, mockRoomTitle, pick, ROOM_TITLES } from "./mockRooms";

/**
 * An in-memory fake Telegram, enabled with MOCK_TELEGRAM=1.
 *
 * It exists so the queue, the pacing logic, flood-wait handling, prerequisite
 * discovery and the link collector can all be exercised end-to-end without real
 * accounts. Behaviour is derived deterministically from the room key, so the
 * same key always behaves the same way across restarts.
 */

/** Rooms we have already flood-waited on, so a retry can succeed. */
const floodedOnce = new Set<string>();

export class MockTelegramSession implements TelegramSession {
  readonly accountId: string;
  /** Chat/profile behaviour lives in its own class, mirroring the real side. */
  readonly chat: ChatCapableSession;

  constructor(accountId: string) {
    this.accountId = accountId;
    this.chat = new MockChatSession(accountId);
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  async resolve(key: string): Promise<ResolvedEntity | null> {
    const seed = hash(key);
    // ~8% of scraped links point at nothing.
    if (seed % 12 === 0) return null;

    return {
      key,
      chatId: mockChatId(key),
      title: mockRoomTitle(key),
      entityType: seed % 7 === 0 ? "CHANNEL" : seed % 23 === 0 ? "BOT" : "GROUP",
      memberCount: 50 + (seed % 9000),
      requiresApproval: seed % 17 === 0,
    };
  }

  async join(key: string): Promise<JoinResult> {
    const seed = hash(key + this.accountId);
    const entity = await this.resolve(key);

    if (!entity) throw new TelegramError("NOT_FOUND", "존재하지 않는 방입니다.", { permanent: true });
    if (isJoined(this.accountId, key)) return { status: "ALREADY_MEMBER", chatId: entity.chatId, entity };

    // Telegram asks for a wait on roughly 1 in 9 first attempts.
    if (seed % 9 === 0 && !floodedOnce.has(key + this.accountId)) {
      floodedOnce.add(key + this.accountId);
      const seconds = 60 + (seed % 240);
      throw new TelegramError("FLOOD_WAIT", `대기 ${seconds}초 요구됨`, { waitSeconds: seconds });
    }

    if (entity.requiresApproval) return { status: "REQUESTED", chatId: null, entity };
    if (seed % 31 === 0) throw new TelegramError("PRIVATE", "비공개 방입니다.", { permanent: true });

    markJoined(this.accountId, key);
    return { status: "JOINED", chatId: entity.chatId, entity };
  }

  async readMessages(key: string, limit: number, opts: ReadOptions = {}): Promise<MessageLite[]> {
    const seed = hash(key);
    const messages: MessageLite[] = [];
    const now = Date.now();

    // Every 4th room demands a prerequisite channel up front.
    if (seed % 4 === 0) {
      messages.push({
        id: 1,
        pinned: true,
        date: new Date(now - 3600_000),
        text: `📢 먼저 아래 채널에 가입하세요\nhttps://t.me/prereq${seed % 500}\n가입 후 이용 가능합니다.`,
      });
    }

    // Promo rooms advertise each other — this is what the collector harvests.
    const promoCount = Math.min(limit, 2 + (seed % 4));
    for (let i = 0; i < promoCount; i++) {
      const other = hash(key + i);
      messages.push({
        id: 100 + i,
        date: new Date(now - i * 600_000),
        text: `${pick(ROOM_TITLES, other)} 홍보합니다\nhttps://t.me/promo${other % 900}`,
        // Every other room hides its second link behind anchor text, the way
        // real promo posts do.
        links: i % 2 === 0 ? [`https://t.me/+Hidden${other % 900}Invite`] : undefined,
      });
    }

    const fresh = opts.minId ? messages.filter((m) => m.id > opts.minId!) : messages;
    return fresh.slice(0, limit);
  }

  async probe(key: string): Promise<MessageLite[]> {
    const seed = hash(key);
    // Only some rooms hide their prerequisite behind a chat attempt.
    if (seed % 5 !== 0) return [];
    return [
      {
        id: 999,
        date: new Date(),
        fromBot: true,
        text: `@hidden${seed % 300} 채널 구독 후 이용하세요.`,
      },
    ];
  }

  async archive(): Promise<void> {}
  async mute(): Promise<void> {}

  async listJoined(): Promise<ResolvedEntity[]> {
    const out: ResolvedEntity[] = [];
    for (const key of joinedKeys(this.accountId)) {
      const entity = await this.resolve(key);
      if (entity) out.push(entity);
    }
    return out;
  }
}
