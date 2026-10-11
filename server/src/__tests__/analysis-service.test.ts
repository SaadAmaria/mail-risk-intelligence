import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AnalysisRecord, NormalizedEmail } from "@mri/shared";
import { AnalysisService, PROMPT_VERSION, type AnalysisServiceOptions } from "../analysis/service";
import type { LlmClient } from "../llm/types";
import { MemoryRepository } from "../storage/memoryRepository";
import type { MailboxRepository } from "../storage/repository";
import { SqliteRepository } from "../storage/sqliteRepository";
import { A_OK, B_NONE, B_OK, injectionEmail, invoiceEmail, wireEmail } from "./agentFixtures";
import { FakeLlm, fail, ok, raw, type Scripted } from "./fakes/fakeLlm";
import { prepared } from "./helpers";

const FIXED_NOW = new Date("2026-10-11T12:00:00.000Z");

function service(repo: MailboxRepository, llm: LlmClient | null, over: Partial<AnalysisServiceOptions> = {}) {
  return new AnalysisService(repo, llm, {
    concurrency: 1,
    maxRuns: 3,
    queueCapacity: 50,
    maxCompletionTokens: 1000,
    now: () => FIXED_NOW,
    ...over,
  });
}

function repoWith(...emails: [string, NormalizedEmail][]): MemoryRepository {
  const repo = new MemoryRepository();
  for (const [id, e] of emails) repo.insertEmail(prepared(e, id));
  return repo;
}

/** Run one email through the pipeline and return its stored analysis. */
async function analyze(repo: MailboxRepository, llm: LlmClient | null, id = "m1", over: Partial<AnalysisServiceOptions> = {}) {
  const svc = service(repo, llm, over);
  expect(svc.enqueue(id)).toBe("queued");
  await svc.idle();
  return { svc, record: repo.getAnalysis(id)! };
}

/** The invariant the whole pipeline protects: no assessment unless fully complete. */
function expectNeverSafe(r: AnalysisRecord): void {
  expect(r.status).not.toBe("complete");
  expect(r.assessment).toBeNull();
}

describe("pipeline: both agents succeed", () => {
  it("persists extraction, assessment, provenance, model, versions and token usage", async () => {
    const repo = repoWith(["m1", wireEmail()]);
    const llm = new FakeLlm([ok(A_OK), ok(B_OK)]);
    const { record } = await analyze(repo, llm);

    expect(record.status).toBe("complete");
    expect(record.analysis_mode).toBe("complete");
    expect(record.provenance).toBe("live");
    expect(record.assessment?.risk.level).toBe("high");
    expect(record.extraction?.facts.amounts[0]?.value).toBe(48200);
    expect(record.model).toBe("fake-model");
    expect(record.prompt_version).toBe(PROMPT_VERSION);
    expect(record.updated_at).toBe(FIXED_NOW.toISOString());

    expect(record.runs).toHaveLength(1);
    const run = record.runs[0]!;
    expect(run.outcome).toBe("complete");
    expect(run.stages.map((s) => [s.stage, s.outcome, s.calls])).toEqual([
      ["extraction", "ok", 1],
      ["risk", "ok", 1],
    ]);
    expect(run.stages[0]!.usage).toEqual({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, reasoning_tokens: 10 });
    expect(llm.callCount).toBe(2);
  });

  it("runs B only on the extraction A produced", async () => {
    const email = invoiceEmail();
    const withExtraLine = { ...email, body: `${email.body}\nUnrelated closing remark ZZ-NOT-EXTRACTED-9931.` };
    const repo = repoWith(["m1", withExtraLine]);
    const llm = new FakeLlm([ok({ ...A_OK, evidence_snippets: [], facts: {} }), ok(B_NONE)]);
    const { record } = await analyze(repo, llm);

    // The raw email text reached A only...
    expect(llm.calls[0]!.messages.map((m) => m.content).join("\n")).toContain("ZZ-NOT-EXTRACTED-9931");
    // ...while B received exactly what A's validated extraction contains.
    const bPrompt = llm.calls[1]!.messages.map((m) => m.content).join("\n");
    expect(bPrompt).not.toContain("ZZ-NOT-EXTRACTED-9931");
    for (const s of record.extraction!.evidence_snippets) expect(bPrompt).toContain(JSON.stringify(s.text).slice(1, -1));
    expect(bPrompt).toContain("billing@parts-supply.example");
    expect(record.status).toBe("complete");
  });
});

