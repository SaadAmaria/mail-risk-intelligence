import type { AnalysisStatus } from "./schemas";
import type { RiskLevel } from "./schemas";

// ---- Derived, read-time risk intelligence (never persisted, never sent back to the LLM) ----

/** `unassessed` means no validated AI assessment exists. It is never rendered as "none". */
export type FinalRiskLevel = RiskLevel | "unassessed";

/** Deterministic rules can only ever reach `medium`. */
export type RulesLevel = "none" | "low" | "medium";

export const INDICATOR_CATEGORIES = [
  "observation", // verified structural/document facts (look-alike domains, amount anomaly...)
  "payment_redirect", // payment destination differs from what prior invoices show
  "action", // asks for money, changed bank details, credentials
  "pressure", // urgency, secrecy
  "impersonation", // authority claim from a look-alike domain
  "information", // inside information, confidential material to a personal address
  "threat", // threatening language
  "tampering", // text aimed at manipulating automated review
] as const;
export type IndicatorCategory = (typeof INDICATOR_CATEGORIES)[number];

/** A located piece of source text supporting an indicator or finding. */
export interface EvidenceRef {
  email_id: string;
  where: "header" | "body" | "attachment";
  filename?: string;
  start: number;
  end: number;
  text: string;
}

export type VendorIdentity = "consistent" | "tentative";

/**
 * Evidence, not proof. Every indicator carries located evidence; one without evidence is never
 * produced.
 */
export interface RiskIndicator {
  id: string;
  rule_id: string;
  category: IndicatorCategory;
  label: string;
  detail: string;
  evidence: EvidenceRef[];
  related_email_ids: string[];
  /** Only set for cross-email indicators. */
  identity?: VendorIdentity;
  /** Whether this indicator's category counts toward the medium threshold. */
  counts_toward_medium: boolean;
  /** A single indicator that is specific enough to justify `medium` on its own. */
  sufficient_for_medium: boolean;
}

export type CrossEmailRule = "payment_account_changed" | "invoice_amount_anomaly";

export interface CrossEmailFinding {
  id: string;
  rule_id: CrossEmailRule;
  /** The later-dated email the finding is about. */
  email_id: string;
  /** Earlier emails used as the baseline. */
  related_email_ids: string[];
  /** `consistent` = same sender domain AND same vendor name in the documents; otherwise tentative. */
  identity: VendorIdentity;
  vendor: { name: string | null; domain: string | null };
  summary: string;
  values: Record<string, string | number | boolean | null | string[] | number[]>;
  evidence: EvidenceRef[];
}

export interface Escalation {
  rule_id: string;
  from: FinalRiskLevel;
  to: FinalRiskLevel;
  rationale: string;
  indicator_ids: string[];
}

export interface Disagreement {
  direction: "ai_lower" | "ai_higher";
  ai_level: RiskLevel;
  rules_level: RulesLevel;
  needs_review: boolean;
  summary: string;
}

export interface RiskView {
  email_id: string;
  /** True only when a validated, grounded AI assessment exists. */
  assessed: boolean;
  ai_status: AnalysisStatus | null;
  /** The validated AI level, kept separate from the rules and final levels. */
  ai_level: RiskLevel | null;
  rules_level: RulesLevel;
  final_level: FinalRiskLevel;
  basis: "ai_and_rules" | "rules_only" | "unassessed";
  escalated: boolean;
  escalations: Escalation[];
  disagreement: Disagreement | null;
  indicators: RiskIndicator[];
  findings: CrossEmailFinding[];
}
