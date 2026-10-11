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

/**
 * `error_kind` of the skipped risk stage of a run that was an explicit "automatic checks" request.
 * It is how a client tells that deliberate, rules-only run from a degraded run caused by an AI
 * failure or by there being no AI at all.
 */
export const AUTOMATIC_CHECKS_STAGE_KIND = "automatic_checks_only";

/** True for a run that was an explicit automatic-checks request (no AI was ever involved). */
export function isAutomaticChecksRunLog(run: RunLog): boolean {
  return run.stages.some((s) => s.stage === "risk" && s.error_kind === AUTOMATIC_CHECKS_STAGE_KIND);
}

/**
 * Runs that count against the automatic AI retry allowance: every run EXCEPT one explicitly marked
 * as an automatic-checks request. Historical degraded runs that were not so marked still count,
 * exactly as before. The full run history and `run_count` are unaffected.
 */
export function aiAttempts(runs: readonly RunLog[]): number {
  return runs.filter((r) => !isAutomaticChecksRunLog(r)).length;
}

/**
 * Whether an explicit automatic-checks request would add something and be accepted. Mirrors the
 * server's own refusals (a complete analysis and an AI-produced extraction are never replaced) and
 * treats an existing rules-only result as nothing left to do.
 */
export function canRunAutomaticChecks(a: AnalysisRecord | null, inProgress: boolean): boolean {
  if (inProgress) return false;
  if (!a) return true;
  if (a.status === "complete") return false;
  if (a.extraction && a.provenance !== "rules") return false;
  if (a.status === "degraded" && a.provenance === "rules" && a.extraction) return false;
  return true;
}

/** True when the most recent run of an analysis was an explicit automatic-checks request. */
export function isAutomaticChecksRun(runs: readonly RunLog[]): boolean {
  const last = runs[runs.length - 1];
  return !!last && last.stages.some((s) => s.stage === "risk" && s.error_kind === AUTOMATIC_CHECKS_STAGE_KIND);
}