describe("pipeline: failures never look safe", () => {
  it("Agent A provider failure -> degraded: code-only extraction, no assessment, B not called", async () => {
    const repo = repoWith(["m1", invoiceEmail()]);
    const llm = new FakeLlm([fail("timeout", "Request timed out after 25000 ms.")]);
    const { record } = await analyze(repo, llm);

    expectNeverSafe(record);
    expect(record.status).toBe("degraded");
    expect(record.analysis_mode).toBe("degraded");
    expect(record.provenance).toBe("rules");
    expect(record.extraction?.summary).toBe("");
    expect(record.extraction?.notes.join(" ")).toMatch(/Deterministic extraction only/);
    expect(record.extraction?.facts.references.map((r) => r.value)).toContain("PS-5521");
    expect(record.warnings.join(" ")).toMatch(/Extraction failed \(timeout\)/);
    expect(llm.callCount).toBe(1);
    expect(record.runs[0]!.stages.map((s) => [s.stage, s.outcome, s.error_kind])).toEqual([
      ["extraction", "failed", "timeout"],
      ["risk", "skipped", "extraction_unavailable"],
    ]);
  });

  it("Agent A returns garbage twice -> degraded after exactly two calls", async () => {
    const repo = repoWith(["m1", wireEmail()]);
    const llm = new FakeLlm([raw("not json"), raw("{still: not json")]);
    const { record } = await analyze(repo, llm);
    expectNeverSafe(record);
    expect(record.status).toBe("degraded");
    expect(llm.callCount).toBe(2);
    expect(record.runs[0]!.stages[0]).toMatchObject({ outcome: "failed", error_kind: "invalid_output", calls: 2 });
  });

  it("Agent B failure -> partial: extraction kept, no assessment", async () => {
    const repo = repoWith(["m1", wireEmail()]);
    const llm = new FakeLlm([ok(A_OK), fail("rate_limited", "Rate limited (HTTP 429)", 429)]);
    const { record } = await analyze(repo, llm);

    expectNeverSafe(record);
    expect(record.status).toBe("partial");
    expect(record.provenance).toBe("live");
    expect(record.extraction?.summary).toMatch(/wire \$48,200/);
    expect(record.warnings.join(" ")).toMatch(/has not been assessed/);
    expect(record.runs[0]!.stages.map((s) => [s.stage, s.outcome, s.error_kind])).toEqual([
      ["extraction", "ok", null],
      ["risk", "failed", "rate_limited"],
    ]);
  });

  it("Agent B invalid twice -> partial", async () => {
    const repo = repoWith(["m1", wireEmail()]);
    const llm = new FakeLlm([ok(A_OK), raw("nope"), ok({ risk: { level: "unknown" } })]);
    const { record } = await analyze(repo, llm);
    expectNeverSafe(record);
    expect(record.status).toBe("partial");
    expect(record.runs[0]!.stages[1]).toMatchObject({ outcome: "failed", error_kind: "invalid_output", calls: 2 });
  });

  it("no LLM configured -> degraded without any provider call", async () => {
    const repo = repoWith(["m1", wireEmail()]);
    const { record, svc } = await analyze(repo, null);
    expectNeverSafe(record);
    expect(svc.hasLlm).toBe(false);
    expect(record.status).toBe("degraded");
    expect(record.provenance).toBe("rules");
    expect(record.model).toBeNull();
    expect(record.warnings.join(" ")).toMatch(/No LLM is configured/);
    expect(record.runs[0]!.stages.every((s) => s.outcome === "skipped" && s.calls === 0)).toBe(true);
  });

  it("an unexpected internal error is recorded as failed, never left in progress", async () => {
    class FlakyRepo extends MemoryRepository {
      override saveAnalysis(r: AnalysisRecord): void {
        if (r.status === "analyzing") throw new TypeError("disk on fire");
        super.saveAnalysis(r);
      }
    }
    const repo = new FlakyRepo();
    repo.insertEmail(prepared(wireEmail(), "m1"));
    const { record } = await analyze(repo, new FakeLlm([ok(A_OK)]));
    expectNeverSafe(record);
    expect(record.status).toBe("failed");
    expect(record.analysis_mode).toBe("failed");
    expect(record.warnings.join(" ")).toMatch(/Unexpected internal error \(TypeError\)/);
    expect(JSON.stringify(record)).not.toContain("disk on fire"); // internal messages are not persisted
  });

  it("an email is never reported complete while a stage is still unfinished", async () => {
    const repo = repoWith(["m1", wireEmail()]);
    const seen: string[] = [];
    const llm = new FakeLlm([
      (_req, _i) => {
        seen.push(repo.getAnalysis("m1")!.status);
        return ok(A_OK);
      },
      () => {
        seen.push(repo.getAnalysis("m1")!.status);
        return ok(B_OK);
      },
    ]);
    await analyze(repo, llm);
    expect(seen).toEqual(["extracting", "analyzing"]);
  });
});

