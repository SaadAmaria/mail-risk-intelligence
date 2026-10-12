import type { AnalysisRecord, RunLog } from "./analysis";
import type { HeaderField, MailboxAddress, NormalizedAttachment, SourceKind, StoredReadIssue } from "./email";
import type { FinalRiskLevel, RiskView, RulesLevel } from "./risk";
import type {
  AnalysisStatus,
  EntityType,
  Extraction,
  Provenance,
  RelationshipPredicate,
  RiskAnalysis,
  RiskLevel,
} from "./schemas";

// Response contracts of the mailbox REST API. Types only (the server builds them, a client reads
// them); they describe derived read-time views, none of which is persisted.

/** `not_started` = no analysis exists. It is never a safe state. */
export type ProcessingStatus = AnalysisStatus | "not_started";

export interface ProcessingSummary {
  status: ProcessingStatus;
  analysis_mode: AnalysisStatus | null;
  provenance: Provenance | null;
  model: string | null;
  prompt_version: string | null;
  updated_at: string | null;
  /** Waiting in, or running from, the in-process queue right now. */
  in_progress: boolean;
  run_count: number;
  can_reprocess: boolean;
  /**
   * True when the latest run was an explicit rules-only request ("automatic checks"), as opposed to
   * a degraded run caused by an AI failure or by no AI being configured. Always `rules` provenance.
   */
  automatic_checks_only?: boolean;
  /** An explicit automatic-checks request would be accepted and would add something right now. */
  automatic_checks_available?: boolean;
}

export interface RiskSummary {
  /** `unassessed` is distinct from `none`: it means no validated AI assessment exists. */
  final_level: FinalRiskLevel;
  assessed: boolean;
  ai_level: RiskLevel | null;
  rules_level: RulesLevel;
  basis: RiskView["basis"];
  escalated: boolean;
  needs_review: boolean;
  indicator_count: number;
  finding_count: number;
}

export interface EmailListItem {
  id: string;
  from: MailboxAddress | null;
  subject: string | null;
  date: string | null;
  source_kind: SourceKind;
  attachment_count: number;
  missing_headers: HeaderField[];
  processing: ProcessingSummary;
  risk: RiskSummary;
}

export interface EmailListResponse {
  emails: EmailListItem[];
  /** Matches after filtering, before `limit`. */
  total: number;
  count: number;
}

export interface EmailDetailEntity {
  key: string;
  type: EntityType;
  display_name: string;
  origin: "ai" | "rules";
  key_basis: string;
  mentions: { surface_form: string; origin: "ai" | "rules"; ref: string | null }[];
  /** Other emails this identity is verified to appear in. */
  also_in: string[];
}

/**
 * An advisory, read-time observation about how a cited quote relates to a relationship. It is a
 * heuristic (English word lists, simple name matching) and is NOT verification of meaning.
 */
export interface RelationshipSupport {
  participants: "both" | "source_only" | "target_only" | "none" | "header";
  order: "source_first" | "target_first" | "unknown";
  wording: "present" | "negated" | "none_found" | "not_applicable";
  /** The reader should check the quote before relying on the relationship type. */
  review: boolean;
  notes: string[];
}

export interface EmailDetailRelationship {
  key: string;
  predicate: RelationshipPredicate;
  source: string;
  target: string;
  evidence: { snippet_id: string; quote: string; support?: RelationshipSupport }[];
  /** Any citation is weakly related to the type (advisory). */
  review?: boolean;
  also_in: string[];
}

export interface EmailDetailResponse {
  email: {
    id: string;
    external_id: string | null;
    source_kind: SourceKind;
    source_filename: string | null;
    from: MailboxAddress | null;
    to: MailboxAddress[];
    cc: MailboxAddress[];
    date: string | null;
    subject: string | null;
    body: string;
    body_truncated: boolean;
    missing_headers: HeaderField[];
    warnings: string[];
    attachments: NormalizedAttachment[];
    created_at: string;
    /** Stored list columns that could not be read in full; the lists above then are not complete. */
    read_issues?: StoredReadIssue[];
  };
  processing: ProcessingSummary & { warnings: string[]; runs: RunLog[] };
  extraction: Extraction | null;
  /** The validated AI assessment, present only when processing is `complete`. */
  assessment: RiskAnalysis | null;
  risk: RiskView;
  entities: EmailDetailEntity[];
  relationships: EmailDetailRelationship[];
}

export interface IngestResponse {
  id: string;
  /** False when identical content was already stored; `id` is then the existing email. */
  created: boolean;
  reason: "id_exists" | "duplicate_content" | null;
  source_kind: SourceKind;
  missing_headers: HeaderField[];
  warnings: string[];
  attachments: { filename: string; extraction_status: NormalizedAttachment["extraction_status"]; error_message: string | null }[];
  processing: ProcessingSummary;
  /** Present only when the request asked for analysis. */
  analysis?: { requested: true; result: string };
}

export interface ReprocessResponse {
  id: string;
  result: "queued";
  processing: ProcessingSummary;
}

/**
 * Response of `POST /api/emails/:id/automatic-checks` (HTTP 200). The request is synchronous and
 * never involves an AI provider. `performed`: this call stored the rules-only result.
 * `unchanged`: a rules-only result already existed and was left as it was.
 */
export interface AutomaticChecksResponse {
  id: string;
  result: "performed" | "unchanged";
  processing: ProcessingSummary;
}

export interface GraphNode {
  id: string;
  type: EntityType;
  label: string;
  origin: "ai" | "rules";
  key_basis: string;
  email_ids: string[];
  mention_count: number;
  /** Highest final risk level among the source emails (`unassessed` ranks below `low`). */
  max_risk: FinalRiskLevel;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  predicate: RelationshipPredicate;
  email_ids: string[];
  count: number;
  origin: "ai";
  evidence: { email_id: string; snippet_id: string; quote: string; support?: RelationshipSupport }[];
  /** Any citation is weakly related to the type (advisory; the relationship is not removed). */
  review?: boolean;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: {
    email_count: number;
    node_count: number;
    edge_count: number;
    /** What the graph is built from, so a reader does not over-trust it. */
    basis: string;
    /** Stored relationships left out because they are structurally impossible under current rules. */
    excluded_relationships?: number;
  };
}

export type { AnalysisRecord };
