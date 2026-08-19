import { EntityType } from "../enums";

/**
 * The chat- and profile-facing half of a Telegram session.
 *
 * Kept separate from the join-oriented types so the two concerns stay legible:
 * everything here exists to serve the web client, not the queue.
 */

/** One conversation in an account's chat list. */
export type DialogSummary = {
  /** Canonical marked peer id, e.g. "-1001234567890" — stable across restarts. */
  peerId: string;
  peerType: EntityType;
  title: string;
  username: string | null;
  unreadCount: number;
  lastMessageId: number | null;
  lastMessageText: string;
  lastMessageAt: Date | null;
  lastMessageOut: boolean;
  pinned: boolean;
  muted: boolean;
  archived: boolean;
};

export type ChatMessageDto = {
  id: number;
  peerId: string;
  text: string;
  date: Date;
  outgoing: boolean;
  senderId: string | null;
  senderName: string | null;
  /** PHOTO | DOCUMENT | VIDEO | VOICE | STICKER | OTHER */
  mediaType: string | null;
  mediaName: string | null;
  /**
   * Addresses that are in the message but not in its text: hidden hyperlinks,
   * inline button targets and the link preview. The live collector reads these
   * alongside the body.
   */
  links?: string[];
};

/** The signed-in account's own profile. */
export type OwnProfile = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  phone: string | null;
  about: string | null;
  hasPhoto: boolean;
};

export type ProfileUpdate = {
  firstName?: string;
  lastName?: string;
  about?: string;
};

/** An active login on the Telegram account, from account.getAuthorizations. */
export type AuthorizationInfo = {
  hash: string;
  deviceModel: string;
  platform: string;
  appName: string;
  ip: string;
  country: string;
  dateActive: Date | null;
  current: boolean;
};

/** What @SpamBot said about the account. */
export type SpamCheckResult = {
  /** OK | LIMITED | UNKNOWN */
  status: string;
  message: string;
  restrictedUntil: Date | null;
};

/** Emitted by the gateway when a new message arrives on any account. */
export type IncomingMessageEvent = {
  accountId: string;
  message: ChatMessageDto;
  /** Dialog metadata so the client can update its list without a refetch. */
  dialogTitle: string | null;
};

/** Chat and profile operations layered on top of a connected session. */
export interface ChatCapableSession {
  listDialogs(limit: number, archived: boolean): Promise<DialogSummary[]>;
  getHistory(peerId: string, limit: number, offsetId?: number): Promise<ChatMessageDto[]>;
  sendChatMessage(peerId: string, text: string): Promise<ChatMessageDto>;
  markRead(peerId: string, maxId?: number): Promise<void>;

  /** Downloads to the local media cache and returns the file path. */
  downloadMedia(peerId: string, messageId: number): Promise<{ path: string; name: string } | null>;

  getProfile(): Promise<OwnProfile>;
  updateProfile(update: ProfileUpdate): Promise<OwnProfile>;
  updateUsername(username: string): Promise<OwnProfile>;
  setProfilePhoto(file: Buffer, fileName: string): Promise<void>;
  deleteProfilePhoto(): Promise<void>;
  /** The account's own avatar, for the chat header. */
  downloadOwnPhoto(): Promise<{ path: string } | null>;

  listAuthorizations(): Promise<AuthorizationInfo[]>;
  resetAuthorization(hash: string): Promise<void>;

  checkSpamStatus(): Promise<SpamCheckResult>;

  /** Register a callback for inbound messages. Returns an unsubscribe fn. */
  onNewMessage(handler: (message: ChatMessageDto) => void): () => void;
}
