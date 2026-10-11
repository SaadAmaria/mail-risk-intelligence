import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initialize, StartupError } from "../startup";
import { SqliteRepository } from "../storage/sqliteRepository";
import { SEED_PATH } from "./helpers";

const original = JSON.parse(readFileSync(SEED_PATH, "utf8")) as { emails: Record<string, unknown>[] };

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mri-start-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function seedFile(dir: string, content: string | object, bom = false): string {
  const file = path.join(dir, `seed-${Math.random().toString(36).slice(2)}.json`);
  const text = typeof content === "string" ? content : JSON.stringify(content);
  writeFileSync(file, (bom ? "﻿" : "") + text, "utf8");
  return file;
}

async function failure(opts: { dbPath: string; seedPath: string }): Promise<StartupError> {
  try {
    const r = await initialize(opts);
    r.repo.close();
  } catch (err) {
    expect(err).toBeInstanceOf(StartupError);
    return err as StartupError;
  }
  throw new Error("expected initialize() to fail");
}

function rowCount(dbPath: string): number {
  const r = new SqliteRepository(dbPath);
  try {
    return r.countEmails();
  } finally {
    r.close();
  }
}

describe("startup: valid seed", () => {
  it("seeds 10 emails, then reports them as already present on the next start", async () => {
    const dir = tempDir();
    const dbPath = path.join(dir, "app.db");
    const first = await initialize({ dbPath, seedPath: SEED_PATH });
    expect(first.report).toMatchObject({ total: 10, created: 10, existing: 0, errors: [] });
    first.repo.close();

    const second = await initialize({ dbPath, seedPath: SEED_PATH });
    expect(second.report).toMatchObject({ created: 0, existing: 10 });
    expect(second.repo.countEmails()).toBe(10);
    second.repo.close();
  });

  it("accepts a seed file saved with a UTF-8 BOM", async () => {
    const dir = tempDir();
    const seedPath = seedFile(dir, { emails: original.emails }, true);
    const r = await initialize({ dbPath: path.join(dir, "bom.db"), seedPath });
    expect(r.report.created).toBe(10);
    r.repo.close();
  });

  it("treats message-level warnings as non-fatal", async () => {
    const dir = tempDir();
    const record: Record<string, unknown> = { ...original.emails[1]!, date: "June 5" };
    const seedPath = seedFile(dir, { emails: [record] });
    const r = await initialize({ dbPath: path.join(dir, "warn.db"), seedPath });
    expect(r.report.created).toBe(1);
    const stored = r.repo.getEmail(String(record["id"]))!;
    expect(stored.date).toBeNull();
    expect(stored.warnings.join(" ")).toMatch(/Date ignored/);
    r.repo.close();
  });
});

describe("startup: mandatory seed failures are fatal and clear", () => {
  it("missing seed file", async () => {
    const dir = tempDir();
    const missing = path.join(dir, "nope.json");
    const err = await failure({ dbPath: path.join(dir, "a.db"), seedPath: missing });
    expect(err.code).toBe("seed_missing");
    expect(err.message).toContain(missing);
  });

  it("malformed JSON", async () => {
    const dir = tempDir();
    const err = await failure({
      dbPath: path.join(dir, "a.db"),
      seedPath: seedFile(dir, '{ "emails": [ {"id": "E001", '),
    });
    expect(err.code).toBe("seed_invalid");
    expect(err.message).toMatch(/not valid JSON/);
    expect(err.details.length).toBeGreaterThan(0);
  });

  it("valid JSON with the wrong shape reports field paths", async () => {
    const dir = tempDir();
    const err = await failure({
      dbPath: path.join(dir, "a.db"),
      seedPath: seedFile(dir, { emails: "not-an-array" }),
    });
    expect(err.code).toBe("seed_invalid");
    expect(err.details.join("\n")).toMatch(/^emails: /m);
  });

  it("an empty mailbox is not a healthy seed", async () => {
    const dir = tempDir();
    const err = await failure({ dbPath: path.join(dir, "a.db"), seedPath: seedFile(dir, { emails: [] }) });
    expect(err.code).toBe("seed_invalid");
    expect(err.message).toMatch(/no emails/);
  });

  it("partially valid records are fatal, name the fields, and leave the database empty", async () => {
    const dir = tempDir();
    const dbPath = path.join(dir, "partial.db");
    const bad = { id: "BAD", from: "x@y.test", body: "SECRET-BODY-CONTENT-123" };
    const seedPath = seedFile(dir, { emails: [original.emails[0], bad, original.emails[1]] });
    const err = await failure({ dbPath, seedPath });
    expect(err.code).toBe("seed_invalid");
    const text = err.details.join("\n");
    expect(text).toContain("BAD");
    expect(text).toMatch(/subject: Required/);
    expect(text).toMatch(/to: Required/);
    // No half-seeded mailbox, and the message never echoes email content.
    expect(rowCount(dbPath)).toBe(0);
    expect(text + err.message).not.toContain("SECRET-BODY-CONTENT-123");
  });

  it("duplicate ids inside the file are fatal", async () => {
    const dir = tempDir();
    const dup = { ...original.emails[0], body: "another body" };
    const err = await failure({
      dbPath: path.join(dir, "a.db"),
      seedPath: seedFile(dir, { emails: [original.emails[0], dup] }),
    });
    expect(err.code).toBe("seed_invalid");
    expect(err.details.join("\n")).toMatch(/duplicate record id "E001"/);
  });

  it("an insert that fails mid-seed is reported as seed_incomplete with the missing id", async () => {
    const dir = tempDir();
    const dbPath = path.join(dir, "blocked.db");
    const setup = new SqliteRepository(dbPath);
    setup.rawDb.exec(
      "CREATE TRIGGER block_e003 BEFORE INSERT ON emails WHEN NEW.id = 'E003' " +
        "BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END",
    );
    setup.close();

    const err = await failure({ dbPath, seedPath: SEED_PATH });
    expect(err.code).toBe("seed_incomplete");
    const text = err.details.join("\n");
    expect(text).toMatch(/E003: .*simulated storage failure/);
    expect(text).toMatch(/missing ids: E003/);
  });
});

describe("startup: database failures are fatal, clear, and sanitized", () => {
  it("database path whose parent is a file", async () => {
    const dir = tempDir();
    const notADir = path.join(dir, "afile");
    writeFileSync(notADir, "x");
    const err = await failure({ dbPath: path.join(notADir, "x.db"), seedPath: SEED_PATH });
    expect(err.code).toBe("database_unavailable");
    expect(err.message).toMatch(/Database could not be opened/);
    expect(err.details.join(" ")).toMatch(/DB_PATH/);
  });

  it("a file that is not a SQLite database", async () => {
    const dir = tempDir();
    const dbPath = path.join(dir, "garbage.db");
    writeFileSync(dbPath, "this is not a sqlite database");
    const err = await failure({ dbPath, seedPath: SEED_PATH });
    expect(err.code).toBe("database_unavailable");
    expect(err.message).not.toMatch(/\n\s+at /); // no stack trace
  });

  it("a database from a newer schema", async () => {
    const dir = tempDir();
    const dbPath = path.join(dir, "future.db");
    const s = new SqliteRepository(dbPath);
    s.rawDb.pragma("user_version = 99");
    s.close();
    const err = await failure({ dbPath, seedPath: SEED_PATH });
    expect(err.code).toBe("database_unavailable");
    expect(err.details.join(" ")).toMatch(/newer than this build supports/);
  });
});
