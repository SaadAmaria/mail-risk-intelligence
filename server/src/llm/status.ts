import type { LlmReachability } from "@mri/shared";
import type { LlmErrorKind } from "./types";

export type CallOutcome = { ok: true } | { ok: false; kind: LlmErrorKind };

export interface ProviderStatusSnapshot {
  reachability: LlmReachability;
  last_call_at: string | null;
  last_error_kind: string | null;
}

/**
 * Remembers what the last REAL provider call looked like, so health can report it without ever
 * making a call itself.
 *
 *   reachable            - the endpoint answered (including 429/4xx/5xx/bad body: it responded)
 *   unreachable          - network error or timeout
 *   credentials_rejected - 401/403
 *   unchecked            - no real call has happened since start-up
 */
export class ProviderStatusTracker {
  private last: ProviderStatusSnapshot = { reachability: "unchecked", last_call_at: null, last_error_kind: null };

  constructor(private readonly now: () => Date = () => new Date()) {}

  record(outcome: CallOutcome): void {
    const at = this.now().toISOString();
    if (outcome.ok) {
      this.last = { reachability: "reachable", last_call_at: at, last_error_kind: null };
      return;
    }
    const reachability: LlmReachability =
      outcome.kind === "network" || outcome.kind === "timeout"
        ? "unreachable"
        : outcome.kind === "auth"
          ? "credentials_rejected"
          : "reachable";
    this.last = { reachability, last_call_at: at, last_error_kind: outcome.kind };
  }

  snapshot(): ProviderStatusSnapshot {
    return { ...this.last };
  }
}
