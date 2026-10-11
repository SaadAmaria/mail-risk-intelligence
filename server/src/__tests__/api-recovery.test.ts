import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AnalysisRecord } from "@mri/shared";
import { bootstrapAnalysis } from "../analysis/bootstrap";
import { AnalysisService } from "../analysis/service";
import { SqliteRepository } from "../storage/sqliteRepository";
import { A_OK, B_OK, wireEmail } from "./agentFixtures";
import { FakeLlm, ok } from "./fakes/fakeLlm";
import { startApi, waitFor, type Started } from "./apiHarness";
import { prepared } from "./helpers";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

function dbPath(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mri-recover-api-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "app.db");
}

const interrupted = (id: string, status: "extracting" | "analyzing" | "queued", runs = 1): AnalysisRecord => ({
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

/** A "previous process" that crashed mid-analysis, leaving its state in a real database file. */
function crashedDatabase(file: string, runs = 1): void {
  const before = new SqliteRepository(file);
  before.insertEmail(prepared(wireEmail(), "m1"));
  before.saveAnalysis(interrupted("m1", "extracting", runs));
  before.close();
}

/** A "new process": open the same file, build the service and run the boot logic. */
async function restart(file: string, llm: FakeLlm | null, autostart: boolean, maxRuns = 3) {
  const repo = new SqliteRepository(file);
  cleanup.push(() => repo.close());
  const service = new AnalysisService(repo, llm, { concurrency: 1, maxRuns, queueCapacity: 20, maxCompletionTokens: 1000 });
  const boot = bootstrapAnalysis(service, { autostart });
  return { repo, service, boot };
}

describe("restart recovery: when may an interrupted job call the provider?", () => {
  it("autostart OFF: the interrupted email is marked queued, NO provider call is made, and it waits", async () => {
    const file = dbPath();
    crashedDatabase(file);
    const llm = new FakeLlm([ok(A_OK), ok(B_OK)]);
    const { repo, service, boot } = await restart(file, llm, false);

    expect(boot).toEqual({ recovered: ["m1"], autoQueued: [], externalCallsMayStart: false });
    await new Promise((r) => setTimeout(r, 50));
    expect(llm.callCount).toBe(0);

    const a = repo.getAnalysis("m1")!;
    expect(a.status).toBe("queued"); // visible, unassessed, never safe
    expect(a.assessment).toBeNull();
    expect(a.runs[0]).toMatchObject({ outcome: "interrupted" });
    expect(service.isActive("m1")).toBe(false); // nothing is running or waiting in memory
  });

  it("autostart OFF: reading the mailbox over the API still makes no call; an explicit reprocess does", async () => {
    const file = dbPath();
    crashedDatabase(file);
    const llm = new FakeLlm([ok(A_OK), ok(B_OK)]);
    const { repo } = await restart(file, llm, false); // the boot logic ran; nothing was submitted
    const api: Started = await startApi({ repo, llm });
    cleanup.push(() => api.close());

    await api.get("/api/emails");
    await api.get("/api/emails/m1");
    await api.get("/api/graph");
    const waiting = (await api.get("/api/emails/m1")).body.processing;
    expect(waiting).toMatchObject({ status: "queued", in_progress: false, can_reprocess: true });
    expect(llm.callCount).toBe(0);

    const r = await api.postJson("/api/emails/m1/reprocess", {});
    expect(r.status).toBe(202);
    await waitFor(async () => (await api.get("/api/emails/m1")).body.processing.status === "complete");
    expect(llm.callCount).toBe(2);
    const d = (await api.get("/api/emails/m1")).body;
    expect(d.processing.runs.map((x: any) => x.outcome)).toEqual(["interrupted", "complete"]);
  });

  it("autostart ON: the interrupted email IS submitted at start-up, and the boot result says external calls may start", async () => {
    const file = dbPath();
    crashedDatabase(file);
    const llm = new FakeLlm([ok(A_OK), ok(B_OK)]);
    const { repo, service, boot } = await restart(file, llm, true);

    expect(boot.recovered).toEqual(["m1"]);
    expect(boot.externalCallsMayStart).toBe(true);
    await service.idle();
    expect(llm.callCount).toBe(2);
    expect(repo.getAnalysis("m1")!.status).toBe("complete");
  });

  it("autostart ON but no LLM configured: work runs degraded and no external call is possible", async () => {
    const file = dbPath();
    crashedDatabase(file);
    const { repo, service, boot } = await restart(file, null, true);
    expect(boot.externalCallsMayStart).toBe(false);
    await service.idle();
    expect(repo.getAnalysis("m1")!.status).toBe("degraded");
  });

  it("autostart ON also submits never-analyzed emails; autostart OFF does not", async () => {
    const file = dbPath();
    const before = new SqliteRepository(file);
    before.insertEmail(prepared(wireEmail(), "fresh"));
    before.close();

    const off = new FakeLlm([]);
    const a = await restart(file, off, false);
    expect(a.boot).toEqual({ recovered: [], autoQueued: [], externalCallsMayStart: false });
    expect(a.repo.getAnalysis("fresh")).toBeNull();
    expect(off.callCount).toBe(0);
    a.repo.close();

    const on = new FakeLlm([ok(A_OK), ok(B_OK)]);
    const b = await restart(file, on, true);
    expect(b.boot.autoQueued).toEqual(["fresh"]);
    await b.service.idle();
    expect(on.callCount).toBe(2);
  });

  it("repeatedly interrupted work is marked failed instead of being retried forever (no call either way)", async () => {
    for (const autostart of [false, true]) {
      const file = dbPath();
      crashedDatabase(file, 3);
      const llm = new FakeLlm([]);
      const { repo, boot } = await restart(file, llm, autostart, 3);
      expect(boot.recovered).toEqual([]);
      expect(repo.getAnalysis("m1")!.status).toBe("failed");
      expect(repo.getAnalysis("m1")!.assessment).toBeNull();
      expect(llm.callCount).toBe(0);
    }
  });

  it("a second restart before anything is processed is idempotent", async () => {
    const file = dbPath();
    crashedDatabase(file);
    const llm = new FakeLlm([]);
    const one = await restart(file, llm, false);
    one.repo.close();
    const two = await restart(file, llm, false);
    expect(two.repo.getAnalysis("m1")!.status).toBe("queued");
    expect(two.repo.getAnalysis("m1")!.runs).toHaveLength(1);
    expect(llm.callCount).toBe(0);
  });
});
