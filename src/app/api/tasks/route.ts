import { z } from "zod";

import { prisma } from "@/lib/db";
import { fail, handleError, ok } from "@/lib/apiResponse";
import { requireUser } from "@/lib/auth/session";
import { refreshJobProgress } from "@/lib/services/jobs";

const bodySchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1, "작업을 선택하세요."),
  action: z.enum(["retry", "cancel"]),
});

/** Retry failed joins, or drop queued ones. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const { taskIds, action } = bodySchema.parse(await request.json());

    const tasks = await prisma.joinTask.findMany({
      where: { id: { in: taskIds }, job: { ownerId: user.id } },
      select: { id: true, jobId: true, status: true },
    });
    if (tasks.length === 0) return fail("선택한 작업을 찾을 수 없습니다.", 404);
    const ownedIds = tasks.map((t) => t.id);

    if (action === "retry") {
      await prisma.joinTask.updateMany({
        where: { id: { in: ownedIds }, status: { in: ["FAILED", "SKIPPED", "WAITING_APPROVAL"] } },
        data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lastError: null, lastErrorCode: null },
      });

      // A finished job has to reopen for its retried tasks to be picked up.
      const jobIds = [...new Set(tasks.map((t) => t.jobId))];
      await prisma.joinJob.updateMany({
        where: { id: { in: jobIds }, status: "DONE" },
        data: { status: "RUNNING", finishedAt: null },
      });
    } else {
      await prisma.joinTask.updateMany({
        where: { id: { in: ownedIds }, status: "PENDING" },
        data: { status: "SKIPPED", lastError: "사용자가 취소했습니다." },
      });
    }

    for (const jobId of new Set(tasks.map((t) => t.jobId))) {
      await refreshJobProgress(jobId);
    }

    return ok({ count: tasks.length });
  } catch (err) {
    return handleError(err);
  }
}
