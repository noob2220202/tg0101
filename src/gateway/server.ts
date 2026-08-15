import http from "node:http";
import fs from "node:fs/promises";

import { prisma } from "../lib/db";
import { getChatSession, toTelegramError } from "../lib/telegram";
import type { ChatMessageDto } from "../lib/telegram/chatTypes";
import { GATEWAY_HEADER, GatewayRequest, gatewayToken } from "./protocol";
import { ingestMessage, startWatching, stopWatching } from "./updates";

/**
 * HTTP face of the session owner.
 *
 * Runs inside the worker process, binds to loopback only, and exposes three
 * things: an RPC endpoint, a server-sent-event stream of inbound messages, and
 * a media file server.
 */

const PORT = Number(process.env.GATEWAY_PORT ?? 4599);

/** Connected SSE clients, keyed by an incrementing id. */
const streams = new Map<number, { res: http.ServerResponse; ownerId: string }>();
let nextStreamId = 1;

/** Push an event to every stream belonging to `ownerId`. */
export function broadcast(ownerId: string, payload: unknown): void {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const [id, stream] of streams) {
    if (stream.ownerId !== ownerId) continue;
    try {
      stream.res.write(data);
    } catch {
      streams.delete(id);
    }
  }
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(text);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // Profile photos come through here; anything larger is a mistake.
    if (size > 12 * 1024 * 1024) throw new Error("요청이 너무 큽니다.");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Dispatch one RPC against the account's live session. */
async function dispatch(request: GatewayRequest): Promise<unknown> {
  const { accountId, method, params = {} } = request;

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true, ownerId: true },
  });
  if (!account) throw new Error("계정을 찾을 수 없습니다.");

  const session = await getChatSession(accountId);

  switch (method) {
    case "listDialogs": {
      const dialogs = await session.listDialogs(Number(params.limit ?? 100), Boolean(params.archived));
      await cacheDialogs(accountId, dialogs);
      return dialogs;
    }
    case "getHistory": {
      const messages = await session.getHistory(
        String(params.peerId),
        Number(params.limit ?? 50),
        params.offsetId ? Number(params.offsetId) : undefined,
      );
      // Opening a conversation is what makes it worth caching.
      await cacheMessages(accountId, messages);
      return messages;
    }
    case "sendMessage": {
      const message = await session.sendChatMessage(String(params.peerId), String(params.text));
      await cacheMessages(accountId, [message]);
      await bumpDialog(accountId, message);
      return message;
    }
    case "markRead": {
      await session.markRead(String(params.peerId), params.maxId ? Number(params.maxId) : undefined);
      await prisma.dialog
        .updateMany({
          where: { accountId, peerId: String(params.peerId) },
          data: { unreadCount: 0 },
        })
        .catch(() => {});
      return { ok: true };
    }
    case "getProfile":
      return session.getProfile();
    case "updateProfile": {
      const profile = await session.updateProfile({
        firstName: params.firstName as string | undefined,
        lastName: params.lastName as string | undefined,
        about: params.about as string | undefined,
      });
      await syncProfile(accountId, profile);
      return profile;
    }
    case "updateUsername": {
      const profile = await session.updateUsername(String(params.username));
      await syncProfile(accountId, profile);
      return profile;
    }
    case "setProfilePhoto": {
      const buffer = Buffer.from(String(params.dataBase64), "base64");
      await session.setProfilePhoto(buffer, String(params.fileName ?? "photo.jpg"));
      await prisma.account.update({ where: { id: accountId }, data: { photoUpdatedAt: new Date() } });
      return { ok: true };
    }
    case "deleteProfilePhoto": {
      await session.deleteProfilePhoto();
      await prisma.account.update({ where: { id: accountId }, data: { photoUpdatedAt: null } });
      return { ok: true };
    }
    case "listAuthorizations":
      return session.listAuthorizations();
    case "resetAuthorization":
      await session.resetAuthorization(String(params.hash));
      return { ok: true };
    case "checkSpam": {
      const result = await session.checkSpamStatus();
      await prisma.accountHealth.upsert({
        where: { accountId },
        create: {
          accountId,
          spamStatus: result.status,
          spamMessage: result.message,
          restrictedUntil: result.restrictedUntil,
          checkedAt: new Date(),
        },
        update: {
          spamStatus: result.status,
          spamMessage: result.message,
          restrictedUntil: result.restrictedUntil,
          checkedAt: new Date(),
        },
      });
      return result;
    }
    default:
      throw new Error(`알 수 없는 요청입니다: ${method}`);
  }
}

