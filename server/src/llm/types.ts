import type { TokenUsage } from "@mri/shared";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  messages: ChatMessage[];
  /** Upper bound for completion tokens. Reasoning models spend part of this on reasoning. */
  maxCompletionTokens: number;
}

export interface LlmResult {
  content: string;
  model: string;
  /** "stop" normally; "length" means the output was cut off. */
  finishReason: string | null;
  usage: TokenUsage | null;
  latencyMs: number;
  /** HTTP attempts made for this call (1 = no transport retry). */
  attempts: number;
}

export interface LlmClient {
  readonly model: string;
  complete(request: LlmRequest): Promise<LlmResult>;
}

export type LlmErrorKind =
  | "timeout"
  | "network"
  | "auth"
  | "rate_limited"
  | "http"
  | "bad_response";

/**
 * A failed provider call. `message` is sanitized: it never contains credentials, request
 * bodies, or email content.
 */
export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly status: number | null;
  readonly retryable: boolean;
  /** Provider-requested wait, when known. */
  readonly retryAfterMs: number | null;
  /** HTTP attempts made before giving up. */
  attempts: number;

  constructor(
    kind: LlmErrorKind,
    message: string,
    opts: { status?: number | null; retryable?: boolean; retryAfterMs?: number | null; attempts?: number } = {},
  ) {
    super(message);
    this.name = "LlmError";
    this.kind = kind;
    this.status = opts.status ?? null;
    this.retryable = opts.retryable ?? false;
    this.retryAfterMs = opts.retryAfterMs ?? null;
    this.attempts = opts.attempts ?? 1;
  }
}
