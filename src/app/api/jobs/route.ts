import { z } from "zod";

import { handleError, ok } from "@/lib/apiResponse";
import { jobOptionsSchema } from "@/lib/jobOptions";
import { createJoinJob } from "@/lib/services/jobs";

const bodySchema = z.object({
  accountId: z.string().min(1, "계정을 선택하세요."),
  targetIds: z.array(z.string().min(1)).min(1, "입장할 방을 선택하세요."),
  name: z.string().trim().max(80).optional().nullable(),
  options: jobOptionsSchema,
});

/** Queue a batch of joins — the "입장 예약" dialog's submit. */
export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const result = await createJoinJob(body);
    return ok(result, 201);
  } catch (err) {
    return handleError(err);
  }
}