// Regression for the Phase 2 quality-gate finding F1: ungrounded findings must not reach `complete`.
describe("pipeline: unsupported risk findings are withheld", () => {
  it.each(["high", "medium", "low"] as const)(
    "a %s finding with no verifiable evidence -> partial, no assessment, proposal kept in the run log",
    async (level) => {
      const repo = repoWith(["m1", wireEmail()]);
      const bad = ok({ ...B_OK, risk: { ...B_OK.risk, level, evidence: [{ snippet_id: "s1", quote: "the CFO signed off" }] } });
      const llm = new FakeLlm([ok(A_OK), bad, bad]);
      const { record } = await analyze(repo, llm);

      expectNeverSafe(record);
      expect(record.status).toBe("partial");
      expect(record.analysis_mode).toBe("partial");
      expect(record.provenance).toBe("live");
      expect(record.extraction?.facts.amounts[0]?.value).toBe(48200); // A's result is kept
      expect(llm.callCount).toBe(3); // A + B + one repair attempt

      const stage = record.runs[0]!.stages[1]!;
      expect(stage).toMatchObject({ stage: "risk", outcome: "failed", error_kind: "ungrounded_assessment", calls: 2 });
      expect(stage.error_message).toContain(`risk level "${level}"`);
      expect(stage.error_message).toMatch(/withheld/);
      expect(record.warnings.join(" ")).toMatch(/could not be verified against the email/);
      // Nothing that looks like an assessment was persisted anywhere on the record.
      expect(JSON.stringify(record)).not.toContain('"risk":{"level"');
      expect(repo.getAnalysis("m1")!.assessment).toBeNull();
    },
  );

  it("a repaired, now-grounded finding reaches complete", async () => {
    const repo = repoWith(["m1", wireEmail()]);
    const ungrounded = ok({ ...B_OK, risk: { ...B_OK.risk, evidence: [] } });
    const { record } = await analyze(repo, new FakeLlm([ok(A_OK), ungrounded, ok(B_OK)]));
    expect(record.status).toBe("complete");
    expect(record.assessment?.risk.evidence.length).toBeGreaterThan(0);
  });

  it("a correctly grounded high-risk finding still completes on the first attempt", async () => {
    const repo = repoWith(["m1", wireEmail()]);
    const llm = new FakeLlm([ok(A_OK), ok(B_OK)]);
    const { record } = await analyze(repo, llm);
    expect(record.status).toBe("complete");
    expect(record.assessment?.risk.level).toBe("high");
    expect(llm.callCount).toBe(2);
  });

  it("a later retry re-runs only Agent B and can then complete", async () => {
    const repo = repoWith(["m1", wireEmail()]);
    const bad = ok({ ...B_OK, risk: { ...B_OK.risk, evidence: [] } });
    const llm = new FakeLlm([ok(A_OK), bad, bad, ok(B_OK)]);
    const svc = service(repo, llm);
    svc.enqueue("m1");
    await svc.idle();
    expect(repo.getAnalysis("m1")!.status).toBe("partial");

    svc.enqueue("m1");
    await svc.idle();
    const r = repo.getAnalysis("m1")!;
    expect(r.status).toBe("complete");
    expect(llm.callCount).toBe(4); // A was not repeated
  });

  it("level 'none' without evidence is a valid complete assessment", async () => {
    const repo = repoWith(["m1", wireEmail()]);
    const { record } = await analyze(repo, new FakeLlm([ok(A_OK), ok(B_NONE)]));
    expect(record.status).toBe("complete");
    expect(record.assessment?.risk.level).toBe("none");
  });
});

