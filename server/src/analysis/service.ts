import {
  aiAttempts,
  MAX_RUN_LOGS,
  type AnalysisRecord,
  type Extraction,
  type RiskAnalysis,
  type RunLog,
  type RunOutcome,
  type StageLog,
} from "@mri/shared";
import { AgentError } from "../agents/errors";
import {
  buildDeterministicExtraction,
  EXTRACTION_PROMPT_VERSION,
  runExtractionAgent,
} from "../agents/extractionAgent";
import { RISK_PROMPT_VERSION, runRiskAgent } from "../agents/riskAgent";
import type { LlmClient } from "../llm/types";
import type { MailboxRepository } from "../storage/repository";
import { WorkQueue } from "./queue";

export const PROMPT_VERSION = `${EXTRACTION_PROMPT_VERSION}+${RISK_PROMPT_VERSION}`;

export interface AnalysisServiceOptions {
  concurrency: number;
  /** An email is not run automatically more than this many times (poison-pill guard). */
  maxRuns: number;
  queueCapacity: number;
  maxCompletionTokens: number;
  now?: () => Date;
  log?: (message: string) => void;
}

export type EnqueueResult =
  | "queued"
  | "already_queued"
  | "not_found"
  | "skipped_complete"
  | "max_runs_reached"
  | "queue_full";

const IN_PROGRESS = new Set(["queued", "extracting", "analyzing"]);
const MAX_WARNINGS = 50;

/**
 * Sequential A -> B orchestration over a bounded in-process queue.
 *
 * Outcomes (persisted, never optimistic):
 *   complete — A validated, B validated: the only state that carries a risk assessment;
 *   partial  — A validated, B failed: extraction kept, no assessment;
 *   degraded — no validated A (no LLM, or A failed): code-only extraction, no assessment;
 *   failed   — unexpected internal error.
 * Agent B runs only on an Extraction that Agent A produced and validation accepted.
 */
export class AnalysisService {
  private readonly queue: WorkQueue;
  private readonly now: () => Date;
  private readonly log: (message: string) => void;

  constructor(
    private readonly repo: MailboxRepository,
    private readonly llm: LlmClient | null,
    private readonly options: AnalysisServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? (() => undefined);
    this.queue = new WorkQueue((id) => this.run(id), {
      concurrency: options.concurrency,
      capacity: options.queueCapacity,
      onError: (id, err) => this.log(`analysis ${id}: unexpected worker error (${err instanceof Error ? err.name : "unknown"})`),
    });
  }

  get hasLlm(): boolean {
    return this.llm !== null;
  }

  /** True only when answers come from a real provider (a recorded client makes no external call). */
  get hasLiveLlm(): boolean {
    return this.llm !== null && this.provenance === "live";
  }

  private get provenance(): "live" | "recorded" {
    return this.llm?.provenance ?? "live";
  }

  /** True while this email is waiting in, or running from, the in-process queue. */
  isActive(emailId: string): boolean {
    return this.queue.has(emailId);
  }

  get queueDepth(): { waiting: number; running: number } {
    return { waiting: this.queue.pending, running: this.queue.active };
  }

  /** Queue one email. Marks it `queued` (unassessed) immediately so it can never look safe. */
  enqueue(emailId: string, opts: { force?: boolean } = {}): EnqueueResult {
    if (!this.repo.getEmail(emailId)) return "not_found";
    if (this.queue.has(emailId)) return "already_queued";

    const prior = this.repo.getAnalysis(emailId);
    if (prior?.status === "complete" && !opts.force) return "skipped_complete";
    // A recording never replaces a finished analysis that came from a live provider.
    if (prior?.status === "complete" && prior.provenance === "live" && this.provenance === "recorded") {
      return "skipped_complete";
    }
    // Explicit automatic-checks runs are in the history but are not AI attempts.
    if (prior && aiAttempts(prior.runs) >= this.options.maxRuns && !opts.force) return "max_runs_reached";
    // Checked before writing, so a rejected email is never left marked "queued" with no job.
    if (this.queue.pending >= this.options.queueCapacity) return "queue_full";

    // Live and recorded answers are never mixed inside one analysis: a stored live extraction is
    // only resumed by a live client, and a recorded run always starts from the beginning.
    const resumable =
      prior && prior.provenance === "live" && prior.status !== "complete" && this.provenance === "live"
        ? prior.extraction
        : null;
    this.repo.saveAnalysis({
      email_id: emailId,
      status: "queued",
      analysis_mode: null,
      provenance: resumable ? "live" : null,
      extraction: resumable,
      assessment: null,
      warnings: prior?.warnings ?? [],
      runs: prior?.runs ?? [],
      model: prior?.model ?? null,
      prompt_version: prior?.prompt_version ?? null,
      updated_at: this.now().toISOString(),
    });
    return this.queue.enqueue(emailId) === "queued" ? "queued" : "already_queued";
  }

