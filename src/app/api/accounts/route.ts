import { z } from "zod";

import { prisma } from "@/lib/db";
import { fail, handleError, ok } from "@/lib/apiResponse";
import { getOwner } from "@/lib/owner";
import { encryptSession } from "@/lib/telegram/crypto";

const createSchema = z.object({
  label: z.string().trim().min(1, "계정 이름을 입력하세요.").max(40),
  phone: z.string().trim().max(30).optional().nullable(),
  /**
   * Pasting an existing MTProto session string skips the SMS flow entirely —
   * handy when migrating accounts in from another tool.
   */
  sessionString: z.string().trim().min(10).optional().nullable(),
  joinIntervalSec: z.number().int().min(5, "5초 미만은 위험합니다.").max(3600).default(20),
  dailyJoinLimit: z.number().int().min(0).max(5000).default(0),
  collectEnabled: z.boolean().default(true),
});

export async function POST(request: Request) {
  try {
    const owner = await getOwner();
    const body = createSchema.parse(await request.json());

    const duplicate = await prisma.account.findUnique({
      where: { ownerId_label: { ownerId: owner.id, label: body.label } },
    });
    if (duplicate) return fail("같은 이름의 계정이 이미 있습니다.", 409);

    const account = await prisma.account.create({
      data: {
        ownerId: owner.id,
        label: body.label,
        phone: body.phone ?? null,
        sessionString: body.sessionString ? encryptSession(body.sessionString) : null,
        // Without a session there is nothing to run with yet.
        status: body.sessionString ? "ACTIVE" : "NEEDS_CHECK",
        joinIntervalSec: body.joinIntervalSec,
        dailyJoinLimit: body.dailyJoinLimit,
        collectEnabled: body.collectEnabled,
      },
    });
    return ok({ id: account.id }, 201);
  } catch (err) {
    return handleError(err);
  }
}
