import { describe, expect, it } from "vitest";
import { OpenAICompatClient, type ClientOptions } from "../llm/client";
import { LlmError, type LlmRequest } from "../llm/types";
import { AnalysisService } from "../analysis/service";
import { loadSeed } from "./riskFixtures";

const REQUEST: LlmRequest = { messages: [{ role: "user", content: "hi" }], maxCompletionTokens: 100 };
const OK_BODY = JSON.stringify({ model: "m", choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: null });
const KEY = "sk-test-deadline-0123456789";

/** Headers arrive at once; the body never ends and ignores any abort signal (a hostile transport). */
function stalledBody(status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({ start() {/* never enqueues or closes */} });
  return new Response(stream, { status, headers: { "content-type": "application/json" } });
}
/** A body that keeps producing data forever. */
function endlessBody(): Response {
  const chunk = new Uint8Array(64 * 1024).fill(0x20);
  const stream = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(chunk); } });
  return new Response(stream, { status: 200 });
}

function client(fetchImpl: ClientOptions["fetchImpl"], over: Partial<ClientOptions> = {}) {
  return new OpenAICompatClient({
    baseUrl: "https://llm.example/v1",
    model: "m",
    apiKey: KEY,
    timeoutMs: 80,
    reasoningEffort: null,
    maxRetries: 0,
    backoffBaseMs: 1,
    maxBackoffMs: 2,
    sleep: async () => undefined,
    fetchImpl,
    ...over,
  });
}
const settle = async <T,>(p: Promise<T>): Promise<{ v?: T; e?: LlmError; ms: number }> => {
  const t = Date.now();
  try {
    return { v: await p, ms: Date.now() - t };
  } catch (e) {
    return { e: e as LlmError, ms: Date.now() - t };
  }
};

describe("one deadline covers headers and body", () => {
  it("headers succeed, then the body stalls: the call times out (it used to hang)", async () => {
    let calls = 0;
    const c = client((async () => (calls++, stalledBody())) as typeof fetch);
    const r = await settle(c.complete(REQUEST));
    expect(r.e).toBeInstanceOf(LlmError);
    expect(r.e!.kind).toBe("timeout");
    expect(r.e!.retryable).toBe(true);
    expect(r.ms).toBeLessThan(1500);
    expect(calls).toBe(1);
  });

  it("a stalled body is retried as a transient failure and a later attempt can succeed", async () => {
    let calls = 0;
    const c = client((async () => (++calls === 1 ? stalledBody() : new Response(OK_BODY, { status: 200 }))) as typeof fetch, { maxRetries: 1 });
    const r = await settle(c.complete(REQUEST));
    expect(r.e).toBeUndefined();
    expect(r.v!.attempts).toBe(2);
    expect(calls).toBe(2);
  });

  it("when every attempt stalls, the retries are bounded and the failure is a timeout", async () => {
    let calls = 0;
    const c = client((async () => (calls++, stalledBody())) as typeof fetch, { maxRetries: 2 });
    const r = await settle(c.complete(REQUEST));
    expect(r.e!.kind).toBe("timeout");
    expect(r.e!.attempts).toBe(3);
    expect(calls).toBe(3);
    expect(r.ms).toBeLessThan(2500);
  });

  it("stalled headers (a transport that ignores the abort signal) also time out", async () => {
    const c = client((() => new Promise<Response>(() => undefined)) as typeof fetch);
    const r = await settle(c.complete(REQUEST));
    expect(r.e!.kind).toBe("timeout");
  });

  it("an abort from the transport is a timeout; any other failure is a network error", async () => {
    const aborting = client(((_u: string, init: RequestInit) => new Promise<Response>((_, rej) => {
      init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })) as unknown as typeof fetch);
    expect((await settle(aborting.complete(REQUEST))).e!.kind).toBe("timeout");

    const broken = client((async () => { throw new TypeError("fetch failed"); }) as typeof fetch);
    expect((await settle(broken.complete(REQUEST))).e!.kind).toBe("network");
  });

  it("a body that fails midway is a retryable network error, not a hang", async () => {
    const stream = new ReadableStream<Uint8Array>({ pull(c) { c.error(new Error("reset")); } });
    const c = client((async () => new Response(stream, { status: 200 })) as typeof fetch);
    const r = await settle(c.complete(REQUEST));
    expect(r.e!.kind).toBe("network");
    expect(r.e!.retryable).toBe(true);
  });
});

