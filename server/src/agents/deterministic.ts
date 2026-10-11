import type { SourceSegment } from "./source";

export type HitKind = "amount" | "account" | "routing" | "invoice" | "url";

/** A value found by code (not by the model) in the original text. */
export interface DeterministicHit {
  kind: HitKind;
  /** Value as it appears (digits, id, URL, or the amount text). */
  value: string;
  /** Parsed number for amounts. */
  numeric: number | null;
  currency: string | null;
  segmentIndex: number;
  /** Span of the matched value inside the segment text. */
  start: number;
  end: number;
}

const CURRENCY: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP", USD: "USD", EUR: "EUR", GBP: "GBP" };
const MULTIPLIER: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

const AMOUNT = /(?:(USD|EUR|GBP)\s?|([$€£]))(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?\s?([KkMmBb])?\b/g;
const ACCOUNT_ENDING = /\baccount(?:\s+(?:number|no\.?|#))?\s*(?:ending(?:\s+in|\s+with)?|ends\s+in)\s*#?\s*(\d{3,})/gi;
const ACCOUNT_NUMBER = /\baccount\s*(?:number|no\.?|#)\s*:?\s*(\d{4,})/gi;
const ROUTING = /\brouting(?:\s+(?:number|no\.?|#))?\s*:?\s*(\d{9})\b/gi;
const INVOICE = /\binvoice\s*(?:#|no\.?|number)?\s*:?\s*([A-Z]{0,4}-?\d[\w-]{2,})/gi;
// Includes defanged hxxp(s). URLs are recorded as text only; nothing ever fetches them.
const URL_RE = /\b(?:https?|hxxps?):\/\/[^\s<>"')\]]+/gi;

function* matches(re: RegExp, text: string): Generator<RegExpExecArray> {
  const r = new RegExp(re.source, re.flags);
  for (let m = r.exec(text); m; m = r.exec(text)) {
    yield m;
    if (m[0].length === 0) r.lastIndex++;
  }
}

/** Find amounts, account/routing numbers, invoice ids and URLs. Pure and deterministic. */
export function findDeterministicHits(segments: SourceSegment[]): DeterministicHit[] {
  const hits: DeterministicHit[] = [];
  segments.forEach((seg, segmentIndex) => {
    const text = seg.text;

    for (const m of matches(AMOUNT, text)) {
      const symbol = (m[1] ?? m[2])!;
      const whole = Number((m[3] ?? "").replace(/,/g, "") + (m[4] ?? ""));
      const mult = m[5] ? MULTIPLIER[m[5].toLowerCase()]! : 1;
      hits.push({
        kind: "amount",
        value: m[0].trim(),
        numeric: Math.round(whole * mult * 100) / 100,
        currency: CURRENCY[symbol.toUpperCase()] ?? CURRENCY[symbol] ?? null,
        segmentIndex,
        start: m.index,
        end: m.index + m[0].length,
      });
    }

    const capture = (re: RegExp, kind: HitKind) => {
      for (const m of matches(re, text)) {
        const raw = m[1]!;
        const start = m.index + m[0].lastIndexOf(raw);
        hits.push({ kind, value: raw, numeric: null, currency: null, segmentIndex, start, end: start + raw.length });
      }
    };
    capture(ACCOUNT_ENDING, "account");
    capture(ACCOUNT_NUMBER, "account");
    capture(ROUTING, "routing");
    capture(INVOICE, "invoice");

    for (const m of matches(URL_RE, text)) {
      const value = m[0].replace(/[.,;:!?]+$/, "");
      hits.push({
        kind: "url",
        value,
        numeric: null,
        currency: null,
        segmentIndex,
        start: m.index,
        end: m.index + value.length,
      });
    }
  });

  // Stable order: by segment then position.
  return hits.sort((a, b) => a.segmentIndex - b.segmentIndex || a.start - b.start);
}

/** Every distinct numeric value that appears in the text, for verifying model-claimed amounts. */
export function numbersInText(text: string): number[] {
  const out: number[] = [];
  for (const m of matches(/\d[\d,]*(?:\.\d+)?/g, text)) {
    const n = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}
