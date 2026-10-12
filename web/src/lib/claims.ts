import type { EmailDetailRelationship, EmailDetailResponse } from "@mri/shared";
import { locateCitedQuote, isValidRange } from "./highlight";
import { unattributedReview } from "./review";

/**
 * A "claim" is one piece of evidence shown to the user, with where it came from and (only when
 * it can be proven) exactly where it sits in the original message.
 */
export type ClaimGroup = "ai" | "check" | "cross" | "linked";

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

export interface LinkedCitation {
  relationship: EmailDetailRelationship;
  /** The server's advisory review of THIS quote for this relationship (never computed here). */
  review: boolean;
  notes: string[];
}

export type EvidenceLinkResult =
  | { status: "ok"; claim: Claim; citations: LinkedCitation[] }
  /** The reference cannot be tied to this record (never highlighted, never guessed). */
  | { status: "unavailable"; reason: "no_extraction" | "unknown_snippet" | "not_a_recorded_relationship" };

/**
 * Resolve a graph evidence link (snippet id + quote) against THIS email's stored record.
 *
 * Nothing in the URL is trusted: the pair must appear as evidence of one of the email's own
 * validated relationships, the snippet must exist in its extraction, and a highlight target is
 * produced only by the same verification the AI-citation highlights use (the snippet really is at
 * its recorded offsets and the quote really is inside it). Header evidence, or anything that does
 * not verify, yields a claim with no target: the quote is shown, no text is marked.
 */
export function resolveRelationshipEvidence(detail: EmailDetailResponse, snippetId: string, quote: string): EvidenceLinkResult {
  const citations: LinkedCitation[] = detail.relationships.flatMap((r) => {
    const ev = r.evidence.find((e) => e.snippet_id === snippetId && e.quote === quote);
    if (!ev) return [];
    // This citation's own advisory where present; a relationship-level flag that no citation
    // explains (legacy payload) as the fallback. Same rule as the graph inspectors.
    const own = ev.support?.review === true;
    return [{ relationship: r, review: own || unattributedReview(r), notes: own ? ev.support!.notes : [] }];
  });
  if (citations.length === 0) return { status: "unavailable", reason: "not_a_recorded_relationship" };
  if (!detail.extraction) return { status: "unavailable", reason: "no_extraction" };
  const snip = detail.extraction.evidence_snippets.find((s) => s.id === snippetId);
  if (!snip) return { status: "unavailable", reason: "unknown_snippet" };

  let target: ClaimTarget | null = null;
  const seg = findSegment(detail, snip.location.where, snip.location.filename);
  const text = seg ? segmentText(detail, seg) : null;
  if (seg && text !== null) {
    const hit = locateCitedQuote(text, snip.location, snip.text, quote);
    if (hit) target = { segment: seg, start: hit.start, end: hit.end };
  }
  return {
    status: "ok",
    citations,
    claim: {
      id: `graph-${snippetId}`,
      group: "linked",
      heading: "Evidence for a relationship",
      quote,
      where: snip.location.where,
      filename: snip.location.filename,
      target,
    },
  };
}
