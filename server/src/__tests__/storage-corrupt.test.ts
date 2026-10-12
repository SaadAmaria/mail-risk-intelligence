import { afterEach, describe, expect, it } from "vitest";
import { ingestSeedRecord } from "../ingestion/ingest";
import { SeedEmail } from "../ingestion/parseSeed";
import { SqliteRepository } from "../storage/sqliteRepository";
import { startApi, type Started } from "./apiHarness";
import { aiComplete, seedRaw } from "./riskFixtures";

let app: Started | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

/** A real SQLite repository holding E004 (healthy, complete) and E009 (about to be corrupted). */
async function sqliteWithSeed() {
  const repo = new SqliteRepository(":memory:");
  for (const id of ["E004", "E009"]) {
    await ingestSeedRecord({ repo }, SeedEmail.parse(seedRaw.find((e) => e.id === id)!));
  }
  repo.saveAnalysis(aiComplete(repo.getEmail("E004")!, "low", { entities: [{ ref: "o", type: "organization", name: "Northgate Suppliers Inc." }], evidence: false }));
  repo.saveAnalysis(aiComplete(repo.getEmail("E009")!, "none", { entities: [{ ref: "o", type: "organization", name: "Northgate Suppliers Inc." }], evidence: false }));
  return repo;
}

const BAD = "{not json";

describe("syntactically invalid stored JSON", () => {
  it.each(["assessment_json", "extraction_json", "warnings_json", "attempts_json"] as const)(
    "a corrupted %s isolates that record; the list, the graph and the other record keep working",
    async (column) => {
      const repo = await sqliteWithSeed();
      repo.rawDb.prepare(`UPDATE analyses SET ${column} = ? WHERE email_id = 'E009'`).run(BAD);
      app = await startApi({ repo });

      const list = await app.get("/api/emails?limit=50");
      expect(list.status).toBe(200);
      expect(list.body.emails.map((e: any) => e.id).sort()).toEqual(["E004", "E009"]);

      const graph = await app.get("/api/graph");
      expect(graph.status).toBe(200);

      // the healthy record is complete and intact
      const ok = (await app.get("/api/emails/E004")).body;
      expect(ok.processing.status).toBe("complete");
      expect(ok.assessment).not.toBeNull();

      // the corrupted record: original email intact, no fabricated analysis, honest status
      const bad = await app.get("/api/emails/E009");
      expect(bad.status).toBe(200);
      expect(bad.body.email.subject).toMatch(/NS-4188/);
      expect(bad.body.email.body.length).toBeGreaterThan(10);
      if (column === "assessment_json" || column === "extraction_json") {
        expect(bad.body.processing.status).toBe("failed"); // a complete record is never kept without its parts
        expect(bad.body.assessment).toBeNull();
        expect(bad.body.risk.assessed).toBe(false);
        expect(bad.body.risk.final_level).not.toBe("none");
      }
      expect(bad.body.processing.warnings.join(" ")).toMatch(/could not be read|ignored/);
    },
  );

  it("a corrupted address column does not take down the email", async () => {
    const repo = await sqliteWithSeed();
    repo.rawDb.prepare("UPDATE emails SET to_json = ? WHERE id = 'E009'").run(BAD);
    app = await startApi({ repo });
    const list = await app.get("/api/emails?limit=50");
    expect(list.status).toBe(200);
    const d = await app.get("/api/emails/E009");
    expect(d.status).toBe(200);
    expect(d.body.email.to).toEqual([]);
    expect(d.body.email.body).toMatch(/monthly invoice/);
  });

  it("does not rewrite the stored bytes on read", async () => {
    const repo = await sqliteWithSeed();
    repo.rawDb.prepare("UPDATE analyses SET assessment_json = ? WHERE email_id = 'E009'").run(BAD);
    app = await startApi({ repo });
    await app.get("/api/graph");
    const row = repo.rawDb.prepare("SELECT assessment_json FROM analyses WHERE email_id = 'E009'").get() as { assessment_json: string };
    expect(row.assessment_json).toBe(BAD);
  });

  it("a partial record that lost its extraction is not left as partial", async () => {
    const repo = await sqliteWithSeed();
    repo.rawDb.prepare("UPDATE analyses SET status = 'partial', analysis_mode = 'partial', assessment_json = NULL, extraction_json = ? WHERE email_id = 'E009'").run(BAD);
    const a = repo.getAnalysis("E009")!;
    expect(a.status).toBe("failed");
    expect(a.extraction).toBeNull();
  });
});

