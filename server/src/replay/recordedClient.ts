import { LlmError, type LlmClient, type LlmRequest, type LlmResult } from "../llm/types";
import { normalizedRequestHash, type RecordedCall, type RecordedFixture } from "./fixture";

/**
 * Serves previously recorded completions. It performs no network operation and no I/O.
 *
 * A request is answered only if its nonce-normalized hash equals a recorded call's hash. The
 * hash covers the full prompt (and therefore the email text), so a response can never be reused
 * for another message, for a changed prompt, or for a repair request whose preceding answer
 * differs. Anything else is `not_recorded`: the caller (Agent A or B) treats it like any failed
 * provider call and the email ends degraded/partial, never "assessed".
 */
export class RecordedLlmClient implements LlmClient {
  readonly provenance = "recorded" as const;
  readonly model: string;
  private readonly index = new Map<string, RecordedCall>();

  constructor(fixtures: Iterable<RecordedFixture>) {
    const ambiguous = new Set<string>();
    let model: string | null = null;
    for (const f of fixtures) {
      for (const c of f.calls) {
        model ??= c.response_model;
        const existing = this.index.get(c.request_hash);
        if (existing && existing.content !== c.content) ambiguous.add(c.request_hash);
        else this.index.set(c.request_hash, c);
      }
    }
    // Two different answers for one request cannot be told apart safely: serve neither.
    for (const h of ambiguous) this.index.delete(h);
    this.model = model ?? "recorded";
  }

  get size(): number {
    return this.index.size;
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    const call = this.index.get(normalizedRequestHash(request.messages));
    if (!call) {
      throw new LlmError(
        "not_recorded",
        "No recorded response matches this request (the message has no recording, or it changed since it was recorded).",
      );
    }
    return {
      content: call.content,
      model: call.response_model,
      finishReason: call.finish_reason,
      usage: call.usage,
      // This run took no provider time; the original latency is kept in the fixture only.
      latencyMs: 0,
      attempts: 1,
    };
  }
}
