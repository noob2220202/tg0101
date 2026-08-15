import { EntityType } from "./enums";

/**
 * Scoring for harvested promo links.
 *
 * The number answers one question: "how likely is it that this link is a real,
 * joinable promo room?" Higher scores mean the collector is more confident, and
 * the policy dialog's threshold decides which ones get registered without a
 * human looking at them.
 */

export type ScoreInput = {
  entityType: EntityType;
  /** Distinct rooms that mentioned this link. */
  roomCount: number;
  /** Total mentions across all rooms. */
  seenCount: number;
  memberCount?: number | null;
  title?: string | null;
  description?: string | null;
  key: string;
  /** True once Telegram confirmed the entity exists. */
  resolved: boolean;
};

export type ScorePolicy = {
  requiredKeywords: string[];
  excludedKeywords: string[];
  minMembers: number;
  collectGroups: boolean;
  collectChannels: boolean;
  collectBots: boolean;
  collectUsers: boolean;
};

export type ScoreResult = {
  score: number;
  reason: string;
  /** Hard rejection — the link should be filed as EXCLUDED, not scored. */
  excluded: boolean;
};

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function typeAllowed(type: EntityType, policy: ScorePolicy): boolean {
  switch (type) {
    case "GROUP":
      return policy.collectGroups;
    case "CHANNEL":
      return policy.collectChannels;
    case "BOT":
      return policy.collectBots;
    case "USER":
      return policy.collectUsers;
    default:
      // Unresolved links are kept for review rather than dropped.
      return true;
  }
}

export function scoreLink(input: ScoreInput, policy: ScorePolicy): ScoreResult {
  const haystack = [input.title, input.description, input.key]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // --- hard rejections -----------------------------------------------------
  const hitExcluded = policy.excludedKeywords.find((kw) => kw && haystack.includes(kw.toLowerCase()));
  if (hitExcluded) {
    return { score: 0, reason: `제외 키워드 "${hitExcluded}" 포함`, excluded: true };
  }

  if (input.resolved && !typeAllowed(input.entityType, policy)) {
    return { score: 0, reason: "수집 대상 종류가 아님", excluded: true };
  }

  if (input.resolved && policy.minMembers > 0 && (input.memberCount ?? 0) < policy.minMembers) {
    return {
      score: 0,
      reason: `인원 ${input.memberCount ?? 0}명 — 최소 ${policy.minMembers}명 미만`,
      excluded: true,
    };
  }

  // --- additive score ------------------------------------------------------
  const parts: string[] = [];
  let score = 20;

  if (input.resolved) {
    score += 10;
  } else {
    parts.push("미확인 링크");
  }

  switch (input.entityType) {
    case "GROUP":
      score += 18;
      break;
    case "CHANNEL":
      score += 8;
      parts.push("읽기 전용 채널");
      break;
    case "BOT":
    case "USER":
      score -= 10;
      parts.push("방이 아님");
      break;
    default:
      break;
  }

  // Being advertised in many different rooms is the strongest signal we have.
  if (input.roomCount > 0) {
    score += clamp(input.roomCount * 4, 0, 22);
    parts.push(`${input.roomCount}개 방에서 발견`);
  }
  if (input.seenCount > 1) {
    // Diminishing returns: 10 mentions and 1000 mentions mean about the same.
    score += clamp(Math.round(Math.log10(input.seenCount) * 8), 0, 14);
    parts.push(`${input.seenCount}회 노출`);
  }

  const hitRequired = policy.requiredKeywords.filter((kw) => kw && haystack.includes(kw.toLowerCase()));
  if (hitRequired.length > 0) {
    score += clamp(hitRequired.length * 12, 0, 24);
    parts.push(`키워드 ${hitRequired.slice(0, 3).join("·")}`);
  }

  if ((input.memberCount ?? 0) >= 1000) {
    score += 8;
    parts.push(`${input.memberCount!.toLocaleString("ko-KR")}명`);
  } else if ((input.memberCount ?? 0) >= 100) {
    score += 4;
  }

  return {
    score: clamp(Math.round(score)),
    reason: parts.join(" · ") || "신호 없음",
    excluded: false,
  };
}

/** Comma-separated policy field -> trimmed list. */
export function parseKeywords(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
