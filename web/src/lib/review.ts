import type { RelationshipSupport } from "@mri/shared";

/**
 * Reads the server's advisory review metadata for a relationship. It never re-derives it: the
 * heuristics live on the server, and this only combines the relationship-level flag with the
 * per-quote ones (a legacy or partial payload may carry either).
 */
export interface Reviewable {
  review?: boolean;
  evidence: { support?: RelationshipSupport }[];
}

export function needsReview(r: Reviewable): boolean {
  return r.review === true || r.evidence.some((e) => e.support?.review === true);
}

/** The server's notes for every flagged quote, without repeats. */
export function reviewNotes(r: Reviewable): string[] {
  return [...new Set(r.evidence.flatMap((e) => (e.support?.review ? e.support.notes : [])))];
}

/**
 * A relationship-level flag that no citation's own metadata explains (a legacy or partial payload).
 * It is shown once for the relationship, never repeated under each quote.
 */
export function unattributedReview(r: Reviewable): boolean {
  return r.review === true && !r.evidence.some((e) => e.support?.review === true);
}
