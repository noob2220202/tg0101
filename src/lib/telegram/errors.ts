import { TelegramError, TelegramErrorCode } from "./types";

/**
 * Translate whatever MTProto threw into our own error vocabulary.
 *
 * Both `instanceof` and message matching are used: error classes differ between
 * library versions, but the server's error strings are stable.
 */
export function toTelegramError(err: unknown): TelegramError {
  if (err instanceof TelegramError) return err;

  const e = err as { errorMessage?: string; message?: string; seconds?: number; className?: string; code?: number };
  const raw = (e?.errorMessage || e?.message || "").toUpperCase();
  const name = (err as Error)?.constructor?.name ?? "";

  // Flood wait carries the number of seconds we must sit out.
  if (name === "FloodWaitError" || raw.includes("FLOOD_WAIT") || raw.startsWith("A WAIT OF")) {
    const seconds = typeof e?.seconds === "number" ? e.seconds : parseWaitSeconds(raw);
    return new TelegramError("FLOOD_WAIT", `대기 ${seconds}초 요구됨`, { waitSeconds: seconds });
  }

  const map: Array<[RegExp, TelegramErrorCode, boolean]> = [
    // [server error pattern, our code, permanent?]
    [/USER_ALREADY_PARTICIPANT/, "ALREADY_PARTICIPANT", true],
    [/INVITE_REQUEST_SENT/, "REQUEST_PENDING", true],
    [/INVITE_HASH_EXPIRED/, "INVITE_EXPIRED", true],
    [/INVITE_HASH_INVALID|INVITE_HASH_EMPTY/, "INVITE_INVALID", true],
    [/USERNAME_NOT_OCCUPIED|USERNAME_INVALID|PEER_ID_INVALID/, "NOT_FOUND", true],
    [/CHANNEL_PRIVATE/, "PRIVATE", true],
    [/USER_BANNED_IN_CHANNEL|USER_DEACTIVATED|CHAT_WRITE_FORBIDDEN|USER_KICKED/, "BANNED", true],
    [/CHANNELS_TOO_MUCH/, "TOO_MANY_CHANNELS", false],
    [/AUTH_KEY_UNREGISTERED|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED_BAN/, "AUTH_INVALID", true],
    [/TIMEOUT|ECONNRESET|ENOTFOUND|ECONNREFUSED|NETWORK|DISCONNECT/, "NETWORK", false],
  ];

  for (const [pattern, code, permanent] of map) {
    if (pattern.test(raw) || pattern.test(name.toUpperCase())) {
      return new TelegramError(code, raw || name, { permanent });
    }
  }

  return new TelegramError("UNKNOWN", raw || name || "unknown telegram error");
}

/** "A WAIT OF 51966 SECONDS IS REQUIRED" -> 51966 */
function parseWaitSeconds(raw: string): number {
  const m = raw.match(/(\d+)/);
  return m ? Number(m[1]) : 60;
}
