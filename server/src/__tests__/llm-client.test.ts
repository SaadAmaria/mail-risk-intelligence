import { describe, expect, it } from "vitest";
import { rejection } from "./helpers";
import { OpenAICompatClient, parseDurationMs, type ClientOptions } from "../llm/client";
import { LlmError } from "../llm/types";

const KEY = "sk-test-SECRET-KEY-0123456789abcdef";

function completion(content = '{"ok":true}', extra: Record<string, unknown> = {}) {
  return {
    id: "c1",
    model: "openai/gpt-oss-120b",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: 120,
      completion_tokens: 60,
      total_tokens: 180,
      completion_tokens_details: { reasoning_tokens: 40 },
    },
    ...extra,
  };
}

function res(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status, headers });
}

interface Harness {
  client: OpenAICompatClient;
  requests: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[];
  sleeps: number[];
}

/** A client wired to a scripted fetch and a recording (non-waiting) sleep. */
function harness(responses: (Response | Error | ((signal: AbortSignal) => Promise<Response>))[], over: Partial<ClientOptions> = {}): Harness {
  const requests: Harness["requests"] = [];
  const sleeps: number[] = [];
  let i = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    requests.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string) as Record<string, unknown>,
    });
    const next = responses[i++];
    if (next === undefined) throw new Error("fetch called more often than scripted");
    if (next instanceof Error) throw next;
    if (typeof next === "function") return next(init.signal as AbortSignal);
    return next;
  }) as unknown as typeof fetch;

  const client = new OpenAICompatClient({
    baseUrl: "https://api.example.test/openai/v1",
    model: "openai/gpt-oss-120b",
    apiKey: KEY,
    timeoutMs: 1000,
    reasoningEffort: "low",
    maxRetries: 2,
    backoffBaseMs: 100,
    maxBackoffMs: 1000,
    maxRetryAfterMs: 5000,
    fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 1, // no jitter reduction: delay == exponential value
    ...over,
  });
  return { client, requests, sleeps };
}

const req = { messages: [{ role: "user" as const, content: "hello" }], maxCompletionTokens: 500 };