describe("valid JSON with the wrong structure", () => {
  const goodRun = { started_at: "2026-10-11T10:00:00Z", finished_at: "2026-10-11T10:00:01Z", outcome: "degraded", stages: [] };
  const cases: [string, string, string][] = [
    ["attempts_json", "[null]", "a null run"],
    ["attempts_json", "[{}]", "an empty run"],
    ["attempts_json", '[{"started_at":"t","finished_at":null,"outcome":null,"stages":[{}]}]', "a run with an empty stage"],
    ["attempts_json", '[{"started_at":"t","finished_at":null,"outcome":"exploded","stages":[]}]', "a run with an unknown outcome"],
    ["attempts_json", "{}", "an object instead of an array"],
    ["attempts_json", '"text"', "a string instead of an array"],
    ["warnings_json", '[1,null,{"x":1}]', "non-string warnings"],
  ];

  it.each(cases)("%s = %s (%s): every endpoint keeps working", async (column, value) => {
    const repo = await sqliteWithSeed();
    repo.rawDb.prepare(`UPDATE analyses SET ${column} = ? WHERE email_id = 'E009'`).run(value);
    app = await startApi({ repo });
    const list = await app.get("/api/emails?limit=50");
    expect(list.status).toBe(200);
    expect(list.body.emails.find((e: any) => e.id === "E009").processing.run_count).toBe(0);
    expect((await app.get("/api/graph")).status).toBe(200);
    const d = await app.get("/api/emails/E009");
    expect(d.status).toBe(200);
    expect(d.body.email.subject).toMatch(/NS-4188/);
    expect(d.body.processing.status).toBe("complete"); // the validated assessment itself is untouched
    expect(d.body.processing.runs).toEqual([]);
    const healthy = (await app.get("/api/emails/E004")).body;
    expect(healthy.processing.status).toBe("complete");
    // never rewritten on read
    const row = repo.rawDb.prepare(`SELECT ${column} AS v FROM analyses WHERE email_id = 'E009'`).get() as { v: string };
    expect(row.v).toBe(value);
  });

  it("an array with one good run and one bad run keeps the good one and says so", async () => {
    const repo = await sqliteWithSeed();
    repo.rawDb.prepare("UPDATE analyses SET attempts_json = ? WHERE email_id = 'E009'").run(JSON.stringify([goodRun, null]));
    app = await startApi({ repo });
    const d = (await app.get("/api/emails/E009")).body;
    expect(d.processing.runs).toHaveLength(1);
    expect(d.processing.warnings.join(" ")).toMatch(/1 stored run record\(s\) were malformed/);
  });

  it.each(["[null]", "[{}]", '[{"address":5}]', '[{"address":"a@b.example"}]', '"x"'])(
    "to_json = %s does not crash the email; valid addresses survive",
    async (value) => {
      const repo = await sqliteWithSeed();
      repo.rawDb.prepare("UPDATE emails SET to_json = ? WHERE id = 'E009'").run(value);
      app = await startApi({ repo });
      expect((await app.get("/api/emails?limit=50")).status).toBe(200);
      expect((await app.get("/api/graph")).status).toBe(200);
      const d = await app.get("/api/emails/E009");
      expect(d.status).toBe(200);
      expect(d.body.email.to).toEqual([]);
      expect(d.body.email.body).toMatch(/monthly invoice/);
    },
  );

  it("a mixed address array keeps only the well-formed address", async () => {
    const repo = await sqliteWithSeed();
    repo.rawDb.prepare("UPDATE emails SET to_json = ? WHERE id = 'E009'").run(JSON.stringify([null, { address: "ap@arcline.com", name: null }, { address: 3 }]));
    app = await startApi({ repo });
    expect((await app.get("/api/emails/E009")).body.email.to).toEqual([{ address: "ap@arcline.com", name: null }]);
  });

  it("missing_headers and cc with the wrong element types are tolerated", async () => {
    const repo = await sqliteWithSeed();
    repo.rawDb.prepare("UPDATE emails SET missing_headers_json = ?, cc_json = ? WHERE id = 'E009'").run("[1,null]", "[{}]");
    app = await startApi({ repo });
    const d = await app.get("/api/emails/E009");
    expect(d.status).toBe(200);
    expect(d.body.email.cc).toEqual([]);
    expect(d.body.email.missing_headers).toEqual([]);
  });
});

