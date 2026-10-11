import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isAutomaticChecksRun, type AnalysisRecord } from "@mri/shared";
import { OpenAICompatClient } from "../llm/client";
import { loadLlmSettings } from "../llm/config";
import { LlmError, type LlmClient, type LlmRequest, type LlmResult } from "../llm/types";
import { setupReplay } from "../replay/setup";
import { startApi, waitFor, GatedLlm, type Started } from "./apiHarness";
import { FakeLlm } from "./fakes/fakeLlm";
import { aiComplete, loadSeed } from "./riskFixtures";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = path.resolve(here, "..");
const REPO_ROOT = path.resolve(here, "../../..");
const RECORDED_DIR = path.join(REPO_ROOT, "fixtures", "recorded");

let app: Started | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
  vi.restoreAllMocks();
});

/** A provider that fails the test the moment anything touches it. */
class TripwireLlm implements LlmClient {
  readonly model = "tripwire-model";
  readonly provenance = "live" as const;
  calls = 0;
  async complete(_request: LlmRequest): Promise<LlmResult> {
    this.calls++;
    throw new LlmError("http", "TRIPWIRE: the rules-only path reached an LlmClient");
  }
}

/** Records every outbound request and refuses anything that is not the test's own loopback API. */
function networkGuard() {
  const external: string[] = [];
  const real = globalThis.fetch;
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    if (!/^http:\/\/127\.0\.0\.1[:/]/.test(url)) {
      external.push(url);
      throw new Error(`network guard: blocked ${url}`);
    }
    return real(input, init);
  });
  return { external, spy };
}

const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const fixtureDigests = () =>
  Object.fromEntries(readdirSync(RECORDED_DIR).sort().map((f) => [f, digest(path.join(RECORDED_DIR, f))]));
const record = (a: Started, id: string): AnalysisRecord | null => a.repo.getAnalysis(id);

const CONFIGURED = loadLlmSettings({
  LLM_BASE_URL: "https://api.groq.com/openai/v1",
  LLM_API_KEY: "gsk_unit_test_not_a_real_key_0000000000",
  LLM_MODEL: "test-model",
});