describe("OpenAICompatClient: request and response", () => {
  it("sends an OpenAI-compatible JSON request and returns content, model, usage, latency", async () => {
    const h = harness([res(200, completion('{"a":1}'))]);
    const out = await h.client.complete(req);

    expect(out.content).toBe('{"a":1}');
    expect(out.model).toBe("openai/gpt-oss-120b");
    expect(out.finishReason).toBe("stop");
    expect(out.usage).toEqual({ prompt_tokens: 120, completion_tokens: 60, total_tokens: 180, reasoning_tokens: 40 });
    expect(out.attempts).toBe(1);

    const r = h.requests[0]!;
    expect(r.url).toBe("https://api.example.test/openai/v1/chat/completions");
    expect(r.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(r.body).toMatchObject({
      model: "openai/gpt-oss-120b",
      temperature: 0,
      max_completion_tokens: 500,
      response_format: { type: "json_object" },
      reasoning_effort: "low",
    });
  });

  it("omits the Authorization header and reasoning_effort when not configured (local server)", async () => {
    const h = harness([res(200, completion())], { apiKey: null, reasoningEffort: null });
    await h.client.complete(req);
    expect(h.requests[0]!.headers.authorization).toBeUndefined();
    expect(h.requests[0]!.body.reasoning_effort).toBeUndefined();
  });

  it("returns null usage when the provider omits it", async () => {
    const body = completion();
    delete (body as { usage?: unknown }).usage;
    const out = await harness([res(200, body)]).client.complete(req);
    expect(out.usage).toBeNull();
  });
});

describe("OpenAICompatClient: retries and rate limits", () => {
  it("retries a 429 and honors Retry-After (seconds)", async () => {
    const h = harness([
      res(429, { error: { message: "slow down" } }, { "retry-after": "2" }),
      res(200, completion()),
    ]);
    const out = await h.client.complete(req);
    expect(out.attempts).toBe(2);
    expect(h.sleeps).toEqual([2000]);
    expect(h.requests).toHaveLength(2);
  });

  it("does not wait for an unreasonable Retry-After: fails fast as rate_limited", async () => {
    const h = harness([res(429, { error: { message: "daily limit" } }, { "retry-after": "3600" })]);
    const err = await rejection<LlmError>(h.client.complete(req));
    expect(err).toBeInstanceOf(LlmError);
    expect(err.kind).toBe("rate_limited");
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(3_600_000);
    expect(h.sleeps).toEqual([]);
    expect(h.requests).toHaveLength(1);
  });

  it("retries 5xx with exponential backoff, then succeeds", async () => {
    const h = harness([res(503, "unavailable"), res(500, { error: { message: "boom" } }), res(200, completion())]);
    const out = await h.client.complete(req);
    expect(out.attempts).toBe(3);
    expect(h.sleeps).toEqual([100, 200]);
  });

  it("gives up after maxRetries and reports the number of attempts", async () => {
    const h = harness([res(503, "x"), res(503, "x"), res(503, "x")]);
    const err = await rejection<LlmError>(h.client.complete(req));
    expect(err.kind).toBe("http");
    expect(err.status).toBe(503);
    expect(err.attempts).toBe(3);
    expect(h.requests).toHaveLength(3);
  });

  it("does not retry authentication or bad-request errors", async () => {
    const auth = harness([res(401, { error: { message: "Invalid API Key" } })]);
    const e1 = await rejection<LlmError>(auth.client.complete(req));
    expect(e1.kind).toBe("auth");
    expect(auth.requests).toHaveLength(1);

    const bad = harness([res(400, { error: { message: "unsupported parameter: reasoning_effort" } })]);
    const e2 = await rejection<LlmError>(bad.client.complete(req));
    expect(e2.kind).toBe("http");
    expect(e2.retryable).toBe(false);
    expect(e2.message).toMatch(/unsupported parameter/);
    expect(bad.requests).toHaveLength(1);
  });

  it("retries network errors, then reports kind=network", async () => {
    const h = harness([new TypeError("fetch failed"), new TypeError("fetch failed"), new TypeError("fetch failed")]);
    const err = await rejection<LlmError>(h.client.complete(req));
    expect(err.kind).toBe("network");
    expect(err.attempts).toBe(3);
  });

  it("times out a request that never completes and retries it", async () => {
    const hang = (signal: AbortSignal) =>
      new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    const h = harness([hang, res(200, completion())], { timeoutMs: 20 });
    const out = await h.client.complete(req);
    expect(out.attempts).toBe(2);
  });

  it("reports timeout when every attempt times out", async () => {
    const hang = (signal: AbortSignal) =>
      new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    const h = harness([hang, hang], { timeoutMs: 15, maxRetries: 1 });
    const err = await rejection<LlmError>(h.client.complete(req));
    expect(err.kind).toBe("timeout");
  });

  it("pauses before a call that would exceed the remaining token budget, using the reset header", async () => {
    let clock = 1_000_000;
    const h = harness(
      [
        res(200, completion(), { "x-ratelimit-remaining-tokens": "300", "x-ratelimit-reset-tokens": "4s" }),
        res(200, completion()),
      ],
      { now: () => clock },
    );
    await h.client.complete(req); // learns: 300 tokens left, reset in 4s
    expect(h.sleeps).toEqual([]);
    clock += 1000; // 1s later: 3s still to wait
    await h.client.complete(req); // estimate (~500 + prompt) > 300 -> waits
    expect(h.sleeps).toEqual([3000]);
  });

  it("does not pause when the remaining budget is sufficient", async () => {
    const h = harness(
      [res(200, completion(), { "x-ratelimit-remaining-tokens": "7000", "x-ratelimit-reset-tokens": "4s" }), res(200, completion())],
    );
    await h.client.complete(req);
    await h.client.complete(req);
    expect(h.sleeps).toEqual([]);
  });
});

describe("OpenAICompatClient: malformed responses", () => {
  it("rejects a non-JSON body", async () => {
    const err = await rejection<LlmError>(harness([res(200, "<html>gateway</html>")]).client.complete(req));
    expect(err.kind).toBe("bad_response");
  });

  it("rejects a response without message content", async () => {
    const err = await rejection<LlmError>(harness([res(200, { choices: [] })]).client.complete(req));
    expect(err.kind).toBe("bad_response");
    expect(err.retryable).toBe(false);
  });

  it("reports finish_reason length so callers can detect truncation", async () => {
    const body = completion('{"a":');
    (body.choices[0] as { finish_reason: string }).finish_reason = "length";
    const out = await harness([res(200, body)]).client.complete(req);
    expect(out.finishReason).toBe("length");
  });
});

describe("OpenAICompatClient: secrecy", () => {
  it("never puts the API key in errors, even when the provider echoes it", async () => {
    const echoed = harness([res(400, { error: { message: `bad key ${KEY} rejected` } })]);
    const err = await rejection<LlmError>(echoed.client.complete(req));
    const dump = JSON.stringify({ message: err.message, kind: err.kind, status: err.status }) + String(err.stack);
    expect(dump).not.toContain(KEY);
    expect(err.message).toContain("[REDACTED]");
  });

  it("does not include the key in network or timeout errors", async () => {
    const h = harness([new TypeError(`fetch failed for key ${KEY}`)], { maxRetries: 0 });
    const err = await rejection<LlmError>(h.client.complete(req));
    expect(err.message).not.toContain(KEY);
    expect(JSON.stringify(err)).not.toContain(KEY);
  });
});

describe("parseDurationMs", () => {
  it.each([
    ["2", 2000],
    ["0.5", 500],
    ["250ms", 250],
    ["7.66s", 7660],
    ["1m30s", 90_000],
    ["2m", 120_000],
    [null, null],
    ["soon", null],
  ])("parses %j", (input, expected) => {
    expect(parseDurationMs(input as string | null)).toBe(expected);
  });
});
