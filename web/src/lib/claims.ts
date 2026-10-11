import type { EmailDetailResponse } from "@mri/shared";
import { locateCitedQuote, isValidRange } from "./highlight";

/**
 * A "claim" is one piece of evidence shown to the user, with where it came from and (only when
 * it can be proven) exactly where it sits in the original message.
 */
export type ClaimGroup = "ai" | "check" | "cross";

export type SegmentRef = { kind: "body" } | { kind: "attachment"; index: number };

export interface ClaimTarget {
  segment: SegmentRef;
  start: number;
  end: number;
}

export interface Claim {
  id: string;
  group: ClaimGroup;
  heading: string;
  quote: string;
  where: "header" | "body" | "attachment";
  filename?: string;
  /** Null when no reliable highlight target exists (e.g. header evidence, or a mismatch). */
  target: ClaimTarget | null;
}

export function segmentText(detail: EmailDetailResponse, seg: SegmentRef): string | null {
  if (seg.kind === "body") return detail.email.body;
  return detail.email.attachments[seg.index]?.extracted_text ?? null;
}

function findSegment(
  detail: EmailDetailResponse,
  where: "header" | "body" | "attachment",
  filename?: string,
): SegmentRef | null {
  if (where === "header") return null; // header offsets refer to a server-side rendering; never highlighted
  if (where === "body") return { kind: "body" };
  const index = detail.email.attachments.findIndex((a) => a.filename === filename && a.extracted_text);
  return index >= 0 ? { kind: "attachment", index } : null;
}

/** All claims for one email, in a stable order: AI evidence, automatic checks, cross-email. */
export function buildClaims(detail: EmailDetailResponse): Claim[] {
  const claims: Claim[] = [];
  // The same passage is often cited by several rules or twice by one finding; show it once per
  // indicator/finding/AI group so the list is not padded with identical quotes.
  const seen = new Set<string>();
  const add = (claim: Claim, owner: string) => {
    const key = `${owner}|${claim.where}|${claim.filename ?? ""}|${claim.quote}`;
    if (seen.has(key)) return;
    seen.add(key);
    claims.push(claim);
  };
  const snippets = new Map((detail.extraction?.evidence_snippets ?? []).map((s) => [s.id, s]));

  // AI evidence: a quote cited from a snippet. Highlight only if the snippet is verifiably at
  // its recorded location and the quote verifiably sits inside it.
  (detail.assessment?.risk.evidence ?? []).forEach((ev, i) => {
    const snip = snippets.get(ev.snippet_id);
    let target: ClaimTarget | null = null;
    const where = snip?.location.where ?? "body";
    if (snip) {
      const seg = findSegment(detail, snip.location.where, snip.location.filename);
      const text = seg ? segmentText(detail, seg) : null;
      if (seg && text !== null) {
        const hit = locateCitedQuote(text, snip.location, snip.text, ev.quote);
        if (hit) target = { segment: seg, start: hit.start, end: hit.end };
      }
    }
    add({
      id: `ai-${i}`,
      group: "ai",
      heading: "Cited by the AI",
      quote: ev.quote,
      where,
      filename: snip?.location.filename,
      target,
    }, "ai");
  });

  // Automatic checks and cross-email findings: evidence carries its own located text.
  const own = (e: { email_id: string }) => e.email_id === detail.email.id;
  detail.risk.indicators.forEach((ind) => {
    // Cross-email indicators are presented through their finding; skip the duplicate here.
    if (ind.identity !== undefined) return;
    ind.evidence.filter(own).forEach((ev, j) => {
      add({
        id: `check-${ind.id}-${j}`,
        group: "check",
        heading: ind.label,
        quote: ev.text,
        where: ev.where,
        filename: ev.filename,
        target: evidenceTarget(detail, ev),
      }, `check-${ind.id}`);
    });
  });
  detail.risk.findings.forEach((f) => {
    f.evidence.filter(own).forEach((ev, j) => {
      add({
        id: `cross-${f.id}-${j}`,
        group: "cross",
        heading: f.rule_id === "payment_account_changed" ? "Payment account in this message" : "Amount in this message",
        quote: ev.text,
        where: ev.where,
        filename: ev.filename,
        target: evidenceTarget(detail, ev),
      }, `cross-${f.id}`);
    });
  });
  return claims;
}

function evidenceTarget(
  detail: EmailDetailResponse,
  ev: { where: "header" | "body" | "attachment"; filename?: string; start: number; end: number; text: string },
): ClaimTarget | null {
  const seg = findSegment(detail, ev.where, ev.filename);
  if (!seg) return null;
  const text = segmentText(detail, seg);
  if (text === null || !isValidRange(text, ev.start, ev.end, ev.text)) return null;
  return { segment: seg, start: ev.start, end: ev.end };
}
