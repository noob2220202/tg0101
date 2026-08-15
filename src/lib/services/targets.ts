import { prisma } from "../db";
import { TargetSource } from "../enums";
import { parseLink } from "../links";

/**
 * Targets are deduplicated by `key`, so importing the same link twice — by hand
 * and via the collector — converges on one row.
 */

export type UpsertTargetInput = {
  key: string;
  url?: string;
  title?: string | null;
  entityType?: string;
  memberCount?: number | null;
  source?: TargetSource;
  note?: string | null;
};

export async function upsertTarget(input: UpsertTargetInput) {
  const kind = input.key.startsWith("+") ? "PRIVATE" : "PUBLIC";
  return prisma.target.upsert({
    where: { key: input.key },
    create: {
      key: input.key,
      kind,
      title: input.title ?? null,
      entityType: input.entityType ?? "UNKNOWN",
      memberCount: input.memberCount ?? null,
      source: input.source ?? "MANUAL",
      note: input.note ?? null,
    },
    update: {
      // Never blank out a title we already resolved.
      ...(input.title ? { title: input.title } : {}),
      ...(input.entityType && input.entityType !== "UNKNOWN" ? { entityType: input.entityType } : {}),
      ...(input.memberCount !== undefined && input.memberCount !== null ? { memberCount: input.memberCount } : {}),
    },
  });
}

export type ImportResult = {
  created: number;
  existing: number;
  invalid: string[];
  targetIds: string[];
};

/**
 * Bulk import from a textarea: one link per line, `@name`, bare usernames and
 * full URLs all accepted.
 */
export async function importLinks(raw: string, source: TargetSource = "MANUAL"): Promise<ImportResult> {
  const lines = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const result: ImportResult = { created: 0, existing: 0, invalid: [], targetIds: [] };
  const seen = new Set<string>();

  for (const line of lines) {
    const parsed = parseLink(line);
    if (!parsed) {
      result.invalid.push(line);
      continue;
    }
    if (seen.has(parsed.key)) continue;
    seen.add(parsed.key);

    const before = await prisma.target.findUnique({ where: { key: parsed.key }, select: { id: true } });
    const target = await upsertTarget({ key: parsed.key, source });
    result.targetIds.push(target.id);
    if (before) result.existing += 1;
    else result.created += 1;
  }
  return result;
}
