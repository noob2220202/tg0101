import fs from "node:fs/promises";
import path from "node:path";

import { Api, TelegramClient, utils } from "teleproto";
import { CustomFile } from "teleproto/client/uploads";
import { NewMessage, NewMessageEvent } from "teleproto/events";

import { entityTypeOf } from "../links";
import { toTelegramError } from "./errors";
import {
  AuthorizationInfo,
  ChatMessageDto,
  DialogSummary,
  OwnProfile,
  ProfileUpdate,
  SpamCheckResult,
} from "./chatTypes";

/**
 * Chat and profile operations against a live MTProto client.
 *
 * These are free functions rather than methods so `RealTelegramSession` can
 * stay focused on joining; it delegates here.
 */

/** Where downloaded photos and documents are cached. */
export function mediaRoot(): string {
  return process.env.MEDIA_DIR ?? path.join(process.cwd(), ".media");
}

/** Telegram's canonical marked id ("-1001234…"), stable across restarts. */
function peerIdOf(entity: unknown): string {
  return utils.getPeerId(entity as never);
}

function textOf(message: { message?: string; media?: unknown }): string {
  if (message.message) return message.message;
  return message.media ? "[미디어]" : "";
}

function mediaTypeOf(media: unknown): string | null {
  if (!media) return null;
  const className = (media as { className?: string }).className ?? "";
  if (className === "MessageMediaPhoto") return "PHOTO";
  if (className !== "MessageMediaDocument") return "OTHER";

  // Documents carry their real nature in attributes.
  const attributes =
    ((media as { document?: { attributes?: Array<{ className: string }> } }).document?.attributes ?? []);
  const names = attributes.map((a) => a.className);
  if (names.includes("DocumentAttributeSticker")) return "STICKER";
  if (names.includes("DocumentAttributeVideo")) return "VIDEO";
  if (names.includes("DocumentAttributeAudio")) return "VOICE";
  return "DOCUMENT";
}

function mediaNameOf(media: unknown): string | null {
  const attributes =
    ((media as { document?: { attributes?: Array<{ className: string; fileName?: string }> } })?.document
      ?.attributes ?? []);
  return attributes.find((a) => a.className === "DocumentAttributeFilename")?.fileName ?? null;
}

function senderNameOf(sender: unknown): string | null {
  const s = sender as { title?: string; firstName?: string; lastName?: string; username?: string } | null;
  if (!s) return null;
  if (s.title) return s.title;
  const full = [s.firstName, s.lastName].filter(Boolean).join(" ").trim();
  return full || s.username || null;
}

export function toMessageDto(message: Api.Message, peerId: string): ChatMessageDto {
  const sender = (message as unknown as { sender?: unknown }).sender ?? null;
  return {
    id: message.id,
    peerId,
    text: textOf(message as unknown as { message?: string; media?: unknown }),
    date: new Date(message.date * 1000),
    outgoing: Boolean(message.out),
    senderId: message.senderId ? message.senderId.toString() : null,
    senderName: senderNameOf(sender),
    mediaType: mediaTypeOf(message.media),
    mediaName: mediaNameOf(message.media),
  };
}

// ---------------------------------------------------------------------------
// Dialogs and messages
// ---------------------------------------------------------------------------

export async function listDialogs(
  client: TelegramClient,
  limit: number,
  archived: boolean,
): Promise<DialogSummary[]> {
  try {
    const dialogs = await client.getDialogs({ limit, archived });
    const out: DialogSummary[] = [];

    for (const dialog of dialogs) {
      const entity = dialog.entity;
      if (!entity) continue;

      const message = dialog.message;
      out.push({
        peerId: peerIdOf(entity),
        peerType: entityTypeOf(entity as never),
        title: dialog.title ?? dialog.name ?? "이름 없음",
        username: (entity as unknown as { username?: string }).username ?? null,
        unreadCount: dialog.unreadCount ?? 0,
        lastMessageId: message?.id ?? null,
        lastMessageText: message ? textOf(message as unknown as { message?: string; media?: unknown }) : "",
        lastMessageAt: message ? new Date(message.date * 1000) : null,
        lastMessageOut: Boolean(message?.out),
        pinned: Boolean(dialog.pinned),
        // `dialog.dialog.notifySettings.muteUntil` is set for muted chats.
        muted: Boolean(dialog.dialog?.notifySettings?.muteUntil),
        archived: Boolean(dialog.archived),
      });
    }
    return out;
  } catch (err) {
    throw toTelegramError(err);
  }
}

