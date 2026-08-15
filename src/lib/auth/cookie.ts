/**
 * The session cookie's name, and nothing else.
 *
 * Middleware runs on the Edge runtime, where `node:crypto` does not exist, so
 * it cannot import from ./session. This module stays dependency-free so both
 * runtimes can share the one constant.
 */
export const SESSION_COOKIE = "tg_session";