// ---------------------------------------------------------------------------
// Cache writes
// ---------------------------------------------------------------------------

async function cacheDialogs(
  accountId: string,
  dialogs: Awaited<ReturnType<Awaited<ReturnType<typeof getChatSession>>["listDialogs"]>>,
): Promise<void> {
  for (const dialog of dialogs) {
    const data = {
      peerType: dialog.peerType,
      title: dialog.title,
      username: dialog.username,
      unreadCount: dialog.unreadCount,
      lastMessageId: dialog.lastMessageId,
      lastMessageText: dialog.lastMessageText.slice(0, 300),
      lastMessageAt: dialog.lastMessageAt,
      lastMessageOut: dialog.lastMessageOut,
      pinned: dialog.pinned,
      muted: dialog.muted,
      archived: dialog.archived,
      syncedAt: new Date(),
    };
    await prisma.dialog
      .upsert({
        where: { accountId_peerId: { accountId, peerId: dialog.peerId } },
        create: { accountId, peerId: dialog.peerId, ...data },
        update: data,
      })
      .catch(() => {});
  }
}

async function cacheMessages(accountId: string, messages: ChatMessageDto[]): Promise<void> {
  for (const message of messages) {
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
        update: { text: message.text },
      })
      .catch(() => {});
  }
}

async function bumpDialog(accountId: string, message: ChatMessageDto): Promise<void> {
  await prisma.dialog
    .updateMany({
      where: { accountId, peerId: message.peerId },
      data: {
        lastMessageId: message.id,
        lastMessageText: message.text.slice(0, 300),
        lastMessageAt: message.date,
        lastMessageOut: message.outgoing,
      },
    })
    .catch(() => {});
}

async function syncProfile(
  accountId: string,
  profile: { firstName: string | null; lastName: string | null; username: string | null; about: string | null },
): Promise<void> {
  await prisma.account
    .update({
      where: { id: accountId },
      data: {
        firstName: profile.firstName,
        lastName: profile.lastName,
        username: profile.username,
        about: profile.about,
      },
    })
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export function startGateway(): http.Server {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (url.pathname === "/health") {
        return json(res, 200, { ok: true, streams: streams.size });
      }

      // Everything below is privileged.
      if (req.headers[GATEWAY_HEADER] !== gatewayToken()) {
        return json(res, 401, { ok: false, error: "게이트웨이 인증에 실패했습니다." });
      }

      if (url.pathname === "/rpc" && req.method === "POST") {
        const body = JSON.parse(await readBody(req)) as GatewayRequest;
        try {
          return json(res, 200, { ok: true, data: await dispatch(body) });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return json(res, 200, { ok: false, error: toTelegramError(err).message || message });
        }
      }

      if (url.pathname === "/events") {
        const ownerId = url.searchParams.get("ownerId");
        if (!ownerId) return json(res, 400, { ok: false, error: "ownerId가 필요합니다." });

        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        });

        const id = nextStreamId++;
        streams.set(id, { res, ownerId });
        res.write(`data: ${JSON.stringify({ type: "ready" })}\n\n`);

        // Proxies drop idle connections; a comment line keeps them open.
        const keepAlive = setInterval(() => {
          try {
            res.write(": ping\n\n");
          } catch {
            clearInterval(keepAlive);
          }
        }, 25_000);

        req.on("close", () => {
          clearInterval(keepAlive);
          streams.delete(id);
        });
        return;
      }

      if (url.pathname === "/media" && req.method === "GET") {
        const accountId = url.searchParams.get("accountId") ?? "";
        const peerId = url.searchParams.get("peerId") ?? "";
        const messageId = Number(url.searchParams.get("messageId") ?? 0);
        if (!accountId || !peerId || !messageId) {
          return json(res, 400, { ok: false, error: "잘못된 요청입니다." });
        }

        const session = await getChatSession(accountId);
        const file = await session.downloadMedia(peerId, messageId);
        if (!file) return json(res, 404, { ok: false, error: "미디어를 찾을 수 없습니다." });

        const buffer = await fs.readFile(file.path);
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          "cache-control": "private, max-age=86400",
        });
        return res.end(buffer);
      }

      return json(res, 404, { ok: false, error: "not found" });
    } catch (err) {
      return json(res, 500, { ok: false, error: err instanceof Error ? err.message : "gateway error" });
    }
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[gateway] listening on 127.0.0.1:${PORT}`);
  });

  // Subscribing to update streams is what makes the SSE feed live.
  void startWatching(broadcast, ingestMessage);

  server.on("close", () => void stopWatching());
  return server;
}
