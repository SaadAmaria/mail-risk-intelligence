import type { TokenUsage } from "@mri/shared";
import type { LlmSettings, ReasoningEffort } from "./config";
import type { CallOutcome } from "./status";
import { LlmError, type LlmClient, type LlmRequest, type LlmResult } from "./types";

export interface ClientOptions {
  baseUrl: string;
  model: string;
  /** Optional: local servers (Ollama) need none. Never logged. */
  apiKey: string | null;
  timeoutMs: number;
  reasoningEffort: ReasoningEffort | null;
  maxRetries: number;
  backoffBaseMs?: number;
  maxBackoffMs?: number;
  /** A provider-requested wait longer than this is not honored; the call fails as rate_limited. */
  maxRetryAfterMs?: number;
  /** Called once per complete() with its final outcome (used for passive health reporting). */
  onResult?: (outcome: CallOutcome) => void;
  /** Largest response body accepted, in bytes (a chat completion is far smaller). Default 1 MiB. */
  maxResponseBytes?: number;
  // Injectable for deterministic tests.
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Parse "250ms", "7.66s", "1m30s", "2m" or plain seconds into milliseconds. */
export function parseDurationMs(value: string | null): number | null {
  if (!value) return null;
  const text = value.trim();
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(parseFloat(text) * 1000);
  const re = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;
  let total = 0;
  let matched = false;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    matched = true;
    const n = parseFloat(m[1]!);
    total += m[2] === "ms" ? n : m[2] === "s" ? n * 1000 : m[2] === "m" ? n * 60_000 : n * 3_600_000;
  }
  return matched ? Math.round(total) : null;
}

/**
 * OpenAI-compatible Chat Completions client (exercised only with Groq). One provider
 * implementation; there is deliberately no automatic multi-provider fallback.
 *
 * Retries are bounded and only for transient conditions (timeout, network error, 408/409/425,
 * 429, 5xx). A 429 honors `Retry-After` when it is within `maxRetryAfterMs`. Remaining-token
 * headers are used to pause before a call that would exceed the provider's per-minute budget.
 */
export class OpenAICompatClient implements LlmClient {
  readonly model: string;
  private readonly o: Required<Omit<ClientOptions, "apiKey" | "reasoningEffort" | "onResult">> &
    Pick<ClientOptions, "apiKey" | "reasoningEffort" | "onResult">;
  private remainingTokens: number | null = null;
  private tokensResetAt = 0;

  constructor(options: ClientOptions) {
    this.model = options.model;
    this.o = {
      backoffBaseMs: 500,
      maxBackoffMs: 8_000,
      maxRetryAfterMs: 20_000,
      maxResponseBytes: 1_048_576,
      fetchImpl: globalThis.fetch.bind(globalThis),
      sleep: defaultSleep,
      random: Math.random,
      now: Date.now,
      ...options,
    };
  }

  static fromSettings(settings: LlmSettings, extra: Pick<ClientOptions, "onResult"> = {}): OpenAICompatClient {
    if (!settings.configured || !settings.baseUrl || !settings.model) {
      throw new LlmError("http", "LLM is not configured.");
    }
    return new OpenAICompatClient({
      baseUrl: settings.baseUrl,
      model: settings.model,
      apiKey: settings.apiKey,
      timeoutMs: settings.timeoutMs,
      reasoningEffort: settings.reasoningEffort,
      maxRetries: settings.maxRetries,
      ...extra,
    });
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    try {
      const result = await this.completeWithRetries(request);
      this.o.onResult?.({ ok: true });
      return result;
    } catch (err) {
      if (err instanceof LlmError) this.o.onResult?.({ ok: false, kind: err.kind });
      throw err;
    }
  }

