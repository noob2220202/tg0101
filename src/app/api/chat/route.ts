import { z } from "zod";

import { handleError, ok } from "@/lib/apiResponse";
import { getOwner } from "@/lib/owner";
import { callGateway } from "@/lib/gateway/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One endpoint for the chat client's reads and writes; the action discriminant
 * keeps the round-trips in a single place rather than five near-identical
 * route files.
 */
const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("dialogs"),
    accountId: z.string().min(1),
    limit: z.number().int().min(1).max(300).default(100),
    archived: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("history"),
    accountId: z.string().min(1),
    peerId: z.string().min(1),
    limit: z.number().int().min(1).max(100).default(50),
    offsetId: z.number().int().optional(),
  }),
  z.object({
    action: z.literal("send"),
    accountId: z.string().min(1),
    peerId: z.string().min(1),
    text: z.string().trim().min(1, "메시지를 입력하세요.").max(4096),
  }),
  z.object({
    action: z.literal("read"),
    accountId: z.string().min(1),
    peerId: z.string().min(1),
    maxId: z.number().int().optional(),
  }),
]);

export async function POST(request: Request) {
  try {
    const owner = await getOwner();
    const body = bodySchema.parse(await request.json());

    switch (body.action) {
      case "dialogs":
        return ok(
          await callGateway(owner.id, body.accountId, "listDialogs", {
            limit: body.limit,
            archived: body.archived,
          }),
        );
      case "history":
        return ok(
          await callGateway(owner.id, body.accountId, "getHistory", {
            peerId: body.peerId,
            limit: body.limit,
            offsetId: body.offsetId,
          }),
        );
      case "send":
        return ok(
          await callGateway(owner.id, body.accountId, "sendMessage", {
            peerId: body.peerId,
            text: body.text,
          }),
        );
      case "read":
        return ok(
          await callGateway(owner.id, body.accountId, "markRead", {
            peerId: body.peerId,
            maxId: body.maxId,
          }),
        );
    }
  } catch (err) {
    return handleError(err);
  }
}
