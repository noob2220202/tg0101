import { Api, Logger, sessions, TelegramClient } from "teleproto";

import { entityTypeOf, kindOfKey } from "../links";
import { toTelegramError } from "./errors";
import { JoinResult, MessageLite, ResolvedEntity, TelegramError, TelegramSession } from "./types";

/** Telegram's "mute forever" sentinel. */
const MUTE_FOREVER = 2147483647;
const ARCHIVE_FOLDER_ID = 1;

export type RealSessionOptions = {
  accountId: string;
  sessionString: string;
  apiId: number;
  apiHash: string;
};

/**
 * A live MTProto session. One instance per account; the worker keeps it warm
 * between tasks so we are not re-handshaking on every join.
 */
export class RealTelegramSession implements TelegramSession {
  readonly accountId: string;
  private client: TelegramClient;
  private connected = false;

  constructor(opts: RealSessionOptions) {
    this.accountId = opts.accountId;
    this.client = new TelegramClient(new sessions.StringSession(opts.sessionString), opts.apiId, opts.apiHash, {
      connectionRetries: 3,
      retryDelay: 2000,
      autoReconnect: true,
      // The library logs every RPC at info level otherwise.
      baseLogger: new Logger("error" as never),
    });
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    try {
      await this.client.connect();
      if (!(await this.client.isUserAuthorized())) {
        throw new TelegramError("AUTH_INVALID", "세션이 인증되지 않았습니다.", { permanent: true });
      }
      this.connected = true;
    } catch (err) {
      throw toTelegramError(err);
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    try {
      await this.client.disconnect();
      await this.client.destroy();
    } catch {
      // Shutting down — nothing useful to do with a disconnect failure.
    }
  }

  // -------------------------------------------------------------------------
  // Resolution
  // -------------------------------------------------------------------------

  async resolve(key: string): Promise<ResolvedEntity | null> {
    await this.connect();
    try {
      return kindOfKey(key) === "PRIVATE" ? await this.resolvePrivate(key) : await this.resolvePublic(key);
    } catch (err) {
      const te = toTelegramError(err);
      // "Does not exist" is an answer, not a failure.
      if (te.code === "NOT_FOUND" || te.code === "INVITE_INVALID" || te.code === "INVITE_EXPIRED") return null;
      throw te;
    }
  }

  private async resolvePublic(key: string): Promise<ResolvedEntity | null> {
    const entity = (await this.client.getEntity(key)) as unknown as {
      className: string;
      id: { toString(): string };
      title?: string;
      username?: string;
      firstName?: string;
      participantsCount?: number;
      broadcast?: boolean;
      megagroup?: boolean;
      bot?: boolean;
      joinRequest?: boolean;
    };
    if (!entity) return null;

    return {
      key,
      chatId: entity.id.toString(),
      title: entity.title ?? entity.firstName ?? entity.username ?? null,
      entityType: entityTypeOf(entity),
      memberCount: entity.participantsCount ?? (await this.tryParticipantsCount(key)),
      requiresApproval: entity.joinRequest ?? false,
    };
  }

  private async resolvePrivate(key: string): Promise<ResolvedEntity | null> {
    const hash = key.slice(1);
    const invite = await this.client.invoke(new Api.messages.CheckChatInvite({ hash }));

    // Already a member: Telegram hands back the chat itself.
    if (invite instanceof Api.ChatInviteAlready || invite instanceof Api.ChatInvitePeek) {
      const chat = invite.chat as unknown as {
        className: string;
        id: { toString(): string };
        title?: string;
        participantsCount?: number;
        broadcast?: boolean;
        megagroup?: boolean;
      };
      return {
        key,
        chatId: chat.id.toString(),
        title: chat.title ?? null,
        entityType: entityTypeOf(chat),
        memberCount: chat.participantsCount ?? null,
      };
    }

    if (invite instanceof Api.ChatInvite) {
      return {
        key,
        // Not a member yet, so there is no usable chat id.
        chatId: "",
        title: invite.title ?? null,
        entityType: invite.broadcast ? "CHANNEL" : "GROUP",
        memberCount: invite.participantsCount ?? null,
        requiresApproval: invite.requestNeeded ?? false,
      };
    }
    return null;
  }

  /** Member count needs a separate full-channel fetch; best effort only. */
  private async tryParticipantsCount(key: string): Promise<number | null> {
    try {
      const full = await this.client.invoke(new Api.channels.GetFullChannel({ channel: key }));
      const count = (full.fullChat as unknown as { participantsCount?: number }).participantsCount;
      return count ?? null;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Joining
  // -------------------------------------------------------------------------

  async join(key: string): Promise<JoinResult> {
    await this.connect();
    try {
      if (kindOfKey(key) === "PRIVATE") {
        const updates = await this.client.invoke(new Api.messages.ImportChatInvite({ hash: key.slice(1) }));
        const chatId = firstChatId(updates);
        return { status: "JOINED", chatId, entity: await this.safeResolve(key) };
      }

      await this.client.invoke(new Api.channels.JoinChannel({ channel: key }));
      const entity = await this.safeResolve(key);
      return { status: "JOINED", chatId: entity?.chatId ?? null, entity };
    } catch (err) {
      const te = toTelegramError(err);

      // These two are successful outcomes wearing an error costume.
      if (te.code === "ALREADY_PARTICIPANT") {
        const entity = await this.safeResolve(key);
        return { status: "ALREADY_MEMBER", chatId: entity?.chatId ?? null, entity };
      }
      if (te.code === "REQUEST_PENDING") {
        return { status: "REQUESTED", chatId: null, entity: await this.safeResolve(key) };
      }
      throw te;
    }
  }

  private async safeResolve(key: string): Promise<ResolvedEntity | null> {
    try {
      return await this.resolve(key);
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Reading & probing
  // -------------------------------------------------------------------------

  async readMessages(key: string, limit: number): Promise<MessageLite[]> {
    await this.connect();
    try {
      const entity = await this.client.getEntity(key);
      const messages = await this.client.getMessages(entity, { limit });
      return messages
        .filter((m) => typeof m.message === "string" && m.message.length > 0)
        .map((m) => ({
          id: m.id,
          text: m.message as string,
          date: new Date(m.date * 1000),
          pinned: Boolean((m as unknown as { pinned?: boolean }).pinned),
          fromBot: Boolean((m as unknown as { viaBotId?: unknown }).viaBotId),
        }));
    } catch (err) {
      throw toTelegramError(err);
    }
  }

  /**
   * Say hello, see what the room says back, then delete our own message.
   *
   * Some rooms only reveal their prerequisite channel when you try to talk, so
   * this is the only way to discover them — but it does put a message in
   * someone else's room, so the caller gates it behind an explicit opt-in and
   * only ever runs it once per room.
   */
  async probe(key: string, text: string): Promise<MessageLite[]> {
    await this.connect();
    let sentId: number | undefined;
    const entity = await this.client.getEntity(key);
    const before = await this.client.getMessages(entity, { limit: 1 });
    const sinceId = before[0]?.id ?? 0;

    try {
      const sent = await this.client.sendMessage(entity, { message: text });
      sentId = sent.id;
    } catch (err) {
      const te = toTelegramError(err);
      // Being refused is itself the signal we were looking for; the refusal
      // text usually names the channel we must join first.
      if (te.code !== "BANNED") throw te;
    }

    // Give bots a moment to answer.
    await sleep(4000);

    let replies: MessageLite[] = [];
    try {
      const after = await this.client.getMessages(entity, { limit: 10 });
      replies = after
        .filter((m) => m.id > sinceId && m.id !== sentId && typeof m.message === "string" && m.message)
        .map((m) => ({
          id: m.id,
          text: m.message as string,
          date: new Date(m.date * 1000),
          fromBot: true,
        }));
    } catch {
      // Reading back is best effort.
    }

    if (sentId !== undefined) {
      try {
        await this.client.deleteMessages(entity, [sentId], { revoke: true });
      } catch {
        // If we cannot delete it, the message stays — nothing else to do.
      }
    }
    return replies;
  }

  // -------------------------------------------------------------------------
  // Housekeeping
  // -------------------------------------------------------------------------

  async archive(key: string): Promise<void> {
    await this.connect();
    try {
      const peer = await this.client.getInputEntity(key);
      await this.client.invoke(
        new Api.folders.EditPeerFolders({
          folderPeers: [new Api.InputFolderPeer({ peer, folderId: ARCHIVE_FOLDER_ID })],
        }),
      );
    } catch (err) {
      throw toTelegramError(err);
    }
  }

  async mute(key: string): Promise<void> {
    await this.connect();
    try {
      const peer = await this.client.getInputEntity(key);
      await this.client.invoke(
        new Api.account.UpdateNotifySettings({
          // The library wraps this in an InputNotifyPeer itself.
          peer,
          settings: new Api.InputPeerNotifySettings({
            muteUntil: MUTE_FOREVER,
            showPreviews: false,
            silent: true,
          }),
        }),
      );
    } catch (err) {
      throw toTelegramError(err);
    }
  }

  async listJoined(): Promise<ResolvedEntity[]> {
    await this.connect();
    try {
      const dialogs = await this.client.getDialogs({ limit: 500 });
      const out: ResolvedEntity[] = [];
      for (const d of dialogs) {
        const e = d.entity as unknown as {
          className: string;
          id: { toString(): string };
          title?: string;
          username?: string;
          participantsCount?: number;
          broadcast?: boolean;
          megagroup?: boolean;
        };
        if (!e || e.className === "User") continue;
        out.push({
          key: e.username?.toLowerCase() ?? `id:${e.id.toString()}`,
          chatId: e.id.toString(),
          title: e.title ?? null,
          entityType: entityTypeOf(e),
          memberCount: e.participantsCount ?? null,
        });
      }
      return out;
    } catch (err) {
      throw toTelegramError(err);
    }
  }
}

function firstChatId(updates: unknown): string | null {
  const chats = (updates as { chats?: Array<{ id: { toString(): string } }> })?.chats;
  return chats?.[0]?.id?.toString() ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