  /**
   * Restart recovery: anything left in an in-progress state by a previous process is marked
   * interrupted and normalized to `queued` (bounded by `maxRuns`; beyond that it is `failed`).
   *
   * `run` decides whether the recovered work is also handed to the worker. With `run: false`
   * (what the server uses unless ANALYSIS_AUTOSTART=true) NO provider call is made: the email
   * simply waits, visibly "queued" (never safe), until someone explicitly asks for processing.
   * With `run: true` the recovered emails are processed, which sends their content to the
   * configured provider again.
   *
   * Returns the ids that were recovered (normalized to `queued`).
   */
  recoverInterrupted(opts: { run?: boolean } = {}): string[] {
    const run = opts.run ?? true;
    const requeued: string[] = [];
    for (const a of this.repo.listAnalyses()) {
      if (!IN_PROGRESS.has(a.status)) continue;

      const runs = a.runs.map((r) => ({ ...r, stages: [...r.stages] }));
      const last = runs[runs.length - 1];
      if (last && last.finished_at === null) {
        last.finished_at = this.now().toISOString();
        last.outcome = "interrupted";
      }

      if (aiAttempts(runs) >= this.options.maxRuns) {
        this.repo.saveAnalysis({
          ...a,
          status: "failed",
          analysis_mode: "failed",
          assessment: null,
          warnings: capWarnings([...a.warnings, "Processing was interrupted repeatedly and was not retried again."]),
          runs: runs.slice(-MAX_RUN_LOGS),
          updated_at: this.now().toISOString(),
        });
        continue;
      }

      this.repo.saveAnalysis({
        ...a,
        status: "queued",
        analysis_mode: null,
        assessment: null,
        runs: runs.slice(-MAX_RUN_LOGS),
        updated_at: this.now().toISOString(),
      });
      if (!run) {
        requeued.push(a.email_id);
      } else if (this.queue.enqueue(a.email_id) === "queued") {
        requeued.push(a.email_id);
      }
    }
    return requeued;
  }

  /**
   * Queue emails that have never been analyzed, plus retriable ones (partial / degraded / failed
   * and under the run limit) when an LLM is available. Complete analyses are left alone.
   */
  enqueueUnanalyzed(): string[] {
    const queued: string[] = [];
    for (const email of this.repo.listEmails({ order: "date_asc" })) {
      const a = this.repo.getAnalysis(email.id);
      const retriable =
        a !== null &&
        this.llm !== null &&
        (a.status === "partial" || a.status === "degraded" || a.status === "failed") &&
        aiAttempts(a.runs) < this.options.maxRuns;
      if (a === null || retriable) {
        if (this.enqueue(email.id) === "queued") queued.push(email.id);
      }
    }
    return queued;
  }

  idle(): Promise<void> {
    return this.queue.idle();
  }

  stop(timeoutMs?: number): Promise<void> {
    return this.queue.stop(timeoutMs);
  }

  // ---- one run ----------------------------------------------------------

