import type { TokenUsage } from "@mri/shared";
import { extractJsonObject } from "../llm/json";
import { LlmError, type ChatMessage, type LlmClient } from "../llm/types";
import { addUsage, AgentError } from "./errors";

export type ParseResult<T> =
  | { ok: true; value: T }
  // `detail` carries diagnostics of a rejected answer; it is surfaced on the final AgentError.
  | { ok: false; errors: string[]; detail?: AgentError["detail"] };

export interface CallJsonOptions<T> {
  client: LlmClient;
  messages: ChatMessage[];
  maxCompletionTokens: number;
  /** Validate and normalize the parsed JSON. Errors must not echo email content. */
  parse: (json: unknown) => ParseResult<T>;
  /** Extra attempts after the first, each carrying the validation errors. Default 1. */
  repairAttempts?: number;
  /** Upper bound if output was cut off and the budget is raised for the retry. */
  maxTokensCap?: number;
}

export interface CallJsonResult<T> {
  value: T;
  usage: TokenUsage | null;
  calls: number;
  latencyMs: number;
  model: string;
  /** True when the first answer was unusable and a repair attempt produced the result. */
  repaired: boolean;
}

/**
 * One model call with a bounded repair loop: malformed JSON or a failed schema check is fed back
 * once with a list of the problems. Transport-level retries (429, 5xx, timeouts) are the
 * client's job; anything it could not recover surfaces here as `llm_error`.
 */
export async function callJsonAgent<T>(opts: CallJsonOptions<T>): Promise<CallJsonResult<T>> {
  const repairs = opts.repairAttempts ?? 1;
  const cap = opts.maxTokensCap ?? 16_000;
  let messages = opts.messages;
  let budget = opts.maxCompletionTokens;
  let usage: TokenUsage | null = null;
  let calls = 0;
  let latencyMs = 0;
  let lastErrors: string[] = [];
  let lastDetail: AgentError["detail"] = null;

  for (let attempt = 0; attempt <= repairs; attempt++) {
    let result;
    try {
      result = await opts.client.complete({ messages, maxCompletionTokens: budget });
    } catch (err) {
      const e = err instanceof LlmError ? err : null;
      calls += e?.attempts ?? 1;
      throw new AgentError("llm_error", e ? e.message : "The LLM call failed unexpectedly.", {
        llmKind: e?.kind ?? null,
        calls,
        usage,
      });
    }
    calls += result.attempts;
    latencyMs += result.latencyMs;
    usage = addUsage(usage, result.usage);

    const truncated = result.finishReason === "length";
    let parsed: ParseResult<T>;
    if (truncated) {
      parsed = { ok: false, errors: ["the output was cut off before the JSON object was complete"] };
    } else {
      try {
        parsed = opts.parse(extractJsonObject(result.content));
      } catch (err) {
        parsed = { ok: false, errors: [err instanceof Error ? err.message : "output is not valid JSON"] };
      }
    }

    if (parsed.ok) {
      return { value: parsed.value, usage, calls, latencyMs, model: result.model, repaired: attempt > 0 };
    }
    lastErrors = parsed.errors;
    lastDetail = parsed.detail ?? null;

    if (attempt < repairs) {
      if (truncated) budget = Math.min(cap, Math.ceil(budget * 1.5));
      messages = [
        ...opts.messages,
        // The previous answer is echoed only when it was a complete (non-truncated) output.
        ...(truncated ? [] : [{ role: "assistant" as const, content: result.content.slice(0, 4000) }]),
        {
          role: "user" as const,
          content:
            "Your previous output was rejected: " +
            parsed.errors.slice(0, 8).join("; ") +
            ". Return one corrected JSON object only, following the required shape exactly.",
        },
      ];
    }
  }

  throw new AgentError("invalid_output", `The model did not return valid output: ${lastErrors.slice(0, 5).join("; ")}`, {
    calls,
    usage,
    detail: lastDetail,
  });
}
