import { z } from "zod";

import { handleError, ok } from "@/lib/apiResponse";
import { setJobStatus } from "@/lib/services/jobs";

const bodySchema = z.object({
  status: z.enum(["RUNNING", "PAUSED", "CANCELLED"]),
});

/** Pause, resume or cancel a running batch. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { status } = bodySchema.parse(await request.json());
    await setJobStatus(id, status);
    return ok({ id, status });
  } catch (err) {
    return handleError(err);
  }
}
