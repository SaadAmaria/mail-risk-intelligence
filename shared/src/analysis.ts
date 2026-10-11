import type { AnalysisStatus, Extraction, Provenance, RiskAnalysis } from "./schemas";

/** Token accounting as reported by the provider; null when the provider omits it. */
export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  reasoning_tokens: number | null;
}

export type StageName = "extraction" | "risk";

export interface StageLog {
  stage: StageName;
  outcome: "ok" | "failed" | "skipped";
  /** Provider calls made for this stage, including repair attempts. */
  calls: number;
  error_kind: string | null;
  /** Sanitized: never contains credentials or email content. */
  error_message: string | null;
  usage: TokenUsage | null;
  latency_ms: number | null;
  /** Number of unsupported claims dropped during validation. */
  dropped_items: number;
}

export type RunOutcome = "complete" | "partial" | "degraded" | "failed" | "interrupted";

export interface RunLog {
  started_at: string;
  finished_at: string | null;
  outcome: RunOutcome | null;
  stages: StageLog[];
}

/**
 * Persisted analysis of one email. Invariants (enforced on write):
 * - `assessment` is present only when status is `complete`;
 * - `none` risk can therefore only come from a fully validated, complete AI analysis;
 * - `partial`, `degraded` and `failed` carry no assessment and must never be shown as safe.
 */
export interface AnalysisRecord {
  email_id: string;
  status: AnalysisStatus;
  /** Equals the terminal status once the run finished; null while in progress. */
  analysis_mode: AnalysisStatus | null;
  provenance: Provenance | null;
  extraction: Extraction | null;
  assessment: RiskAnalysis | null;
  warnings: string[];
  runs: RunLog[];
  model: string | null;
  prompt_version: string | null;
  updated_at: string;
}

export const MAX_RUN_LOGS = 10;
