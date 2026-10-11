import type { TokenUsage } from "@mri/shared";
import { LlmError, type LlmClient, type LlmRequest, type LlmResult } from "../../llm/types";

export type Scripted =
  | { content: string; finishReason?: string; usage?: TokenUsage | null }
  | { error: LlmError }
  | ((request: LlmRequest, callIndex: number) => Scripted);

export const USAGE: TokenUsage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, reasoning_tokens: 10 };

/**
 * Deterministic stand-in for a provider. Each `complete()` consumes the next scripted item;
 * running past the script is a test error (it means the code made an unexpected extra call).
 * Records every request so tests can assert exactly what would have been sent.
 */
export class FakeLlm implements LlmClient {
  readonly model: string;
  readonly calls: LlmRequest[] = [];
  private readonly script: Scripted[];

  constructor(script: Scripted[], model = "fake-model") {
    this.script = [...script];
    this.model = model;
  }

  get callCount(): number {
    return this.calls.length;
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    const index = this.calls.length;
    this.calls.push(request);
    let item: Scripted | undefined = this.script[index];
    if (item === undefined) throw new Error(`FakeLlm: unexpected call #${index + 1} (script has ${this.script.length})`);
    while (typeof item === "function") item = item(request, index);
    if ("error" in item) throw item.error;
    return {
      content: item.content,
      model: this.model,
      finishReason: item.finishReason ?? "stop",
      usage: item.usage === undefined ? USAGE : item.usage,
      latencyMs: 5,
      attempts: 1,
    };
  }
}

export const ok = (obj: unknown): Scripted => ({ content: JSON.stringify(obj) });
export const raw = (content: string, finishReason?: string): Scripted => ({ content, ...(finishReason ? { finishReason } : {}) });
export const fail = (kind: ConstructorParameters<typeof LlmError>[0], message = "simulated failure", status?: number): Scripted => ({
  error: new LlmError(kind, message, { status: status ?? null }),
});
