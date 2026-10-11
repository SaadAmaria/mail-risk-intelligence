import { describe, expect, it } from "vitest";
import { buildHealth } from "../health";
import { describeSettings, loadLlmSettings } from "../llm/config";
import { extractJsonObject } from "../llm/json";

const GROQ = {
  LLM_BASE_URL: "https://api.groq.com/openai/v1",
  LLM_MODEL: "openai/gpt-oss-120b",
  LLM_API_KEY: "gsk_test_not_a_real_key_0123456789",
};

describe("loadLlmSettings", () => {
  it("accepts a complete hosted configuration and applies defaults", () => {
    const s = loadLlmSettings(GROQ);
    expect(s.configured).toBe(true);
    expect(s.host).toBe("api.groq.com");
    expect(s.model).toBe("openai/gpt-oss-120b");
    expect(s.reasoningEffort).toBe("low");
    expect(s.maxRetries).toBe(2);
    expect(s.timeoutMs).toBe(25_000);
    expect(s.problems).toEqual([]);
  });

  it("strips trailing slashes from the base URL", () => {
    expect(loadLlmSettings({ ...GROQ, LLM_BASE_URL: "https://api.groq.com/openai/v1///" }).baseUrl).toBe(
      "https://api.groq.com/openai/v1",
    );
  });

  it("treats everything unset as not configured, without problems", () => {
    const s = loadLlmSettings({});
    expect(s.configured).toBe(false);
    expect(s.problems).toEqual([]);
  });

  // Regression: a malformed LLM_BASE_URL used to make the health handler throw (`new URL()`).
  it("reports a malformed base URL as a problem instead of throwing", () => {
    const s = loadLlmSettings({ ...GROQ, LLM_BASE_URL: "not a url" });
    expect(s.configured).toBe(false);
    expect(s.baseUrl).toBeNull();
    expect(s.host).toBeNull();
    expect(s.problems.join(" ")).toMatch(/not a valid URL/);
  });

  it("rejects non-http(s) schemes", () => {
    const s = loadLlmSettings({ ...GROQ, LLM_BASE_URL: "file:///etc/passwd" });
    expect(s.configured).toBe(false);
    expect(s.problems.join(" ")).toMatch(/http or https/);
  });

  it("requires a model when an endpoint is set", () => {
    const s = loadLlmSettings({ LLM_BASE_URL: GROQ.LLM_BASE_URL, LLM_API_KEY: GROQ.LLM_API_KEY });
    expect(s.configured).toBe(false);
    expect(s.problems.join(" ")).toMatch(/LLM_MODEL is required/);
  });

  it("requires a key for a hosted endpoint but not for a local one", () => {
    const hosted = loadLlmSettings({ LLM_BASE_URL: GROQ.LLM_BASE_URL, LLM_MODEL: GROQ.LLM_MODEL });
    expect(hosted.configured).toBe(false);
    expect(hosted.problems.join(" ")).toMatch(/LLM_API_KEY is required/);

    const local = loadLlmSettings({ LLM_BASE_URL: "http://localhost:11434/v1", LLM_MODEL: "llama3.1" });
    expect(local.configured).toBe(true);
    expect(local.apiKey).toBeNull();
  });

  it("validates numeric and enum settings, falling back with a problem", () => {
    const s = loadLlmSettings({
      ...GROQ,
      LLM_REASONING_EFFORT: "extreme",
      LLM_MAX_RETRIES: "99",
      LLM_TIMEOUT_MS: "abc",
      LLM_MAX_COMPLETION_TOKENS: "10",
    });
    expect(s.configured).toBe(true);
    expect(s.reasoningEffort).toBe("low");
    expect(s.maxRetries).toBe(2);
    expect(s.timeoutMs).toBe(25_000);
    expect(s.maxCompletionTokens).toBe(3_000);
    expect(s.problems).toHaveLength(4);
  });

  it("allows reasoning effort to be switched off", () => {
    expect(loadLlmSettings({ ...GROQ, LLM_REASONING_EFFORT: "none" }).reasoningEffort).toBeNull();
    expect(loadLlmSettings({ ...GROQ, LLM_REASONING_EFFORT: "HIGH" }).reasoningEffort).toBe("high");
  });

  it("never includes the key in its printable description or problems", () => {
    const s = loadLlmSettings({ ...GROQ, LLM_BASE_URL: "bad url" });
    expect(describeSettings(loadLlmSettings(GROQ))).not.toContain(GROQ.LLM_API_KEY);
    expect(JSON.stringify(s.problems)).not.toContain(GROQ.LLM_API_KEY);
  });
});

describe("buildHealth", () => {
  it("reports host and model when configured, never the key", () => {
    const body = buildHealth(loadLlmSettings(GROQ));
    expect(body).toMatchObject({
      status: "ok",
      service: "mail-risk-intelligence",
      llm: { configured: true, provider: "api.groq.com", model: "openai/gpt-oss-120b", reachability: "unchecked" },
    });
    expect(JSON.stringify(body)).not.toContain(GROQ.LLM_API_KEY);
  });

  it("stays healthy and honest with a malformed base URL (regression)", () => {
    const body = buildHealth(loadLlmSettings({ ...GROQ, LLM_BASE_URL: "::::" }));
    expect(body.status).toBe("ok");
    expect(body.llm).toMatchObject({ configured: false, provider: null, model: null, reachability: "unchecked" });
  });

  it("reports unconfigured when nothing is set", () => {
    expect(buildHealth(loadLlmSettings({})).llm.configured).toBe(false);
  });
});

describe("extractJsonObject", () => {
  it("parses plain JSON, a fenced block, and an object embedded in prose", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('Here you go: {"a":{"b":2}} thanks')).toEqual({ a: { b: 2 } });
  });

  it("rejects empty output, arrays, and unparseable text", () => {
    expect(() => extractJsonObject("")).toThrow(/empty/);
    expect(() => extractJsonObject("[1,2]")).toThrow(/not valid JSON|not a JSON object/);
    expect(() => extractJsonObject("no json here")).toThrow(/not valid JSON/);
    expect(() => extractJsonObject('{"a": ')).toThrow(/not valid JSON/);
  });
});
