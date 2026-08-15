import { z } from "zod";

import { prisma } from "@/lib/db";
import { fail, handleError, ok } from "@/lib/apiResponse";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession } from "@/lib/auth/session";
import { defaultPolicyData } from "@/lib/services/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const loginSchema = z.object({
  action: z.literal("login"),
  email: z.string().trim().email("이메일 형식이 올바르지 않습니다."),
  password: z.string().min(1, "비밀번호를 입력하세요."),
});

const setupSchema = z.object({
  action: z.literal("setup"),
  email: z.string().trim().email("이메일 형식이 올바르지 않습니다."),
  password: z.string().min(1),
  name: z.string().trim().min(1, "이름을 입력하세요.").max(40),
});

const bodySchema = z.discriminatedUnion("action", [loginSchema, setupSchema]);

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const email = body.email.toLowerCase();
    const userAgent = request.headers.get("user-agent");

    if (body.action === "setup") {
      // Only valid while no operator exists; otherwise this would be an open
      // door to self-registering as an admin.
      if ((await prisma.user.count()) > 0) {
        return fail("이미 관리자 계정이 있습니다. 로그인하세요.", 409);
      }

      const weak = validatePasswordStrength(body.password);
      if (weak) return fail(weak, 422);

      const user = await prisma.user.create({
        data: {
          email,
          name: body.name,
          role: "ADMIN",
          passwordHash: await hashPassword(body.password),
          policy: { create: defaultPolicyData() },
        },
      });

      await createSession(user.id, userAgent);
      return ok({ id: user.id, email: user.email }, 201);
    }

    const user = await prisma.user.findUnique({ where: { email } });
    // Same message either way, so the response cannot enumerate accounts.
    const valid = user ? await verifyPassword(body.password, user.passwordHash) : false;
    if (!user || !valid) return fail("이메일 또는 비밀번호가 올바르지 않습니다.", 401);

    await createSession(user.id, userAgent);
    return ok({ id: user.id, email: user.email });
  } catch (err) {
    return handleError(err);
  }
}

/** Sign out. */
export async function DELETE() {
  try {
    await destroySession();
    return ok({ signedOut: true });
  } catch (err) {
    return handleError(err);
  }
}