export async function getHistory(
  client: TelegramClient,
  peerId: string,
  limit: number,
  offsetId?: number,
): Promise<ChatMessageDto[]> {
  try {
    const entity = await client.getEntity(peerId);
    const messages = await client.getMessages(entity, {
      limit,
      ...(offsetId ? { offsetId } : {}),
    });
    // Telegram returns newest-first; the UI reads oldest-first.
    return messages.map((m) => toMessageDto(m, peerId)).reverse();
  } catch (err) {
    throw toTelegramError(err);
  }
}

export async function sendChatMessage(
  client: TelegramClient,
  peerId: string,
  text: string,
): Promise<ChatMessageDto> {
  try {
    const entity = await client.getEntity(peerId);
    const sent = await client.sendMessage(entity, { message: text });
    return toMessageDto(sent, peerId);
  } catch (err) {
    throw toTelegramError(err);
  }
}

export async function markRead(client: TelegramClient, peerId: string, maxId?: number): Promise<void> {
  try {
    const entity = await client.getEntity(peerId);
    await client.markAsRead(entity, maxId);
  } catch (err) {
    throw toTelegramError(err);
  }
}

export async function downloadMedia(
  client: TelegramClient,
  accountId: string,
  peerId: string,
  messageId: number,
): Promise<{ path: string; name: string } | null> {
  try {
    const entity = await client.getEntity(peerId);
    const [message] = await client.getMessages(entity, { ids: [messageId] });
    if (!message?.media) return null;

    const dir = path.join(mediaRoot(), accountId, peerId.replace("-", "n"));
    await fs.mkdir(dir, { recursive: true });

    const name = mediaNameOf(message.media) ?? `${messageId}`;
    const target = path.join(dir, `${messageId}-${sanitize(name)}`);

    // Already cached from a previous request.
    if (await exists(target)) return { path: target, name };

    const buffer = await client.downloadMedia(message, {});
    if (!buffer || typeof buffer === "string") return null;

    await fs.writeFile(target, buffer as Buffer);
    return { path: target, name };
  } catch (err) {
    throw toTelegramError(err);
  }
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export async function getProfile(client: TelegramClient): Promise<OwnProfile> {
  try {
    const me = (await client.getMe()) as unknown as {
      id: { toString(): string };
      firstName?: string;
      lastName?: string;
      username?: string;
      phone?: string;
      photo?: unknown;
    };

    // `about` lives on the full user, not the short one.
    let about: string | null = null;
    try {
      const full = await client.invoke(new Api.users.GetFullUser({ id: "me" }));
      about = (full.fullUser as unknown as { about?: string }).about ?? null;
    } catch {
      // Not fatal — the rest of the profile is still useful.
    }

    return {
      id: me.id.toString(),
      firstName: me.firstName ?? null,
      lastName: me.lastName ?? null,
      username: me.username ?? null,
      phone: me.phone ?? null,
      about,
      hasPhoto: Boolean(me.photo),
    };
  } catch (err) {
    throw toTelegramError(err);
  }
}

export async function updateProfile(client: TelegramClient, update: ProfileUpdate): Promise<OwnProfile> {
  try {
    await client.invoke(
      new Api.account.UpdateProfile({
        // Telegram treats an omitted field as "leave unchanged".
        ...(update.firstName !== undefined ? { firstName: update.firstName } : {}),
        ...(update.lastName !== undefined ? { lastName: update.lastName } : {}),
        ...(update.about !== undefined ? { about: update.about } : {}),
      }),
    );
    return getProfile(client);
  } catch (err) {
    throw toTelegramError(err);
  }
}

export async function updateUsername(client: TelegramClient, username: string): Promise<OwnProfile> {
  try {
    await client.invoke(new Api.account.UpdateUsername({ username }));
    return getProfile(client);
  } catch (err) {
    const error = toTelegramError(err);
    // These come back as raw server strings; make them readable.
    if (/USERNAME_OCCUPIED/i.test(error.message)) {
      throw new Error("이미 사용 중인 아이디입니다.");
    }
    if (/USERNAME_INVALID/i.test(error.message)) {
      throw new Error("사용할 수 없는 아이디입니다. 영문·숫자·밑줄 5자 이상이어야 합니다.");
    }
    if (/USERNAME_NOT_MODIFIED/i.test(error.message)) return getProfile(client);
    throw error;
  }
}

export async function setProfilePhoto(
  client: TelegramClient,
  buffer: Buffer,
  fileName: string,
): Promise<void> {
  try {
    const file = await client.uploadFile({
      file: new CustomFile(fileName, buffer.length, "", buffer),
      workers: 1,
    });
    await client.invoke(new Api.photos.UploadProfilePhoto({ file }));
  } catch (err) {
    throw toTelegramError(err);
  }
}

export async function deleteProfilePhoto(client: TelegramClient): Promise<void> {
  try {
    const photos = await client.invoke(
      new Api.photos.GetUserPhotos({ userId: "me", offset: 0, maxId: BigInt(0) as never, limit: 1 }),
    );
    const list = (photos as unknown as { photos?: Array<{ id: unknown; accessHash: unknown; fileReference: unknown }> })
      .photos;
    if (!list || list.length === 0) return;

    await client.invoke(
      new Api.photos.DeletePhotos({
        id: list.map(
          (photo) =>
            new Api.InputPhoto({
              id: photo.id as never,
              accessHash: photo.accessHash as never,
              fileReference: photo.fileReference as never,
            }),
        ),
      }),
    );
  } catch (err) {
    throw toTelegramError(err);
  }
}

export async function downloadOwnPhoto(
  client: TelegramClient,
  accountId: string,
): Promise<{ path: string } | null> {
  try {
    const me = await client.getMe();
    if (!(me as unknown as { photo?: unknown }).photo) return null;

    const dir = path.join(mediaRoot(), accountId);
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, "avatar.jpg");

    const buffer = await client.downloadProfilePhoto(me);
    if (!buffer || typeof buffer === "string" || buffer.length === 0) return null;

    await fs.writeFile(target, buffer as Buffer);
    return { path: target };
  } catch {
    // An avatar is decoration; never fail a request over it.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sessions & spam status
// ---------------------------------------------------------------------------

export async function listAuthorizations(client: TelegramClient): Promise<AuthorizationInfo[]> {
  try {
    const result = await client.invoke(new Api.account.GetAuthorizations());
    return result.authorizations.map((auth) => ({
      hash: auth.hash.toString(),
      deviceModel: auth.deviceModel,
      platform: auth.platform,
      appName: auth.appName,
      ip: auth.ip,
      country: auth.country,
      dateActive: auth.dateActive ? new Date(auth.dateActive * 1000) : null,
      current: Boolean(auth.current),
    }));
  } catch (err) {
    throw toTelegramError(err);
  }
}

export async function resetAuthorization(client: TelegramClient, hash: string): Promise<void> {
  try {
    await client.invoke(new Api.account.ResetAuthorization({ hash: BigInt(hash) as never }));
  } catch (err) {
    throw toTelegramError(err);
  }
}

/** Phrases @SpamBot uses when an account is in the clear. */
const SPAM_OK = [/no limits are currently applied/i, /good news/i, /제한(이)?\s*없/];
/** …and when it is not. */
const SPAM_LIMITED = [/limited until/i, /your account.*(limited|restricted)/i, /제한/];

/**
 * Ask @SpamBot whether the account is restricted.
 *
 * There is no API for this — the bot is the only source of truth Telegram
 * offers, so we talk to it and parse the prose.
 */
export async function checkSpamStatus(client: TelegramClient): Promise<SpamCheckResult> {
  try {
    const bot = await client.getEntity("SpamBot");
    await client.sendMessage(bot, { message: "/start" });

    // Give the bot a moment; it answers within a second or two.
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const [reply] = await client.getMessages(bot, { limit: 1 });
    const text = reply?.message ?? "";
    if (!text) return { status: "UNKNOWN", message: "응답을 받지 못했습니다.", restrictedUntil: null };

    const limited = SPAM_LIMITED.some((re) => re.test(text));
    const clear = SPAM_OK.some((re) => re.test(text));

    return {
      status: clear && !limited ? "OK" : limited ? "LIMITED" : "UNKNOWN",
      message: text.slice(0, 500),
      restrictedUntil: parseRestrictionDate(text),
    };
  } catch (err) {
    const error = toTelegramError(err);
    return { status: "UNKNOWN", message: error.message, restrictedUntil: null };
  }
}

/** "limited until 12 Sep 2026" -> Date. */
function parseRestrictionDate(text: string): Date | null {
  const match = text.match(/until\s+(\d{1,2}\s+\w+\s+\d{4})/i);
  if (!match) return null;
  const parsed = new Date(match[1]);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// ---------------------------------------------------------------------------
// Live updates
// ---------------------------------------------------------------------------

export function onNewMessage(
  client: TelegramClient,
  handler: (message: ChatMessageDto) => void,
): () => void {
  const callback = async (event: NewMessageEvent) => {
    try {
      const message = event.message;
      const peerId = peerIdOf(message.peerId);
      handler(toMessageDto(message, peerId));
    } catch {
      // A malformed update must never take the stream down.
    }
  };

  client.addEventHandler(callback, new NewMessage({}));
  return () => client.removeEventHandler(callback, new NewMessage({}));
}

// ---------------------------------------------------------------------------

function sanitize(name: string): string {
  return name.replace(/[^\w.\-가-힣]/g, "_").slice(0, 80);
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
