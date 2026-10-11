import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { HealthResponse } from "@mri/shared";
import { buildHealth, healthHandler } from "../health";
import { OpenAICompatClient } from "../llm/client";
import { loadLlmSettings } from "../llm/config";
import { ProviderStatusTracker } from "../llm/status";

const KEY = "gsk_test_not_a_real_key_0123456789";
const GROQ = {
  LLM_BASE_URL: "https://api.groq.com/openai/v1",
  LLM_MODEL: "openai/gpt-oss-120b",
  LLM_API_KEY: KEY,
};

function call(llm: ReturnType<typeof loadLlmSettings>, tracker = new ProviderStatusTracker()) {
  let body: HealthResponse | undefined;
  healthHandler(llm, () => tracker.snapshot())({}, { json: (b) => (body = b) });
  return body!;
}

describe("health: configured is not reachable", () => {
  it("a valid configuration is reported as configured but 'unchecked', never as reachable", () => {
    const h = call(loadLlmSettings(GROQ));
    expect(h.llm.configured).toBe(true);
    expect(h.llm.provider).toBe("api.groq.com");
    expect(h.llm.reachability).toBe("unchecked");
    expect(h.llm.last_call_at).toBeNull();
    expect(h.llm.last_error_kind).toBeNull();
  });

  it("an ordinary health request never contacts the provider", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      for (let i = 0; i < 5; i++) call(loadLlmSettings(GROQ));
      call(loadLlmSettings({ ...GROQ, LLM_BASE_URL: "::bad::" }));
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("reports the last observed real-call outcome without making a call", () => {
    const t = new ProviderStatusTracker(() => new Date("2026-10-11T12:00:00.000Z"));
    t.record({ ok: true });
    const h = call(loadLlmSettings(GROQ), t);
    expect(h.llm).toMatchObject({
      configured: true,
      reachability: "reachable",
      last_call_at: "2026-10-11T12:00:00.000Z",
      last_error_kind: null,
    });
  });

  it("never reports reachability for an unusable configuration, even with a stale observation", () => {
    const t = new ProviderStatusTracker();
    t.record({ ok: true });
    const h = call(loadLlmSettings({ ...GROQ, LLM_API_KEY: "" }), t);
    expect(h.llm.configured).toBe(false);
    expect(h.llm.provider).toBeNull();
    expect(h.llm.reachability).toBe("unchecked");
  });
});

describe("health: malformed configuration", () => {
  it.each([["::not a url::"], ["ftp://example.test"], ["   "], ["http://"]])(
    "does not throw and explains the problem for LLM_BASE_URL=%j",
    (url) => {
      const settings = loadLlmSettings({ ...GROQ, LLM_BASE_URL: url });
      const h = call(settings);
      expect(h.status).toBe("ok");
      expect(h.llm.configured).toBe(false);
      expect(h.llm.provider).toBeNull();
      expect(h.llm.model).toBeNull();
    },
  );

  it("lists configuration problems without ever including secret values", () => {
    const h = call(loadLlmSettings({ LLM_BASE_URL: GROQ.LLM_BASE_URL, LLM_MODEL: GROQ.LLM_MODEL }));
    expect(h.llm.problems?.join(" ")).toMatch(/LLM_API_KEY is required/);

    const withKey = call(loadLlmSettings({ ...GROQ, LLM_BASE_URL: "nope", LLM_MAX_RETRIES: "99" }));
    expect(JSON.stringify(withKey)).not.toContain(KEY);
  });

  it("never serializes the API key in any health payload", () => {
    expect(JSON.stringify(buildHealth(loadLlmSettings(GROQ)))).not.toContain(KEY);
  });
});

describe("health: backward compatibility", () => {
  // The Phase 0/2 contract, as an older client would have declared it.
  const OldHealth = z.object({
    status: z.literal("ok"),
    service: z.string(),
    llm: z.object({ configured: z.boolean(), provider: z.string().nullable(), model: z.string().nullable() }),
  });

  it("the extended payload still satisfies the previous schema", () => {
    const body = buildHealth(loadLlmSettings(GROQ));
    expect(OldHealth.safeParse(body).success).toBe(true);
  });

  it("a payload without the new fields is still valid under the current schema", () => {
    const old = { status: "ok", service: "mail-risk-intelligence", llm: { configured: false, provider: null, model: null } };
    expect(HealthResponse.safeParse(old).success).toBe(true);
  });

  it("the extended payload satisfies the current schema", () => {
    expect(HealthResponse.safeParse(buildHealth(loadLlmSettings(GROQ))).success).toBe(true);
  });
});

describe("ProviderStatusTracker", () => {
  it("starts unchecked", () => {
    expect(new ProviderStatusTracker().snapshot()).toEqual({
      reachability: "unchecked",
      last_call_at: null,
      last_error_kind: null,
    });
  });

  it.each([
    [{ ok: true } as const, "reachable", null],
    [{ ok: false, kind: "network" } as const, "unreachable", "network"],
    [{ ok: false, kind: "timeout" } as const, "unreachable", "timeout"],
    [{ ok: false, kind: "auth" } as const, "credentials_rejected", "auth"],
    [{ ok: false, kind: "rate_limited" } as const, "reachable", "rate_limited"],
    [{ ok: false, kind: "http" } as const, "reachable", "http"],
    [{ ok: false, kind: "bad_response" } as const, "reachable", "bad_response"],
  ])("maps %j to %s", (outcome, reachability, kind) => {
    const t = new ProviderStatusTracker(() => new Date("2026-10-11T12:00:00.000Z"));
    t.record(outcome);
    expect(t.snapshot()).toEqual({
      reachability,
      last_call_at: "2026-10-11T12:00:00.000Z",
      last_error_kind: kind,
    });
  });

  it("the most recent call wins", () => {
    const t = new ProviderStatusTracker();
    t.record({ ok: false, kind: "timeout" });
    t.record({ ok: true });
    expect(t.snapshot().reachability).toBe("reachable");
  });
});

describe("OpenAICompatClient reports outcomes to the tracker (passive health)", () => {
  const ok = () =>
    new Response(JSON.stringify({ model: "m", choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }), { status: 200 });

  function clientWith(responses: (Response | Error)[], tracker: ProviderStatusTracker, maxRetries = 0) {
    let i = 0;
    return new OpenAICompatClient({
      baseUrl: "https://api.example.test/v1",
      model: "m",
      apiKey: KEY,
      timeoutMs: 1000,
      reasoningEffort: null,
      maxRetries,
      sleep: async () => undefined,
      onResult: (o) => tracker.record(o),
      fetchImpl: (async () => {
        const next = responses[i++]!;
        if (next instanceof Error) throw next;
        return next;
      }) as unknown as typeof fetch,
    });
  }
  const req = { messages: [{ role: "user" as const, content: "x" }], maxCompletionTokens: 100 };

  it("marks reachable after a successful call", async () => {
    const t = new ProviderStatusTracker();
    await clientWith([ok()], t).complete(req);
    expect(t.snapshot().reachability).toBe("reachable");
  });

  it("marks unreachable after a network failure and credentials_rejected after a 401", async () => {
    const t = new ProviderStatusTracker();
    await clientWith([new TypeError("fetch failed")], t).complete(req).catch(() => undefined);
    expect(t.snapshot()).toMatchObject({ reachability: "unreachable", last_error_kind: "network" });

    await clientWith([new Response("{}", { status: 401 })], t).complete(req).catch(() => undefined);
    expect(t.snapshot()).toMatchObject({ reachability: "credentials_rejected", last_error_kind: "auth" });
  });

  it("records only the final outcome of a call that needed retries", async () => {
    const seen: string[] = [];
    const t = { record: (o: { ok: boolean }) => seen.push(String(o.ok)) } as unknown as ProviderStatusTracker;
    await clientWith([new Response("x", { status: 503 }), ok()], t, 2).complete(req);
    expect(seen).toEqual(["true"]);
  });
});
