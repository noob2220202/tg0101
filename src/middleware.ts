import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/lib/auth/cookie";

/**
 * Cheap gate: bounce anyone without a session cookie to the login screen.
 *
 * This runs on the edge and cannot reach the database, so it only checks that a
 * cookie exists. The real validation is `requireUser()` inside each page and
 * route handler — a forged or expired cookie gets past middleware and is
 * rejected there.
 */
export function middleware(request: NextRequest) {
  const hasCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (hasCookie) return NextResponse.next();

  const { pathname } = request.nextUrl;

  // API callers get a JSON 401 rather than a redirect they cannot follow.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    /*
     * Everything except the login screen, the auth endpoint that issues the
     * cookie, and Next's own static assets.
     */
    "/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
