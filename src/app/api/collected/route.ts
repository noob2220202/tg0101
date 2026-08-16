import { z } from "zod";

import { prisma } from "@/lib/db";
import { fail, handleError, ok } from "@/lib/apiResponse";
import { getOwner } from "@/lib/owner";
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
    const owner = await getOwner();
    const { linkIds, action, joinAccountId } = bodySchema.parse(await request.json());

    // Narrow the ids to rows this operator owns; anything else silently drops
    // out rather than being acted on.
    const owned = await prisma.collectedLink.findMany({
      where: { id: { in: linkIds }, ownerId: owner.id },
      select: { id: true },
    });
    const ownedIds = owned.map((row) => row.id);
    if (ownedIds.length === 0) return fail("선택한 링크를 찾을 수 없습니다.", 404);

    if (action === "register") {
      const policy = await getPolicy(owner.id);
      let account = joinAccountId !== undefined ? joinAccountId : policy.joinAccountId;

      if (account) {
        const owned = await prisma.account.findFirst({
          where: { id: account, ownerId: owner.id },
          select: { id: true },
        });
        // Registering is still worth doing even if the join account is bogus.
        if (!owned) account = null;
      }

      let registered = 0;
      for (const id of ownedIds) {
        const target = await registerCollectedLink(id, account);
        if (target) registered += 1;
      }
      return ok({ registered });
    }

    if (action === "reset") {
      // Back to PENDING and re-scored against the current policy.
      await prisma.collectedLink.updateMany({ where: { id: { in: ownedIds } }, data: { status: "PENDING" } });
      for (const id of ownedIds) await rescore(id);
      return ok({ count: ownedIds.length });
    }

    const status = action === "approve" ? "APPROVED" : "EXCLUDED";
    const { count } = await prisma.collectedLink.updateMany({
      where: { id: { in: ownedIds } },
      data: { status },
    });
    return ok({ count });
  } catch (err) {
    return handleError(err);
  }
}
