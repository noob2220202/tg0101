import { z } from "zod";

import { prisma } from "@/lib/db";
import { handleError, ok } from "@/lib/apiResponse";
import { registerCollectedLink, rescore } from "@/lib/services/collect";
import { getPolicy } from "@/lib/services/policy";

const bodySchema = z.object({
  linkIds: z.array(z.string().min(1)).min(1, "링크를 선택하세요."),
  action: z.enum(["approve", "exclude", "register", "reset"]),
  /** Overrides the policy's join account for this batch only. */
  joinAccountId: z.string().nullable().optional(),
});

/**
 * Bulk triage from the 수집된 링크 screen.
 *
 * `register` promotes a link to a real target (and optionally queues a join);
 * the rest just move it between review buckets.
 */
export async function POST(request: Request) {
  try {
    const { linkIds, action, joinAccountId } = bodySchema.parse(await request.json());

    if (action === "register") {
      const policy = await getPolicy();
      const account = joinAccountId !== undefined ? joinAccountId : policy.joinAccountId;

      let registered = 0;
      for (const id of linkIds) {
        const target = await registerCollectedLink(id, account);
        if (target) registered += 1;
      }
      return ok({ registered });
    }

    if (action === "reset") {
      // Back to PENDING and re-scored against the current policy.
      await prisma.collectedLink.updateMany({ where: { id: { in: linkIds } }, data: { status: "PENDING" } });
      for (const id of linkIds) await rescore(id);
      return ok({ count: linkIds.length });
    }

    const status = action === "approve" ? "APPROVED" : "EXCLUDED";
    const { count } = await prisma.collectedLink.updateMany({
      where: { id: { in: linkIds } },
      data: { status },
    });
    return ok({ count });
  } catch (err) {
    return handleError(err);
  }
}