  private async completeWithRetries(request: LlmRequest): Promise<LlmResult> {
    await this.pace(this.estimateTokens(request));

    let attempt = 0;
    for (;;) {
      attempt++;
      try {
        const result = await this.once(request);
        return { ...result, attempts: attempt };
      } catch (err) {
        const e = err instanceof LlmError ? err : new LlmError("network", "Unexpected client error.", { retryable: false });
        e.attempts = attempt;
        if (!e.retryable || attempt > this.o.maxRetries) throw e;

        const delay = e.retryAfterMs ?? this.backoff(attempt - 1);
        if (delay > this.o.maxRetryAfterMs) {
          // Waiting this long is not reasonable for an interactive pipeline: fail now, loudly.
          throw e;
        }
        await this.o.sleep(delay);
      }
    }
  }

  private backoff(retryIndex: number): number {
    const exp = Math.min(this.o.maxBackoffMs, this.o.backoffBaseMs * 2 ** retryIndex);
    return Math.round(exp * (0.5 + this.o.random() * 0.5));
  }

  private estimateTokens(request: LlmRequest): number {
    const chars = request.messages.reduce((n, m) => n + m.content.length, 0);
    return Math.ceil(chars / 3) + request.maxCompletionTokens;
  }

  /** If the provider told us we are about to exceed the token budget, wait for the reset. */
  private async pace(estimated: number): Promise<void> {
    if (this.remainingTokens === null) return;
    const now = this.o.now();
    if (this.remainingTokens < estimated && this.tokensResetAt > now) {
      const wait = Math.min(this.tokensResetAt - now, this.o.maxRetryAfterMs);
      this.remainingTokens = null;
      await this.o.sleep(wait);
    }
  }

  private redact(text: string): string {
    const key = this.o.apiKey;
    return (key ? text.split(key).join("[REDACTED]") : text).slice(0, 300);
  }

  private async once(request: LlmRequest): Promise<Omit<LlmResult, "attempts">> {
    const body: Record<string, unknown> = {
      model: this.o.model,
      messages: request.messages,
      temperature: 0,
      max_completion_tokens: request.maxCompletionTokens,
      response_format: { type: "json_object" },
    };
    if (this.o.reasoningEffort) body.reasoning_effort = this.o.reasoningEffort;

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.o.apiKey) headers.authorization = `Bearer ${this.o.apiKey}`;

