import type { AnalysisService } from "./service";

export interface BootstrapResult {
  /** Interrupted analyses normalized to `queued` at start-up. */
  recovered: string[];
  /** Never-analyzed / retriable emails handed to the worker because autostart is on. */
  autoQueued: string[];
  /**
   * Whether this start-up may send mailbox content to an external provider on its own. It is
   * true only when autostart is on, an LLM is configured, and there was something to process.
   */
  externalCallsMayStart: boolean;
}

/**
 * What the server does with analysis work at start-up.
 *
 * - Always: interrupted analyses are marked interrupted and normalized to `queued`, so nothing
 *   is left looking "in progress" after a crash and nothing looks safe.
 * - Only when `autostart` is true: those recovered emails, plus never-analyzed and retriable
 *   ones, are handed to the worker. That is the ONLY start-up path that can trigger an external
 *   provider call. Otherwise an interrupted job waits until `POST /api/emails/:id/reprocess`.
 */
export function bootstrapAnalysis(service: AnalysisService, options: { autostart: boolean }): BootstrapResult {
  const recovered = service.recoverInterrupted({ run: options.autostart });
  const autoQueued = options.autostart ? service.enqueueUnanalyzed() : [];
  return {
    recovered,
    autoQueued,
    externalCallsMayStart: options.autostart && service.hasLlm && recovered.length + autoQueued.length > 0,
  };
}
