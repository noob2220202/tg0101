import { EntityType } from "../enums";

/** Normalised view of a Telegram chat, independent of the MTProto layer. */
export type ResolvedEntity = {
  key: string;
  chatId: string;
  title: string | null;
  entityType: EntityType;
  memberCount: number | null;
  /** True when the room only lets you in after an admin approves. */
  requiresApproval?: boolean;
};

export type MessageLite = {
  id: number;
  text: string;
  date: Date;
  /** Pinned messages usually carry the rules, including prerequisites. */
  pinned?: boolean;
  fromBot?: boolean;
  /**
   * Addresses the message carries outside its text: hidden hyperlinks, inline
   * button targets and the link preview. Promo rooms hide most of their links
   * this way.
   */
  links?: string[];
};

/** Narrowing options for a history read. */
export type ReadOptions = {
  /** Only messages newer than this id — how an incremental sweep stays cheap. */
  minId?: number | null;
};

export type JoinStatus =
  /** We are in the room. */
  | "JOINED"
  /** We were already a member before this attempt. */
  | "ALREADY_MEMBER"
  /** Join request sent; an admin has to accept it. */
  | "REQUESTED";

export type JoinResult = {
  status: JoinStatus;
  chatId: string | null;
  entity: ResolvedEntity | null;
};

/**
 * Everything the worker needs from one logged-in Telegram account.
 * Implemented by `RealTelegramSession` and `MockTelegramSession`.
 */
export interface TelegramSession {
  readonly accountId: string;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  resolve(key: string): Promise<ResolvedEntity | null>;
  join(key: string): Promise<JoinResult>;

  /** Newest-first slice of a room's history. */
  readMessages(key: string, limit: number, opts?: ReadOptions): Promise<MessageLite[]>;

  /** Send a short message, wait briefly for a reply, then delete what we sent. */
  probe(key: string, text: string): Promise<MessageLite[]>;

  archive(key: string): Promise<void>;
  mute(key: string): Promise<void>;

  /** Rooms this account is currently in — used to reconcile memberships. */
  listJoined(): Promise<ResolvedEntity[]>;
}

/** Error codes the worker branches on. */
export type TelegramErrorCode =
  | "FLOOD_WAIT"
  | "ALREADY_PARTICIPANT"
  | "REQUEST_PENDING"
  | "INVITE_INVALID"
  | "INVITE_EXPIRED"
  | "NOT_FOUND"
  | "PRIVATE"
  | "BANNED"
  | "TOO_MANY_CHANNELS"
  | "AUTH_INVALID"
  | "NETWORK"
  | "UNKNOWN";

export class TelegramError extends Error {
  readonly code: TelegramErrorCode;
  /** Seconds Telegram asked us to wait, for FLOOD_WAIT. */
  readonly waitSeconds?: number;
  /** Permanent failures should not be retried. */
  readonly permanent: boolean;

  constructor(code: TelegramErrorCode, message: string, opts: { waitSeconds?: number; permanent?: boolean } = {}) {
    super(message);
    this.name = "TelegramError";
    this.code = code;
    this.waitSeconds = opts.waitSeconds;
    this.permanent = opts.permanent ?? false;
  }
}

/** Korean copy for each failure, shown in the 최근 입장 기록 feed. */
export const ERROR_MESSAGE_KO: Record<TelegramErrorCode, string> = {
  FLOOD_WAIT: "텔레그램이 대기를 요구했습니다. 대기 후 자동으로 재시도합니다.",
  ALREADY_PARTICIPANT: "이미 입장한 방입니다.",
  REQUEST_PENDING: "입장 요청을 보냈습니다. 관리자 수락이 필요합니다.",
  INVITE_INVALID: "초대 링크가 올바르지 않습니다.",
  INVITE_EXPIRED: "초대 링크가 만료되었습니다.",
  NOT_FOUND: "존재하지 않는 방입니다.",
  PRIVATE: "비공개 방이라 입장할 수 없습니다.",
  BANNED: "이 계정은 해당 방에서 차단되었습니다.",
  TOO_MANY_CHANNELS: "계정이 참여할 수 있는 방 수를 초과했습니다.",
  AUTH_INVALID: "세션이 만료되었습니다. 계정을 다시 연결해 주세요.",
  NETWORK: "네트워크 오류입니다. 잠시 후 재시도합니다.",
  UNKNOWN: "분류되지 않은 오류입니다. 잠시 후 재시도합니다.",
};
