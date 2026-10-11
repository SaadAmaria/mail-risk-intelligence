import type {
  AnalysisRecord,
  EntityType,
  Extraction,
  RelationshipPredicate,
  RiskAnalysis,
} from "@mri/shared";
import { normalizeVendorName } from "./vendor";

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
  evidence: { email_id: string; snippet_id: string; quote: string }[];
  count: number;
  origin: "ai";
}

export interface EntityGraphData {
  entities: CanonicalEntity[];
  relationships: AggregatedRelationship[];
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

function keyFor(
  e: RawEntity,
  ownerKeyByRef: Map<string, string>,
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
      const norm = normalizeVendorName(e.name);
      return norm ? { key: `organization:name:${norm}`, basis: "organization_name" } : scoped();
    }
    case "account": {
      const digits = (e.name.match(/\d{3,}/g) ?? []).at(-1) ?? null;
      const owner = ownerKeyByRef.get(`${e.email_id}|${e.ref}`);
      if (digits && owner) return { key: `account:${digits}@${owner}`, basis: "account_with_owner" };
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
    // Header display names of THIS email, so an AI-named person that exactly equals one of them
    // resolves to that header's address. Exact (normalized) equality within one email only.
    const headerAddressByName = new Map<string, string | null>();
    // Addresses this email itself contains: its headers and its evidence snippets.
    const verified = new Set<string>();
    if (a.extraction) {
      for (const p of [a.extraction.sender, ...a.extraction.recipients]) if (p) verified.add(p.address.toLowerCase());
      for (const s of a.extraction.evidence_snippets) {
        for (const m of s.text.matchAll(new RegExp(EMAIL_IN_TEXT.source, "gi"))) verified.add(m[0].toLowerCase());
      }
      raws.push(...entitiesFromExtraction(a.email_id, a.extraction));
      for (const p of [a.extraction.sender, ...a.extraction.recipients]) {
        if (!p?.name) continue;
        const n = normalizePersonName(p.name);
        // Two different addresses sharing one display name make the name ambiguous: no mapping.
        headerAddressByName.set(n, headerAddressByName.has(n) ? null : p.address.toLowerCase());
      }
    }
    if (a.status === "complete" && a.assessment && (a.provenance === "live" || a.provenance === "recorded")) {
      relsByEmail.push({ email_id: a.email_id, assessment: a.assessment });
      for (const e of a.assessment.entities) {
        let attributes = e.attributes;
        let verifiedEmail: string | null = null;
        if (e.type === "person") {
          // A candidate address (model attribute, an address written as the name, or the header
          // address whose display name this exactly equals) counts only if the email contains it.
          const candidates = [
            typeof attributes?.email === "string" ? attributes.email : null,
            EMAIL_IN_TEXT.exec(e.name)?.[0] ?? null,
            headerAddressByName.get(normalizePersonName(e.name)) ?? null,
          ];
          for (const c of candidates) {
            if (c && verified.has(c.toLowerCase())) {
              verifiedEmail = c.toLowerCase();
              break;
            }
          }
          if (verifiedEmail && typeof attributes?.email !== "string") {
            attributes = { ...(attributes ?? {}), email: verifiedEmail };
          }
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

  // Pass 1: which organization (by key) owns each account ref in each email, from
  // validated owns_account relationships only.
  const orgKeyByRef = new Map<string, string>();
  for (const r of raws) {
    if (r.type === "organization") {
      orgKeyByRef.set(`${r.email_id}|${r.ref}`, `organization:name:${normalizeVendorName(r.name)}`);
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
    const { key, basis } = keyFor(r, ownerKeyByRef);
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
  for (const { email_id, assessment } of relsByEmail) {
    for (const rel of assessment.relationships) {
      const source = keyOfRef.get(`${email_id}|${rel.from_ref}`);
      const target = keyOfRef.get(`${email_id}|${rel.to_ref}`);
      if (!source || !target || source === target) continue;
      const key = `${source}|${rel.predicate}|${target}`;
      let agg = rels.get(key);
      if (!agg) {
        agg = { key, predicate: rel.predicate, source, target, email_ids: [], evidence: [], count: 0, origin: "ai" };
        rels.set(key, agg);
      }
      agg.count++;
      if (!agg.email_ids.includes(email_id)) agg.email_ids.push(email_id);
      agg.evidence.push({ email_id, snippet_id: rel.snippet_id, quote: rel.quote });
    }
  }

  const sortedEntities = [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  for (const e of sortedEntities) e.email_ids.sort();
  return {
    entities: sortedEntities,
    relationships: [...rels.values()].sort((a, b) => (a.key < b.key ? -1 : 1)),
  };
}
