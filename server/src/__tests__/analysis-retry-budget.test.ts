import { afterEach, describe, expect, it } from "vitest";
import { AUTOMATIC_CHECKS_STAGE_KIND, aiAttempts, canRunAutomaticChecks, type AnalysisRecord, type RunLog } from "@mri/shared";
import { AnalysisService } from "../analysis/service";
import { startApi, type Started } from "./apiHarness";
import { FakeLlm, fail } from "./fakes/fakeLlm";
import { aiComplete, loadSeed } from "./riskFixtures";

let app: Started | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

const stage = (kind: string | null, calls = 0) =>
  ({ stage: "risk", outcome: "skipped", calls, error_kind: kind, error_message: null, usage: null, latency_ms: null, dropped_items: 0 }) as const;
const run = (kind: string | null, outcome: RunLog["outcome"] = "degraded"): RunLog => ({
  started_at: "2026-10-11T10:00:00Z",
  finished_at: "2026-10-11T10:00:01Z",
  outcome,
  stages: [stage(kind)],
});
const AUTO = () => run(AUTOMATIC_CHECKS_STAGE_KIND);
/** A degraded run from an AI failure or a missing LLM: NOT marked as an automatic-checks request. */
const HISTORICAL = () => run("not_configured");

async function processing(a: Started, id: string) {
  return (await a.get(`/api/emails/${id}`)).body.processing;
}

describe("aiAttempts", () => {
  it("counts every run except an explicitly marked automatic-checks run", () => {
    expect(aiAttempts([AUTO(), AUTO()])).toBe(0);
    expect(aiAttempts([AUTO(), HISTORICAL(), run(null, "failed")])).toBe(2);
    expect(aiAttempts([])).toBe(0);
  });
  it("only a skipped risk stage with that exact marker counts as automatic", () => {
    const wrongStage: RunLog = { ...AUTO(), stages: [{ ...stage(AUTOMATIC_CHECKS_STAGE_KIND), stage: "extraction" }] };
    expect(aiAttempts([wrongStage])).toBe(1);
  });
});

