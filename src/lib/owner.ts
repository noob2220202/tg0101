import { cache } from "react";

import { prisma } from "./db";

/**
 * The single operator everything belongs to.
 *
 * This installation has no sign-in — it is meant to sit behind a firewall or an
 * SSH tunnel and serve one person. Ownership columns are still enforced on
 * every query, so the data model does not change if authentication is ever
 * reintroduced; there is simply exactly one owner and it is resolved here.
 *
 * The id is a fixed constant rather than a cuid so that concurrent first
 * requests converge on one row instead of racing to create several.
 */
const OWNER_ID = "solo";

export type Owner = {
  id: string;
  label: string;
};

async function loadOwner(): Promise<Owner> {
  const existing = await prisma.owner.findUnique({
    where: { id: OWNER_ID },
    select: { id: true, label: true },
  });
  if (existing) return existing;

  // First run: create the owner and its collection policy together.
  return prisma.owner.create({
    data: {
      id: OWNER_ID,
      policy: {
        create: {
          requiredKeywords: "자유홍보방, 광고, 구인구직, 총판, 토토, 본사",
          minScore: 70,
          dailyLimit: 100,
        },
      },
    },
    select: { id: true, label: true },
  });
}

/**
 * `cache` dedupes this within a single render, so a page and its nested server
 * components share one lookup.
 */
export const getOwner = cache(loadOwner);

/** For the worker and other non-React callers, where `cache` does not apply. */
export const getOwnerUncached = loadOwner;
