import { extractLinks, ParsedLink } from "./links";
import type { MessageLite } from "./telegram/types";

/**
 * Detection of "선행 채널" — rooms that refuse to let you participate until you
 * have joined some other channel first.
 *
 * The notice is almost always a pinned message or a bot reply, and it is
 * phrased in a small number of recognisable ways. We look for one of those
 * phrasings and then take the room links out of the same message, rather than
 * out of the whole history, so ordinary cross-promotion is not mistaken for a
 * requirement.
 */

const NOTICE_PATTERNS: RegExp[] = [
  // 먼저 ... 가입 / 입장 / 구독
  /먼저\s*[^\n]{0,30}(가입|입장|구독|참여)/,
  // 아래 채널(에) 가입 후 / 필수 가입 / 선행 채널
  /(아래|하단|다음)\s*[^\n]{0,20}(채널|방)[^\n]{0,20}(가입|입장|구독)/,
  /(가입|입장|구독)\s*(후|하고|하셔야|해야)[^\n]{0,20}(이용|참여|채팅|가능)/,
  /(필수|선행)\s*(가입|채널|방|구독)/,
  /채널\s*구독\s*후/,
  /공지(방|채널)\s*(가입|입장|구독)/,
  // Common English equivalents seen in mixed-language rooms.
  /join\s+(the\s+)?(channel|group)\s+(first|before)/i,
  /subscribe\s+(to\s+)?[^\n]{0,20}\s+(first|to\s+chat)/i,
];

export type PrereqDetection = {
  /** Rooms that must be joined first. */
  links: ParsedLink[];
  /** The message text that triggered detection, for the activity log. */
  evidence: string;
};

/**
 * Scan messages for a prerequisite notice.
 *
 * `selfKey` is the room being examined — a notice that links to itself is not a
 * prerequisite.
 */
export function detectPrerequisites(messages: MessageLite[], selfKey: string): PrereqDetection | null {
  // Pinned messages first: they hold the rules when there is no bot reply.
  const ordered = [...messages].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));

  for (const message of ordered) {
    if (!message.text) continue;
    if (!NOTICE_PATTERNS.some((re) => re.test(message.text))) continue;

    const links = extractLinks(message.text).filter((link) => link.key !== selfKey.toLowerCase());
    if (links.length === 0) continue;

    return {
      links,
      evidence: message.text.replace(/\s+/g, " ").slice(0, 200),
    };
  }
  return null;
}

/** The one-line greeting used to smoke out hidden prerequisites. */
export const PROBE_MESSAGE = "안녕하세요";
