import { z } from "zod";

import { prisma } from "@/lib/db";
import { handleError, ok } from "@/lib/apiResponse";
import { requireUser } from "@/lib/auth/session";
import { cancelLogin, startLogin, submitLoginValue } from "@/lib/telegram/login";

// The login conversation holds an open MTProto connection in module state, so
// it must run on Node and never be pre-rendered.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startSchema = z.object({
  action: z.literal("start"),
  label: z.string().trim().min(1, "계정 이름을 입력하세요.").max(40),
  phone: z.string().trim().min(5, "전화번호를 입력하세요.").max(30),
});

const submitSchema = z.object({
  action: z.literal("submit"),
  loginId: z.string().min(1),
  kind: z.enum(["code", "password"]),
  value: z.string().trim().min(1, "값을 입력하세요."),
  /** Settings applied to the account row once sign-in completes. */
  joinIntervalSec: z.number().int().min(5).max(3600).default(20),
  collectEnabled: z.boolean().default(true),
});

const cancelSchema = z.object({
  action: z.literal("cancel"),
  loginId: z.string().min(1),
});

const bodySchema = z.discriminatedUnion("action", [startSchema, submitSchema, cancelSchema]);

/**
 * Drives the three-step Telegram sign-in:
 *   start   -> Telegram sends a code
 *   submit  -> code, then a 2FA password if the account has one
 *   cancel  -> tear down a half-finished attempt
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = bodySchema.parse(await request.json());

    if (body.action === "cancel") {
      await cancelLogin(body.loginId);
      return ok({ cancelled: true });
    }

    if (body.action === "start") {
      const existing = await prisma.account.findUnique({
        where: { ownerId_label: { ownerId: user.id, label: body.label } },
      });
      if (existing) throw new Error("같은 이름의 계정이 이미 있습니다.");

      const result = await startLogin(body.phone, body.label);
      return ok(result);
    }

    const result = await submitLoginValue(body.loginId, body.value, body.kind);

    if (result.stage !== "COMPLETE" || !result.sessionString) {
      // Telegram wants the 2FA password next.
      return ok({ stage: result.stage });
    }

    const account = await prisma.account.create({
      data: {
        ownerId: user.id,
        label: result.label,
        phone: result.phone,
        sessionString: result.sessionString,
        status: "ACTIVE",
        joinIntervalSec: body.joinIntervalSec,
        collectEnabled: body.collectEnabled,
      },
    });

    return ok({ stage: "COMPLETE", accountId: account.id }, 201);
  } catch (err) {
    return handleError(err);
  }
}
