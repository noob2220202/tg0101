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
/** Invite hashes are base64url; an all-digit "+" path is a phone number. */
const INVITE_HASH_RE = /^[a-zA-Z0-9_-]{8,64}$/;

/**
 * Telegram reserves these paths, and they are the most common false positives
 * when scraping message text.
 */
const RESERVED = new Set([
  "joinchat",
  "addstickers",
  "addemoji",
  "addtheme",
  "addlist",
  "proxy",
  "socks",
  "share",
  "iv",
  "login",
  "auth",
  "confirmphone",
  "setlanguage",
  "bg",
  "invoice",
  "giftcode",
  "boost",
  "contact",
  "premium",
  "wallet",
  "c",
  "s",
  "k",
  "a",
  "m",
  "web",
  "apps",
  "faq",
  "blog",
  "press",
  "tos",
  "privacy",
  "support",
]);

const TELEGRAM_HOST_RE = /^(t\.me|telegram\.me|telegram\.dog)\//i;

/**
 * Every shape a link can take in message text.
 *
 * Kept in one place because both `extractLinks` and the entity/button scan feed
 * off it — a hidden hyperlink may itself be a wrapper URL with a t.me inside.
 */
const PATTERNS: RegExp[] = [
  // https://t.me/room, t.me/+hash, telegram.me/joinchat/hash …
  // The lookbehind stops "chat.me/x" or "mailt.me/x" from matching.
  /(?<![\w.@-])(?:https?:\/\/)?(?:t\.me|telegram\.me|telegram\.dog)\/[A-Za-z0-9_%+/-]+/gi,
  // tg://join?invite=HASH and tg://resolve?domain=room
  /tg:\/\/(?:join\?invite=|resolve\?domain=)[A-Za-z0-9_-]+/gi,
  // Bare @mention — but not an e-mail address ("foo@gmail.com") or a handle
  // that is really a domain ("@example.co.kr"). A plain sentence-ending period
  // still counts as the end of the name.
  /(?<![\w.@/-])@[a-zA-Z][a-zA-Z0-9_]{3,31}(?!\.[a-zA-Z])/g,
];

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
  raw = raw.replace(/^https?:\/\//i, "");
  const tgScheme = /^tg:\/\/(join\?invite=|resolve\?domain=)/i.exec(raw);
  if (tgScheme) {
    const rest = raw.slice(tgScheme[0].length);
    raw = /join/i.test(tgScheme[1]) ? `+${rest}` : rest;
  }

  let path = raw;
  if (TELEGRAM_HOST_RE.test(raw)) {
    path = raw.replace(TELEGRAM_HOST_RE, "");
  } else if (raw.includes("/")) {
    // Some other host — not a Telegram link.
    return null;
  }

  // Drop query string, fragment and trailing slash.
  path = path.split(/[?&#]/)[0].replace(/\/+$/, "");
  if (!path) return null;

  // Invite links survive percent-encoding when they travel through link
  // shorteners and web previews.
  path = path.replace(/^%2[bB]/, "+");
  // t.me/s/room is the public web-preview form of an ordinary room.
  path = path.replace(/^s\//i, "");
  if (!path) return null;

  // Private invite: t.me/+HASH or t.me/joinchat/HASH
  if (path.startsWith("+") || /^joinchat\//i.test(path)) {
    const hash = path.startsWith("+") ? path.slice(1) : path.split("/")[1] ?? "";
    // "t.me/+821012345678" is a phone-number contact link, not an invite.
    if (/^\d+$/.test(hash)) return null;
    if (!INVITE_HASH_RE.test(hash)) return null;
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
 * Pull every distinct room reference out of a message, in the order they
 * appear.
 *
 * `extraUrls` carries the links a message holds outside its text: hidden
 * hyperlinks, inline-button targets and the link preview. Promo rooms lean on
 * those heavily — "여기 클릭" with the real address behind it — so text alone
 * misses a large share of what is being advertised. They have no position in
 * the text, so they are appended after the in-text hits.
 *
 * Document order matters: when a prerequisite notice names several rooms, the
 * first one is the one being demanded.
 */
export function extractLinks(text: string, extraUrls: readonly string[] = []): ParsedLink[] {
  const found: ParsedLink[] = [...linksInText(text)];

  for (const url of extraUrls) {
    if (!url) continue;
    const parsed = parseLink(url);
    if (parsed) {
      found.push(parsed);
      continue;
    }
    // A button often points at a redirect that carries the real t.me address
    // in its query string — percent-encoded as often as not — so fall back to
    // scanning the address itself as if it were text.
    found.push(...linksInText(url));
    const decoded = decodeOnce(url);
    if (decoded !== url) found.push(...linksInText(decoded));
  }

  const distinct = new Map<string, ParsedLink>();
  for (const link of found) {
    if (!distinct.has(link.key)) distinct.set(link.key, link);
  }
  return [...distinct.values()];
}

/** In-text matches, in document order. */
function linksInText(text: string): ParsedLink[] {
  if (!text) return [];

  const hits: Array<{ index: number; link: ParsedLink }> = [];
  for (const re of PATTERNS) {
    for (const match of text.matchAll(re)) {
      const parsed = parseLink(match[0]);
      if (parsed) hits.push({ index: match.index ?? 0, link: parsed });
    }
  }

  hits.sort((a, b) => a.index - b.index);
  return hits.map((hit) => hit.link);
}

/** Percent-decoding that tolerates the malformed escapes seen in the wild. */
function decodeOnce(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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
