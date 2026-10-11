import type { EvidenceLocation, NormalizedEmail } from "@mri/shared";

/**
 * The "original" that every evidence claim is verified against: the normalized email split into
 * addressable text segments. Offsets in `EvidenceLocation` are character offsets into one
 * segment's `text`.
 *
 * The header segment is a canonical rendering of the already-parsed headers (code is the source
 * of truth for them); body and attachment segments are the stored text verbatim.
 */
export interface SourceSegment {
  where: EvidenceLocation["where"];
  filename?: string;
  text: string;
}

type Mailbox = { address: string; name: string | null };

const fmt = (m: Mailbox) => (m.name ? `${m.name} <${m.address}>` : m.address);

export function buildHeaderText(e: Pick<NormalizedEmail, "from" | "to" | "cc" | "date" | "subject">): string {
  const lines: string[] = [];
  if (e.from) lines.push(`From: ${fmt(e.from)}`);
  if (e.to.length) lines.push(`To: ${e.to.map(fmt).join(", ")}`);
  if (e.cc.length) lines.push(`Cc: ${e.cc.map(fmt).join(", ")}`);
  if (e.date) lines.push(`Date: ${e.date}`);
  if (e.subject) lines.push(`Subject: ${e.subject}`);
  return lines.join("\n");
}

export function buildSegments(
  e: Pick<NormalizedEmail, "from" | "to" | "cc" | "date" | "subject" | "body" | "attachments">,
): SourceSegment[] {
  const segments: SourceSegment[] = [];
  const header = buildHeaderText(e);
  if (header) segments.push({ where: "header", text: header });
  if (e.body) segments.push({ where: "body", text: e.body });
  for (const a of e.attachments) {
    if (a.extraction_status === "ok" && a.extracted_text) {
      segments.push({ where: "attachment", filename: a.filename, text: a.extracted_text });
    }
  }
  return segments;
}

/** Collapse whitespace and fold case, for tolerant "does this text appear" comparisons. */
export function normalizeForMatch(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

const MAX_QUOTE = 300;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find `quote` inside `text`, tolerating differences in whitespace and case only. Returns the
 * span in the ORIGINAL text, so offsets are exact. Never matches a different wording.
 */
export function locateQuote(text: string, quote: string): { start: number; end: number } | null {
  const q = quote.trim();
  if (q.length === 0 || q.length > MAX_QUOTE) return null;
  const tokens = q.split(/\s+/).map(escapeRegex);
  const m = new RegExp(tokens.join("\\s+"), "i").exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

/** Locate a quote in the segment named by `where` (+ `filename` for attachments). */
export function locateInSegments(
  segments: SourceSegment[],
  where: string,
  filename: string | null | undefined,
  quote: string,
): { segment: SourceSegment; start: number; end: number } | null {
  for (const seg of segments) {
    if (seg.where !== where) continue;
    if (where === "attachment" && filename && seg.filename !== filename) continue;
    const hit = locateQuote(seg.text, quote);
    if (hit) return { segment: seg, ...hit };
  }
  return null;
}

/** Locate a quote anywhere in the source (when the model gave no or a wrong location). */
export function locateAnywhere(
  segments: SourceSegment[],
  quote: string,
): { segment: SourceSegment; start: number; end: number } | null {
  for (const seg of segments) {
    const hit = locateQuote(seg.text, quote);
    if (hit) return { segment: seg, ...hit };
  }
  return null;
}
