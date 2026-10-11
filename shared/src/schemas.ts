import { z } from "zod";
import { HeaderField } from "./email";

// ---- Shared enums -------------------------------------------------------

export const RISK_LEVELS = ["none", "low", "medium", "high"] as const;
export const RiskLevel = z.enum(RISK_LEVELS);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const ANALYSIS_STATUSES = [
  "queued",
  "extracting",
  "analyzing",
  "complete",
  "partial",
  "degraded",
  "failed",
] as const;
export const AnalysisStatus = z.enum(ANALYSIS_STATUSES);
export type AnalysisStatus = z.infer<typeof AnalysisStatus>;

export const PROVENANCES = ["live", "recorded", "rules"] as const;
export const Provenance = z.enum(PROVENANCES);
export type Provenance = z.infer<typeof Provenance>;

export const RISK_TAGS = [
  "urgency",
  "financial-anomaly",
  "payment-redirect",
  "impersonation",
  "phishing",
  "threat-language",
  "harassment",
  "mnpi-risk",
  "data-exfiltration",
  "insider-threat",
  "policy-circumvention",
  "misconduct-allegation",
  "confidentiality-concern",
] as const;
export const RiskTag = z.enum(RISK_TAGS);
export type RiskTag = z.infer<typeof RiskTag>;

export const ENTITY_TYPES = ["person", "organization", "amount", "account", "location"] as const;
export const EntityType = z.enum(ENTITY_TYPES);
export type EntityType = z.infer<typeof EntityType>;

export const RELATIONSHIP_PREDICATES = [
  "employed_by",
  "sent_email_to",
  "requests_transfer_to",
  "impersonates",
  "owns_account",
  "invoices",
  "shares_information_with",
  "threatens",
  "alleges_against",
  "instructs",
  "related_to",
] as const;
export const RelationshipPredicate = z.enum(RELATIONSHIP_PREDICATES);
export type RelationshipPredicate = z.infer<typeof RelationshipPredicate>;

// ---- Agent A: Extraction ------------------------------------------------

export const EvidenceLocation = z.object({
  where: z.enum(["header", "body", "attachment"]),
  filename: z.string().optional(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});
export type EvidenceLocation = z.infer<typeof EvidenceLocation>;

export const EvidenceSnippet = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(300),
  location: EvidenceLocation,
  origin: z.enum(["llm", "rules"]).default("llm"),
});
export type EvidenceSnippet = z.infer<typeof EvidenceSnippet>;

const Address = z.object({ address: z.string().min(1), name: z.string().nullable() });

export const ExtractionSchemaVersion = 1 as const;

export const Extraction = z.object({
  schema_version: z.literal(ExtractionSchemaVersion),
  // Header fields come from the Phase 1 normalized email (code is the source of truth) and are
  // explicitly null/empty when the source had no such header: nothing is invented.
  sender: Address.nullable(),
  recipients: z.array(Address),
  date: z.string().nullable(),
  subject: z.string().nullable(),
  missing_headers: z.array(HeaderField),
  summary: z.string().max(400),
  facts: z.object({
    amounts: z.array(
      z.object({
        value: z.number(),
        currency: z.string(),
        context: z.string(),
        snippet_id: z.string().optional(),
      }),
    ),
    dates: z.array(
      z.object({ value: z.string(), context: z.string(), snippet_id: z.string().optional() }),
    ),
    references: z.array(
      z.object({
        kind: z.enum(["invoice", "account", "routing", "url", "phone", "other"]),
        value: z.string(),
        context: z.string(),
        snippet_id: z.string().optional(),
      }),
    ),
    attachments: z.array(z.object({ filename: z.string(), summary: z.string() })),
  }),
  evidence_snippets: z.array(EvidenceSnippet).max(24),
  notes: z.array(z.string()),
});
export type Extraction = z.infer<typeof Extraction>;

// ---- Agent B: Risk & Graph ---------------------------------------------
// Input to Agent B is exactly a validated `Extraction`. Evidence cites A's
// snippet ids; quotes must be substrings of the cited snippet (enforced in
// the Phase 2 validator, not by this schema alone).

export const RiskAnalysisSchemaVersion = 1 as const;

export const RiskAnalysis = z.object({
  schema_version: z.literal(RiskAnalysisSchemaVersion),
  risk: z.object({
    level: RiskLevel,
    rationale: z.string().max(500),
    tags: z.array(RiskTag),
    evidence: z.array(z.object({ snippet_id: z.string(), quote: z.string().min(1) })),
    confidence: z.enum(["low", "medium", "high"]),
  }),
  entities: z.array(
    z.object({
      ref: z.string().min(1),
      type: EntityType,
      name: z.string().min(1),
      attributes: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    }),
  ),
  relationships: z.array(
    z.object({
      from_ref: z.string(),
      predicate: RelationshipPredicate,
      to_ref: z.string(),
      snippet_id: z.string(),
      quote: z.string().min(1),
    }),
  ),
});
export type RiskAnalysis = z.infer<typeof RiskAnalysis>;