describe("persistence invariants", () => {
  const base = (over: Partial<AnalysisRecord>): AnalysisRecord => ({
    email_id: "m1",
    status: "partial",
    analysis_mode: "partial",
    provenance: "live",
    extraction: null,
    assessment: null,
    warnings: [],
    runs: [],
    model: null,
    prompt_version: null,
    updated_at: FIXED_NOW.toISOString(),
    ...over,
  });

  it("refuses to store an assessment (including 'none') for a non-complete analysis", async () => {
    const repo = repoWith(["m1", wireEmail()]);
    const { record } = await analyze(repo, new FakeLlm([ok(A_OK), ok(B_OK)]));
    const none = { ...record.assessment!, risk: { ...record.assessment!.risk, level: "none" as const } };

    for (const status of ["partial", "degraded", "failed"] as const) {
      expect(() =>
        repo.saveAnalysis(base({ status, analysis_mode: status, extraction: record.extraction, assessment: none })),
      ).toThrow(/assessment is not allowed/);
    }
    expect(() =>
      repo.saveAnalysis(
        base({ status: "complete", analysis_mode: "complete", provenance: "rules", extraction: record.extraction, assessment: none }),
      ),
    ).toThrow(/live or recorded provenance/);
  });

  it("refuses incomplete 'complete' and mismatched modes", async () => {
    const repo = repoWith(["m1", wireEmail()]);
    expect(() => repo.saveAnalysis(base({ status: "complete", analysis_mode: "complete" }))).toThrow(
      /complete requires an extraction and an assessment/,
    );
    expect(() => repo.saveAnalysis(base({ status: "queued", analysis_mode: "partial" }))).toThrow(/null while in progress/);
    expect(() => repo.saveAnalysis(base({ status: "failed", analysis_mode: null }))).toThrow(/terminal status/);
    expect(repo.listAnalyses()).toEqual([]);
  });
});

describe("retry and resume", () => {
  it("retries a partial analysis by re-running only Agent B", async () => {
    const repo = repoWith(["m1", wireEmail()]);
    const llm = new FakeLlm([ok(A_OK), fail("http", "HTTP 503", 503), ok(B_OK)]);
    const svc = service(repo, llm);

    svc.enqueue("m1");
    await svc.idle();
    expect(repo.getAnalysis("m1")!.status).toBe("partial");
    expect(llm.callCount).toBe(2);

    expect(svc.enqueue("m1")).toBe("queued");
    await svc.idle();
    const record = repo.getAnalysis("m1")!;
    expect(record.status).toBe("complete");
    expect(llm.callCount).toBe(3); // exactly one more call: B only; A was not repeated
    expect(record.runs).toHaveLength(2);
    expect(record.runs[1]!.stages.map((s) => [s.stage, s.outcome])).toEqual([
      ["extraction", "skipped"],
      ["risk", "ok"],
    ]);
  });

  it("enqueue reports why nothing was queued", async () => {
    const repo = repoWith(["m1", wireEmail()]);
    const llm = new FakeLlm([ok(A_OK), ok(B_OK), ok(A_OK), ok(B_OK)]);
    const svc = service(repo, llm, { maxRuns: 1 });

    expect(svc.enqueue("nope")).toBe("not_found");
    expect(svc.enqueue("m1")).toBe("queued");
    expect(svc.enqueue("m1")).toBe("already_queued");
    await svc.idle();
    expect(svc.enqueue("m1")).toBe("skipped_complete");
    expect(svc.enqueue("m1", { force: true })).toBe("queued"); // explicit reprocess
    await svc.idle();
    expect(repo.getAnalysis("m1")!.runs).toHaveLength(2);
  });

  it("stops retrying a failing email after maxRuns", async () => {
    const repo = repoWith(["m1", wireEmail()]);
    const llm = new FakeLlm([fail("auth"), fail("auth"), fail("auth")]);
    const svc = service(repo, llm, { maxRuns: 2 });
    for (let i = 0; i < 2; i++) {
      expect(svc.enqueue("m1")).toBe("queued");
      await svc.idle();
    }
    expect(svc.enqueue("m1")).toBe("max_runs_reached");
    expect(repo.getAnalysis("m1")!.status).toBe("degraded");
  });

  it("rejects work beyond queue capacity without leaving a phantom 'queued' record", async () => {
    const repo = repoWith(["m1", wireEmail()], ["m2", invoiceEmail()], ["m3", injectionEmail()]);
    const gate: { release: () => void } = { release: () => undefined };
    const blocker = new Promise<void>((resolve) => (gate.release = resolve));
    const slow: Scripted = (_req, _i) => {
      throw new Error("not used");
    };
    void slow;
    const llm: LlmClient = {
      model: "slow",
      complete: async () => {
        await blocker;
        return { content: JSON.stringify(A_OK), model: "slow", finishReason: "stop", usage: null, latencyMs: 1, attempts: 1 };
      },
    };
    const svc = service(repo, llm, { queueCapacity: 1 });
    expect(svc.enqueue("m1")).toBe("queued"); // runs immediately (blocked)
    expect(svc.enqueue("m2")).toBe("queued"); // waits
    expect(svc.enqueue("m3")).toBe("queue_full");
    expect(repo.getAnalysis("m3")).toBeNull();
    gate.release();
    await svc.stop(2000);
  });
});