describe("response size is bounded", () => {
  it("an endless body is refused as a bad response, long before the deadline", async () => {
    const c = client((async () => endlessBody()) as typeof fetch, { timeoutMs: 5000, maxResponseBytes: 256 * 1024 });
    const r = await settle(c.complete(REQUEST));
    expect(r.e!.kind).toBe("bad_response");
    expect(r.e!.retryable).toBe(false);
    expect(r.ms).toBeLessThan(2000);
  });

  it("a declared content-length over the limit is refused without reading", async () => {
    const c = client((async () => new Response("x", { status: 200, headers: { "content-length": String(10 * 1024 * 1024) } })) as typeof fetch);
    expect((await settle(c.complete(REQUEST))).e!.kind).toBe("bad_response");
  });

  it("a normal response is unaffected", async () => {
    const c = client((async () => new Response(OK_BODY, { status: 200 })) as typeof fetch);
    const r = await settle(c.complete(REQUEST));
    expect(r.v!.content).toBe("{}");
    expect(r.v!.model).toBe("m");
  });
});

describe("a stalled provider cannot monopolize the single worker", () => {
  it("the stalled message degrades and the next message is processed", async () => {
    const { repo } = await loadSeed(["E004", "E009"]);
    let calls = 0;
    const llm = client(
      (async () => (++calls === 1 ? stalledBody() : new Response("{}", { status: 500 }))) as typeof fetch,
      { timeoutMs: 100, maxRetries: 0 },
    );
    const service = new AnalysisService(repo, llm, { concurrency: 1, maxRuns: 3, queueCapacity: 10, maxCompletionTokens: 100 });
    expect(service.enqueue("E004")).toBe("queued");
    expect(service.enqueue("E009")).toBe("queued");
    const t = Date.now();
    await service.idle();
    expect(Date.now() - t).toBeLessThan(5000);
    for (const id of ["E004", "E009"]) {
      const a = repo.getAnalysis(id)!;
      expect(a.status).toBe("degraded");
      expect(a.assessment).toBeNull();
      expect(a.runs.at(-1)!.stages[0]!.error_kind).toMatch(/timeout|http/);
    }
    expect(repo.getAnalysis("E004")!.runs.at(-1)!.stages[0]!.error_kind).toBe("timeout");
    expect(calls).toBeGreaterThanOrEqual(2); // the second message really reached the provider
    await service.stop(10);
  });
});

/** A real stream whose cancel() never settles. */
function uncancellable(init: ResponseInit & { chunks?: number } = {}): Response {
  const chunk = new Uint8Array(32 * 1024).fill(0x20);
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (init.chunks === undefined || sent++ < init.chunks) c.enqueue(chunk);
    },
    cancel: () => new Promise<void>(() => undefined),
  });
  return new Response(stream, { status: init.status ?? 200, headers: init.headers });
}

