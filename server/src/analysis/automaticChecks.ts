import {
  AUTOMATIC_CHECKS_STAGE_KIND,
  MAX_RUN_LOGS,
  type AnalysisRecord,
  type RunLog,
} from "@mri/shared";
import { buildDeterministicExtraction } from "../agents/extractionAgent";
import type { MailboxRepository } from "../storage/repository";

/**
 * Rules-only processing of one email ("automatic checks").
 *
 * SAFETY BOUNDARY. This module is the whole execution path of
 * `POST /api/emails/:id/automatic-checks` and it is deliberately incapable of reaching a model:
 *
 *   - its only collaborators are a repository and a function that says whether the email is
 *     queued or running elsewhere; there is no `LlmClient` parameter, field or import;
 *   - it never imports `analysis/service`, the provider client, the recorded client, the
 *     configuration loader or anything under `llm/` other than what the extraction module
 *     itself pulls in as types (asserted by a test that walks the static import graph);
 *   - the only agent code it uses is `buildDeterministicExtraction`, a pure function of the
 *     stored email.
 *
 * Whether a provider key is configured in this process is therefore irrelevant: the key lives in
 * an object this code is never given.
 *
 * What it writes: a `degraded` analysis with `rules` provenance, a deterministic extraction (the
 * header people, amounts, accounts and URLs found by code) and NO assessment. By the storage
 * invariants that can never read as "analyzed by AI" or as safe. Risk indicators and cross-email
 * findings are computed at read time from the stored emails and are unaffected by this write.
 *
 * What it refuses to touch: a complete analysis (live or recorded), and any analysis that holds
 * an AI-produced extraction. Those are never replaced by a rules-only record.
 */

export type AutomaticChecksResult =
  | { kind: "performed"; analysis: AnalysisRecord }
  | { kind: "unchanged"; analysis: AnalysisRecord }
  | { kind: "not_found" }
  | { kind: "busy" }
  | { kind: "complete" }
  | { kind: "ai_extraction_present" };

export interface AutomaticChecksOptions {
  /** True while the email is waiting in, or running from, the AI work queue. */
  isActive: (emailId: string) => boolean;
  now?: () => Date;
}

const WARNING = "Automatic checks only: no AI analysis was performed and nothing was sent to an AI provider.";
const MAX_WARNINGS = 50;

export class AutomaticChecks {
  private readonly now: () => Date;

  constructor(
    private readonly repo: MailboxRepository,
    private readonly options: AutomaticChecksOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Run the deterministic checks for one email. Synchronous on purpose: the read of the prior
   * state and the write of the result happen with no `await` between them, so two concurrent
   * HTTP requests are serialized by the event loop and cannot both write.
   */
  run(emailId: string): AutomaticChecksResult {
    const email = this.repo.getEmail(emailId);
    if (!email) return { kind: "not_found" };
    if (this.options.isActive(emailId)) return { kind: "busy" };

    const prior = this.repo.getAnalysis(emailId);
    if (prior?.status === "complete") return { kind: "complete" };
    // An extraction produced by a model (live or recorded, even without an assessment) is kept.
    if (prior?.extraction && prior.provenance !== "rules") return { kind: "ai_extraction_present" };
    // Already done: the result is a pure function of the stored email, so repeating it is a no-op.
    if (prior?.status === "degraded" && prior.provenance === "rules" && prior.extraction) {
      return { kind: "unchanged", analysis: prior };
    }

    const started = this.now().toISOString();
    const run: RunLog = {
      started_at: started,
      finished_at: started,
      outcome: "degraded",
      stages: [
        {
          stage: "extraction",
          outcome: "ok",
          calls: 0,
          error_kind: null,
          error_message: null,
          usage: null,
          latency_ms: null,
          dropped_items: 0,
        },
        {
          stage: "risk",
          outcome: "skipped",
          calls: 0,
          error_kind: AUTOMATIC_CHECKS_STAGE_KIND,
          error_message: null,
          usage: null,
          latency_ms: null,
          dropped_items: 0,
        },
      ],
    };

    const record: AnalysisRecord = {
      email_id: emailId,
      status: "degraded",
      analysis_mode: "degraded",
      provenance: "rules",
      extraction: buildDeterministicExtraction(email, "automatic checks were requested; no AI was used"),
      assessment: null,
      warnings: [...new Set([...(prior?.warnings ?? []), WARNING])].slice(0, MAX_WARNINGS),
      runs: [...(prior?.runs ?? []), run].slice(-MAX_RUN_LOGS),
      model: null,
      prompt_version: null,
      updated_at: started,
    };
    this.repo.saveAnalysis(record);
    return { kind: "performed", analysis: record };
  }
}
