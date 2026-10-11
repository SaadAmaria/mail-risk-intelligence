import { afterEach, describe, expect, it } from "vitest";
import { A_OK, B_NONE, B_OK } from "./agentFixtures";
import { FakeLlm, fail, ok, raw } from "./fakes/fakeLlm";
import { GatedLlm, PASTE_BENIGN, PASTE_WIRE, startApi, waitFor, type Started } from "./apiHarness";
import { loadSeed } from "./riskFixtures";

let app: Started | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

const status = async (a: Started, id: string) => (await a.get(`/api/emails/${id}`)).body.processing.status as string;
const until = (a: Started, id: string, s: string) => waitFor(async () => (await status(a, id)) === s && s, 3000, `${id} ${s}`);

async function ingest(a: Started, text = PASTE_WIRE): Promise<string> {
  const r = await a.postJson("/api/emails", { raw_text: text });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

describe("processing lifecycle and polling", () => {
  it("POST reprocess returns 202; polling shows queued/extracting/analyzing, then complete", async () => {
    const inner = new FakeLlm([ok(A_OK), ok(B_OK)]);
    const gated = new GatedLlm(inner);
    app = await startApi({ llm: gated });
    const id = await ingest(app);

    const r = await app.postJson(`/api/emails/${id}/reprocess`, {});
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ id, result: "queued", processing: { in_progress: true } });

    // Held at Agent A: visible as extracting, in progress, with no assessment.
    await waitFor(async () => gated.entered === 1);
    const mid = (await app.get(`/api/emails/${id}`)).body;
    expect(mid.processing).toMatchObject({ status: "extracting", in_progress: true, can_reprocess: false });
    expect(mid.assessment).toBeNull();
    expect(mid.risk).toMatchObject({ assessed: false, ai_level: null });
    expect(mid.risk.final_level).not.toBe("none");
    const listed = (await app.get("/api/emails")).body.emails[0];
    expect(listed.processing).toMatchObject({ status: "extracting", in_progress: true });

    gated.release();
    await until(app, id, "complete");
    const done = (await app.get(`/api/emails/${id}`)).body;
    expect(done.processing).toMatchObject({ status: "complete", provenance: "live", in_progress: false, can_reprocess: false });
    expect(done.processing.runs[0].stages.map((s: any) => [s.stage, s.outcome])).toEqual([
      ["extraction", "ok"],
      ["risk", "ok"],
    ]);
    expect(done.extraction.summary).toMatch(/wire \$48,200/);
    expect(done.assessment.risk.level).toBe("high");
    expect(done.risk).toMatchObject({ assessed: true, ai_level: "high", rules_level: "medium", final_level: "high", basis: "ai_and_rules" });
    // Grounded evidence is exposed with its snippet ids.
    expect(done.assessment.risk.evidence.length).toBeGreaterThan(0);
    expect(done.extraction.evidence_snippets.map((s: any) => s.id)).toContain(done.assessment.risk.evidence[0].snippet_id);
    // Entities and relationships of the assessment are attached to the email.
    expect(done.entities.map((e: any) => e.display_name)).toEqual(expect.arrayContaining(["Dana Cole", "account ending 7731"]));
    expect(done.relationships[0]).toMatchObject({ predicate: "requests_transfer_to" });
    expect(inner.callCount).toBe(2);
  });

  it("does not run the same email twice concurrently (409), and counts one job", async () => {
    const inner = new FakeLlm([ok(A_OK), ok(B_OK)]);
    const gated = new GatedLlm(inner);
    app = await startApi({ llm: gated });
    const id = await ingest(app);

    expect((await app.postJson(`/api/emails/${id}/reprocess`, {})).status).toBe(202);
    await waitFor(async () => gated.entered === 1);
    const dup = await app.postJson(`/api/emails/${id}/reprocess`, {});
    expect(dup.status).toBe(409);
    expect(dup.body).toEqual({ error: { code: "already_processing", message: expect.any(String) } });
    expect(app.analysis.queueDepth.running).toBe(1);

    gated.release();
    await until(app, id, "complete");
    expect(inner.callCount).toBe(2); // exactly one A and one B
  });

  it("a complete analysis is not re-run without force; force re-runs it", async () => {
    const inner = new FakeLlm([ok(A_OK), ok(B_OK), ok(A_OK), ok(B_NONE)]);
    app = await startApi({ llm: inner });
    const id = await ingest(app);
    await app.postJson(`/api/emails/${id}/reprocess`, {});
    await until(app, id, "complete");

    const again = await app.postJson(`/api/emails/${id}/reprocess`, {});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("already_complete");
    expect(inner.callCount).toBe(2);

    const forced = await app.postJson(`/api/emails/${id}/reprocess?force=true`, {});
    expect(forced.status).toBe(202);
    await waitFor(async () => inner.callCount === 4);
    await app.analysis.idle();
    const d = (await app.get(`/api/emails/${id}`)).body;
    expect(d.processing.run_count).toBe(2);
    expect(d.assessment.risk.level).toBe("none"); // the second answer replaced the first
  });

  it("returns 404 for an unknown email", async () => {
    app = await startApi({ llm: new FakeLlm([]) });
    const r = await app.postJson("/api/emails/E404/reprocess", {});
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("not_found");
  });
});

