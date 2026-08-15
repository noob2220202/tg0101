/** Keyword-rule matching for the live message stream. */

export type CompiledRule = {
  id: string;
  name: string;
  terms: string[];
  /** Null means "every account this operator owns". */
  accountId: string | null;
};

export function compileRule(rule: {
  id: string;
  name: string;
  terms: string;
  accountId: string | null;
}): CompiledRule {
  return {
    id: rule.id,
    name: rule.name,
    accountId: rule.accountId,
    terms: rule.terms
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  };
}

/**
 * Which rules a message trips.
 *
 * Substring matching, not word boundaries: Korean does not space words the way
 * a `\b` anchor expects, so "구인" has to match inside "구인구직".
 */
export function matchRules(text: string, accountId: string, rules: CompiledRule[]): CompiledRule[] {
  if (!text) return [];
  const haystack = text.toLowerCase();

  return rules.filter((rule) => {
    if (rule.accountId && rule.accountId !== accountId) return false;
    return rule.terms.some((term) => haystack.includes(term));
  });
}
