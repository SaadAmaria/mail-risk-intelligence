import type { TokenUsage } from "@mri/shared";
import type { LlmError } from "../llm/types";

export type AgentErrorKind =
  | "llm_error" // the provider call failed (timeout, 429 exhausted, auth, ...)
  | "invalid_output" // the model answered, but not with a valid, usable structure
  // The model proposed a risk level above "none" but cited no evidence that could be verified
  // against the extraction. The finding is withheld, not recorded as an assessment.
  | "ungrounded_assessment";

/** What the model proposed, kept for diagnostics only (never stored as an assessment). */
export interface ProposedAssessment {
  level: string;
  confidence: string;
  tags: string[];
  evidenceCited: number;
  evidenceValid: number;
}

/**
 * A stage failure. `message` is sanitized: it may name fields and error kinds but never
 * contains credentials, request bodies or email content.
 */
export class AgentError extends Error {
  readonly kind: AgentErrorKind;
  readonly llmKind: LlmError["kind"] | null;
  readonly calls: number;
  readonly usage: TokenUsage | null;
  /** Diagnostic detail from the last rejected attempt (e.g. a proposed-but-ungrounded finding). */
  readonly detail: { proposed?: ProposedAssessment } | null;

  constructor(
    kind: AgentErrorKind,
    message: string,
    opts: {
      llmKind?: LlmError["kind"] | null;
      calls?: number;
      usage?: TokenUsage | null;
      detail?: { proposed?: ProposedAssessment } | null;
    } = {},
  ) {
    super(message);
    this.name = "AgentError";
    this.kind = kind;
    this.llmKind = opts.llmKind ?? null;
    this.calls = opts.calls ?? 0;
    this.usage = opts.usage ?? null;
    this.detail = opts.detail ?? null;
  }
}

export function addUsage(a: TokenUsage | null, b: TokenUsage | null): TokenUsage | null {
  if (!a) return b;
  if (!b) return a;
  return {
    prompt_tokens: a.prompt_tokens + b.prompt_tokens,
    completion_tokens: a.completion_tokens + b.completion_tokens,
    total_tokens: a.total_tokens + b.total_tokens,
    reasoning_tokens:
      a.reasoning_tokens === null && b.reasoning_tokens === null
        ? null
        : (a.reasoning_tokens ?? 0) + (b.reasoning_tokens ?? 0),
  };
}
