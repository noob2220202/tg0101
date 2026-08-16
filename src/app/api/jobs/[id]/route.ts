import { z } from "zod";

import { fail, handleError, ok } from "@/lib/apiResponse";
import { getOwner } from "@/lib/owner";
import { prisma } from "@/lib/db";
import { setJobStatus } from "@/lib/services/jobs";

const bodySchema = z.object({
  status: z.enum(["RUNNING", "PAUSED", "CANCELLED"]),
});

/** Pause, resume or cancel a running batch. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const owner = await getOwner();
    const { id } = await params;
    const { status } = bodySchema.parse(await request.json());

    const job = await prisma.joinJob.findFirst({ where: { id, ownerId: owner.id }, select: { id: true } });
    if (!job) return fail("작업을 찾을 수 없습니다.", 404);

    await setJobStatus(id, status);
    return ok({ id, status });
  } catch (err) {
    return handleError(err);
  }
}