describe("restart recovery", () => {
  const inProgress = (id: string, status: "queued" | "extracting" | "analyzing", runs = 1): AnalysisRecord => ({
    email_id: id,
    status,
    analysis_mode: null,
    provenance: null,
    extraction: null,
    assessment: null,
    warnings: [],
    runs: Array.from({ length: runs }, () => ({ started_at: "2026-10-11T11:00:00.000Z", finished_at: null, outcome: null, stages: [] })),
    model: null,
    prompt_version: null,
    updated_at: "2026-10-11T11:00:00.000Z",
  });

  it("re-queues interrupted work, marks the interrupted run, and completes it", async () => {
    const repo = repoWith(["m1", wireEmail()], ["m2", invoiceEmail()]);
    repo.saveAnalysis(inProgress("m1", "extracting"));
    repo.saveAnalysis(inProgress("m2", "analyzing"));

    const llm = new FakeLlm([ok(A_OK), ok(B_OK), ok({ ...A_OK, evidence_snippets: [], facts: {} }), ok(B_NONE)]);
    const svc = service(repo, llm);
    expect(svc.recoverInterrupted().sort()).toEqual(["m1", "m2"]);
    expect(repo.getAnalysis("m1")!.status === "queued" || repo.getAnalysis("m1")!.status === "extracting").toBe(true);
    await svc.idle();

    for (const id of ["m1", "m2"]) {
      const r = repo.getAnalysis(id)!;
      expect(r.status).toBe("complete");
      expect(r.runs).toHaveLength(2);
      expect(r.runs[0]!.outcome).toBe("interrupted");
      expect(r.runs[0]!.finished_at).toBe(FIXED_NOW.toISOString());
      expect(r.runs[1]!.outcome).toBe("complete");
    }
  });

  it("marks work that keeps getting interrupted as failed instead of retrying forever", () => {
    const repo = repoWith(["m1", wireEmail()]);
    repo.saveAnalysis(inProgress("m1", "analyzing", 3));
    const svc = service(repo, new FakeLlm([]), { maxRuns: 3 });
    expect(svc.recoverInterrupted()).toEqual([]);
    const r = repo.getAnalysis("m1")!;
    expect(r.status).toBe("failed");
    expect(r.assessment).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/interrupted repeatedly/);
  });

  it("leaves finished analyses alone", async () => {
    const repo = repoWith(["m1", wireEmail()]);
    const llm = new FakeLlm([ok(A_OK), ok(B_OK)]);
    const svc = service(repo, llm);
    svc.enqueue("m1");
    await svc.idle();
    expect(svc.recoverInterrupted()).toEqual([]);
    expect(llm.callCount).toBe(2);
  });

  describe("across a real process restart (SQLite file)", () => {
    const dirs: string[] = [];
    afterEach(() => {
      while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
    });

    it("recovers an analysis that was in progress when the database was closed", async () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "mri-recover-"));
      dirs.push(dir);
      const file = path.join(dir, "app.db");

      const first = new SqliteRepository(file);
      first.insertEmail(prepared(wireEmail(), "m1"));
      first.saveAnalysis(inProgress("m1", "extracting"));
      first.close(); // "crash"

      const second = new SqliteRepository(file);
      try {
        expect(second.getAnalysis("m1")!.status).toBe("extracting");
        const svc = service(second, new FakeLlm([ok(A_OK), ok(B_OK)]));
        expect(svc.recoverInterrupted()).toEqual(["m1"]);
        await svc.idle();
        const r = second.getAnalysis("m1")!;
        expect(r.status).toBe("complete");
        expect(r.runs.map((x) => x.outcome)).toEqual(["interrupted", "complete"]);
      } finally {
        second.close();
      }
    });
  });
});

