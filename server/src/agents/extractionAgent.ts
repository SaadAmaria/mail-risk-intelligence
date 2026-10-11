import { z } from "zod";
import {
  Extraction,
  type EvidenceSnippet,
  type NormalizedEmail,
  type TokenUsage,
} from "@mri/shared";
import type { LlmClient } from "../llm/types";
import { callJsonAgent, type ParseResult } from "./callJson";
import { findDeterministicHits, numbersInText, type DeterministicHit } from "./deterministic";
import { buildExtractionPrompt, EXTRACTION_PROMPT_VERSION } from "./prompts/extraction";
import {
  buildSegments,
  locateAnywhere,
  locateInSegments,
  normalizeForMatch,
  type SourceSegment,
} from "./source";

export { EXTRACTION_PROMPT_VERSION };

const MAX_SNIPPET_CHARS = 300;
const MAX_DETERMINISTIC_SNIPPETS = 12;
const MAX_LLM_SNIPPETS = 12;
const MAX_SUMMARY = 400;

// What the model is allowed to say. Deliberately permissive about shape (so one stray field does
// not discard a good answer) and strict later, when each claim is checked against the source.
const LlmExtraction = z.object({
  summary: z.string().default(""),
  facts: z
    .object({
      amounts: z
        .array(
          z.object({
            value: z.union([z.number(), z.string()]),
            currency: z.string().default("USD"),
            context: z.string().default(""),
          }),
        )
        .default([]),
      dates: z.array(z.object({ value: z.string(), context: z.string().default("") })).default([]),
      references: z
        .array(z.object({ kind: z.string().default("other"), value: z.string(), context: z.string().default("") }))
        .default([]),
      attachments: z
        .array(z.object({ filename: z.string(), summary: z.string().default("") }))
        .default([]),
    })
    .default({}),
  evidence_snippets: z
    .array(z.object({ text: z.string(), where: z.string().default("body"), filename: z.string().nullish() }))
    .default([]),
  notes: z.array(z.string()).default([]),
});
type LlmExtraction = z.infer<typeof LlmExtraction>;

const REFERENCE_KINDS = new Set(["invoice", "account", "routing", "url", "phone", "other"]);

export interface ExtractionOutcome {
  extraction: Extraction;
  /** Unsupported claims removed during validation (flagged, not silently kept). */
  droppedItems: number;
  warnings: string[];
  usage: TokenUsage | null;
  calls: number;
  latencyMs: number;
  model: string | null;
  repaired: boolean;
}

function clamp(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s;
}

function parseAmount(value: number | string): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const m = /^\s*[$€£]?\s*(\d[\d,]*(?:\.\d+)?)\s*([KkMmBb])?\s*(?:USD|EUR|GBP)?\s*$/.exec(value);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ""));
  const mult = m[2] ? { k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase() as "k" | "m" | "b"] : 1;
  return Number.isFinite(n) ? Math.round(n * mult * 100) / 100 : null;
}

/** Collects evidence snippets with exact offsets, separate budgets per origin, and de-duplication. */
class SnippetSet {
  readonly items: EvidenceSnippet[] = [];
  private counts = { rules: 0, llm: 0 };

  constructor(private readonly segments: SourceSegment[]) {}

  /** Add (or reuse) a snippet covering [start,end) of a segment. Returns its id, or null. */
  add(segmentIndex: number, start: number, end: number, origin: "rules" | "llm"): string | null {
    const seg = this.segments[segmentIndex];
    if (!seg) return null;

    // Trim whitespace while keeping exact offsets.
    while (start < end && /\s/.test(seg.text[start]!)) start++;
    while (end > start && /\s/.test(seg.text[end - 1]!)) end--;
    if (end <= start || end - start > MAX_SNIPPET_CHARS) return null;

    const reuse = this.items.find(
      (s) =>
        s.location.where === seg.where &&
        (s.location.filename ?? null) === (seg.filename ?? null) &&
        s.location.start <= start &&
        s.location.end >= end,
    );
    if (reuse) return reuse.id;

    const limit = origin === "rules" ? MAX_DETERMINISTIC_SNIPPETS : MAX_LLM_SNIPPETS;
    if (this.counts[origin] >= limit) return null;
    this.counts[origin]++;

    const id = `s${this.items.length + 1}`;
    this.items.push({
      id,
      text: seg.text.slice(start, end),
      location: {
        where: seg.where,
        ...(seg.filename ? { filename: seg.filename } : {}),
        start,
        end,
      },
      origin,
    });
    return id;
  }

