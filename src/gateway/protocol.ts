/**
 * The contract between the web app and the gateway.
 *
 * Only one process may hold an MTProto connection per account — two would split
 * the update stream and corrupt read state — so the worker owns every session
 * and the web app reaches Telegram exclusively through these calls.
 */

export type GatewayMethod =
  | "listDialogs"
  | "getHistory"
  | "sendMessage"
  | "markRead"
  | "getProfile"
  | "updateProfile"
  | "updateUsername"
  | "setProfilePhoto"
  | "deleteProfilePhoto"
  | "listAuthorizations"
  | "resetAuthorization"
  | "checkSpam";

export type GatewayRequest = {
  accountId: string;
  method: GatewayMethod;
  params?: Record<string, unknown>;
};

export type GatewayResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

/** Server-sent event payloads on /events. */
export type GatewayEvent =
  | { type: "message"; accountId: string; message: unknown; keywordHits: string[] }
  | { type: "ready"; accounts: string[] }
  | { type: "ping" };

export function gatewayUrl(): string {
  return process.env.GATEWAY_URL ?? `http://127.0.0.1:${process.env.GATEWAY_PORT ?? 4599}`;
}

/**
 * Shared secret between web and gateway. The gateway binds to loopback, so this
 * is defence in depth rather than the only control.
 */
export function gatewayToken(): string {
  return process.env.GATEWAY_TOKEN ?? "local-dev-token";
}

export const GATEWAY_HEADER = "x-gateway-token";
