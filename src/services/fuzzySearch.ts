/** Returned by {@link fuzzyScore} when the value does not match the query at all. */
export const FUZZY_NO_MATCH = Number.NEGATIVE_INFINITY;

export function fuzzyMatches(value: string | undefined, query: string): boolean {
  return fuzzyScore(value, query) > FUZZY_NO_MATCH;
}

/**
 * Scores how well `value` matches `query`. Higher is a better match;
 * {@link FUZZY_NO_MATCH} means no match at all. Callers can sort matches by
 * this score to surface the most relevant options first instead of leaving
 * them in their original (e.g. alphabetical) order.
 *
 * Ranking, best to worst:
 *   1. exact match
 *   2. prefix match (value starts with the query)
 *   3. substring match (earlier position ranks higher)
 *   4. subsequence match (query characters appear in order, with gaps)
 */
export function fuzzyScore(value: string | undefined, query: string): number {
  const normalizedValue = normalizeSearchText(value ?? "");
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) {
    return 0;
  }

  const index = normalizedValue.indexOf(normalizedQuery);
  if (index !== -1) {
    if (normalizedValue.length === normalizedQuery.length) {
      return 4000;
    }
    if (index === 0) {
      return 3000;
    }
    // Substring match: earlier occurrences rank higher.
    return 2000 - Math.min(index, 999);
  }

  let queryIndex = 0;
  for (const char of normalizedValue) {
    if (char === normalizedQuery[queryIndex]) {
      queryIndex += 1;
      if (queryIndex === normalizedQuery.length) {
        return 1000;
      }
    }
  }

  return FUZZY_NO_MATCH;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