  /** Whole-line snippet around a match, clipped to the snippet size limit. */
  addAround(segmentIndex: number, start: number, end: number, origin: "rules" | "llm"): string | null {
    const seg = this.segments[segmentIndex];
    if (!seg) return null;
    let lineStart = seg.text.lastIndexOf("\n", start - 1) + 1;
    let lineEnd = seg.text.indexOf("\n", end);
    if (lineEnd === -1) lineEnd = seg.text.length;
    if (lineEnd - lineStart > MAX_SNIPPET_CHARS) {
      lineStart = Math.max(lineStart, start - 120);
      lineEnd = Math.min(lineEnd, Math.max(end + 120, lineStart + 1));
      if (lineEnd - lineStart > MAX_SNIPPET_CHARS) lineEnd = lineStart + MAX_SNIPPET_CHARS;
    }
    return this.add(segmentIndex, lineStart, lineEnd, origin);
  }
}

function headerFields(email: NormalizedEmail) {
  return {
    sender: email.from ? { address: email.from.address, name: email.from.name } : null,
    recipients: [...email.to, ...email.cc].map((a) => ({ address: a.address, name: a.name })),
    date: email.date,
    subject: email.subject,
    missing_headers: email.missing_headers,
  };
}

function referenceFromHit(h: DeterministicHit): { kind: "account" | "routing" | "invoice" | "url"; value: string } | null {
  return h.kind === "amount" ? null : { kind: h.kind, value: h.value };
}

interface Assembled {
  extraction: Extraction;
  dropped: number;
  warnings: string[];
}

/**
 * Build the final Extraction. Header fields come from the normalized email; deterministic
 * findings are always included; every model claim is verified against the source text and
 * dropped (and counted) when unsupported.
 */
function assemble(
  email: NormalizedEmail,
  segments: SourceSegment[],
  llm: LlmExtraction | null,
  extraNotes: string[],
): Assembled {
  const warnings: string[] = [];
  let dropped = 0;
  const snippets = new SnippetSet(segments);

  // 1. Deterministic values first: they exist whether or not the model cooperates.
  const hits = findDeterministicHits(segments);
  const amounts: Extraction["facts"]["amounts"] = [];
  const references: Extraction["facts"]["references"] = [];
  const seenAmount = new Set<string>();
  const seenRef = new Set<string>();

  for (const h of hits) {
    const id = snippets.addAround(h.segmentIndex, h.start, h.end, "rules");
    const context = clamp(
      id ? (snippets.items.find((s) => s.id === id)?.text ?? "") : segments[h.segmentIndex]!.text.slice(h.start, h.end),
      120,
    );
    if (h.kind === "amount" && h.numeric !== null) {
      const key = `${h.currency}:${h.numeric}`;
      if (seenAmount.has(key)) continue;
      seenAmount.add(key);
      amounts.push({ value: h.numeric, currency: h.currency ?? "USD", context, ...(id ? { snippet_id: id } : {}) });
    } else {
      const ref = referenceFromHit(h);
      if (!ref) continue;
      const key = `${ref.kind}:${normalizeForMatch(ref.value)}`;
      if (seenRef.has(key)) continue;
      seenRef.add(key);
      references.push({ kind: ref.kind, value: ref.value, context, ...(id ? { snippet_id: id } : {}) });
    }
  }

  const allNumbers = new Set<number>([
    ...segments.flatMap((s) => numbersInText(s.text)),
    ...hits.filter((h) => h.numeric !== null).map((h) => h.numeric as number),
  ]);
  const numberAppears = (n: number) => [...allNumbers].some((x) => Math.abs(x - n) <= 0.005);

  const dates: Extraction["facts"]["dates"] = [];
  const attachmentFacts: Extraction["facts"]["attachments"] = [];
  let summary = "";
  const notes: string[] = [...extraNotes];

  if (llm) {
    summary = clamp(llm.summary.trim(), MAX_SUMMARY);
    if (llm.summary.trim().length > MAX_SUMMARY) warnings.push("Summary exceeded 400 characters and was truncated.");

    // 2. Model-chosen evidence: must be an exact quote of the original.
    for (const s of llm.evidence_snippets.slice(0, 40)) {
      const where = s.where === "header" || s.where === "attachment" ? s.where : "body";
      const hit =
        locateInSegments(segments, where, s.filename ?? null, s.text) ?? locateAnywhere(segments, s.text);
      const idx = hit ? segments.indexOf(hit.segment) : -1;
      const id = hit ? snippets.add(idx, hit.start, hit.end, "llm") : null;
      if (!id) {
        dropped++;
        warnings.push("An evidence snippet was removed: it is not an exact quote of the email (or exceeds limits).");
      }
    }

    // 3. Model-reported facts: kept only when the original text supports them.
    for (const a of llm.facts.amounts) {
      const n = parseAmount(a.value);
      if (n === null || !numberAppears(n)) {
        dropped++;
        warnings.push("An amount was removed: it does not appear in the email.");
        continue;
      }
      const currency = clamp(a.currency.trim().toUpperCase() || "USD", 8);
      const key = `${currency}:${n}`;
      const already = amounts.find((x) => Math.abs(x.value - n) <= 0.005);
      if (already || seenAmount.has(key)) continue;
      seenAmount.add(key);
      amounts.push({ value: n, currency, context: clamp(a.context, 120) });
    }

    for (const r of llm.facts.references) {
      const value = r.value.trim();
      const hit = value ? locateAnywhere(segments, value) : null;
      if (!hit) {
        dropped++;
        warnings.push("A reference was removed: it does not appear in the email.");
        continue;
      }
      const kind = REFERENCE_KINDS.has(r.kind) ? (r.kind as Extraction["facts"]["references"][number]["kind"]) : "other";
      const key = `${kind}:${normalizeForMatch(value)}`;
      const anyKind = [...seenRef].some((k) => k.endsWith(`:${normalizeForMatch(value)}`));
      if (seenRef.has(key) || anyKind) continue;
      seenRef.add(key);
      const id = snippets.addAround(segments.indexOf(hit.segment), hit.start, hit.end, "llm");
      references.push({ kind, value, context: clamp(r.context, 120), ...(id ? { snippet_id: id } : {}) });
    }

    for (const d of llm.facts.dates) {
      const value = d.value.trim();
      const hit = value ? locateAnywhere(segments, value) : null;
      if (!hit) {
        dropped++;
        warnings.push("A date was removed: it does not appear in the email as written.");
        continue;
      }
      const id = snippets.addAround(segments.indexOf(hit.segment), hit.start, hit.end, "llm");
      dates.push({ value, context: clamp(d.context, 120), ...(id ? { snippet_id: id } : {}) });
    }

    const realAttachments = new Map(email.attachments.map((a) => [a.filename, a]));
    for (const a of llm.facts.attachments) {
      if (!realAttachments.has(a.filename)) {
        dropped++;
        warnings.push("An attachment fact was removed: no such attachment exists.");
        continue;
      }
      attachmentFacts.push({ filename: a.filename, summary: clamp(a.summary, 300) });
    }

    notes.push(...llm.notes.slice(0, 10).map((n) => clamp(n, 200)));
  }

  if (dropped > 0) notes.push(`${dropped} unsupported claim(s) were removed during validation.`);

  const extraction = Extraction.parse({
    schema_version: 1,
    ...headerFields(email),
    summary,
    facts: { amounts, dates, references, attachments: attachmentFacts },
    evidence_snippets: snippets.items,
    notes,
  });
  return { extraction, dropped, warnings };
}

