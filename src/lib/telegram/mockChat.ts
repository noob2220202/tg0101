import {
  AuthorizationInfo,
  ChatCapableSession,
  ChatMessageDto,
  DialogSummary,
  OwnProfile,
  ProfileUpdate,
  SpamCheckResult,
} from "./chatTypes";
import { joinedKeys, mockPeerId, mockRoomTitle } from "./mockRooms";

/**
 * Chat/profile behaviour for MOCK_TELEGRAM=1.
 *
 * Conversations are generated deterministically from the account id, and a
 * timer injects an inbound message every few seconds so the live stream, the
 * unread counters and the keyword rules all have something to react to.
 */

const PEOPLE = ["김철수", "박영희", "이민수", "최지우", "정하늘"];
const ROOMS = ["자유홍보방 12", "구인구직 소통방", "총판 광고방 7", "코인 정보방", "먹튀검증 공유"];
const CHATTER = [
  "안녕하세요 반갑습니다",
  "오늘 구인 공고 올라왔나요?",
  "총판 문의 받습니다 연락주세요",
  "https://t.me/newpromo42 여기도 들어오세요",
  "본사 직영 확인했습니다",
  "정보 감사합니다",
];

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * A promo post in a room the account actually joined.
 *
 * The peer id matches what the join fake reported, so the live collector can
 * map it back to a target and file the links — mock mode exercises the whole
 * real-time path, not just the chat UI.
 */
function promoPost(accountId: string, id: number): ChatMessageDto | null {
  const keys = joinedKeys(accountId);
  if (keys.length === 0) return null;

  const key = keys[Math.floor(Math.random() * keys.length)];
  const seed = hash(`${key}:${id}`);
  return {
    id,
    peerId: mockPeerId(key),
    text: `${mockRoomTitle(String(seed))} 새로 열었습니다\nhttps://t.me/live${seed % 900} 놀러오세요`,
    date: new Date(),
    outgoing: false,
    senderId: String(seed % 100000),
    senderName: PEOPLE[seed % PEOPLE.length],
    mediaType: null,
    mediaName: null,
    // Half of them hide the second room behind anchor text.
    links: seed % 2 === 0 ? [`https://t.me/+LiveHidden${seed % 700}`] : undefined,
  };
}

/** Per-account mutable state, so sent messages persist within a run. */
type MockState = {
  profile: OwnProfile;
  sent: Map<string, ChatMessageDto[]>;
  handlers: Set<(message: ChatMessageDto) => void>;
  timer?: NodeJS.Timeout;
  nextId: number;
};

const states = new Map<string, MockState>();

function stateFor(accountId: string): MockState {
  const existing = states.get(accountId);
  if (existing) return existing;

  const seed = hash(accountId);
  const state: MockState = {
    profile: {
      id: String(seed % 1000000),
      firstName: "테스트",
      lastName: `계정${seed % 100}`,
      username: `mock_user_${seed % 1000}`,
      phone: "+821000000000",
      about: "모의 계정입니다.",
      hasPhoto: false,
    },
    sent: new Map(),
    handlers: new Set(),
    nextId: 10_000,
  };
  states.set(accountId, state);
  return state;
}

function dialogsFor(accountId: string): DialogSummary[] {
  const seed = hash(accountId);
  const now = Date.now();

  const out: DialogSummary[] = [];
  for (let i = 0; i < 5; i++) {
    const s = hash(`${accountId}:group:${i}`);
    out.push({
      peerId: `-100${1000000 + (s % 900000)}`,
      peerType: "GROUP",
      title: ROOMS[(seed + i) % ROOMS.length],
      username: `room${s % 900}`,
      unreadCount: s % 5,
      lastMessageId: 100 + i,
      lastMessageText: CHATTER[s % CHATTER.length],
      lastMessageAt: new Date(now - i * 600_000),
      lastMessageOut: i % 3 === 0,
      pinned: i === 0,
      muted: i % 4 === 0,
      archived: false,
    });
  }
  for (let i = 0; i < 3; i++) {
    const s = hash(`${accountId}:user:${i}`);
    out.push({
      peerId: String(500000 + (s % 400000)),
      peerType: "USER",
      title: PEOPLE[(seed + i) % PEOPLE.length],
      username: null,
      unreadCount: i === 0 ? 2 : 0,
      lastMessageId: 200 + i,
      lastMessageText: CHATTER[(s + 2) % CHATTER.length],
      lastMessageAt: new Date(now - (i + 1) * 1_800_000),
      lastMessageOut: false,
      pinned: false,
      muted: false,
      archived: false,
    });
  }
  return out.sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0));
}

/** Ordinary traffic in one of the account's conversations. */
function chatterPost(accountId: string, id: number): ChatMessageDto {
  const dialogs = dialogsFor(accountId);
  const dialog = dialogs[Math.floor(Math.random() * dialogs.length)];
  return {
    id,
    peerId: dialog.peerId,
    text: CHATTER[Math.floor(Math.random() * CHATTER.length)],
    date: new Date(),
    outgoing: false,
    senderId: String(hash(dialog.peerId) % 100000),
    senderName: PEOPLE[Math.floor(Math.random() * PEOPLE.length)],
    mediaType: null,
    mediaName: null,
  };
}

