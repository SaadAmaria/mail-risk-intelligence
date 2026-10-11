import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AnalysisRecord } from "@mri/shared";
import { AnalysisService } from "../analysis/service";
import { MemoryRepository } from "../storage/memoryRepository";
import type { MailboxRepository } from "../storage/repository";
import { SqliteRepository } from "../storage/sqliteRepository";
import { A_OK, B_OK, wireEmail } from "./agentFixtures";
import { FakeLlm, ok } from "./fakes/fakeLlm";
import { prepared } from "./helpers";

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

function tempFile(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mri-analysis-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "app.db");
}

async function completeRecord(repo: MailboxRepository): Promise<AnalysisRecord> {
  repo.insertEmail(prepared(wireEmail(), "m1"));
  const svc = new AnalysisService(repo, new FakeLlm([ok(A_OK), ok(B_OK)]), {
    concurrency: 1,
    maxRuns: 3,
    queueCapacity: 10,
    maxCompletionTokens: 1000,
    now: () => new Date("2026-10-11T12:00:00.000Z"),
  });
  svc.enqueue("m1");
  await svc.idle();
  return repo.getAnalysis("m1")!;
}

describe("analysis persistence", () => {
  it("round-trips a complete analysis across closing and reopening the SQLite file", async () => {
    const file = tempFile();
    const a = new SqliteRepository(file);
    const saved = await completeRecord(a);
    expect(saved.status).toBe("complete");
    a.close();

    const b = new SqliteRepository(file);
    cleanup.push(() => b.close());
    const loaded = b.getAnalysis("m1")!;
    expect(loaded).toEqual(saved);
    expect(loaded.assessment?.risk.level).toBe("high");
    expect(loaded.runs[0]!.stages[0]!.usage?.total_tokens).toBe(150);
    expect(b.listAnalyses().map((r) => r.email_id)).toEqual(["m1"]);
  });

  it("memory and SQLite repositories behave the same for this scenario", async () => {
    const mem = await completeRecord(new MemoryRepository());
    const sql = new SqliteRepository(":memory:");
    cleanup.push(() => sql.close());
    expect(await completeRecord(sql)).toEqual(mem);
  });

  it("upserts: a later save replaces the earlier analysis for the same email", async () => {
    const repo = new SqliteRepository(":memory:");
    cleanup.push(() => repo.close());
    const done = await completeRecord(repo);
    repo.saveAnalysis({
      ...done,
      status: "queued",
      analysis_mode: null,
      assessment: null,
    });
    expect(repo.getAnalysis("m1")!.status).toBe("queued");
    expect(repo.listAnalyses()).toHaveLength(1);
  });

  it("rejects an analysis for an email that does not exist", () => {
    for (const repo of [new MemoryRepository(), new SqliteRepository(":memory:")]) {
      expect(() =>
        repo.saveAnalysis({
          email_id: "ghost",
          status: "queued",
          analysis_mode: null,
          provenance: null,
          extraction: null,
          assessment: null,
          warnings: [],
          runs: [],
          model: null,
          prompt_version: null,
          updated_at: "2026-10-11T12:00:00.000Z",
        }),
      ).toThrow();
      repo.close();
    }
  });

  it("downgrades a stored 'complete' whose assessment no longer matches the schema", async () => {
    const repo = new SqliteRepository(":memory:");
    cleanup.push(() => repo.close());
    await completeRecord(repo);
    repo.rawDb.prepare("UPDATE analyses SET assessment_json = ? WHERE email_id = 'm1'").run('{"risk":{"level":"none"}}');

    const r = repo.getAnalysis("m1")!;
    expect(r.status).toBe("failed"); // never surfaces as complete / safe
    expect(r.assessment).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/no longer matches the current schema/);
  });
});