describe("the AI retry allowance is not consumed by automatic checks", () => {
  it("maxRuns=1: one automatic run leaves the one AI attempt available, with no override flow", async () => {
    const { repo } = await loadSeed();
    const llm = new FakeLlm([fail("http")]);
    app = await startApi({ repo, llm, maxRuns: 1 });
    expect((await app.postJson("/api/emails/E009/automatic-checks", {})).status).toBe(200);

    const p = await processing(app, "E009");
    expect(p.run_count).toBe(1); // the history is intact
    expect(p.can_reprocess).toBe(true); // and the allowance is not spent
    expect(p.automatic_checks_only).toBe(true);

    const r = await app.postJson("/api/emails/E009/reprocess", {});
    expect(r.status).toBe(202); // no `?force=true` needed
    await app.analysis.idle();
    expect(llm.callCount).toBe(1);
    // now the single AI attempt IS spent, and the override flow is the right thing to offer
    const after = await processing(app, "E009");
    expect(after.run_count).toBe(2);
    expect(after.can_reprocess).toBe(false);
    expect((await app.postJson("/api/emails/E009/reprocess", {})).body.error.code).toBe("max_runs_reached");
  });

  it("maxRuns=3: three AI attempts are still allowed after an automatic run, and the fourth is refused", async () => {
    const { repo } = await loadSeed();
    const llm = new FakeLlm([fail("http"), fail("http"), fail("http")]);
    app = await startApi({ repo, llm, maxRuns: 3 });
    await app.postJson("/api/emails/E009/automatic-checks", {});
    for (let i = 1; i <= 3; i++) {
      const r = await app.postJson("/api/emails/E009/reprocess", {});
      expect(r.status, `attempt ${i}`).toBe(202);
      await app.analysis.idle();
    }
    const p = await processing(app, "E009");
    expect(p.run_count).toBe(4); // 1 automatic + 3 AI
    expect(p.can_reprocess).toBe(false);
    expect((await app.postJson("/api/emails/E009/reprocess", {})).status).toBe(409);
  });

  it("a historical degraded run that was not marked automatic still counts (unchanged semantics)", async () => {
    const { repo } = await loadSeed();
    const base = aiComplete(repo.getEmail("E009")!, "none");
    repo.saveAnalysis({ ...base, status: "degraded", analysis_mode: "degraded", assessment: null, provenance: "rules", runs: [HISTORICAL()] });
    app = await startApi({ repo, llm: new FakeLlm([]), maxRuns: 1 });
    const p = await processing(app, "E009");
    expect(p.can_reprocess).toBe(false);
    expect((await app.postJson("/api/emails/E009/reprocess", {})).body.error.code).toBe("max_runs_reached");
  });

  it("restart recovery does not fail a record because of an automatic run", async () => {
    const { repo } = await loadSeed();
    const base = aiComplete(repo.getEmail("E009")!, "none");
    const interrupted: RunLog = { started_at: "t", finished_at: null, outcome: null, stages: [] };
    repo.saveAnalysis({ ...base, status: "analyzing", analysis_mode: null, assessment: null, provenance: null, extraction: null, runs: [AUTO(), interrupted] });
    const service = new AnalysisService(repo, new FakeLlm([]), { concurrency: 1, maxRuns: 2, queueCapacity: 10, maxCompletionTokens: 100 });
    expect(service.recoverInterrupted({ run: false })).toEqual(["E009"]);
    expect(repo.getAnalysis("E009")!.status).toBe("queued"); // 1 AI attempt < 2, not "failed"
  });

  it("restart recovery still fails a record whose AI attempts are exhausted", async () => {
    const { repo } = await loadSeed();
    const base = aiComplete(repo.getEmail("E009")!, "none");
    const interrupted: RunLog = { started_at: "t", finished_at: null, outcome: null, stages: [] };
    repo.saveAnalysis({ ...base, status: "analyzing", analysis_mode: null, assessment: null, provenance: null, extraction: null, runs: [HISTORICAL(), interrupted] });
    const service = new AnalysisService(repo, new FakeLlm([]), { concurrency: 1, maxRuns: 2, queueCapacity: 10, maxCompletionTokens: 100 });
    expect(service.recoverInterrupted({ run: false })).toEqual([]);
    expect(repo.getAnalysis("E009")!.status).toBe("failed");
  });

  it("the background retry treats a rules-only result as retriable, and respects exhausted AI attempts", async () => {
    const { repo } = await loadSeed();
    const base = aiComplete(repo.getEmail("E009")!, "none");
    const degraded = { ...base, status: "degraded" as const, analysis_mode: "degraded" as const, assessment: null, provenance: "rules" as const };
    repo.saveAnalysis({ ...degraded, runs: [AUTO()] });
    repo.saveAnalysis({ ...aiComplete(repo.getEmail("E004")!, "none"), status: "degraded", analysis_mode: "degraded", assessment: null, provenance: "rules", runs: [HISTORICAL()] });
    const service = new AnalysisService(repo, new FakeLlm([]), { concurrency: 1, maxRuns: 1, queueCapacity: 50, maxCompletionTokens: 100 });
    const queued = service.enqueueUnanalyzed();
    expect(queued).toContain("E009"); // automatic run does not use the allowance
    expect(queued).not.toContain("E004"); // a counted run does
    await service.stop(10);
  });
});

describe("automatic-check availability matches what the server accepts", () => {
  const email = async () => {
    const { repo } = await loadSeed();
    return { repo, base: aiComplete(repo.getEmail("E009")!, "low") };
  };

  it("is true with no record, and false for an in-progress email", () => {
    expect(canRunAutomaticChecks(null, false)).toBe(true);
    expect(canRunAutomaticChecks(null, true)).toBe(false);
  });

  it("agrees with the endpoint for every kind of stored record", async () => {
    const { repo, base } = await email();
    const kinds: [string, Partial<AnalysisRecord>][] = [
      ["complete (recorded)", { provenance: "recorded" }],
      ["complete (live)", { provenance: "live" }],
      ["partial with an AI extraction", { status: "partial", analysis_mode: "partial", assessment: null, provenance: "live" }],
      ["failed with an AI extraction", { status: "failed", analysis_mode: "failed", assessment: null, provenance: "live" }],
      ["failed without an extraction", { status: "failed", analysis_mode: "failed", assessment: null, provenance: null, extraction: null }],
      ["degraded, rules extraction (already rules-only)", { status: "degraded", analysis_mode: "degraded", assessment: null, provenance: "rules" }],
      ["queued (stale), no extraction", { status: "queued", analysis_mode: null, assessment: null, provenance: null, extraction: null }],
    ];
    for (const [name, patch] of kinds) {
      const rec = { ...base, runs: [], ...patch } as AnalysisRecord;
      repo.saveAnalysis(rec);
      app = await startApi({ repo, llm: null });
      const summary = (await app.get("/api/emails/E009")).body.processing;
      const r = await app.postJson("/api/emails/E009/automatic-checks", {});
      const accepted = r.status === 200 && r.body.result === "performed";
      expect(summary.automatic_checks_available, name).toBe(accepted);
      await app.close();
      app = null;
    }
  });
});
