import { prisma } from "../db";
import { dayKey } from "../format";
import { parseKeywords, ScorePolicy } from "../scoring";

/** The collection policy is a single row; this creates it on first read. */
export async function getPolicy() {
  const existing = await prisma.collectionPolicy.findUnique({ where: { id: "default" } });
  if (existing) return existing;
  return prisma.collectionPolicy.create({
    data: {
      id: "default",
      requiredKeywords: "자유홍보방, 광고, 구인구직, 총판, 토토, 본사",
    },
  });
}

export type PolicyRow = Awaited<ReturnType<typeof getPolicy>>;

export function toScorePolicy(policy: PolicyRow): ScorePolicy {
  return {
    requiredKeywords: parseKeywords(policy.requiredKeywords),
    excludedKeywords: parseKeywords(policy.excludedKeywords),
    minMembers: policy.minMembers,
    collectGroups: policy.collectGroups,
    collectChannels: policy.collectChannels,
    collectBots: policy.collectBots,
    collectUsers: policy.collectUsers,
  };
}

/**
 * Daily auto-registration budget. The counter resets on the first call of a new
 * local day rather than on a timer, so a stopped worker cannot skip a reset.
 */
export async function remainingDailyBudget(policy: PolicyRow): Promise<number> {
  const today = dayKey();
  if (policy.counterDate !== today) {
    await prisma.collectionPolicy.update({
      where: { id: policy.id },
      data: { counterDate: today, registeredToday: 0 },
    });
    return policy.dailyLimit;
  }
  return Math.max(0, policy.dailyLimit - policy.registeredToday);
}

export async function consumeDailyBudget(policyId: string, amount = 1): Promise<void> {
  await prisma.collectionPolicy.update({
    where: { id: policyId },
    data: { registeredToday: { increment: amount }, counterDate: dayKey() },
  });
}