describe("failures never look safe; retry preserves validated partial results", () => {
  it("Agent A failure -> degraded: code-only extraction, no assessment, not 'none'", async () => {
    const llm = new FakeLlm([fail("timeout", "Request timed out")]);
    app = await startApi({ llm });
    const id = await ingest(app, PASTE_BENIGN);
    await app.postJson(`/api/emails/${id}/reprocess`, {});
    await until(app, id, "degraded");

    const d = (await app.get(`/api/emails/${id}`)).body;
    expect(d.assessment).toBeNull();
    expect(d.processing).toMatchObject({ status: "degraded", provenance: "rules" });
    expect(d.extraction.summary).toBe("");
    expect(d.risk).toMatchObject({ assessed: false, ai_level: null, final_level: "unassessed" });
    expect(d.processing.warnings.join(" ")).toMatch(/Extraction failed/);
    expect(llm.callCount).toBe(1); // Agent B was never run
    const listed = (await app.get(`/api/emails?status=degraded`)).body;
    expect(listed.total).toBe(1);
    expect(listed.emails[0].risk.final_level).toBe("unassessed");
  });

  it("Agent B failure -> partial; a retry re-runs only Agent B and completes", async () => {
    const llm = new FakeLlm([ok(A_OK), fail("rate_limited", "429", 429), ok(B_OK)]);
    app = await startApi({ llm });
    const id = await ingest(app);

    await app.postJson(`/api/emails/${id}/reprocess`, {});
    await until(app, id, "partial");
    const partial = (await app.get(`/api/emails/${id}`)).body;
    expect(partial.assessment).toBeNull();
    expect(partial.extraction.summary).toMatch(/wire/); // A's validated output is preserved
    expect(partial.processing).toMatchObject({ status: "partial", provenance: "live", can_reprocess: true });
    expect(partial.risk).toMatchObject({ assessed: false, final_level: "medium", basis: "rules_only" });

    const retry = await app.postJson(`/api/emails/${id}/reprocess`, {});
    expect(retry.status).toBe(202);
    await until(app, id, "complete");
    expect(llm.callCount).toBe(3); // A once, B twice
    const d = (await app.get(`/api/emails/${id}`)).body;
    expect(d.processing.runs).toHaveLength(2);
    expect(d.processing.runs[1].stages[0]).toMatchObject({ stage: "extraction", outcome: "skipped" });
  });

  it("an ungrounded risk finding is withheld (partial) and never shown as assessed", async () => {
    const bad = ok({ ...B_OK, risk: { ...B_OK.risk, evidence: [] } });
    app = await startApi({ llm: new FakeLlm([ok(A_OK), bad, bad]) });
    const id = await ingest(app);
    await app.postJson(`/api/emails/${id}/reprocess`, {});
    await until(app, id, "partial");
    const d = (await app.get(`/api/emails/${id}`)).body;
    expect(d.assessment).toBeNull();
    expect(d.risk.assessed).toBe(false);
    expect(d.processing.runs[0].stages[1]).toMatchObject({ error_kind: "ungrounded_assessment" });
  });

  it("malformed model output twice -> degraded", async () => {
    app = await startApi({ llm: new FakeLlm([raw("not json"), raw("{still not")]) });
    const id = await ingest(app);
    await app.postJson(`/api/emails/${id}/reprocess`, {});
    await until(app, id, "degraded");
  });

  it("no LLM configured -> degraded without any provider call", async () => {
    app = await startApi({ llm: null });
    const id = await ingest(app);
    const r = await app.postJson(`/api/emails/${id}/reprocess`, {});
    expect(r.status).toBe(202);
    await until(app, id, "degraded");
    const d = (await app.get(`/api/emails/${id}`)).body;
    expect(d.processing).toMatchObject({ provenance: "rules", model: null });
    expect(d.risk.assessed).toBe(false);
    const health = (await app.get("/api/health")).body;
    expect(health.llm).toMatchObject({ configured: false, provider: null, reachability: "unchecked" });
  });

  it("stops offering automatic retries after maxRuns; force overrides", async () => {
    const llm = new FakeLlm([fail("auth"), fail("auth"), fail("auth")]);
    app = await startApi({ llm, maxRuns: 1 });
    const id = await ingest(app);
    await app.postJson(`/api/emails/${id}/reprocess`, {});
    await until(app, id, "degraded");

    const d = (await app.get(`/api/emails/${id}`)).body;
    expect(d.processing.can_reprocess).toBe(false);
    const blocked = await app.postJson(`/api/emails/${id}/reprocess`, {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("max_runs_reached");
    expect((await app.postJson(`/api/emails/${id}/reprocess?force=true`, {})).status).toBe(202);
    await app.analysis.idle();
  });

  it("returns 503 with Retry-After when the queue is full, and leaves no phantom 'queued' record", async () => {
    const gated = new GatedLlm(new FakeLlm([ok(A_OK), ok(B_OK), ok(A_OK), ok(B_OK)]));
    app = await startApi({ llm: gated, queueCapacity: 1 });
    const a = await ingest(app, PASTE_WIRE);
    const b = await ingest(app, PASTE_BENIGN);
    const c = await ingest(app, "Subject: third\n\nthird message body");

    expect((await app.postJson(`/api/emails/${a}/reprocess`, {})).status).toBe(202); // running (held)
    await waitFor(async () => gated.entered === 1);
    expect((await app.postJson(`/api/emails/${b}/reprocess`, {})).status).toBe(202); // waiting
    const full = await app.postJson(`/api/emails/${c}/reprocess`, {});
    expect(full.status).toBe(503);
    expect(full.headers.get("retry-after")).toBe("10");
    expect(full.body.error.code).toBe("queue_full");
    expect(await status(app, c)).toBe("not_started");
    gated.release();
    await app.analysis.idle();
  });
});

describe("cross-email risk through the API (seed data, scripted model)", () => {
  it("E004: a validated AI 'none' is raised to medium by evidence from E009, with both levels visible", async () => {
    const { repo } = await loadSeed();
    const llm = new FakeLlm([ok({ summary: "Invoice from a vendor.", facts: {}, evidence_snippets: [], notes: [] }), ok(B_NONE)]);
    app = await startApi({ repo, llm });

    expect((await app.postJson("/api/emails/E004/reprocess", {})).status).toBe(202);
    await until(app, "E004", "complete");
    const d = (await app.get("/api/emails/E004")).body;

    expect(d.risk).toMatchObject({ ai_level: "none", rules_level: "medium", final_level: "medium", escalated: true });
    expect(d.risk.escalations[0]).toMatchObject({ from: "none", to: "medium" });
    expect(d.risk.disagreement).toMatchObject({ direction: "ai_lower", needs_review: true });
    expect(d.assessment.risk.level).toBe("none"); // the stored AI result is unchanged
    expect(d.risk.findings.map((f: any) => f.rule_id).sort()).toEqual(["invoice_amount_anomaly", "payment_account_changed"]);
    expect(d.risk.findings[0].related_email_ids).toEqual(["E009"]);
    expect(llm.callCount).toBe(2); // computing the findings made no model call

    // The cross-email result is visible on the other email without re-running anything.
    const list = (await app.get("/api/emails")).body.emails;
    expect(list.find((e: any) => e.id === "E004").risk).toMatchObject({ final_level: "medium", ai_level: "none", assessed: true });
    expect(list.find((e: any) => e.id === "E009").risk).toMatchObject({ final_level: "unassessed", assessed: false });
  });
});
