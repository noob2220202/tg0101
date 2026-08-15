import { z } from "zod";

import { prisma } from "@/lib/db";
import { handleError, ok } from "@/lib/apiResponse";
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
    return ok(await getPolicy());
  } catch (err) {
    return handleError(err);
  }
}

/** Save the "홍보 링크 수집 정책" dialog. */
export async function PUT(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    await getPolicy(); // ensure the row exists before updating

    const updated = await prisma.collectionPolicy.update({
      where: { id: "default" },
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