/**
 * Code-only extraction (headers, deterministic values, line snippets). Used when no LLM stage
 * produced a validated answer: it carries no AI summary and is labeled as such in `notes`.
 */
export function buildDeterministicExtraction(email: NormalizedEmail, reason: string): Extraction {
  const segments = buildSegments(email);
  return assemble(email, segments, null, [
    `Deterministic extraction only (${reason}). No AI summary or evidence selection was produced.`,
  ]).extraction;
}

export interface ExtractionAgentOptions {
  maxCompletionTokens: number;
}

/** Agent A. Input: a normalized email. Output: a validated, source-grounded Extraction. */
export async function runExtractionAgent(
  client: LlmClient,
  email: NormalizedEmail,
  options: ExtractionAgentOptions,
): Promise<ExtractionOutcome> {
  const segments = buildSegments(email);
  const prompt = buildExtractionPrompt(
    segments,
    email.attachments.map((a) => ({ filename: a.filename, status: a.extraction_status })),
  );

  let assembled: Assembled | null = null;
  const parse = (json: unknown): ParseResult<LlmExtraction> => {
    const r = LlmExtraction.safeParse(json);
    if (r.success) return { ok: true, value: r.data };
    return {
      ok: false,
      errors: r.error.issues.slice(0, 6).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  };

  const result = await callJsonAgent<LlmExtraction>({
    client,
    messages: prompt.messages,
    maxCompletionTokens: options.maxCompletionTokens,
    parse,
  });

  assembled = assemble(
    email,
    segments,
    result.value,
    prompt.truncated ? ["Long content was shortened before being shown to the model."] : [],
  );

  return {
    extraction: assembled.extraction,
    droppedItems: assembled.dropped,
    warnings: assembled.warnings,
    usage: result.usage,
    calls: result.calls,
    latencyMs: result.latencyMs,
    model: result.model,
    repaired: result.repaired,
  };
}