  private async run(emailId: string): Promise<void> {
    const email = this.repo.getEmail(emailId);
    if (!email) return;

    const prior = this.repo.getAnalysis(emailId);
    const run: RunLog = { started_at: this.now().toISOString(), finished_at: null, outcome: null, stages: [] };
    const runs = [...(prior?.runs ?? []), run].slice(-MAX_RUN_LOGS);
    const warnings: string[] = [];
    let model = this.llm?.model ?? prior?.model ?? null;

    const save = (patch: Partial<AnalysisRecord> & Pick<AnalysisRecord, "status">): void => {
      this.repo.saveAnalysis({
        email_id: emailId,
        analysis_mode: null,
        provenance: null,
        extraction: null,
        assessment: null,
        warnings: capWarnings(warnings),
        runs,
        model,
        prompt_version: PROMPT_VERSION,
        updated_at: this.now().toISOString(),
        ...patch,
      });
    };

    const finish = (
      outcome: Exclude<RunOutcome, "interrupted">,
      patch: Partial<AnalysisRecord>,
    ): void => {
      run.finished_at = this.now().toISOString();
      run.outcome = outcome;
      save({ status: outcome, analysis_mode: outcome, ...patch });
    };

    let extraction: Extraction | null = null;
    try {
      save({ status: "extracting" });

      // Resume: a validated live extraction from an earlier, incomplete run is not redone.
      if (prior?.extraction && prior.provenance === "live" && prior.status !== "complete" && this.provenance === "live") {
        extraction = prior.extraction;
        run.stages.push(stage("extraction", { outcome: "skipped" }));
      } else if (this.llm === null) {
        const reason = "no LLM is configured";
        warnings.push("No LLM is configured: AI analysis was not performed.");
        run.stages.push(stage("extraction", { outcome: "skipped", error_kind: "not_configured", error_message: reason }));
        run.stages.push(stage("risk", { outcome: "skipped", error_kind: "not_configured" }));
        finish("degraded", {
          provenance: "rules",
          extraction: buildDeterministicExtraction(email, reason),
        });
        return;
      } else {
        try {
          const a = await runExtractionAgent(this.llm, email, { maxCompletionTokens: this.options.maxCompletionTokens });
          extraction = a.extraction;
          model = a.model ?? model;
          warnings.push(...a.warnings);
          run.stages.push(
            stage("extraction", {
              outcome: "ok",
              calls: a.calls,
              usage: a.usage,
              latency_ms: a.latencyMs,
              dropped_items: a.droppedItems,
            }),
          );
        } catch (err) {
          const e = toAgentError(err);
          run.stages.push(
            stage("extraction", {
              outcome: "failed",
              calls: e.calls,
              usage: e.usage,
              error_kind: e.llmKind ?? e.kind,
              error_message: e.message,
            }),
          );
          run.stages.push(stage("risk", { outcome: "skipped", error_kind: "extraction_unavailable" }));
          warnings.push(`Extraction failed (${e.llmKind ?? e.kind}); only code-based extraction is available.`);
          finish("degraded", {
            provenance: "rules",
            extraction: buildDeterministicExtraction(email, "AI extraction failed"),
          });
          return;
        }
      }

      // The extraction is validated; keep it even if Agent B cannot run or fails.
      const llm = this.llm;
      if (llm === null) {
        // Only reachable when resuming a stored live extraction without an LLM now configured.
        run.stages.push(stage("risk", { outcome: "skipped", error_kind: "not_configured" }));
        warnings.push("No LLM is configured: the stored extraction could not be risk-assessed.");
        finish("partial", { provenance: "live", extraction });
        return;
      }
      save({ status: "analyzing", provenance: this.provenance, extraction });

      let assessment: RiskAnalysis;
      try {
        const b = await runRiskAgent(llm, extraction, { maxCompletionTokens: this.options.maxCompletionTokens });
        assessment = b.analysis;
        model = b.model ?? model;
        warnings.push(...b.warnings);
        run.stages.push(
          stage("risk", {
            outcome: "ok",
            calls: b.calls,
            usage: b.usage,
            latency_ms: b.latencyMs,
            dropped_items: b.dropped,
          }),
        );
      } catch (err) {
        const e = toAgentError(err);
        run.stages.push(
          stage("risk", {
            outcome: "failed",
            calls: e.calls,
            usage: e.usage,
            error_kind: e.llmKind ?? e.kind,
            error_message: e.message,
          }),
        );
        warnings.push(
          e.kind === "ungrounded_assessment"
            ? "The model's proposed risk finding could not be verified against the email, so it was withheld; the email has not been assessed."
            : `Risk analysis failed (${e.llmKind ?? e.kind}); the email has not been assessed.`,
        );
        finish("partial", { provenance: this.provenance, extraction });
        return;
      }

      finish("complete", { provenance: this.provenance, extraction, assessment });
    } catch (err) {
      // Anything unexpected (storage error, bug): record a failure; never leave "in progress".
      this.log(`analysis ${emailId}: unexpected error (${err instanceof Error ? err.name : "unknown"})`);
      warnings.push(`Unexpected internal error (${err instanceof Error ? err.name : "unknown"}).`);
      run.stages.push(
        stage(extraction ? "risk" : "extraction", {
          outcome: "failed",
          error_kind: "internal",
          error_message: err instanceof Error ? err.name : "unknown",
        }),
      );
      try {
        finish("failed", { provenance: extraction ? this.provenance : null, extraction });
      } catch (writeErr) {
        this.log(`analysis ${emailId}: could not record failure (${writeErr instanceof Error ? writeErr.name : "unknown"})`);
      }
    }
  }
}

function toAgentError(err: unknown): AgentError {
  if (err instanceof AgentError) return err;
  throw err; // not an agent failure: let the outer handler record it as an internal error
}

function stage(name: StageLog["stage"], patch: Partial<StageLog>): StageLog {
  return {
    stage: name,
    outcome: "ok",
    calls: 0,
    error_kind: null,
    error_message: null,
    usage: null,
    latency_ms: null,
    dropped_items: 0,
    ...patch,
  };
}

function capWarnings(w: string[]): string[] {
  const unique = [...new Set(w)];
  return unique.length > MAX_WARNINGS ? unique.slice(0, MAX_WARNINGS) : unique;
}