describe("POST /api/emails/:id/automatic-checks: behaviour", () => {
  it("stores a rules-only result: degraded, provenance rules, extraction present, no assessment", async () => {
    const { repo } = await loadSeed();
    app = await startApi({ repo, llm: null });
    const r = await app.postJson("/api/emails/E009/automatic-checks", {});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      id: "E009",
      result: "performed",
      processing: { status: "degraded", analysis_mode: "degraded", provenance: "rules", model: null, in_progress: false },
    });

    const rec = record(app, "E009")!;
    expect(rec.assessment).toBeNull();
    expect(rec.extraction).not.toBeNull();
    expect(rec.warnings.join(" ")).toMatch(/Automatic checks only/);
    expect(rec.runs.at(-1)).toMatchObject({ outcome: "degraded" });
    expect(rec.runs.at(-1)!.stages.every((s) => s.calls === 0)).toBe(true);
    expect(isAutomaticChecksRun(rec.runs)).toBe(true);

    const detail = (await app.get("/api/emails/E009")).body;
    expect(detail.assessment).toBeNull();
    expect(detail.risk.assessed).toBe(false);
    expect(detail.risk.final_level).toBe("unassessed"); // never "none"/safe
    expect(detail.processing.status).toBe("degraded");
  });

  it("is idempotent: a repeat reports unchanged and writes nothing", async () => {
    const { repo } = await loadSeed();
    app = await startApi({ repo });
    await app.postJson("/api/emails/E009/automatic-checks", {});
    const before = JSON.stringify(record(app, "E009"));
    const again = await app.postJson("/api/emails/E009/automatic-checks", {});
    expect(again.status).toBe(200);
    expect(again.body.result).toBe("unchanged");
    expect(JSON.stringify(record(app, "E009"))).toBe(before);
    expect(record(app, "E009")!.runs).toHaveLength(1);
  });

  it("serializes concurrent requests: exactly one performs, the rest are unchanged", async () => {
    const { repo } = await loadSeed();
    app = await startApi({ repo });
    const results = await Promise.all(
      Array.from({ length: 8 }, () => app!.postJson("/api/emails/E009/automatic-checks", {})),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    const kinds = results.map((r) => r.body.result).sort();
    expect(kinds.filter((k) => k === "performed")).toHaveLength(1);
    expect(kinds.filter((k) => k === "unchanged")).toHaveLength(7);
    expect(record(app, "E009")!.runs).toHaveLength(1);
  });

  it("never replaces a complete analysis, live or recorded", async () => {
    for (const provenance of ["live", "recorded"] as const) {
      const { repo } = await loadSeed();
      const rec = { ...aiComplete(repo.getEmail("E004")!, "low"), provenance };
      repo.saveAnalysis(rec);
      app = await startApi({ repo });
      const before = JSON.stringify(repo.getAnalysis("E004"));
      const r = await app.postJson("/api/emails/E004/automatic-checks", {});
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe("already_complete");
      expect(JSON.stringify(repo.getAnalysis("E004"))).toBe(before);
      await app.close();
      app = null;
    }
  });

  it("never replaces an AI-produced extraction kept by a partial result", async () => {
    const { repo } = await loadSeed();
    const base = aiComplete(repo.getEmail("E004")!, "low");
    repo.saveAnalysis({
      ...base,
      status: "partial",
      analysis_mode: "partial",
      assessment: null,
      provenance: "live",
      runs: [],
    });
    app = await startApi({ repo });
    const before = JSON.stringify(repo.getAnalysis("E004"));
    const r = await app.postJson("/api/emails/E004/automatic-checks", {});
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("ai_extraction_present");
    expect(JSON.stringify(repo.getAnalysis("E004"))).toBe(before);
  });

  it("refuses an email that is queued or running, and does not disturb that run", async () => {
    const { repo } = await loadSeed();
    const gate = new GatedLlm(new FakeLlm([]));
    app = await startApi({ repo, llm: gate });
    const start = await app.postJson("/api/emails/E009/reprocess", {});
    expect(start.status).toBe(202);
    await waitFor(async () => gate.entered > 0 || null, 3000, "provider call to begin");
    const r = await app.postJson("/api/emails/E009/automatic-checks", {});
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("already_processing");
    expect(record(app, "E009")!.provenance).not.toBe("rules");
    gate.release();
    await app.analysis.idle();
  });

  it("reports an unknown or malformed id as not found, and only POST is accepted", async () => {
    app = await startApi({ repo: (await loadSeed()).repo });
    expect((await app.postJson("/api/emails/NOPE/automatic-checks", {})).status).toBe(404);
    expect((await app.postJson("/api/emails/..%2Fx/automatic-checks", {})).status).toBe(404);
    const get = await app.get("/api/emails/E009/automatic-checks");
    expect(get.status).toBe(404); // not a readable resource: GET falls through to the API 404
    expect(record(app, "E009")).toBeNull();
  });

  it("works with no request body and with the same security headers as other routes", async () => {
    app = await startApi({ repo: (await loadSeed()).repo });
    const res = await fetch(`${app.baseUrl}/api/emails/E009/automatic-checks`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-powered-by")).toBeNull();
  });

  it("applies the CORS allow-list: a disallowed origin gets no allow-origin header", async () => {
    app = await startApi({ repo: (await loadSeed()).repo, corsOrigins: ["http://localhost:5173"] });
    const bad = await fetch(`${app.baseUrl}/api/emails/E009/automatic-checks`, {
      method: "POST",
      headers: { origin: "http://evil.example" },
    });
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
    const good = await fetch(`${app.baseUrl}/api/emails/E001/automatic-checks`, {
      method: "POST",
      headers: { origin: "http://localhost:5173" },
    });
    expect(good.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });
});

describe("automatic checks: no path to a provider", () => {
  it("makes zero provider calls with a live client configured (tripwire client, real configured settings)", async () => {
    const guard = networkGuard();
    const tripwire = new TripwireLlm();
    const { repo } = await loadSeed();
    app = await startApi({ repo, llm: tripwire, llmSettings: CONFIGURED });
    expect((await app.get("/api/health")).body.llm.configured).toBe(true);

    for (const id of ["E009", "E001", "E010"]) {
      const r = await app.postJson(`/api/emails/${id}/automatic-checks`, {});
      expect(r.status).toBe(200);
    }
    expect(tripwire.calls).toBe(0);
    expect(guard.external).toEqual([]);
    expect(app.tracker.snapshot().last_call_at).toBeNull();
  });

  it("sends nothing through a real OpenAI-compatible client carrying a key (its fetch is a counting stub)", async () => {
    const hits: string[] = [];
    const client = new OpenAICompatClient({
      baseUrl: "https://api.groq.com/openai/v1",
      model: "test-model",
      apiKey: "gsk_unit_test_not_a_real_key_0000000000",
      timeoutMs: 1000,
      reasoningEffort: null,
      maxRetries: 0,
      fetchImpl: (async (url: unknown) => {
        hits.push(String(url));
        throw new Error("blocked");
      }) as typeof fetch,
    });
    const guard = networkGuard();
    const { repo } = await loadSeed();
    app = await startApi({ repo, llm: client, llmSettings: CONFIGURED });
    await app.postJson("/api/emails/E009/automatic-checks", {});
    expect(hits).toEqual([]);
    expect(guard.external).toEqual([]);

    // Control: the same client DOES call its fetch when the AI path is used, so the zero above
    // is meaningful and not an artefact of a broken stub.
    await app.postJson("/api/emails/E001/reprocess", {});
    await app.analysis.idle();
    expect(hits.length).toBeGreaterThan(0);
  });

  it("the module's static import graph contains no provider client, replay, config or AI service", () => {
    const entry = path.join(SERVER_SRC, "analysis", "automaticChecks.ts");
    const seen = new Set<string>();
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?from\s+["'](\.[^"']+)["']/g)) {
        const base = path.resolve(path.dirname(file), m[1]!);
        const target = [base + ".ts", path.join(base, "index.ts")].find((p) => existsSync(p));
        if (target) walk(target);
      }
    };
    walk(entry);
    const rel = [...seen].map((f) => path.relative(SERVER_SRC, f).replace(/\\/g, "/")).sort();

    const forbidden = [
      "llm/client.ts",
      "llm/config.ts",
      "llm/status.ts",
      "analysis/service.ts",
      "analysis/queue.ts",
      "analysis/bootstrap.ts",
      "replay/recordedClient.ts",
      "replay/recorder.ts",
      "replay/setup.ts",
      "config.ts",
      "index.ts",
    ];
    for (const f of forbidden) expect(rel, `must not import ${f}`).not.toContain(f);
    expect(rel.filter((f) => f.startsWith("replay/"))).toEqual([]);
    // The agent entry points that take a client are not imported either.
    expect(rel).not.toContain("agents/riskAgent.ts");
    // Documented limit: extractionAgent.ts is reached (for buildDeterministicExtraction), and it
    // contains runExtractionAgent(client, ...). Reaching a model needs a client object that this
    // module is never given.
    expect(rel).toContain("agents/extractionAgent.ts");
  });

  it("the module has no LlmClient parameter, field or construction", () => {
    const src = readFileSync(path.join(SERVER_SRC, "analysis", "automaticChecks.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/LlmClient|OpenAICompat|RecordedLlm|runExtractionAgent|runRiskAgent|fetch\s*\(|apiKey|process\.env/);
  });

  it("the route handler reaches only the rules-only service (it does not call the AI queue)", async () => {
    const { repo } = await loadSeed();
    app = await startApi({ repo, llm: new FakeLlm([]) });
    const enqueue = vi.spyOn(app.analysis, "enqueue");
    await app.postJson("/api/emails/E009/automatic-checks", {});
    expect(enqueue).not.toHaveBeenCalled();
    expect(app.analysis.queueDepth).toEqual({ waiting: 0, running: 0 });
  });
});