export class MockChatSession implements ChatCapableSession {
  constructor(private readonly accountId: string) {}

  async listDialogs(limit: number, archived: boolean): Promise<DialogSummary[]> {
    if (archived) return [];
    return dialogsFor(this.accountId).slice(0, limit);
  }

  async getHistory(peerId: string, limit: number, offsetId?: number): Promise<ChatMessageDto[]> {
    // Paging past the synthetic history returns nothing, which is what the UI
    // needs to stop asking for more.
    if (offsetId && offsetId <= 1) return [];

    const seed = hash(peerId);
    const base: ChatMessageDto[] = [];
    const now = Date.now();
    const count = Math.min(limit, 20);

    for (let i = count; i > 0; i--) {
      const s = hash(`${peerId}:${i}`);
      base.push({
        id: i,
        peerId,
        text: CHATTER[s % CHATTER.length],
        date: new Date(now - i * 300_000),
        outgoing: s % 4 === 0,
        senderId: String(seed % 100000),
        senderName: PEOPLE[s % PEOPLE.length],
        mediaType: s % 11 === 0 ? "PHOTO" : null,
        mediaName: null,
      });
    }

    const sent = stateFor(this.accountId).sent.get(peerId) ?? [];
    return [...base, ...sent].sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  async sendChatMessage(peerId: string, text: string): Promise<ChatMessageDto> {
    const state = stateFor(this.accountId);
    const message: ChatMessageDto = {
      id: state.nextId++,
      peerId,
      text,
      date: new Date(),
      outgoing: true,
      senderId: state.profile.id,
      senderName: "나",
      mediaType: null,
      mediaName: null,
    };
    const list = state.sent.get(peerId) ?? [];
    list.push(message);
    state.sent.set(peerId, list);
    return message;
  }

  async markRead(): Promise<void> {}

  async downloadMedia(): Promise<{ path: string; name: string } | null> {
    // No real bytes exist in mock mode.
    return null;
  }

  async getProfile(): Promise<OwnProfile> {
    return stateFor(this.accountId).profile;
  }

  async updateProfile(update: ProfileUpdate): Promise<OwnProfile> {
    const state = stateFor(this.accountId);
    state.profile = {
      ...state.profile,
      ...(update.firstName !== undefined ? { firstName: update.firstName } : {}),
      ...(update.lastName !== undefined ? { lastName: update.lastName } : {}),
      ...(update.about !== undefined ? { about: update.about } : {}),
    };
    return state.profile;
  }

  async updateUsername(username: string): Promise<OwnProfile> {
    const state = stateFor(this.accountId);
    // Mimic the one failure operators actually hit.
    if (username.toLowerCase() === "admin") throw new Error("이미 사용 중인 아이디입니다.");
    state.profile = { ...state.profile, username };
    return state.profile;
  }

  async setProfilePhoto(): Promise<void> {
    const state = stateFor(this.accountId);
    state.profile = { ...state.profile, hasPhoto: true };
  }

  async deleteProfilePhoto(): Promise<void> {
    const state = stateFor(this.accountId);
    state.profile = { ...state.profile, hasPhoto: false };
  }

  async downloadOwnPhoto(): Promise<{ path: string } | null> {
    return null;
  }

  async listAuthorizations(): Promise<AuthorizationInfo[]> {
    return [
      {
        hash: "0",
        deviceModel: "tg-autojoin",
        platform: "Linux",
        appName: "MockClient",
        ip: "127.0.0.1",
        country: "Korea",
        dateActive: new Date(),
        current: true,
      },
      {
        hash: "12345",
        deviceModel: "iPhone 15",
        platform: "iOS",
        appName: "Telegram",
        ip: "203.0.113.7",
        country: "Korea",
        dateActive: new Date(Date.now() - 86_400_000),
        current: false,
      },
    ];
  }

  async resetAuthorization(): Promise<void> {}

  async checkSpamStatus(): Promise<SpamCheckResult> {
    // One account in four looks limited, so the health UI has both states.
    const limited = hash(this.accountId) % 4 === 0;
    return limited
      ? {
          status: "LIMITED",
          message: "Your account is limited until 12 Sep 2026.",
          restrictedUntil: new Date(Date.now() + 7 * 86_400_000),
        }
      : { status: "OK", message: "Good news, no limits are currently applied to your account.", restrictedUntil: null };
  }

  onNewMessage(handler: (message: ChatMessageDto) => void): () => void {
    const state = stateFor(this.accountId);
    state.handlers.add(handler);

    // Start the synthetic feed on the first subscriber.
    if (!state.timer) {
      state.timer = setInterval(() => {
        const id = state.nextId++;
        // Two thirds ordinary chatter, one third a promo post in a joined room.
        const message =
          (id % 3 === 0 ? promoPost(this.accountId, id) : null) ?? chatterPost(this.accountId, id);
        for (const fn of state.handlers) fn(message);
      }, 15_000);
      // Never keep the process alive just for fake traffic.
      state.timer.unref?.();
    }

    return () => {
      state.handlers.delete(handler);
      if (state.handlers.size === 0 && state.timer) {
        clearInterval(state.timer);
        state.timer = undefined;
      }
    };
  }
}
