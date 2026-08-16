import crypto from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";

import { prisma } from "../db";
import { SESSION_COOKIE } from "./cookie";

/**
 * Cookie-backed sessions.
 *
 * The cookie carries an opaque random token and nothing else, so nothing about
 * the operator is forgeable client-side and revoking a session is a row delete.
 */

export { SESSION_COOKIE };
const SESSION_DAYS = 14;

/**
 * Whether to mark the cookie `Secure`.
 *
 * Defaults to on in production, which is right behind TLS — but a browser
 * silently discards a `Secure` cookie over plain HTTP, and the symptom is a
 * login that "does nothing". Browsers exempt `localhost`, so this only bites
 * when reaching the app by IP or hostname without TLS; `COOKIE_SECURE=0` is
 * the escape hatch for that case.
 */
function cookieSecure(): boolean {
  const override = process.env.COOKIE_SECURE;
  if (override === "0" || override === "false") return false;
  if (override === "1" || override === "true") return true;
  return process.env.NODE_ENV === "production";
}

export async function createSession(userId: string, userAgent?: string | null): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600_000);

  await prisma.userSession.create({
    data: { token, userId, expiresAt, userAgent: userAgent ?? null },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    expires: expiresAt,
  });

  // Opportunistic cleanup; expired rows are useless and unbounded otherwise.
  await prisma.userSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });

  return token;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await prisma.userSession.deleteMany({ where: { token } });
  store.delete(SESSION_COOKIE);
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: string;
};

/**
 * The signed-in operator, or null.
 *
 * `cache` dedupes this across a single render — a page and its nested server
 * components would otherwise each hit the database.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.userSession.findUnique({
    where: { token },
    include: { user: { select: { id: true, email: true, name: true, role: true } } },
  });

  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.userSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return session.user;
});

/**
 * Same, but throws when signed out.
 *
 * Every page and route handler that touches tenant data must call this — it is
 * the single place ownership is established.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("로그인이 필요합니다.");
    this.name = "UnauthorizedError";
  }
}
