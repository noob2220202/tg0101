import { EntityType, TargetKind } from "./enums";

/**
 * Parsing and normalising of t.me links.
 *
 * A target is identified by a `key`:
 *   - public username  -> "somegroup"   (lower-cased)
 *   - private invite   -> "+AbCdEf1234" (hash, case preserved)
 */

export type ParsedLink = {
  key: string;
  url: string;
  kind: TargetKind;
};

const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/;

/**
 * Telegram reserves these paths, and they are the most common false positives
 * when scraping message text.
 */
const RESERVED = new Set([
  "joinchat",
  "addstickers",
  "addemoji",
  "addtheme",
  "proxy",
  "socks",
  "share",
  "iv",
  "login",
  "confirmphone",
  "setlanguage",
  "bg",
  "invoice",
  "giftcode",
  "boost",
  "c",
  "s",
]);

/**
 * Accepts anything a human might paste: full URLs, `@name`, or a bare username.
 * Returns null when the input is not a joinable room reference.
 */
export function parseLink(input: string): ParsedLink | null {
  let raw = input.trim();
  if (!raw) return null;

  // "@somegroup"
  if (raw.startsWith("@")) raw = raw.slice(1);

  // Strip a scheme so URL parsing and bare usernames take the same path.
  raw = raw.replace(/^https?:\/\//i, "").replace(/^tg:\/\/(join\?invite=|resolve\?domain=)/i, "");

  let path = raw;
  if (/^(t\.me|telegram\.me|telegram\.dog)\//i.test(raw)) {
    path = raw.replace(/^(t\.me|telegram\.me|telegram\.dog)\//i, "");
  } else if (raw.includes("/")) {
    // Some other host — not a Telegram link.
    return null;
  }

  // Drop query string and trailing slash.
  path = path.split("?")[0].split("#")[0].replace(/\/+$/, "");
  if (!path) return null;

  // Private invite: t.me/+HASH or t.me/joinchat/HASH
  if (path.startsWith("+") || /^joinchat\//i.test(path)) {
    const hash = path.startsWith("+") ? path.slice(1) : path.split("/")[1] ?? "";
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(hash)) return null;
    return { key: `+${hash}`, url: `https://t.me/+${hash}`, kind: "PRIVATE" };
  }

  // Public username — reject deep links like t.me/name/123 (message permalinks)
  // by keeping only the first segment and checking it stands alone.
  const [first, ...rest] = path.split("/");
  if (rest.length > 0 && rest.some((seg) => seg !== "")) return null;

  const username = first.toLowerCase();
  if (RESERVED.has(username)) return null;
  if (!USERNAME_RE.test(first)) return null;

  return { key: username, url: `https://t.me/${username}`, kind: "PUBLIC" };
}

/**
 * Pull every distinct room reference out of a block of message text, in the
 * order they appear.
 *
 * Document order matters: when a prerequisite notice names several rooms, the
 * first one is the one being demanded.
 */
export function extractLinks(text: string): ParsedLink[] {
  if (!text) return [];

  const patterns = [
    /(?:https?:\/\/)?(?:t\.me|telegram\.me|telegram\.dog)\/[+a-zA-Z0-9_/-]+/gi,
    /@[a-zA-Z][a-zA-Z0-9_]{3,31}/g,
  ];

  const hits: Array<{ index: number; link: ParsedLink }> = [];
  for (const re of patterns) {
    for (const match of text.matchAll(re)) {
      const parsed = parseLink(match[0]);
      if (parsed) hits.push({ index: match.index ?? 0, link: parsed });
    }
  }

  hits.sort((a, b) => a.index - b.index);

  const found = new Map<string, ParsedLink>();
  for (const hit of hits) {
    if (!found.has(hit.link.key)) found.set(hit.link.key, hit.link);
  }
  return [...found.values()];
}

export function linkUrl(key: string): string {
  return `https://t.me/${key}`;
}

export function kindOfKey(key: string): TargetKind {
  return key.startsWith("+") ? "PRIVATE" : "PUBLIC";
}

/** Map a resolved Telegram entity onto our EntityType strings. */
export function entityTypeOf(entity: {
  className?: string;
  broadcast?: boolean;
  megagroup?: boolean;
  bot?: boolean;
}): EntityType {
  if (!entity) return "UNKNOWN";
  if (entity.className === "User") return entity.bot ? "BOT" : "USER";
  if (entity.className === "Chat" || entity.className === "ChatForbidden") return "GROUP";
  if (entity.className === "Channel" || entity.className === "ChannelForbidden") {
    // A megagroup is a supergroup (chat room); broadcast is a read-only channel.
    if (entity.megagroup) return "GROUP";
    if (entity.broadcast) return "CHANNEL";
    return "GROUP";
  }
  return "UNKNOWN";
}
