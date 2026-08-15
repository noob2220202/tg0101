import { z } from "zod";

import { handleError, ok } from "@/lib/apiResponse";
import { requireUser } from "@/lib/auth/session";
import { callGateway } from "@/lib/gateway/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Telegram's own rules for a username, checked before the round-trip. */
const usernameSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/, "영문으로 시작하는 5~32자의 영문·숫자·밑줄이어야 합니다.");

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get"), accountId: z.string().min(1) }),
  z.object({
    action: z.literal("update"),
    accountId: z.string().min(1),
    firstName: z.string().trim().max(64).optional(),
    lastName: z.string().trim().max(64).optional(),
    about: z.string().trim().max(70, "소개는 70자까지 입력할 수 있습니다.").optional(),
  }),
  z.object({ action: z.literal("username"), accountId: z.string().min(1), username: usernameSchema }),
  z.object({
    action: z.literal("photo"),
    accountId: z.string().min(1),
    /** Base64 without the data: prefix. */
    dataBase64: z.string().min(1),
    fileName: z.string().max(120).default("photo.jpg"),
  }),
  z.object({ action: z.literal("deletePhoto"), accountId: z.string().min(1) }),
  z.object({ action: z.literal("sessions"), accountId: z.string().min(1) }),
  z.object({ action: z.literal("resetSession"), accountId: z.string().min(1), hash: z.string().min(1) }),
  z.object({ action: z.literal("checkSpam"), accountId: z.string().min(1) }),
]);

/** Profile editing and session management for one Telegram account. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = bodySchema.parse(await request.json());
    const { accountId } = body;

    switch (body.action) {
      case "get":
        return ok(await callGateway(user.id, accountId, "getProfile"));
      case "update":
        return ok(
          await callGateway(user.id, accountId, "updateProfile", {
            firstName: body.firstName,
            lastName: body.lastName,
            about: body.about,
          }),
        );
      case "username":
        return ok(await callGateway(user.id, accountId, "updateUsername", { username: body.username }));
      case "photo": {
        // ~4/3 expansion from base64, so this caps the original around 4 MB.
        if (body.dataBase64.length > 6_000_000) throw new Error("이미지가 너무 큽니다. 4MB 이하로 올려주세요.");
        return ok(
          await callGateway(user.id, accountId, "setProfilePhoto", {
            dataBase64: body.dataBase64,
            fileName: body.fileName,
          }),
        );
      }
      case "deletePhoto":
        return ok(await callGateway(user.id, accountId, "deleteProfilePhoto"));
      case "sessions":
        return ok(await callGateway(user.id, accountId, "listAuthorizations"));
      case "resetSession":
        return ok(await callGateway(user.id, accountId, "resetAuthorization", { hash: body.hash }));
      case "checkSpam":
        return ok(await callGateway(user.id, accountId, "checkSpam"));
    }
  } catch (err) {
    return handleError(err);
  }
}
