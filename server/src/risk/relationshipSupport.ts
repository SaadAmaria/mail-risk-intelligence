import type { EntityType, RelationshipPredicate } from "@mri/shared";

/**
 * A READ-TIME, advisory check of how well a cited quote relates to the relationship built on it.
 *
 * What it is: a set of conservative, structural observations (does the quote name the entities;
 * in which order; for accusations, is there wording of that kind and is it negated). What it is
 * not: verification of meaning. English cue words are a HEURISTIC; their presence does not make a
 * claim true and their absence does not make it false. Nothing here removes a relationship or
 * changes a stored analysis: it only decides whether the interface asks the reader to check.
 */

export type Participants = "both" | "source_only" | "target_only" | "none" | "header";
export type Wording = "present" | "negated" | "none_found" | "not_applicable";

export interface RelationshipSupport {
  participants: Participants;
  /** Which entity the quote mentions first, when it mentions both. */
  order: "source_first" | "target_first" | "unknown";
  wording: Wording;
  /** True when the reader should check the quote before relying on the relationship type. */
  review: boolean;
  notes: string[];
}

export interface Party {
  name: string;
  type: EntityType;
  address?: string | null;
}

const ACCUSATORY = new Set<RelationshipPredicate>(["threatens", "alleges_against"]);
const SYMMETRIC = new Set<RelationshipPredicate>(["related_to"]);

const THREAT_CUE =
  /\b(?:threat\w*|regret|sorry|careful|warn\w*|harm\w*|hurt\w*|retaliat\w*|consequences?|or else|expos\w+|destroy\w*|ruin\w*|come after|watch your back|know where|won'?t like|if you don'?t|or you|sue|lawsuit|legal action|report you|make you pay|pay for)\b/i;
const ALLEGE_CUE =
  /\b(?:alleg\w*|accus\w*|claim\w*|misconduct|harass\w*|fraud\w*|falsif\w*|embezzl\w*|violat\w*|illegal\w*|unethical|complain\w*|inappropriate|discriminat\w*|bribe\w*|kickback\w*|concern\w*|irregularit\w*|manipulat\w*|misstat\w*|cooking|retaliat\w*|report\w*)\b/i;
const NEGATION = /\b(?:not|no|never|without|cannot|neither|nor|nothing)\b|n['’]t\b/i;
const STOP = new Set(["inc", "llc", "ltd", "corp", "company", "limited", "the", "and", "group", "holdings"]);

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

/** Surface forms by which a party could be named in a quote. */
function surfaces(p: Party): string[] {
  const full = norm(p.name);
  const out = new Set<string>();
  if (full.length >= 3) out.add(full);
  if (p.address) out.add(norm(p.address));
  if (p.type === "person" || p.type === "organization") {
    for (const tok of full.split(/[^a-z0-9@.'-]+/)) {
      const t = tok.replace(/^[.'-]+|[.'-]+$/g, "");
      if (t.length >= 4 && !STOP.has(t)) out.add(t);
    }
  }
  return [...out];
}

function firstIndex(quote: string, forms: string[]): number {
  let best = -1;
  for (const f of forms) {
    const i = quote.indexOf(f);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
}

function wordingOf(predicate: RelationshipPredicate, quote: string): Wording {
  if (!ACCUSATORY.has(predicate)) return "not_applicable";
  const cue = predicate === "threatens" ? THREAT_CUE : ALLEGE_CUE;
  const m = cue.exec(quote);
  if (!m) return "none_found";
  const before = quote.slice(Math.max(0, m.index - 28), m.index);
  return NEGATION.test(before) ? "negated" : "present";
}

export function assessRelationshipSupport(args: {
  predicate: RelationshipPredicate;
  source: Party;
  target: Party;
  quote: string;
  /** The cited snippet is the message's header block (it implies sender and recipient). */
  fromHeader: boolean;
}): RelationshipSupport {
  const q = norm(args.quote);
  const si = firstIndex(q, surfaces(args.source));
  const ti = firstIndex(q, surfaces(args.target));
  const participants: Participants =
    si >= 0 && ti >= 0 ? "both" : si >= 0 ? "source_only" : ti >= 0 ? "target_only" : args.fromHeader ? "header" : "none";
  const order: RelationshipSupport["order"] = si >= 0 && ti >= 0 ? (si <= ti ? "source_first" : "target_first") : "unknown";
  const wording = wordingOf(args.predicate, q);

  const notes: string[] = [];
  if (participants === "none") notes.push("The quote does not name either entity.");
  else if (participants === "source_only") notes.push("The quote names only the first entity.");
  else if (participants === "target_only") notes.push("The quote names only the second entity.");
  if (wording === "none_found") notes.push("No wording in the quote clearly indicates this kind of claim.");
  if (wording === "negated") notes.push("The wording that suggests this claim appears next to a negation.");
  if (order === "target_first" && !SYMMETRIC.has(args.predicate) && ACCUSATORY.has(args.predicate)) {
    notes.push("The quote mentions the second entity first, so the direction may be reversed.");
  }

  const accusatory = ACCUSATORY.has(args.predicate);
  const review = accusatory
    ? wording !== "present" || participants === "none" || order === "target_first"
    : participants === "none";
  return { participants, order, wording, review, notes };
}