describe("automatic checks: fixtures and existing behaviour", () => {
  it("does not touch the recorded fixtures", async () => {
    const before = fixtureDigests();
    const { repo } = await loadSeed();
    app = await startApi({ repo });
    await app.postJson("/api/emails/E009/automatic-checks", {});
    await app.postJson("/api/emails/E004/automatic-checks", {});
    expect(fixtureDigests()).toEqual(before);
  });

  it("leaves reprocess working afterwards: an automatic-checks result is retried like any degraded one", async () => {
    const { repo } = await loadSeed();
    const fake = new FakeLlm([]); // an empty script makes any call fail -> degraded, but proves the AI path is used
    app = await startApi({ repo, llm: fake });
    await app.postJson("/api/emails/E009/automatic-checks", {});
    const detail = (await app.get("/api/emails/E009")).body;
    expect(detail.processing.can_reprocess).toBe(true);
    const r = await app.postJson("/api/emails/E009/reprocess", {});
    expect(r.status).toBe(202);
    await app.analysis.idle();
    expect(fake.callCount).toBeGreaterThan(0);
  });

  it("the E004/E009 scenario: shared-sender node, no invented edges, comparison preserved", async () => {
    const { repo } = await loadSeed();
    const replay = setupReplay(RECORDED_DIR, repo);
    expect(replay.client).not.toBeNull();
    expect(replay.status.email_ids).toEqual(["E001", "E004", "E007"]);
    app = await startApi({ repo, llm: replay.client, replay: replay.status });

    expect((await app.postJson("/api/emails/E004/reprocess", {})).status).toBe(202);
    await app.analysis.idle();
    expect(record(app, "E004")!.provenance).toBe("recorded");

    const before = (await app.get("/api/graph?include_amounts=true")).body;
    const sender = "person:email:billing@northgate-suppliers.com";
    expect(before.nodes.find((n: any) => n.id === sender).email_ids).toEqual(["E004"]);

    const r = await app.postJson("/api/emails/E009/automatic-checks", {});
    expect(r.status).toBe(200);
    const after = (await app.get("/api/graph?include_amounts=true")).body;

    // E009 contributes only header-derived people: the sender merges by identical verified address.
    expect(after.nodes.find((n: any) => n.id === sender).email_ids).toEqual(["E004", "E009"]);
    expect(after.edges).toEqual(before.edges); // no relationship was synthesized
    const added = after.nodes.filter((n: any) => !before.nodes.some((b: any) => b.id === n.id));
    expect(added.every((n: any) => n.origin === "rules" && n.type === "person")).toBe(true);
    expect(added.map((n: any) => n.email_ids)).toEqual(added.map(() => ["E009"]));
    expect(after.nodes.filter((n: any) => n.type === "account").every((n: any) => !n.email_ids.includes("E009"))).toBe(true);

    // The E004 comparison is a read-time view of stored emails and is unchanged.
    const d4 = (await app.get("/api/emails/E004")).body;
    const account = d4.risk.findings.find((f: any) => f.rule_id === "payment_account_changed");
    const amount = d4.risk.findings.find((f: any) => f.rule_id === "invoice_amount_anomaly");
    expect(account).toBeTruthy();
    expect(JSON.stringify(account)).toMatch(/6621/);
    expect(JSON.stringify(account)).toMatch(/9902/);
    expect(JSON.stringify(amount)).toMatch(/13,900|13900/);
    expect(JSON.stringify(amount)).toMatch(/47,300|47300/);

    // The recorded assessment of E004 is untouched and E009 reads as not assessed by AI.
    expect(record(app, "E004")!.status).toBe("complete");
    expect((await app.get("/api/emails/E009")).body.risk.final_level).toBe("unassessed");
  });
});