describe("unreadable email list columns are reported, never filled in", () => {
  const issues = async (repo: SqliteRepository) => {
    app = await startApi({ repo });
    const d = await app.get("/api/emails/E009");
    expect(d.status).toBe(200);
    return d.body.email;
  };

  it("a healthy email reports no read issues", async () => {
    const e = await issues(await sqliteWithSeed());
    expect(e.read_issues).toBeUndefined();
    expect(e.to.length).toBeGreaterThan(0);
  });

  it("a partially corrupt recipient list keeps the healthy recipient and reports how many were dropped", async () => {
    const repo = await sqliteWithSeed();
    repo.rawDb.prepare("UPDATE emails SET to_json = ? WHERE id = 'E009'").run(JSON.stringify([null, { address: "ap@arcline.com", name: null }, { address: 3 }]));
    const e = await issues(repo);
    expect(e.to).toEqual([{ address: "ap@arcline.com", name: null }]);
    expect(e.read_issues).toEqual([{ field: "to", unreadable: false, dropped: 2 }]);
  });

  it("to_json = [null]: no recipient is manufactured and the loss is reported", async () => {
    const repo = await sqliteWithSeed();
    repo.rawDb.prepare("UPDATE emails SET to_json = ? WHERE id = 'E009'").run("[null]");
    const e = await issues(repo);
    expect(e.to).toEqual([]);
    expect(e.read_issues).toEqual([{ field: "to", unreadable: false, dropped: 1 }]);
  });

  it("a wholly unreadable recipient column is reported as unreadable", async () => {
    const repo = await sqliteWithSeed();
    repo.rawDb.prepare("UPDATE emails SET to_json = ? WHERE id = 'E009'").run(BAD);
    const e = await issues(repo);
    expect(e.to).toEqual([]);
    expect(e.read_issues).toEqual([{ field: "to", unreadable: true, dropped: 0 }]);
  });

  it("cc, missing_headers (including an unknown header name) and warnings elements are each reported", async () => {
    const repo = await sqliteWithSeed();
    repo.rawDb
      .prepare("UPDATE emails SET cc_json = ?, missing_headers_json = ?, warnings_json = ? WHERE id = 'E009'")
      .run('[{}, {"address":"cc@arcline.com","name":null}]', '["date", "bogus", 1]', '["kept note", null]');
    const e = await issues(repo);
    expect(e.cc).toEqual([{ address: "cc@arcline.com", name: null }]);
    expect(e.missing_headers).toEqual(["date"]);
    expect(e.warnings).toEqual(["kept note"]);
    expect(e.read_issues).toEqual([
      { field: "cc", unreadable: false, dropped: 1 },
      { field: "missing_headers", unreadable: false, dropped: 2 },
      { field: "warnings", unreadable: false, dropped: 1 },
    ]);
  });

  it("inbox and graph stay available, and the stored email columns and source are not rewritten", async () => {
    const repo = await sqliteWithSeed();
    const before = repo.rawDb.prepare("SELECT raw_source, body FROM emails WHERE id = 'E009'").get() as { raw_source: string; body: string };
    repo.rawDb.prepare("UPDATE emails SET to_json = ?, cc_json = ? WHERE id = 'E009'").run("[null]", BAD);
    app = await startApi({ repo });
    expect((await app.get("/api/emails?limit=50")).status).toBe(200);
    expect((await app.get("/api/graph")).status).toBe(200);
    expect((await app.get("/api/emails/E009")).status).toBe(200);
    const after = repo.rawDb.prepare("SELECT to_json, cc_json, raw_source, body FROM emails WHERE id = 'E009'").get() as Record<string, string>;
    expect(after).toEqual({ to_json: "[null]", cc_json: BAD, raw_source: before.raw_source, body: before.body });
  });
});
