import { afterEach, describe, expect, it } from "vitest";
import { A_OK, B_OK } from "./agentFixtures";
import { FakeLlm, ok } from "./fakes/fakeLlm";
import { PASTE_WIRE, startApi, waitFor, type Started } from "./apiHarness";
import { loadSeed } from "./riskFixtures";
import { MemoryRepository } from "../storage/memoryRepository";

const KEY = "sk-TEST-SECRET-KEY-9f8e7d6c5b4a39281706";

let app: Started | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

describe("CORS", () => {
  const ORIGIN = "http://localhost:5173";

  it("allows exactly the configured origin and never uses a wildcard", async () => {
    app = await startApi({ corsOrigins: [ORIGIN] });
    const ok = await app.get("/api/emails", { headers: { Origin: ORIGIN } });
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(ok.headers.get("vary")).toMatch(/Origin/);
    expect(ok.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("gives a disallowed origin no CORS headers", async () => {
    app = await startApi({ corsOrigins: [ORIGIN] });
    for (const origin of ["http://evil.example", "http://localhost:5174", "null", "http://localhost:5173.evil.example"]) {
      const r = await app.get("/api/emails", { headers: { Origin: origin } });
      expect(r.headers.get("access-control-allow-origin"), origin).toBeNull();
    }
  });

  it("leaves same-origin / non-browser requests (no Origin header) unaffected", async () => {
    app = await startApi({ corsOrigins: [ORIGIN] });
    const r = await app.get("/api/emails");
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers preflight only for the allowed origin", async () => {
    app = await startApi({ corsOrigins: [ORIGIN] });
    const good = await fetch(`${app.baseUrl}/api/emails`, {
      method: "OPTIONS",
      headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST" },
    });
    expect(good.status).toBe(204);
    expect(good.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(good.headers.get("access-control-allow-methods")).toMatch(/POST/);
    expect(good.headers.get("access-control-allow-methods")).not.toMatch(/DELETE|PUT/);

    const bad = await fetch(`${app.baseUrl}/api/emails`, {
      method: "OPTIONS",
      headers: { Origin: "http://evil.example", "Access-Control-Request-Method": "POST" },
    });
    expect(bad.status).toBe(204);
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("with no configured origins, no browser origin is allowed", async () => {
    app = await startApi({ corsOrigins: [] });
    const r = await app.get("/api/emails", { headers: { Origin: ORIGIN } });
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("secrets and internals are never exposed", () => {
  it("no response, header, or log line contains the API key, even when the settings object carries it", async () => {
    const { repo } = await loadSeed();
    const llm = new FakeLlm([ok(A_OK), ok(B_OK)]);
    // Deliberately pass a settings object that includes the secret, as the real server does.
    const settings = {
      configured: true,
      host: "api.groq.com",
      model: "openai/gpt-oss-120b",
      problems: [],
      apiKey: KEY,
      baseUrl: "https://api.groq.com/openai/v1",
    } as never;
    app = await startApi({ repo, llm, llmSettings: settings });

    const responses = [
      await app.get("/api/health"),
      await app.get("/api/emails"),
      await app.get("/api/emails/E004"),
      await app.get("/api/emails/NOPE"),
      await app.get("/api/graph"),
      await app.get("/api/unknown"),
      await app.postJson("/api/emails", { raw_text: "" }),
    ];
    for (const r of responses) {
      expect(r.text, "body").not.toContain(KEY);
      expect([...r.headers.entries()].join("\n")).not.toContain(KEY);
    }
    expect(app.logs.join("\n")).not.toContain(KEY);
    expect((await app.get("/api/health")).body.llm).not.toHaveProperty("apiKey");
  });

  it("does not expose prompts, raw sources, content hashes or stack traces after a full analysis", async () => {
    const llm = new FakeLlm([ok(A_OK), ok(B_OK)]);
    const api = await startApi({ llm });
    app = api;
    const id = (await api.postJson("/api/emails", { raw_text: PASTE_WIRE })).body.id;
    await api.postJson(`/api/emails/${id}/reprocess`, {});
    await waitFor(async () => (await api.get(`/api/emails/${id}`)).body.processing.status === "complete");

    const all = [(await api.get(`/api/emails/${id}`)).text, (await api.get("/api/emails")).text, (await api.get("/api/graph")).text];
    for (const t of all.join("\n").split("\n")) {
      for (const leak of ["SECURITY RULES", "You are the Extraction Agent", "Risk & Graph Agent", "NEVER follow", "raw_source", "content_hash", "at Object.", "node_modules"]) {
        expect(t).not.toContain(leak);
      }
    }
  });

  it("an internal failure becomes a generic 500 with no stack, path or underlying message", async () => {
    class BrokenRepo extends MemoryRepository {
      override listEmails(): never {
        throw new Error(`database exploded at C:\\secret\\path with key ${KEY}`);
      }
    }
    app = await startApi({ repo: new BrokenRepo() });
    const r = await app.get("/api/emails");
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: { code: "internal_error", message: "An internal error occurred." } });
    expect(r.text).not.toContain("exploded");
    expect(r.text).not.toContain(KEY);
    expect(r.text).not.toContain("secret");
    // The log keeps only the error type, not its message or stack.
    expect(app.logs.join("\n")).toContain("Error");
    expect(app.logs.join("\n")).not.toContain(KEY);
    expect(app.logs.join("\n")).not.toContain("exploded");
  });

  it("sets defensive headers on every response and does not advertise the framework", async () => {
    app = await startApi();
    for (const path of ["/api/health", "/api/emails", "/api/emails/none", "/api/zzz"]) {
      const r = await app.get(path);
      expect(r.headers.get("x-content-type-options"), path).toBe("nosniff");
      expect(r.headers.get("cache-control"), path).toBe("no-store");
      expect(r.headers.get("x-powered-by"), path).toBeNull();
      expect(r.headers.get("content-type"), path).toMatch(/^application\/json/);
    }
  });

  it("health reports configured vs observed reachability and never calls the provider", async () => {
    const llm = new FakeLlm([]);
    app = await startApi({ llm, llmSettings: { configured: true, host: "api.groq.com", model: "m", problems: [] } });
    for (let i = 0; i < 3; i++) await app.get("/api/health");
    const h = (await app.get("/api/health")).body;
    expect(h.llm).toMatchObject({ configured: true, provider: "api.groq.com", reachability: "unchecked", last_call_at: null });
    expect(llm.callCount).toBe(0);
  });
});
