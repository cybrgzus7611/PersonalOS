/** Title similarity for duplicate-task detection: Dice coefficient over character bigrams of normalised text. */
export function normaliseTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function bigrams(value: string): Map<string, number> {
  const s = normaliseTitle(value).replace(/ /g, "");
  const out = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

export function similarity(a: string, b: string): number {
  const na = normaliseTitle(a);
  const nb = normaliseTitle(b);
  if (na === nb) return 1;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let total = 0;
  let overlap = 0;
  for (const n of ga.values()) total += n;
  for (const n of gb.values()) total += n;
  for (const [g, n] of ga) overlap += Math.min(n, gb.get(g) ?? 0);
  return total === 0 ? 0 : (2 * overlap) / total;
}

export const DUPLICATE_THRESHOLD = 0.8;
