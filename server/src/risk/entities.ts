import type {
  AnalysisRecord,
  EntityType,
  Extraction,
  RelationshipPredicate,
  RiskAnalysis,
} from "@mri/shared";
import { checkRelationship } from "./relationshipRules";
import { assessRelationshipSupport, type RelationshipSupport } from "./relationshipSupport";
import { splitLegalSuffix } from "./vendor";

/**
 * Entity identity and relationship aggregation: the data foundation for a cross-email graph.
 * Pure and derived at read time; nothing here is persisted or calls a model.
 *
 * Identity is conservative on purpose. A WRONG merge asserts something false (two different
 * people are one node); a missed merge only leaves two nodes apart. So:
 *   - no fuzzy matching of any kind, and no first-name-only merging;
 *   - a person merges across emails ONLY on an identical, verified e-mail address (one that
 *     appears in that email's own headers or evidence text). A name is never an identifier:
 *     two different people can share a full name, and a model-asserted address that the email
 *     does not contain is not trusted. Without a verified address a person stays scoped to the
 *     one email they were mentioned in;
 *   - an account is identified by its number plus the organization that owns it (via an
 *     `owns_account` relationship); an account with no known owner stays scoped to its email;
 *   - amounts are never merged across emails.
 */

export type EntityOrigin = "ai" | "rules";

export interface Mention {
  email_id: string;
  ref: string | null;
  surface_form: string;
  origin: EntityOrigin;
  /** Evidence snippet id of the source email's extraction, when known. */
  snippet_id: string | null;
}

export interface CanonicalEntity {
  key: string;
  type: EntityType;
  display_name: string;
  /** How the key was derived: strongest identifier available. */
  key_basis: "email_address" | "organization_name" | "account_with_owner" | "location_name" | "email_scoped";
  /** "ai" when any mention came from a validated AI assessment, else "rules". */
  origin: EntityOrigin;
  email_ids: string[];
  mentions: Mention[];
}

export interface AggregatedRelationship {
  key: string;
  predicate: RelationshipPredicate;
  source: string;
  target: string;
  email_ids: string[];
  /** Verified quotes, one per supporting email. */
  evidence: { email_id: string; snippet_id: string; quote: string; support: RelationshipSupport }[];
  /** True when any citation is weakly related to the relationship type (advisory, see relationshipSupport.ts). */
  review: boolean;
  count: number;
  origin: "ai";
}

export interface EntityGraphData {
  entities: CanonicalEntity[];
  relationships: AggregatedRelationship[];
  /**
   * Stored relationships left out at read time because they are structurally impossible under the
   * current rules (for example a legacy analysis accepted before they existed). The stored analysis
   * is not modified.
   */
  excluded_relationships: number;
}

const TITLE = /^(?:mr|mrs|ms|miss|dr|prof|sir)\.?\s+/i;