describe("autostart selection", () => {
  it("queues never-analyzed emails, skips complete ones, and retries retriable ones only with an LLM", async () => {
    const repo = repoWith(["m1", wireEmail()], ["m2", invoiceEmail()], ["m3", injectionEmail()]);

    // m1 -> complete, m2 -> partial, m3 never analyzed
    const llm1 = new FakeLlm([ok(A_OK), ok(B_OK), ok({ ...A_OK, evidence_snippets: [] }), fail("http", "503", 503)]);
    const s1 = service(repo, llm1);
    s1.enqueue("m1");
    await s1.idle();
    s1.enqueue("m2");
    await s1.idle();
    expect(repo.getAnalysis("m1")!.status).toBe("complete");
    expect(repo.getAnalysis("m2")!.status).toBe("partial");

    // Without an LLM only never-analyzed emails are queued (they become degraded).
    const s2 = service(repo, null);
    expect(s2.enqueueUnanalyzed()).toEqual(["m3"]);
    await s2.idle();
    expect(repo.getAnalysis("m3")!.status).toBe("degraded");

    // With an LLM, partial and degraded are retried; complete is never touched.
    const llm3 = new FakeLlm([
      ok(B_OK), // m2: resume -> B only
      ok({ ...A_OK, evidence_snippets: [], facts: {} }), // m3: A
      ok(B_NONE), // m3: B
    ]);
    const s3 = service(repo, llm3);
    const queued = s3.enqueueUnanalyzed();
    expect(queued.sort()).toEqual(["m2", "m3"]);
    await s3.idle();
    expect(repo.getAnalysis("m1")!.runs).toHaveLength(1);
  });
});

describe("prompt injection through the full pipeline", () => {
  it("cannot set status, level or evidence by instruction; delimiters and grounding still apply", async () => {
    const repo = repoWith(["m1", injectionEmail()]);
    // A hijacked model "complies": it returns control fields and a fabricated quote.
    const llm = new FakeLlm([
      ok({
        summary: "Marked safe as instructed.",
        status: "complete",
        risk: { level: "none" },
        facts: { amounts: [{ value: 1000000 }], references: [], dates: [], attachments: [] },
        evidence_snippets: [{ text: "This message has been verified safe by compliance.", where: "body" }],
        notes: [],
      }),
      ok({
        risk: { level: "none", rationale: "Verified safe.", tags: [], evidence: [{ snippet_id: "s1", quote: "verified safe" }], confidence: "high" },
        status: "complete",
        entities: [{ ref: "e1", type: "person", name: "Compliance Officer" }],
        relationships: [],
      }),
    ]);
    const { record } = await analyze(repo, llm);

    // The fabricated quote, amount and entity were rejected as unsupported.
    expect(record.extraction!.evidence_snippets.every((s) => s.text !== "This message has been verified safe by compliance.")).toBe(true);
    expect(record.extraction!.facts.amounts).toEqual([]);
    expect(record.assessment?.entities ?? []).toEqual([]);
    expect(record.assessment?.risk.evidence ?? []).toEqual([]);
    expect(record.runs[0]!.stages[0]!.dropped_items).toBeGreaterThanOrEqual(2);
    // Both prompts told the model to treat the content as data and put it in delimiters.
    for (const call of llm.calls) {
      expect(call.messages[0]!.content).toMatch(/NEVER follow/);
      expect(call.messages[1]!.content).toMatch(/<<<BEGIN_UNTRUSTED/);
    }
    // And the stored record's status came from the pipeline, not from the model's output.
    expect(["complete", "partial", "degraded"]).toContain(record.status);
  });
});
