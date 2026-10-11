import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExtractionSchemaVersion, RiskAnalysisSchemaVersion, type AnalysisRecord } from "@mri/shared";
import { AnalysisService, PROMPT_VERSION } from "../analysis/service";
import { seedRecords } from "../ingestion/seed";
import { ingestPastedText } from "../ingestion/ingest";
import type { SeedEmail } from "../ingestion/parseSeed";
import type { LlmClient, LlmRequest, LlmResult } from "../llm/types";
import { buildHealth } from "../health";
import { loadLlmSettings } from "../llm/config";
import { computeIntegrity, MANIFEST_FILE, resultDigest, seal, type RecordedFixture } from "../replay/fixture";
import { loadRecordings } from "../replay/loader";
import { RecordedLlmClient } from "../replay/recordedClient";
import { recordFixtures, scanForSecrets } from "../replay/recorder";
import { setupReplay } from "../replay/setup";
import { MemoryRepository } from "../storage/memoryRepository";
import { A_OK, B_NONE, B_OK, WIRE_BODY } from "./agentFixtures";
import { FakeLlm, fail, ok, raw } from "./fakes/fakeLlm";
import { startApi, waitFor, type Started } from "./apiHarness";

const SEED: SeedEmail = {
  id: "T1",
  from: "d.cole@acme-parts.example",
  to: ["ap@arcline.com"],
  date: "2026-06-02T08:14:00Z",
  subject: "URGENT wire before noon",
  body: WIRE_BODY,
  attachments: [],
};

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "mri-replay-"));
  dirs.push(d);
  return d;
};
let started: Started | null = null;
afterEach(async () => {
  await started?.close();
  started = null;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const NOW = () => new Date("2026-07-01T10:00:00Z");

async function seededRepo(records: SeedEmail[] = [SEED]): Promise<MemoryRepository> {
  const repo = new MemoryRepository();
  await seedRecords({ repo }, { total: records.length, records, errors: [] });
  return repo;
}

/** Record with a scripted FAKE provider (no network anywhere) into a temp directory. */
async function record(script: ConstructorParameters<typeof FakeLlm>[0]) {
  const outDir = tmp();
  const llm = new FakeLlm(script);
  const report = await recordFixtures({
    seed: [SEED],
    client: llm,
    outDir,
    now: NOW,
    tool: "test",
    providerHost: "fake.example",
    requestedModel: "fake-model",
    secrets: ["SECRET-VALUE-1234567890"],
  });
  return { outDir, llm, report };
}

function service(repo: MemoryRepository, client: LlmClient | null) {
  return new AnalysisService(repo, client, { concurrency: 1, maxRuns: 3, queueCapacity: 10, maxCompletionTokens: 1000, now: NOW });
}

async function run(repo: MemoryRepository, client: LlmClient | null, id = "T1", force = false) {
  const s = service(repo, client);
  const queued = s.enqueue(id, { force });
  await s.idle();
  return { queued, record: repo.getAnalysis(id) as AnalysisRecord, s };
}

function target(repo: MemoryRepository) {
  return {
    lookup: (id: string) => repo.getEmail(id),
    promptVersion: PROMPT_VERSION,
    extractionSchemaVersion: ExtractionSchemaVersion,
    riskSchemaVersion: RiskAnalysisSchemaVersion,
  };
}

function readFixture(dir: string): RecordedFixture {
  return JSON.parse(readFileSync(path.join(dir, "T1.json"), "utf8"));
}

function rewrite(dir: string, mutate: (f: RecordedFixture) => RecordedFixture, opts: { reseal: boolean }) {
  const f = mutate(readFixture(dir));
  const { integrity: _i, ...body } = f;
  const out = opts.reseal ? seal(body) : f;
  writeFileSync(path.join(dir, "T1.json"), JSON.stringify(out, null, 2));
  if (opts.reseal) {
    const manifest = JSON.parse(readFileSync(path.join(dir, MANIFEST_FILE), "utf8"));
    manifest.files[0].integrity = out.integrity;
    writeFileSync(path.join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2));
  }
}

describe("recorder (fake provider only)", () => {
  it("records through the real pipeline, verifies by replay, and writes a clean fixture", async () => {
    const { outDir, llm, report } = await record([ok(A_OK), ok(B_OK)]);
    expect(report.outcomes).toEqual([{ id: "T1", ok: true, status: "complete", calls: 2, attempt: 1, replaced: false }]);
    expect(llm.callCount).toBe(2);
    expect(readdirSync(outDir).sort()).toEqual(["T1.json", "index.json"]);

    const text = readFileSync(path.join(outDir, "T1.json"), "utf8");
    const f = JSON.parse(text) as RecordedFixture;
    expect(f.email).toMatchObject({ id: "T1" });
    expect(f.calls.map((c) => c.stage)).toEqual(["extraction", "risk"]);
    expect(f.capture).toMatchObject({ provider_host: "fake.example", attempt: 1, attempts_made: 1 });
    expect(f.result.status).toBe("complete");
    // No prompt text, system rules or untrusted markers are stored: only a hash of the request.
    expect(text).not.toMatch(/SECURITY RULES|UNTRUSTED|You are the/);
    expect(f.integrity).toBe(computeIntegrity({ ...f, integrity: undefined } as never));
  });

  it("refuses non-seed ids and writes nothing for them", async () => {
    const outDir = tmp();
    const report = await recordFixtures({
      seed: [SEED],
      ids: ["NOT-SEED"],
      client: new FakeLlm([]),
      outDir,
      tool: "test",
      providerHost: null,
      requestedModel: "m",
    });
    expect(report.outcomes).toEqual([{ id: "NOT-SEED", ok: false, reason: "not a seed email id" }]);
    expect(readdirSync(outDir)).toEqual([]);
  });

  it("does not publish a result when the provider produced no completion", async () => {
    const { outDir, report } = await record([fail("timeout", "timed out")]);
    expect(report.outcomes[0]).toMatchObject({ id: "T1", ok: false });
    expect(readdirSync(outDir)).toEqual([]);
  });

  it("preserves a partial (ungrounded) capture faithfully instead of tidying it", async () => {
    const ungrounded = { ...B_OK, risk: { ...B_OK.risk, evidence: [{ snippet_id: "s1", quote: "text that is nowhere in the email" }] } };
    const { outDir, report } = await record([ok(A_OK), ok(ungrounded), ok(ungrounded)]);
    expect(report.outcomes[0]).toMatchObject({ ok: true, status: "partial" });
    expect(readFixture(outDir).result.status).toBe("partial");
  });

  it("rejects a fixture that would contain a configured secret", async () => {
    const leaky = { ...A_OK, summary: "token SECRET-VALUE-1234567890 appears here" };
    const { outDir, report } = await record([ok(leaky), ok(B_OK)]);
    expect(report.outcomes[0]).toMatchObject({ ok: false });
    expect((report.outcomes[0] as { reason: string }).reason).toMatch(/possible secret/);
    expect(readdirSync(outDir)).toEqual([]);
  });

  it("scanForSecrets reports check names, never the matched text", () => {
    // Built at run time so no key-shaped literal sits in the repository.
    const fake = ["gsk", "_", "a".repeat(24)].join("");
    const hits = scanForSecrets(`x ${fake} and C:\\Users\\bob`, []);
    expect(hits).toEqual(expect.arrayContaining(["groq-style key", "windows user path"]));
    expect(JSON.stringify(hits)).not.toContain(fake);
  });
});

describe("replay passes the same validation as live", () => {
  it("replays to the identical persisted result, labelled recorded, with no provider", async () => {
    const { outDir } = await record([ok(A_OK), ok(B_OK)]);

    const live = await run(await seededRepo(), new FakeLlm([ok(A_OK), ok(B_OK)]));
    expect(live.record.provenance).toBe("live");

    const repo = await seededRepo();
    const setup = setupReplay(outDir, repo);
    expect(setup.status).toMatchObject({ available: true, email_ids: ["T1"], model: "fake-model" });
    expect(setup.client).not.toBeNull();

    const replayed = await run(repo, setup.client);
    expect(replayed.record.status).toBe("complete");
    expect(replayed.record.provenance).toBe("recorded");
    expect(replayed.record.assessment).toEqual(live.record.assessment);
    expect(replayed.record.extraction).toEqual(live.record.extraction);
    expect(replayed.record.model).toBe("fake-model");
    expect(replayed.record.runs[0]!.stages[0]!.latency_ms).toBe(0); // this run took no provider time
  });

  it("is deterministic across repeated replays in fresh databases", async () => {
    const { outDir } = await record([ok(A_OK), ok(B_OK)]);
    const digests: string[] = [];
    for (let i = 0; i < 3; i++) {
      const repo = await seededRepo();
      const { client } = setupReplay(outDir, repo);
      const r = await run(repo, client);
      digests.push(resultDigest(r.record));
    }
    expect(new Set(digests).size).toBe(1);
    expect(digests[0]).toBe(readFixture(outDir).result.digest);
  });

  it("an invalid quote in a (consistently sealed) fixture cannot become verified evidence", async () => {
    const { outDir } = await record([ok(A_OK), ok(B_OK)]);
    const f = readFixture(outDir);
    const bad = JSON.parse(f.calls[1]!.content);
    bad.risk.evidence = [{ snippet_id: "s1", quote: "a quotation that is not in the email" }];
    const { integrity: _old, ...base } = f;
    const tampered = seal({
      ...base,
      calls: [f.calls[0]!, { ...f.calls[1]!, content: JSON.stringify(bad) }],
    });

    const repo = await seededRepo();
    const r = await run(repo, new RecordedLlmClient([tampered]));
    expect(r.record.status).not.toBe("complete");
    expect(r.record.assessment).toBeNull();
  });

  it("replays a recorded repair attempt in order, and degrades safely if it is missing", async () => {
    const { outDir } = await record([raw("this is not json"), ok(A_OK), ok(B_OK)]);
    const f = readFixture(outDir);
    expect(f.calls).toHaveLength(3);

    const repo = await seededRepo();
    const r = await run(repo, new RecordedLlmClient([f]));
    expect(r.record.status).toBe("complete");
    expect(r.record.runs[0]!.stages[0]!.calls).toBeGreaterThanOrEqual(1);

    const { integrity: _old, ...base } = f;
    const missing = seal({ ...base, calls: [f.calls[0]!] });
    const repo2 = await seededRepo();
    const r2 = await run(repo2, new RecordedLlmClient([missing]));
    expect(r2.record.status).toBe("degraded");
    expect(r2.record.assessment).toBeNull();
    expect(r2.record.runs[0]!.stages[0]!.error_kind).toBe("not_recorded");
  });
});

describe("loader: unusable recordings are rejected safely", () => {
  it("no directory or an empty one is simply 'no recordings'", async () => {
    const repo = await seededRepo();
    expect(loadRecordings(path.join(tmp(), "missing"), target(repo))).toEqual({ byEmail: new Map(), problems: [] });
    expect(loadRecordings(tmp(), target(repo)).byEmail.size).toBe(0);
  });

  it("fixture files without a manifest are ignored with a reason", async () => {
    const { outDir } = await record([ok(A_OK), ok(B_OK)]);
    rmSync(path.join(outDir, MANIFEST_FILE));
    const r = loadRecordings(outDir, target(await seededRepo()));
    expect(r.byEmail.size).toBe(0);
    expect(r.problems.join(" ")).toMatch(/manifest .* missing/);
  });

  it.each([
    ["corrupted JSON", (d: string) => writeFileSync(path.join(d, "T1.json"), "{ not json"), /not valid JSON/],
    [
      "edited without re-sealing",
      (d: string) => rewrite(d, (f) => ({ ...f, calls: [{ ...f.calls[0]!, content: "changed" }, f.calls[1]!] }), { reseal: false }),
      /integrity check failed/,
    ],
    [
      "unsupported format version",
      (d: string) => rewrite(d, (f) => ({ ...f, format_version: 2 as never }), { reseal: false }),
      /does not match the fixture format/,
    ],
    [
      "changed prompt version",
      (d: string) => rewrite(d, (f) => ({ ...f, pipeline: { ...f.pipeline, prompt_version: "extract-v0+risk-v0" } }), { reseal: true }),
      /incompatible/,
    ],
    [
      "changed schema version",
      (d: string) => rewrite(d, (f) => ({ ...f, pipeline: { ...f.pipeline, risk_schema_version: 99 } }), { reseal: true }),
      /incompatible/,
    ],
  ])("%s", async (_name, damage, expected) => {
    const { outDir } = await record([ok(A_OK), ok(B_OK)]);
    (damage as (d: string) => void)(outDir);
    const r = loadRecordings(outDir, target(await seededRepo()));
    expect(r.byEmail.size).toBe(0);
    expect(r.problems.join(" ")).toMatch(expected as RegExp);
  });

  it("a message that changed since recording is stale and not used", async () => {
    const { outDir } = await record([ok(A_OK), ok(B_OK)]);
    const changed = await seededRepo([{ ...SEED, body: `${SEED.body} Please also confirm the new account.` }]);
    const r = loadRecordings(outDir, target(changed));
    expect(r.byEmail.size).toBe(0);
    expect(r.problems.join(" ")).toMatch(/stale/);

    const absent = loadRecordings(outDir, target(new MemoryRepository()));
    expect(absent.problems.join(" ")).toMatch(/no such message/);
  });

  it("rejects a manifest entry that tries to leave the directory", async () => {
    const { outDir } = await record([ok(A_OK), ok(B_OK)]);
    const manifest = JSON.parse(readFileSync(path.join(outDir, MANIFEST_FILE), "utf8"));
    manifest.files[0].file = "../T1.json";
    writeFileSync(path.join(outDir, MANIFEST_FILE), JSON.stringify(manifest));
    const r = loadRecordings(outDir, target(await seededRepo()));
    expect(r.byEmail.size).toBe(0);
    expect(r.problems.join(" ")).toMatch(/manifest is unusable/);
  });

  it("an unlisted fixture file is not loaded", async () => {
    const { outDir } = await record([ok(A_OK), ok(B_OK)]);
    writeFileSync(path.join(outDir, "EXTRA.json"), readFileSync(path.join(outDir, "T1.json")));
    const r = loadRecordings(outDir, target(await seededRepo()));
    expect(r.byEmail.size).toBe(1);
    expect(r.problems.join(" ")).toMatch(/EXTRA.json: not listed/);
  });
});

describe("routing, provenance and safety around replay", () => {
  it("an unknown or pasted email is never assessed from a recording", async () => {
    const { outDir } = await record([ok(A_OK), ok(B_OK)]);
    const repo = await seededRepo();
    const pasted = await ingestPastedText(
      { repo },
      "From: Pat <pat@vendor.example>\nTo: ap@arcline.com\nSubject: Hello\n\nPlease review the attached notes.",
    );
    const { client } = setupReplay(outDir, repo);
    const r = await run(repo, client, pasted.email.id);
    expect(r.record.status).toBe("degraded");
    expect(r.record.assessment).toBeNull();
    expect(r.record.provenance).toBe("rules");
    expect(r.record.runs[0]!.stages[0]!.error_kind).toBe("not_recorded");
  });

  it("a recording never overwrites a finished live analysis, even with force", async () => {
    const { outDir } = await record([ok(A_OK), ok(B_OK)]);
    const repo = await seededRepo();
    const live = await run(repo, new FakeLlm([ok(A_OK), ok(B_OK)]));
    expect(live.record.provenance).toBe("live");
    const before = JSON.stringify(repo.getAnalysis("T1"));

    const { client } = setupReplay(outDir, repo);
    const again = await run(repo, client, "T1", true);
    expect(again.queued).toBe("skipped_complete");
    expect(JSON.stringify(repo.getAnalysis("T1"))).toBe(before);
  });

  it("a recorded run does not resume a stored live extraction (no mixing)", async () => {
    const { outDir } = await record([ok(A_OK), ok(B_OK)]);
    const repo = await seededRepo();
    // Live A succeeds, live B fails: partial analysis with a live extraction.
    const partial = await run(repo, new FakeLlm([ok(A_OK), fail("timeout", "t"), fail("timeout", "t")]));
    expect(partial.record.status).toBe("partial");
    expect(partial.record.provenance).toBe("live");

    const { client } = setupReplay(outDir, repo);
    const r = await run(repo, client);
    expect(r.record.status).toBe("complete");
    expect(r.record.provenance).toBe("recorded");
    // The extraction stage was replayed, not skipped from the live record.
    expect(r.record.runs[r.record.runs.length - 1]!.stages[0]!.outcome).toBe("ok");
  });

  it("restart recovery stays explicit: an interrupted replay is queued, not run", async () => {
    const { outDir } = await record([ok(A_OK), ok(B_OK)]);
    const repo = await seededRepo();
    repo.saveAnalysis({
      email_id: "T1",
      status: "extracting",
      analysis_mode: null,
      provenance: null,
      extraction: null,
      assessment: null,
      warnings: [],
      runs: [{ started_at: NOW().toISOString(), finished_at: null, outcome: null, stages: [] }],
      model: null,
      prompt_version: PROMPT_VERSION,
      updated_at: NOW().toISOString(),
    });
    const { client } = setupReplay(outDir, repo);
    let calls = 0;
    const spy: LlmClient = {
      model: client!.model,
      provenance: "recorded",
      complete: (r: LlmRequest): Promise<LlmResult> => {
        calls++;
        return client!.complete(r);
      },
    };
    const s = service(repo, spy);
    expect(s.recoverInterrupted({ run: false })).toEqual(["T1"]);
    await s.idle();
    expect(calls).toBe(0);
    expect(repo.getAnalysis("T1")!.status).toBe("queued");
    expect(repo.getAnalysis("T1")!.assessment).toBeNull();

    s.enqueue("T1");
    await s.idle();
    expect(repo.getAnalysis("T1")!.status).toBe("complete");
    expect(calls).toBe(2);
    expect(s.hasLiveLlm).toBe(false);
  });
});

describe("API: health and read-only behaviour with replay", () => {
  it("reports replay availability without claiming provider reachability, and reads never replay", async () => {
    const { outDir } = await record([ok(A_OK), ok(B_OK)]);
    const repo = await seededRepo();
    const { client, status } = setupReplay(outDir, repo);
    let calls = 0;
    const spy: LlmClient = {
      model: client!.model,
      provenance: "recorded",
      complete: (r) => {
        calls++;
        return client!.complete(r);
      },
    };
    started = await startApi({ repo, llm: spy, replay: status });

    const h = (await started.get("/api/health")).body;
    expect(h.llm).toMatchObject({ configured: false, reachability: "unchecked", provider: null });
    expect(h.replay).toMatchObject({ available: true, email_ids: ["T1"], model: "fake-model" });

    await started.get("/api/emails");
    const detail = (await started.get("/api/emails/T1")).body;
    expect(detail.processing).toMatchObject({ status: "not_started", provenance: null });
    expect(detail.risk.final_level).not.toBe("none");
    expect(calls).toBe(0);

    const r = await started.postJson("/api/emails/T1/reprocess", {});
    expect(r.status).toBe(202);
    await waitFor(async () => (await started!.get("/api/emails/T1")).body.processing.status === "complete");
    const done = (await started.get("/api/emails/T1")).body;
    expect(done.processing).toMatchObject({ provenance: "recorded", model: "fake-model" });
    expect(done.risk).toMatchObject({ basis: "ai_and_rules", assessed: true });
    expect(calls).toBe(2);
    // Replay never touches the provider tracker.
    expect((await started.get("/api/health")).body.llm.reachability).toBe("unchecked");
    const listed = (await started.get("/api/emails")).body.emails.find((e: any) => e.id === "T1");
    expect(listed.processing.provenance).toBe("recorded");
  });

  it("without recordings the health has no replay block and analysis degrades", async () => {
    started = await startApi({ llm: null });
    const h = (await started.get("/api/health")).body;
    expect(h.replay).toBeUndefined();
    expect(h.llm.configured).toBe(false);
  });

  it("a live configuration never reports a replay block", () => {
    const live = loadLlmSettings({ LLM_BASE_URL: "http://127.0.0.1:1/v1", LLM_MODEL: "m" });
    const body = buildHealth(live, undefined, {
      available: true,
      email_ids: ["T1"],
      model: "m",
      captured_at: null,
      problems: [],
    });
    expect(body.replay).toBeUndefined();
    expect(body.llm.configured).toBe(true);
  });
});


// ---- incremental publication and attempt provenance ------------------------------------------

const SEED2: SeedEmail = {
  id: "T2",
  from: "facilities@arcline.com",
  to: ["all-staff@arcline.com"],
  date: "2026-06-03T09:00:00Z",
  subject: "Kitchen rota",
  body: "Hi all, the June kitchen rota is on the fridge. Thanks!",
  attachments: [],
};
const A2 = { summary: "Kitchen rota notice.", facts: { amounts: [], dates: [], references: [], attachments: [] }, evidence_snippets: [], notes: [] };
const BOTH = [SEED, SEED2];

type Script = ConstructorParameters<typeof FakeLlm>[0];

async function recordTo(
  dir: string,
  ids: string[],
  script: Script,
  extra: Partial<Parameters<typeof recordFixtures>[0]> = {},
) {
  const llm = new FakeLlm(script);
  const report = await recordFixtures({
    seed: BOTH,
    ids,
    client: llm,
    outDir: dir,
    now: NOW,
    tool: "test",
    providerHost: "fake.example",
    requestedModel: "fake-model",
    ...extra,
  });
  return { llm, report };
}

const T1_SCRIPT: Script = [ok(A_OK), ok(B_OK)];
const T2_SCRIPT: Script = [ok(A2), ok(B_NONE)];
const manifestOf = (dir: string) => JSON.parse(readFileSync(path.join(dir, MANIFEST_FILE), "utf8")) as { files: { email_id: string; file: string }[] };
const bytesOf = (dir: string, name: string) => readFileSync(path.join(dir, name), "utf8");
async function loaded(dir: string) {
  return loadRecordings(dir, target(await seededRepo(BOTH)));
}

describe("incremental recording keeps the existing set", () => {
  it("records a second email without losing the first; both stay available", async () => {
    const dir = tmp();
    const first = await recordTo(dir, ["T1"], T1_SCRIPT);
    expect(first.report.outcomes[0]).toMatchObject({ ok: true, attempt: 1 });
    const t1Before = bytesOf(dir, "T1.json");

    const second = await recordTo(dir, ["T2"], T2_SCRIPT);
    expect(second.report.outcomes[0]).toMatchObject({ id: "T2", ok: true, attempt: 1, replaced: false });
    expect(second.report.preserved).toEqual(["T1"]);
    expect(bytesOf(dir, "T1.json")).toBe(t1Before); // the first fixture was not rewritten

    const r = await loaded(dir);
    expect([...r.byEmail.keys()].sort()).toEqual(["T1", "T2"]);
    expect(r.problems).toEqual([]);
    expect(manifestOf(dir).files.map((f) => f.email_id)).toEqual(["T1", "T2"]);
    expect(readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);

    // Both replay to a complete, recorded analysis.
    const repo = await seededRepo(BOTH);
    const { client } = setupReplay(dir, repo);
    expect((await run(repo, client, "T1")).record.provenance).toBe("recorded");
    expect((await run(repo, client, "T2")).record.status).toBe("complete");
  });

  it("keeps index.json in a deterministic order whichever email is recorded first", async () => {
    const a = tmp();
    await recordTo(a, ["T2"], T2_SCRIPT);
    await recordTo(a, ["T1"], T1_SCRIPT);
    expect(manifestOf(a).files.map((f) => f.email_id)).toEqual(["T1", "T2"]);
  });

  it("refuses a duplicate recording BEFORE any provider call and changes nothing", async () => {
    const dir = tmp();
    await recordTo(dir, ["T1"], T1_SCRIPT);
    const files = readdirSync(dir).sort();
    const manifest = bytesOf(dir, MANIFEST_FILE);

    const dup = await recordTo(dir, ["T1"], []); // an empty script: any provider call would throw
    expect(dup.llm.callCount).toBe(0);
    expect(dup.report.outcomes[0]).toMatchObject({ id: "T1", ok: false });
    expect((dup.report.outcomes[0] as { reason: string }).reason).toMatch(/already recorded; nothing was sent/);
    expect(dup.report.written).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(files);
    expect(bytesOf(dir, MANIFEST_FILE)).toBe(manifest);
  });

  it("an explicit overwrite is recorded as a repeat attempt and replaces only that email", async () => {
    const dir = tmp();
    await recordTo(dir, ["T1"], T1_SCRIPT);
    await recordTo(dir, ["T2"], T2_SCRIPT);
    const t2Before = bytesOf(dir, "T2.json");

    const again = await recordTo(dir, ["T1"], T1_SCRIPT, { overwrite: ["T1"] });
    expect(again.report.outcomes[0]).toMatchObject({ id: "T1", ok: true, attempt: 2, replaced: true });
    const third = await recordTo(dir, ["T1"], T1_SCRIPT, { overwrite: ["T1"] });
    expect(third.report.outcomes[0]).toMatchObject({ attempt: 3, replaced: true });

    const r = await loaded(dir);
    expect([...r.byEmail.keys()].sort()).toEqual(["T1", "T2"]);
    expect(r.byEmail.get("T1")!.capture).toMatchObject({ attempt: 3, attempts_made: 3 });
    expect(r.byEmail.get("T2")!.capture).toMatchObject({ attempt: 1, attempts_made: 1 });
    expect(bytesOf(dir, "T2.json")).toBe(t2Before);
    // Superseded files are removed once the new manifest is in place; nothing is left unlisted.
    expect(r.problems).toEqual([]);
    expect(readdirSync(dir).filter((n) => n.startsWith("T1")).length).toBe(1);
  });

  it("refuses to overwrite when there is nothing to overwrite", async () => {
    const dir = tmp();
    const r = await recordTo(dir, ["T1"], [], { overwrite: ["T1"] });
    expect(r.llm.callCount).toBe(0);
    expect((r.report.outcomes[0] as { reason: string }).reason).toMatch(/nothing to overwrite/);
  });

  it("a corrupted existing fixture blocks new publication and is reported, not hidden", async () => {
    const dir = tmp();
    await recordTo(dir, ["T1"], T1_SCRIPT);
    writeFileSync(path.join(dir, "T1.json"), "{ corrupted");
    const manifest = bytesOf(dir, MANIFEST_FILE);

    const blocked = await recordTo(dir, ["T2"], T2_SCRIPT);
    expect(blocked.llm.callCount).toBe(0);
    expect(blocked.report.written).toEqual([]);
    expect(blocked.report.existingProblems.join(" ")).toMatch(/existing recording T1 is unusable \(not valid JSON\)/);
    expect(bytesOf(dir, MANIFEST_FILE)).toBe(manifest);
    expect(readdirSync(dir).includes("T2.json")).toBe(false);
  });

  it("repairing a corrupted entry needs an explicit overwrite and an explicitly declared attempt", async () => {
    const dir = tmp();
    await recordTo(dir, ["T1"], T1_SCRIPT);
    writeFileSync(path.join(dir, "T1.json"), "{ corrupted");

    const undeclared = await recordTo(dir, ["T1"], [], { overwrite: ["T1"] });
    expect(undeclared.llm.callCount).toBe(0);
    expect((undeclared.report.outcomes[0] as { reason: string }).reason).toMatch(/attempt number cannot be determined/);

    const tooLow = await recordTo(dir, ["T1"], [], { overwrite: ["T1"], declaredAttempt: 1 });
    expect(tooLow.llm.callCount).toBe(0);
    expect(tooLow.report.outcomes[0]).toMatchObject({ ok: false });

    const declared = await recordTo(dir, ["T1"], T1_SCRIPT, { overwrite: ["T1"], declaredAttempt: 2 });
    expect(declared.report.outcomes[0]).toMatchObject({ ok: true, attempt: 2, replaced: true });
    const r = await loaded(dir);
    expect(r.byEmail.get("T1")!.capture.attempts_made).toBe(2);
    expect(r.problems).toEqual([]);
  });

  it("an incompatible (stale prompt) existing recording also blocks until handled explicitly", async () => {
    const dir = tmp();
    await recordTo(dir, ["T1"], T1_SCRIPT);
    rewrite(dir, (f) => ({ ...f, pipeline: { ...f.pipeline, prompt_version: "old-v0" } }), { reseal: true });
    const r = await recordTo(dir, ["T2"], [ok(A2), ok(B_NONE)]);
    expect(r.llm.callCount).toBe(0);
    expect(r.report.existingProblems.join(" ")).toMatch(/T1 is unusable \(incompatible/);
  });

  it("an unusable manifest stops everything before any provider call", async () => {
    const dir = tmp();
    await recordTo(dir, ["T1"], T1_SCRIPT);
    writeFileSync(path.join(dir, MANIFEST_FILE), "not json");
    const r = await recordTo(dir, ["T2"], T2_SCRIPT);
    expect(r.llm.callCount).toBe(0);
    expect(r.report.existingProblems.join(" ")).toMatch(/manifest is unusable/);
    expect(readdirSync(dir).includes("T2.json")).toBe(false);
  });

  it("a failed second recording leaves the previously recorded set exactly as it was", async () => {
    const dir = tmp();
    await recordTo(dir, ["T1"], T1_SCRIPT);
    const before = { manifest: bytesOf(dir, MANIFEST_FILE), t1: bytesOf(dir, "T1.json"), files: readdirSync(dir).sort() };

    const failed = await recordTo(dir, ["T2"], [fail("timeout", "timed out"), fail("timeout", "timed out")]);
    expect(failed.report.outcomes[0]).toMatchObject({ id: "T2", ok: false });
    expect(failed.report.written).toEqual([]);

    expect(bytesOf(dir, MANIFEST_FILE)).toBe(before.manifest);
    expect(bytesOf(dir, "T1.json")).toBe(before.t1);
    expect(readdirSync(dir).sort()).toEqual(before.files);
    const r = await loaded(dir);
    expect([...r.byEmail.keys()]).toEqual(["T1"]);
    expect(r.problems).toEqual([]);
  });

  it("a crash during publication leaves the old set intact and the new file unlisted", async () => {
    const dir = tmp();
    await recordTo(dir, ["T1"], T1_SCRIPT);
    const manifest = bytesOf(dir, MANIFEST_FILE);

    await expect(
      recordTo(dir, ["T2"], T2_SCRIPT, {
        beforeManifestPublish: () => {
          throw new Error("simulated crash before the manifest was replaced");
        },
      }),
    ).rejects.toThrow(/simulated crash/);

    expect(bytesOf(dir, MANIFEST_FILE)).toBe(manifest);
    const r = await loaded(dir);
    expect([...r.byEmail.keys()]).toEqual(["T1"]);
    expect(r.problems.join(" ")).toMatch(/T2.json: not listed in the manifest; ignored/);
  });

  it("a crash during an overwrite keeps the previous recording of that email usable", async () => {
    const dir = tmp();
    await recordTo(dir, ["T1"], T1_SCRIPT);
    await expect(
      recordTo(dir, ["T1"], T1_SCRIPT, {
        overwrite: ["T1"],
        beforeManifestPublish: () => {
          throw new Error("simulated crash");
        },
      }),
    ).rejects.toThrow();
    const r = await loaded(dir);
    expect(r.byEmail.get("T1")!.capture.attempts_made).toBe(1);
  });

  it("the set is consistent after a restart and a duplicate is still refused", async () => {
    const dir = tmp();
    await recordTo(dir, ["T1"], T1_SCRIPT);
    await recordTo(dir, ["T2"], T2_SCRIPT);

    // "Restart": nothing is held in memory; everything is re-derived from the directory.
    const repo = await seededRepo(BOTH);
    const setup = setupReplay(dir, repo);
    expect(setup.status).toMatchObject({ available: true, email_ids: ["T1", "T2"], problems: [] });
    const dup = await recordTo(dir, ["T1", "T2"], []);
    expect(dup.llm.callCount).toBe(0);
    expect(dup.report.outcomes.every((o) => !o.ok)).toBe(true);
  });
});

describe("recorder CLI safety (no provider is ever contacted)", () => {
  const cli = path.resolve(__dirname, "../replay/recordCli.ts");
  const seedFile = () => {
    const d = tmp();
    const f = path.join(d, "seed.json");
    writeFileSync(f, JSON.stringify({ emails: [SEED] }));
    return { f, out: path.join(d, "out") };
  };
  const runCli = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, ["--import", "tsx", cli, ...args], {
      encoding: "utf8",
      // No LLM_* in the environment, so even a mistaken --send cannot reach a provider.
      env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", ...env },
      timeout: 60_000,
    });

  it("is a dry run by default and writes nothing", () => {
    const { f, out } = seedFile();
    const r = runCli(["--seed", f, "--out", out]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/DRY RUN: nothing was sent/);
    expect(r.stdout).toMatch(/seed emails : 1 \(T1\)/);
    expect(r.stdout).toMatch(/destination : \(no LLM configured\)/);
  });

  it("refuses transmission without the matching authorization count", () => {
    const { f, out } = seedFile();
    const r = runCli(["--seed", f, "--out", out, "--send"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--authorize-seed-transmission must equal 1/);
  });

  it("a dry run reports what already exists and which ids it would refuse", async () => {
    const { f } = seedFile();
    const out = tmp();
    await recordFixtures({
      seed: [SEED],
      client: new FakeLlm([ok(A_OK), ok(B_OK)]),
      outDir: out,
      now: NOW,
      tool: "test",
      providerHost: null,
      requestedModel: "m",
    });
    const r = runCli(["--seed", f, "--out", out, "--ids", "T1"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/existing\s+: T1 valid \(attempt 1\)/);
    expect(r.stdout).toMatch(/would refuse: T1 is already recorded/);
    expect(readdirSync(out).sort()).toEqual(["T1.json", "index.json"]);
  });

  it("--attempt is only accepted together with --overwrite", () => {
    const { f, out } = seedFile();
    const r = runCli(["--seed", f, "--out", out, "--attempt", "2"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/only meaningful together with --overwrite/);
  });

  it("refuses transmission when no LLM is configured, and rejects non-seed ids", () => {
    const { f, out } = seedFile();
    const noLlm = runCli(["--seed", f, "--out", out, "--send", "--authorize-seed-transmission=1"]);
    expect(noLlm.status).toBe(2);
    expect(noLlm.stderr).toMatch(/no usable LLM configuration/);

    const nonSeed = runCli(["--seed", f, "--out", out, "--ids", "ZZZ"]);
    expect(nonSeed.status).toBe(1);
    expect(nonSeed.stderr).toMatch(/only seed emails can be recorded/);
  });
});
