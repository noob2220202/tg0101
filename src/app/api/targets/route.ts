import { z } from "zod";

import { prisma } from "@/lib/db";
import { handleError, ok } from "@/lib/apiResponse";
import { getOwner } from "@/lib/owner";
import { importLinks } from "@/lib/services/targets";

const importSchema = z.object({
  links: z.string().min(1, "링크를 입력하세요."),
});

/** Bulk-import pasted links — the "행 추가" flow on the group list. */
export async function POST(request: Request) {
  try {
    const owner = await getOwner();
    const { links } = importSchema.parse(await request.json());
    const result = await importLinks(owner.id, links, "MANUAL");
    return ok(result, 201);
  } catch (err) {
    return handleError(err);
  }
}

const patchSchema = z.object({
  targetIds: z.array(z.string().min(1)).min(1),
  archived: z.boolean(),
});

/** Archive or unarchive rows so the working list stays short. */
export async function PATCH(request: Request) {
  try {
    const owner = await getOwner();
    const { targetIds, archived } = patchSchema.parse(await request.json());
    const { count } = await prisma.target.updateMany({
      // The ownerId predicate is what stops one operator editing another's rows.
      where: { id: { in: targetIds }, ownerId: owner.id },
      data: { archived },
    });
    return ok({ count });
  } catch (err) {
    return handleError(err);
  }
}
