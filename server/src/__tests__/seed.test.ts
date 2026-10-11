import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ingestPastedText, ingestUpload } from "../ingestion/ingest";
import { computeContentHash } from "../ingestion/normalize";
import { loadSeedFile, seedFromFile } from "../ingestion/seed";
import { MemoryRepository } from "../storage/memoryRepository";
import { SqliteRepository } from "../storage/sqliteRepository";
import { buildEml, prepared, SEED_PATH, sha256File } from "./helpers";

interface SeedRecord {
  id: string;
  from: string;
  to: string[];
  date: string;
  subject: string;
  body: string;
  attachments: { filename: string; extracted_text: string }[];
}

const original = JSON.parse(readFileSync(SEED_PATH, "utf8")) as { emails: SeedRecord[] };

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

function memRepo(): SqliteRepository {
  const r = new SqliteRepository(":memory:");
  cleanup.push(() => r.close());
  return r;
}

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mri-seed-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe("seed loading", () => {
  it("loads exactly the 10 emails from the original file", async () => {
    const repo = memRepo();
    const report = await seedFromFile({ repo }, SEED_PATH);
    expect(original.emails).toHaveLength(10);
    expect(report).toEqual({ total: 10, created: 10, existing: 0, errors: [] });
    expect(repo.countEmails()).toBe(10);
    expect(
      repo
        .listEmails()
        .map((e) => e.id)
        .sort(),
    ).toEqual(original.emails.map((e) => e.id).sort());
  });

  it("does not modify the original JSON file", async () => {
    const before = sha256File(SEED_PATH);
    await seedFromFile({ repo: memRepo() }, SEED_PATH);
    expect(sha256File(SEED_PATH)).toBe(before);
  });

  it("preserves ids, headers, bodies, and attachment filenames and text verbatim", async () => {
    const repo = memRepo();
    await seedFromFile({ repo }, SEED_PATH);
    for (const rec of original.emails) {
      const e = repo.getEmail(rec.id)!;
      expect(e, rec.id).not.toBeNull();
      expect(e.external_id).toBe(rec.id);
      expect(e.source_kind).toBe("seed");
      expect(e.from?.address).toBe(rec.from);
      expect(e.to.map((a) => a.address)).toEqual(rec.to);
      expect(e.date).toBe(rec.date); // seed dates are second-resolution UTC and round-trip exactly
      expect(e.subject).toBe(rec.subject);
      expect(e.body).toBe(rec.body);
      expect(e.missing_headers).toEqual([]);
      expect(e.attachments.map((a) => a.filename)).toEqual(rec.attachments.map((a) => a.filename));
      expect(e.attachments.map((a) => a.extracted_text)).toEqual(rec.attachments.map((a) => a.extracted_text));
      for (const a of e.attachments) {
        expect(a.text_origin).toBe("provided");
        expect(a.extraction_status).toBe("ok");
      }
    }
    const withAttachments = original.emails.filter((r) => r.attachments.length > 0).map((r) => r.id);
    expect(withAttachments.sort()).toEqual(["E003", "E004", "E007", "E009"]);
  });

  it("is idempotent within one database", async () => {
    const repo = memRepo();
    await seedFromFile({ repo }, SEED_PATH);
    const second = await seedFromFile({ repo }, SEED_PATH);
    expect(second).toEqual({ total: 10, created: 0, existing: 10, errors: [] });
    expect(repo.countEmails()).toBe(10);
  });

  it("does not duplicate across a restart (close and reopen the database file)", async () => {
    const file = path.join(tempDir(), "seed.db");
    const first = new SqliteRepository(file);
    await seedFromFile({ repo: first }, SEED_PATH);
    first.close();

    const second = new SqliteRepository(file);
    cleanup.push(() => second.close());
    expect(second.countEmails()).toBe(10);
    const report = await seedFromFile({ repo: second }, SEED_PATH);
    expect(report.created).toBe(0);
    expect(second.countEmails()).toBe(10);
  });

  it("derives chronology from message dates, not array order", async () => {
    // In the file, E009 (2026-05-04) is listed ninth but is the earliest message.
    expect(original.emails.findIndex((e) => e.id === "E009")).toBe(8);
    const repo = memRepo();
    await seedFromFile({ repo }, SEED_PATH);
    const asc = repo.listEmails({ order: "date_asc" }).map((e) => e.id);
    expect(asc[0]).toBe("E009");
    const expected = [...original.emails].sort((a, b) => a.date.localeCompare(b.date)).map((e) => e.id);
    expect(asc).toEqual(expected);
  });

  it("rejects an invalid record without aborting the rest, and reports it", async () => {
    const dir = tempDir();
    const file = path.join(dir, "partial.json");
    const good = original.emails[1]!;
    writeFileSync(file, JSON.stringify({ emails: [{ id: "BAD1", from: "x@y.test" }, good] }));
    const repo = memRepo();
    const report = await seedFromFile({ repo }, file);
    expect(report.created).toBe(1);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]!.id).toBe("BAD1");
    expect(repo.getEmail(good.id)).not.toBeNull();
  });

  it("throws a typed error for a missing seed file", async () => {
    await expect(
      seedFromFile({ repo: memRepo() }, path.join(tempDir(), "nope.json")),
    ).rejects.toMatchObject({ code: "seed_missing" });
  });
});

