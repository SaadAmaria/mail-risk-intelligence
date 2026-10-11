/**
 * Safe evidence highlighting.
 *
 * Highlights are only ever drawn where the source text at the given offsets IS the expected
 * text. A location that does not match is never "best-guessed": the caller shows the quote on
 * its own instead, so unrelated words are never marked as evidence.
 */

/** True only if `text.slice(start, end)` is exactly `expected` (and the range is sane). */
export function isValidRange(text: string, start: number, end: number, expected: string): boolean {
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end > start &&
    end <= text.length &&
    text.slice(start, end) === expected
  );
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Where does `quote` occur inside `snippet`? Case and whitespace differences are tolerated (the
 * server verified the quote the same way); the result is a range within `snippet`.
 */
export function findQuoteIn(snippet: string, quote: string): { start: number; end: number } | null {
  const q = quote.trim();
  if (q === "" || q.length > 600) return null;
  const tokens = q.split(/\s+/).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const m = new RegExp(tokens.join("\\s+"), "i").exec(snippet);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

export interface LocatedQuote {
  start: number;
  end: number;
}

/**
 * Highlight target for a quote cited from an evidence snippet that the server located at
 * [loc.start, loc.end) of `segmentText`. Returns null (no highlight) unless BOTH hold:
 *   1. the snippet text really is at that location, and
 *   2. the quote occurs inside the snippet and matches the source text there.
 */
export function locateCitedQuote(
  segmentText: string,
  loc: { start: number; end: number },
  snippetText: string,
  quote: string,
): LocatedQuote | null {
  if (!isValidRange(segmentText, loc.start, loc.end, snippetText)) return null;
  const inSnippet = findQuoteIn(snippetText, quote);
  if (!inSnippet) return null;
  const start = loc.start + inSnippet.start;
  const end = loc.start + inSnippet.end;
  if (end > segmentText.length) return null;
  if (collapse(segmentText.slice(start, end)) !== collapse(quote)) return null;
  return { start, end };
}

export interface HighlightRange {
  start: number;
  end: number;
  claimId: string;
}

export interface TextRun {
  text: string;
  /** Claims citing this run; empty for plain text. */
  claims: string[];
}

/**
 * Split `text` into runs, merging overlapping ranges. Out-of-bounds or empty ranges are
 * ignored. The concatenation of all runs is always exactly `text`.
 */
export function buildRuns(text: string, ranges: HighlightRange[]): TextRun[] {
  const valid = ranges.filter(
    (r) => Number.isInteger(r.start) && Number.isInteger(r.end) && r.start >= 0 && r.end > r.start && r.end <= text.length,
  );
  if (valid.length === 0) return [{ text, claims: [] }];

  const cuts = new Set<number>([0, text.length]);
  for (const r of valid) {
    cuts.add(r.start);
    cuts.add(r.end);
  }
  const points = [...cuts].sort((a, b) => a - b);

  const runs: TextRun[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const claims = [...new Set(valid.filter((r) => r.start <= a && r.end >= b).map((r) => r.claimId))];
    const last = runs[runs.length - 1];
    const same = last && last.claims.length === claims.length && last.claims.every((c, j) => c === claims[j]);
    if (same) last.text += text.slice(a, b);
    else runs.push({ text: text.slice(a, b), claims });
  }
  return runs;
}