export function normalizePersonName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(TITLE, "")
    .replace(/[.,'ג€™"()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


const EMAIL_IN_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/**
 * "Name <address>", "Name (address)", "Name at address", "Name, address", "Name - address": a name
 * of one to four capitalized words immediately followed by an address. Anything looser is mere
 * co-occurrence and is not an association. (The name part is case-sensitive on purpose.)
 */
const NAME_ADDRESS =
  /((?:[A-Z][\w.'’-]*\s+){0,3}[A-Z][\w.'’-]*)(?:\s*<\s*|\s*\(\s*|\s*,\s*|\s+at\s+|\s+[-–:]\s+)([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

interface RawEntity {
  email_id: string;
  ref: string;
  type: EntityType;
  name: string;
  attributes?: Record<string, string | number>;
  origin: EntityOrigin;
  snippet_id: string | null;
  /** An address for this person that the SAME email's headers or evidence text contain. */
  verified_email: string | null;
}

/** Entities that code can read straight from the extraction (header addresses). */
export function entitiesFromExtraction(emailId: string, x: Extraction): RawEntity[] {
  const out: RawEntity[] = [];
  const add = (a: { address: string; name: string | null } | null, role: string) => {
    if (!a) return;
    out.push({
      email_id: emailId,
      ref: `${role}:${a.address.toLowerCase()}`,
      type: "person",
      name: a.name?.trim() || a.address,
      attributes: { email: a.address.toLowerCase() },
      origin: "rules",
      snippet_id: null,
      verified_email: a.address.toLowerCase(), // read from the header itself
    });
  };
  add(x.sender, "sender");
  x.recipients.forEach((r) => add(r, "recipient"));
  return out;
}

/**
 * Facts about the whole set of mentions that decide whether a weak identity is ambiguous. They are
 * computed from every analysis (order-independent) before any key is assigned.
 */
interface IdentityContext {
  /** Organization base name -> the distinct legal-form classes seen for it. */
  orgForms: Map<string, Set<string>>;
}

/**
 * Organization identity. The legal-form suffix is ignored ("Acme" = "Acme Inc.") UNLESS the data
 * itself contains two different legal forms of the same base ("Acme Inc." and "Acme LLC"): those
 * are distinct legal entities, so each keeps its own node. A name without a suffix stays with the
 * base (it is not guessed to be either).
 */
function orgKey(name: string, ctx: IdentityContext): string | null {
  const { base, suffix } = splitLegalSuffix(name);
  if (!base) return null;
  const forms = ctx.orgForms.get(base);
  return suffix && forms && forms.size > 1 ? `organization:name:${base} ${suffix}` : `organization:name:${base}`;
}

const MASK_WORDS = /\b(?:account|acct|number|no|num|ending|ends|in|with|last|digits|xxxx|x+)\b|[#*.\-:\/]/gi;
/** The descriptive words of an account mention ("checking ending 1234" -> "checking"). */
/** A masked mention: it says "ending/last/x" or carries fewer digits than a complete number. */
function isMaskedAccount(name: string, digits: string): boolean {
  return digits.length < 8 || /\b(?:ending|ends|last)\b|x{2,}|\*{2,}|[\u2022\u2026]/i.test(name);
}

function accountSurface(name: string): string {
  return name.toLowerCase().replace(/\d+/g, " ").replace(MASK_WORDS, " ").replace(/\s+/g, " ").trim();
}

function keyFor(
  e: RawEntity,
  ownerKeyByRef: Map<string, string>,
  ctx: IdentityContext,
): { key: string; basis: CanonicalEntity["key_basis"] } {
  const scoped = (basis: CanonicalEntity["key_basis"] = "email_scoped") => ({
    key: `${e.type}:email:${e.email_id}:${e.name.toLowerCase().replace(/\s+/g, " ").trim()}`,
    basis,
  });

  switch (e.type) {
    case "person": {
      if (e.verified_email) return { key: `person:email:${e.verified_email}`, basis: "email_address" };
      return scoped(); // no verified address: never merged with anyone in another email
    }
    case "organization": {
      const key = orgKey(e.name, ctx);
      return key ? { key, basis: "organization_name" } : scoped();
    }
    case "account": {
      const digits = (e.name.match(/\d{3,}/g) ?? []).at(-1) ?? null;
      const owner = ownerKeyByRef.get(`${e.email_id}|${e.ref}`);
      if (digits && owner) {
        // A complete account number identifies the account (with its owner). The LAST DIGITS of a
        // masked number do not: two accounts of one owner can share them. A masked mention is
        // therefore merged only with another mention that describes it the same way ("checking
        // account ending 1234" with the same; a bare "account ending 6621" with a bare one). A bare
        // mention and a described one, or two different descriptions, stay separate.
        const base = `account:${digits}@${owner}`;
        if (!isMaskedAccount(e.name, digits)) return { key: base, basis: "account_with_owner" };
        const surface = accountSurface(e.name);
        return { key: surface ? `${base}#${surface}` : base, basis: "account_with_owner" };
      }
      return scoped();
    }
    case "location": {
      const norm = e.name.toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
      return norm ? { key: `location:name:${norm}`, basis: "location_name" } : scoped();
    }
    default:
      return scoped(); // amounts: never merged
  }
}

/**
 * Build canonical entities and aggregated relationships from stored analyses.
 *
 * Only `complete` analyses with a validated assessment contribute AI entities and
 * relationships; those were already grounded in the email by Phase 2 validation, so no
 * unverified relationship is added here. Rule-derived person entities (header addresses)
 * come from any analysis that has an extraction and keep `origin: "rules"`.
 */
export function buildEntityGraph(analyses: AnalysisRecord[]): EntityGraphData {
  const raws: RawEntity[] = [];
  const relsByEmail: { email_id: string; assessment: RiskAnalysis }[] = [];

  for (const a of [...analyses].sort((x, y) => (x.email_id < y.email_id ? -1 : 1))) {
    // Address <-> display-name pairs that THIS email itself states: its header fields and any
    // "Name <address>" written in its evidence text. A name paired with two different addresses is
    // ambiguous and is paired with none. The only association ever made is an exact (normalized)
    // name match against one of these pairs: an address that merely appears somewhere in the same
    // message does NOT identify a person.
    const pairedAddressByName = new Map<string, string | null>();
    const pair = (name: string | null | undefined, address: string) => {
      if (!name) return;
      const n = normalizePersonName(name);
      if (!n) return;
      const addr = address.toLowerCase();
      const had = pairedAddressByName.get(n);
      pairedAddressByName.set(n, had === undefined || had === addr ? addr : null);
    };
    // Addresses this email itself contains (headers, evidence text): consulted only for the case
    // where the entity's own name IS an address.
    const verified = new Set<string>();
    if (a.extraction) {
      for (const p of [a.extraction.sender, ...a.extraction.recipients]) {
        if (!p) continue;
        verified.add(p.address.toLowerCase());
        pair(p.name, p.address);
      }
      for (const s of a.extraction.evidence_snippets) {
        for (const m of s.text.matchAll(new RegExp(EMAIL_IN_TEXT.source, "gi"))) verified.add(m[0].toLowerCase());
        for (const m of s.text.matchAll(NAME_ADDRESS)) {
          // A sentence-initial capitalised word ("Copying Priya Nair (...)") can precede the name, so
          // every trailing run of at least two words is a candidate name too. A single word is
          // paired only when it is the whole captured name.
          const words = m[1]!.trim().split(/\s+/);
          if (words.length === 1) pair(words[0], m[2]!);
          for (let i = 0; i + 2 <= words.length; i++) pair(words.slice(i).join(" "), m[2]!);
        }
      }
      raws.push(...entitiesFromExtraction(a.email_id, a.extraction));
    }
    if (a.status === "complete" && a.assessment && (a.provenance === "live" || a.provenance === "recorded")) {
      relsByEmail.push({ email_id: a.email_id, assessment: a.assessment });
      for (const e of a.assessment.entities) {
        let attributes = e.attributes;
        let verifiedEmail: string | null = null;
        if (e.type === "person") {
          // 1. the entity's name is itself an address that this email contains;
          // 2. otherwise its name exactly matches a name/address pair the email states.
          // A model-supplied `attributes.email` is NOT evidence: it never identifies anyone on its
          // own, and is ignored for identity when it does not agree with one of the above.
          const named = EMAIL_IN_TEXT.exec(e.name)?.[0]?.toLowerCase() ?? null;
          const paired = pairedAddressByName.get(normalizePersonName(e.name)) ?? null;
          verifiedEmail = named && verified.has(named) ? named : paired;
          if (verifiedEmail) attributes = { ...(attributes ?? {}), email: verifiedEmail };
        }
        raws.push({
          email_id: a.email_id,
          ref: e.ref,
          type: e.type,
          name: e.name,
          attributes,
          origin: "ai",
          snippet_id: null,
          verified_email: verifiedEmail,
        });
      }
    }
  }

  // Identity context: which weak identities the data itself shows to be ambiguous.
  const ctx: IdentityContext = { orgForms: new Map() };
  for (const r of raws) {
    if (r.type !== "organization") continue;
    const { base, suffix } = splitLegalSuffix(r.name);
    if (!base || !suffix) continue;
    (ctx.orgForms.get(base) ?? ctx.orgForms.set(base, new Set()).get(base)!).add(suffix);
  }

  // Pass 1: which organization (by key) owns each account ref in each email, from
  // validated owns_account relationships only.
  const orgKeyByRef = new Map<string, string>();
  for (const r of raws) {
    if (r.type === "organization") {
      const k = orgKey(r.name, ctx);
      if (k) orgKeyByRef.set(`${r.email_id}|${r.ref}`, k);
    }
  }
  const ownerKeyByRef = new Map<string, string>();
  for (const { email_id, assessment } of relsByEmail) {
    for (const rel of assessment.relationships) {
      if (rel.predicate !== "owns_account") continue;
      const owner = orgKeyByRef.get(`${email_id}|${rel.from_ref}`);
      if (owner) ownerKeyByRef.set(`${email_id}|${rel.to_ref}`, owner);
    }
  }

  // Pass 2: canonical entities.
  const byKey = new Map<string, CanonicalEntity>();
  const keyOfRef = new Map<string, string>();
  for (const r of raws) {
    const { key, basis } = keyFor(r, ownerKeyByRef, ctx);
    keyOfRef.set(`${r.email_id}|${r.ref}`, key);
    let ent = byKey.get(key);
    if (!ent) {
      ent = { key, type: r.type, display_name: r.name, key_basis: basis, origin: r.origin, email_ids: [], mentions: [] };
      byKey.set(key, ent);
    }
    if (r.origin === "ai") ent.origin = "ai";
    if (!ent.email_ids.includes(r.email_id)) ent.email_ids.push(r.email_id);
    ent.mentions.push({
      email_id: r.email_id,
      ref: r.ref,
      surface_form: r.name,
      origin: r.origin,
      snippet_id: r.snippet_id,
    });
  }

  // Relationships, aggregated by (source, predicate, target).
  const rels = new Map<string, AggregatedRelationship>();
  let excluded = 0;
  const analysisByEmail = new Map(analyses.map((x) => [x.email_id, x]));
  for (const { email_id, assessment } of relsByEmail) {
    const entityByRef = new Map(assessment.entities.map((x) => [x.ref, x]));
    const snippets = new Map((analysisByEmail.get(email_id)?.extraction?.evidence_snippets ?? []).map((s) => [s.id, s]));
    for (const rel of assessment.relationships) {
      const source = keyOfRef.get(`${email_id}|${rel.from_ref}`);
      const target = keyOfRef.get(`${email_id}|${rel.to_ref}`);
      if (!source || !target || source === target) continue;
      const from = entityByRef.get(rel.from_ref);
      const to = entityByRef.get(rel.to_ref);
      // Legacy policy: the structural rules apply at read time too, so an analysis stored under older
      // rules cannot present an impossible relationship. It is counted, never silently rewritten.
      if (!from || !to || !checkRelationship(rel.predicate, from.type, to.type, rel.quote, false).ok) {
        excluded++;
        continue;
      }
      const support = assessRelationshipSupport({
        predicate: rel.predicate,
        source: { name: from.name, type: from.type, address: typeof from.attributes?.email === "string" ? from.attributes.email : null },
        target: { name: to.name, type: to.type, address: typeof to.attributes?.email === "string" ? to.attributes.email : null },
        quote: rel.quote,
        fromHeader: snippets.get(rel.snippet_id)?.location.where === "header",
      });
      const key = `${source}|${rel.predicate}|${target}`;
      let agg = rels.get(key);
      if (!agg) {
        agg = { key, predicate: rel.predicate, source, target, email_ids: [], evidence: [], review: false, count: 0, origin: "ai" };
        rels.set(key, agg);
      }
      agg.count++;
      if (!agg.email_ids.includes(email_id)) agg.email_ids.push(email_id);
      agg.evidence.push({ email_id, snippet_id: rel.snippet_id, quote: rel.quote, support });
      if (support.review) agg.review = true;
    }
  }

  const sortedEntities = [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  for (const e of sortedEntities) e.email_ids.sort();
  return {
    entities: sortedEntities,
    relationships: [...rels.values()].sort((a, b) => (a.key < b.key ? -1 : 1)),
    excluded_relationships: excluded,
  };
}
