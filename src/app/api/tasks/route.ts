import { z } from "zod";

import { prisma } from "@/lib/db";
import { handleError, ok } from "@/lib/apiResponse";
import { refreshJobProgress } from "@/lib/services/jobs";

const bodySchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1, "작업을 선택하세요."),
  action: z.enum(["retry", "cancel"]),
});

/** Retry failed joins, or drop queued ones. */
export async function POST(request: Request) {
  try {
    const { taskIds, action } = bodySchema.parse(await request.json());

    const tasks = await prisma.joinTask.findMany({
      where: { id: { in: taskIds } },
      select: { id: true, jobId: true, status: true },
    });

    if (action === "retry") {
      await prisma.joinTask.updateMany({
        where: { id: { in: taskIds }, status: { in: ["FAILED", "SKIPPED", "WAITING_APPROVAL"] } },
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
        where: { id: { in: taskIds }, status: "PENDING" },
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