    // ONE deadline covers connecting, the response headers AND reading the body. It is enforced by
    // racing, so a transport (or a stalled stream) that ignores the abort signal still cannot hold
    // the single worker: the call fails as a retryable timeout and the body is cancelled.
    const ctrl = new AbortController();
    const started = this.o.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort();
        reject(new LlmError("timeout", `Request timed out after ${this.o.timeoutMs} ms.`, { retryable: true }));
      }, this.o.timeoutMs);
    });
    deadline.catch(() => undefined); // never an unhandled rejection when the call finishes first

    let res: Response | undefined;
    // The reader that holds the body's lock once reading starts: only it can cancel the stream.
    const reading: { reader?: ReadableStreamDefaultReader<Uint8Array> } = {};
    try {
      let text: string;
      try {
        res = await Promise.race([
          this.o.fetchImpl(`${this.o.baseUrl}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: ctrl.signal,
          }),
          deadline,
        ]);
      } catch (err) {
        if (err instanceof LlmError) throw err;
        const aborted = ctrl.signal.aborted || (err as { name?: string })?.name === "AbortError";
        throw aborted
          ? new LlmError("timeout", `Request timed out after ${this.o.timeoutMs} ms.`, { retryable: true })
          : new LlmError("network", "Network error contacting the LLM endpoint.", { retryable: true });
      }

      this.readRateLimitHeaders(res.headers);

      try {
        text = await Promise.race([readBounded(res, this.o.maxResponseBytes, reading), deadline]);
      } catch (err) {
        if (err instanceof LlmError) throw err;
        const aborted = ctrl.signal.aborted || (err as { name?: string })?.name === "AbortError";
        throw aborted
          ? new LlmError("timeout", `Request timed out after ${this.o.timeoutMs} ms.`, { retryable: true })
          : new LlmError("network", "Connection lost while reading the response.", { status: res.status, retryable: true });
      }

      return this.finish(res, text, started);
    } catch (err) {
      // Release the body on every failure path, WITHOUT waiting: a stream whose cancel() never
      // settles must not delay the original error or keep the worker.
      releaseBody(res?.body, reading.reader);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private finish(res: Response, text: string, started: number): Omit<LlmResult, "attempts"> {
    if (!res.ok) throw this.httpError(res, text);

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new LlmError("bad_response", "The endpoint returned a non-JSON response body.", { status: res.status });
    }

    const choice = (json as { choices?: { message?: { content?: unknown }; finish_reason?: unknown }[] }).choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== "string") {
      throw new LlmError("bad_response", "The response had no message content.", { status: res.status });
    }

    return {
      content,
      model: typeof (json as { model?: unknown }).model === "string" ? (json as { model: string }).model : this.o.model,
      finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : null,
      usage: parseUsage((json as { usage?: unknown }).usage),
      latencyMs: this.o.now() - started,
    };
  }

  private readRateLimitHeaders(h: Headers): void {
    const remaining = h.get("x-ratelimit-remaining-tokens");
    const reset = parseDurationMs(h.get("x-ratelimit-reset-tokens"));
    if (remaining !== null && /^\d+$/.test(remaining.trim())) {
      this.remainingTokens = Number(remaining);
      this.tokensResetAt = this.o.now() + (reset ?? 0);
    }
  }

  private httpError(res: Response, text: string): LlmError {
    const status = res.status;
    let providerMessage = "";
    try {
      const j = JSON.parse(text) as { error?: { message?: unknown } };
      if (typeof j.error?.message === "string") providerMessage = this.redact(j.error.message);
    } catch {
      /* body was not JSON; ignore */
    }
    const suffix = providerMessage ? `: ${providerMessage}` : "";

    if (status === 401 || status === 403) {
      return new LlmError("auth", `The endpoint rejected the credentials (HTTP ${status}).`, { status });
    }
    if (status === 429) {
      const retryAfter = parseDurationMs(res.headers.get("retry-after"));
      return new LlmError("rate_limited", `Rate limited by the endpoint (HTTP 429)${suffix}`, {
        status,
        retryable: true,
        retryAfterMs: retryAfter,
      });
    }
    const transient = status === 408 || status === 409 || status === 425 || status >= 500;
    return new LlmError("http", `The endpoint returned HTTP ${status}${suffix}`, { status, retryable: transient });
  }
}

/**
 * Cancel a body stream fire-and-forget. Never throws, never awaits, never leaves a rejection.
 * Once reading has started the stream is locked to `reader`, and `body.cancel()` would only reject
 * with a lock error without reaching the source, so the reader is the one cancelled.
 */
function releaseBody(body: ReadableStream<Uint8Array> | null | undefined, reader?: ReadableStreamDefaultReader<Uint8Array>): void {
  if (!body && !reader) return;
  try {
    void Promise.resolve(reader ? reader.cancel() : body!.cancel()).catch(() => undefined);
  } catch {
    /* a non-standard stream whose cancel() throws synchronously */
  }
}

/**
 * Read a response body with a hard size cap. A body larger than `maxBytes` is a bad response (it
 * is never buffered whole), so a misbehaving endpoint cannot exhaust memory.
 */
async function readBounded(
  res: Response,
  maxBytes: number,
  reading: { reader?: ReadableStreamDefaultReader<Uint8Array> },
): Promise<string> {
  const tooBig = () => new LlmError("bad_response", "The response body was larger than the allowed size.", { status: res.status });
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooBig();
  if (!res.body) {
    const text = await res.text();
    if (text.length > maxBytes) throw tooBig();
    return text;
  }
  const reader = res.body.getReader();
  reading.reader = reader;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) throw tooBig(); // the caller cancels the reader without awaiting it
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function parseUsage(raw: unknown): TokenUsage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const u = raw as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
    completion_tokens_details?: { reasoning_tokens?: unknown };
  };
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const prompt = num(u.prompt_tokens);
  const completion = num(u.completion_tokens);
  if (prompt === null || completion === null) return null;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: num(u.total_tokens) ?? prompt + completion,
    reasoning_tokens: num(u.completion_tokens_details?.reasoning_tokens),
  };
}
