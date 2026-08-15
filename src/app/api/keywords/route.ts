import { z } from "zod";

import { prisma } from "@/lib/db";
import { fail, handleError, ok } from "@/lib/apiResponse";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  action: z.literal("create"),
  name: z.string().trim().min(1, "규칙 이름을 입력하세요.").max(40),
  terms: z.string().trim().min(1, "감시할 단어를 입력하세요.").max(500),
  accountId: z.string().nullable().optional(),
});

const updateSchema = z.object({
  action: z.literal("update"),
  id: z.string().min(1),
  name: z.string().trim().min(1).max(40).optional(),
  terms: z.string().trim().min(1).max(500).optional(),
  enabled: z.boolean().optional(),
  accountId: z.string().nullable().optional(),
});

const deleteSchema = z.object({ action: z.literal("delete"), id: z.string().min(1) });

const bodySchema = z.discriminatedUnion("action", [createSchema, updateSchema, deleteSchema]);

/** Keyword rules for the live message stream. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = bodySchema.parse(await request.json());

    if (body.action === "create") {
      if (body.accountId) {
        const owned = await prisma.account.findFirst({
          where: { id: body.accountId, ownerId: user.id },
          select: { id: true },
        });
        if (!owned) return fail("계정을 찾을 수 없습니다.", 404);
      }
      const rule = await prisma.keywordRule.create({
        data: {
          ownerId: user.id,
          name: body.name,
          terms: body.terms,
          accountId: body.accountId || null,
        },
      });
      return ok(rule, 201);
    }

    const existing = await prisma.keywordRule.findFirst({
      where: { id: body.id, ownerId: user.id },
      select: { id: true },
    });
    if (!existing) return fail("규칙을 찾을 수 없습니다.", 404);

    if (body.action === "delete") {
      await prisma.keywordRule.delete({ where: { id: body.id } });
      return ok({ id: body.id });
    }

    const rule = await prisma.keywordRule.update({
      where: { id: body.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.terms !== undefined ? { terms: body.terms } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.accountId !== undefined ? { accountId: body.accountId || null } : {}),
      },
    });
    return ok(rule);
  } catch (err) {
    return handleError(err);
  }
}