// Regression for reproduced defect F1: user content ingested before seeding used to take the
// content hash, so a seed message silently never received its original id.
describe("seed identity", () => {
  const e1 = original.emails[0]!;
  const asPaste = () =>
    `From: ${e1.from}\nTo: ${e1.to.join(", ")}\nDate: ${e1.date}\nSubject: ${e1.subject}\n\n${e1.body}`;

  it("keeps E001–E010 even when identical content was pasted before seeding", async () => {
    const repo = memRepo();
    const pasted = await ingestPastedText({ repo }, asPaste());
    expect(pasted.created).toBe(true);

    const report = await seedFromFile({ repo }, SEED_PATH);
    expect(report).toEqual({ total: 10, created: 10, existing: 0, errors: [] });
    const seeded = repo.getEmail("E001")!;
    expect(seeded).not.toBeNull();
    expect(seeded.source_kind).toBe("seed");
    expect(pasted.email.id).not.toBe("E001");
    expect(repo.countEmails()).toBe(11); // the pasted copy is stored separately
  });

  it("keeps ids when the same content arrives as an EML before seeding", async () => {
    const repo = memRepo();
    const eml = buildEml({
      from: e1.from,
      to: e1.to.join(", "),
      date: "Tue, 02 Jun 2026 08:14:00 +0000",
      subject: e1.subject,
      text: e1.body,
    });
    await ingestUpload({ repo }, { filename: "copy.eml", data: eml });
    const report = await seedFromFile({ repo }, SEED_PATH);
    expect(report.created).toBe(10);
    expect(repo.getEmail("E001")).not.toBeNull();
  });

  it("documents the trade-off: a pasted copy made after seeding is stored separately", async () => {
    const repo = memRepo();
    await seedFromFile({ repo }, SEED_PATH);
    const pasted = await ingestPastedText({ repo }, asPaste());
    expect(pasted.created).toBe(true);
    expect(pasted.email.id).not.toBe("E001");
    expect(pasted.email.source_kind).toBe("paste");
    expect(repo.countEmails()).toBe(11);
    // ...but pasting the same copy again is still deduplicated against the first paste.
    const again = await ingestPastedText({ repo }, asPaste());
    expect(again.created).toBe(false);
    expect(again.email.id).toBe(pasted.email.id);
  });

  it("stays idempotent after the id-collision scenario", async () => {
    const repo = memRepo();
    await ingestPastedText({ repo }, asPaste());
    await seedFromFile({ repo }, SEED_PATH);
    const second = await seedFromFile({ repo }, SEED_PATH);
    expect(second).toEqual({ total: 10, created: 0, existing: 10, errors: [] });
    expect(repo.countEmails()).toBe(11);
  });

  it("still treats a legacy seed row (unscoped hash) as already present", async () => {
    const repo = memRepo();
    const legacy = prepared(
      {
        source_kind: "seed",
        external_id: "E001",
        from: { address: e1.from, name: null },
        to: e1.to.map((address) => ({ address, name: null })),
        date: e1.date,
        subject: e1.subject,
        body: e1.body,
      },
      "E001",
    );
    // Hash as an older build computed it: no seed scope.
    legacy.content_hash = computeContentHash({ ...legacy.email, source_kind: "paste" });
    repo.insertEmail(legacy);

    const report = await seedFromFile({ repo }, SEED_PATH);
    expect(report).toEqual({ total: 10, created: 9, existing: 1, errors: [] });
  });

  it("reports a content collision as an error, never as 'existing'", async () => {
    const stub = new MemoryRepository();
    stub.insertEmail = () => ({
      email: { id: "em_other" } as never,
      created: false,
      reason: "duplicate_content",
    });
    const report = await seedFromFile({ repo: stub }, SEED_PATH);
    expect(report.created).toBe(0);
    expect(report.existing).toBe(0);
    expect(report.errors).toHaveLength(10);
    expect(report.errors[0]!.message).toMatch(/could not be stored under its own id/);
  });

  it("reports duplicate record ids in the file instead of skipping silently", () => {
    const dir = tempDir();
    const file = path.join(dir, "dup.json");
    writeFileSync(file, JSON.stringify({ emails: [original.emails[0], { ...original.emails[0], body: "different" }] }));
    const loaded = loadSeedFile(file);
    expect(loaded.records).toHaveLength(1);
    expect(loaded.errors).toHaveLength(1);
    expect(loaded.errors[0]!.message).toMatch(/duplicate record id "E001"/);
  });
});