describe("cleanup never delays the original error or the worker", () => {
  it("declared oversize body whose cancel() never settles: refused immediately", async () => {
    const c = client((async () => uncancellable({ headers: { "content-length": String(50 * 1024 * 1024) } })) as typeof fetch, { timeoutMs: 5000 });
    const r = await settle(c.complete(REQUEST));
    expect(r.e!.kind).toBe("bad_response");
    expect(r.ms).toBeLessThan(1000);
  });

  it("streamed oversize body whose cancel() never settles: refused, not hung", async () => {
    const c = client((async () => uncancellable()) as typeof fetch, { timeoutMs: 5000, maxResponseBytes: 128 * 1024 });
    const r = await settle(c.complete(REQUEST));
    expect(r.e!.kind).toBe("bad_response");
    expect(r.ms).toBeLessThan(1000);
  });

  it("a stalled body whose cancel() never settles still times out on schedule, and its cancel is really invoked", async () => {
    let cancelled = 0;
    const stream = new ReadableStream<Uint8Array>({ start() {}, cancel: () => (cancelled++, new Promise<void>(() => undefined)) });
    const c = client((async () => new Response(stream, { status: 200 })) as typeof fetch);
    const r = await settle(c.complete(REQUEST));
    expect(r.e!.kind).toBe("timeout");
    expect(r.ms).toBeLessThan(1000);
    expect(cancelled).toBe(1); // reached the source through the reader that holds the lock
  });

  it("an HTTP error status whose body then stalls, ignores the abort and cannot be cancelled fails on the deadline", async () => {
    // A hostile transport: 503 headers arrive, the body never ends, nothing reacts to the abort
    // signal, and cancel() never settles. The body is read before the status is classified, so
    // this is a retryable timeout (not "http"), and it must not hang the call.
    let cancelled = 0;
    let aborted = false;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      init.signal!.addEventListener("abort", () => (aborted = true)); // observed, deliberately ignored
      const stream = new ReadableStream<Uint8Array>({ start() {}, cancel: () => (cancelled++, new Promise<void>(() => undefined)) });
      return new Response(stream, { status: 503 });
    }) as unknown as typeof fetch;
    const r = await settle(client(fetchImpl).complete(REQUEST));
    expect(r.e!.kind).toBe("timeout");
    expect(r.e!.retryable).toBe(true);
    expect(r.ms).toBeLessThan(1000);
    expect(aborted).toBe(true);
    expect(cancelled).toBe(1);
  });

  it("HTTP error statuses with an ordinary complete body are classified from their status", async () => {
    for (const [status, kind] of [[429, "rate_limited"], [503, "http"], [401, "auth"]] as const) {
      const c = client((async () => new Response("{}", { status })) as typeof fetch);
      expect((await settle(c.complete(REQUEST))).e!.kind, String(status)).toBe(kind);
    }
  });

  it("a source cancel() that rejects is reached and leaves no unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      let cancelled = 0;
      const rejecting = new ReadableStream<Uint8Array>({ start() {}, cancel: () => (cancelled++, Promise.reject(new Error("cancel failed"))) });
      const c = client((async () => new Response(rejecting, { status: 200 })) as typeof fetch);
      expect((await settle(c.complete(REQUEST))).e!.kind).toBe("timeout");
      await new Promise((r) => setTimeout(r, 50));
      expect(cancelled).toBe(1); // the rejecting cancel really ran
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("a non-standard body whose cancel() throws synchronously does not replace the timeout", async () => {
    let thrown = 0;
    const throwing = () => {
      thrown++;
      throw new Error("sync cancel failure");
    };
    const fetchImpl = (async () => {
      const res = new Response(null, { status: 200 });
      const reader = { read: () => new Promise<never>(() => undefined), cancel: throwing, releaseLock() {} };
      Object.defineProperty(res, "body", { value: { getReader: () => reader, cancel: throwing } });
      return res;
    }) as typeof fetch;
    const r = await settle(client(fetchImpl).complete(REQUEST));
    expect(r.e!.kind).toBe("timeout");
    expect(r.ms).toBeLessThan(1000);
    expect(thrown).toBe(1);
  });

  it("the single worker keeps moving when every response body is uncancellable", async () => {
    const { repo } = await loadSeed(["E004", "E009"]);
    const llm = client((async () => uncancellable({ headers: { "content-length": "999999999" } })) as typeof fetch, { timeoutMs: 200 });
    const service = new AnalysisService(repo, llm, { concurrency: 1, maxRuns: 3, queueCapacity: 10, maxCompletionTokens: 100 });
    service.enqueue("E004");
    service.enqueue("E009");
    const t = Date.now();
    await service.idle();
    expect(Date.now() - t).toBeLessThan(4000);
    expect(repo.getAnalysis("E004")!.status).toBe("degraded");
    expect(repo.getAnalysis("E009")!.status).toBe("degraded");
    await service.stop(10);
  });
});
