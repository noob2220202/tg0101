import { z } from "zod";

import { prisma } from "@/lib/db";
import { handleError, fail, ok } from "@/lib/apiResponse";
import { dropSession } from "@/lib/telegram";

const patchSchema = z.object({
  label: z.string().trim().min(1).max(40).optional(),
  joinIntervalSec: z.number().int().min(5, "5초 미만은 위험합니다.").max(3600).optional(),
  dailyJoinLimit: z.number().int().min(0).max(5000).optional(),
  collectEnabled: z.boolean().optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  /** Clear a Telegram-imposed wait early (it will simply come back if real). */
  clearCooldown: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = patchSchema.parse(await request.json());
    const { clearCooldown, ...rest } = body;

    const account = await prisma.account.update({
      where: { id },
      data: {
        ...rest,
        ...(clearCooldown
          ? { status: "ACTIVE", cooldownUntil: null, cooldownSeconds: null, cooldownReason: null }
          : {}),
      },
    });

    // The pooled session carries the old settings; force a reconnect.
    if (rest.status === "DISABLED") await dropSession(id);

    return ok({ id: account.id });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const openTasks = await prisma.joinTask.count({
      where: { accountId: id, status: { in: ["PENDING", "RUNNING"] } },
    });
    if (openTasks > 0) {
      return fail(`대기 중인 작업이 ${openTasks}건 있습니다. 작업을 취소한 뒤 삭제하세요.`);
    }

    await dropSession(id);
    await prisma.account.delete({ where: { id } });
    return ok({ id });
  } catch (err) {
    return handleError(err);
  }
}
