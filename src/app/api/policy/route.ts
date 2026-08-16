import { z } from "zod";

import { prisma } from "@/lib/db";
import { fail, handleError, ok } from "@/lib/apiResponse";
import { getOwner } from "@/lib/owner";
import { getPolicy } from "@/lib/services/policy";

const bodySchema = z.object({
  enabled: z.boolean(),
  autoRegister: z.boolean(),
  minScore: z.number().int().min(0, "0 이상이어야 합니다.").max(100, "100 이하여야 합니다."),
  dailyLimit: z.number().int().min(0).max(10000),
  joinAccountId: z.string().nullable(),
  chainCollect: z.boolean(),
  collectGroups: z.boolean(),
  collectChannels: z.boolean(),
  collectBots: z.boolean(),
  collectUsers: z.boolean(),
  minMembers: z.number().int().min(0),
  requiredKeywords: z.string().max(500),
  excludedKeywords: z.string().max(500),
});

export async function GET() {
  try {
    const owner = await getOwner();
    return ok(await getPolicy(owner.id));
  } catch (err) {
    return handleError(err);
  }
}

/** Save the "홍보 링크 수집 정책" dialog. */
export async function PUT(request: Request) {
  try {
    const owner = await getOwner();
    const body = bodySchema.parse(await request.json());
    const policy = await getPolicy(owner.id);

    // A join account from another tenant would leak work across operators.
    if (body.joinAccountId) {
      const owned = await prisma.account.findFirst({
        where: { id: body.joinAccountId, ownerId: owner.id },
        select: { id: true },
      });
      if (!owned) return fail("선택한 계정을 찾을 수 없습니다.", 404);
    }

    const updated = await prisma.collectionPolicy.update({
      where: { id: policy.id },
      data: {
        ...body,
        // An empty select means "register only, do not join".
        joinAccountId: body.joinAccountId || null,
      },
    });
    return ok(updated);
  } catch (err) {
    return handleError(err);
  }
}
