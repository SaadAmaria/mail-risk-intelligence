import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "../storage/memoryRepository";
import type { EmailRepository } from "../storage/repository";
import { SqliteRepository } from "../storage/sqliteRepository";
import { prepared } from "./helpers";

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

function tempDbPath(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mri-test-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "nested", "test.db");
}

const factories: [string, () => EmailRepository][] = [
  ["MemoryRepository", () => new MemoryRepository()],
  ["SqliteRepository(:memory:)", () => new SqliteRepository(":memory:")],
  ["SqliteRepository(file)", () => new SqliteRepository(tempDbPath())],
];

describe.each(factories)("repository contract: %s", (_name, make) => {
  function open(): EmailRepository {
    const repo = make();
    cleanup.push(() => repo.close());
    return repo;
  }

  it("round-trips an email with ordered attachments", () => {
    const repo = open();
    const p = prepared({
      attachments: [
        {
          filename: "b.pdf",
          mime_type: "application/pdf",
          size_bytes: 10,
          text_origin: "extracted",
          extraction_status: "ok",
          error_message: null,
          truncated: false,
          extracted_text: "Invoice 42",
        },
        {
          filename: "a.png",
          mime_type: "image/png",
          size_bytes: 99,
          text_origin: null,
          extraction_status: "unsupported_type",
          error_message: "not supported",
          truncated: false,
          extracted_text: null,
        },
      ],
    });
    const res = repo.insertEmail(p);
    expect(res.created).toBe(true);
    const got = repo.getEmail(res.email.id)!;
    expect(got.subject).toBe("Subject");
    expect(got.attachments.map((a) => a.filename)).toEqual(["b.pdf", "a.png"]);
    expect(got.attachments[0]!.extracted_text).toBe("Invoice 42");
    expect(got.attachments[1]!.extraction_status).toBe("unsupported_type");
    expect(got.raw_source).toBe(p.raw_source);
    expect(repo.countEmails()).toBe(1);
  });

  it("preserves a caller-supplied id and rejects a repeat of it", () => {
    const repo = open();
    const first = repo.insertEmail(prepared({ subject: "one" }, "E001"));
    expect(first.email.id).toBe("E001");
    const again = repo.insertEmail(prepared({ subject: "different content" }, "E001"));
    expect(again.created).toBe(false);
    expect(again.reason).toBe("id_exists");
    expect(repo.countEmails()).toBe(1);
  });

  it("treats identical content as a duplicate and returns the original", () => {
    const repo = open();
    const first = repo.insertEmail(prepared({ subject: "dup" }));
    const second = repo.insertEmail(prepared({ subject: "dup" }));
    expect(second.created).toBe(false);
    expect(second.reason).toBe("duplicate_content");
    expect(second.email.id).toBe(first.email.id);
    expect(repo.countEmails()).toBe(1);
  });

  it("orders by date, nulls last, with a stable tie-break", () => {
    const repo = open();
    repo.insertEmail(prepared({ subject: "undated", date: null }, "U"));
    repo.insertEmail(prepared({ subject: "late", date: "2026-06-09T00:00:00Z" }, "L"));
    repo.insertEmail(prepared({ subject: "early", date: "2026-05-04T11:00:00Z" }, "A"));
    repo.insertEmail(prepared({ subject: "tie", date: "2026-06-09T00:00:00Z" }, "B"));
    expect(repo.listEmails({ order: "date_asc" }).map((e) => e.id)).toEqual(["A", "B", "L", "U"]);
    expect(repo.listEmails().map((e) => e.id)).toEqual(["B", "L", "A", "U"]);
  });

  it("returns null for an unknown id", () => {
    expect(open().getEmail("nope")).toBeNull();
  });

  it("stores hostile strings literally (parameterized SQL)", () => {
    const repo = open();
    const evil = "'); DROP TABLE emails; --";
    const res = repo.insertEmail(prepared({ subject: evil, body: evil }));
    expect(repo.getEmail(res.email.id)!.subject).toBe(evil);
    expect(repo.countEmails()).toBe(1);
  });

  it("close() is idempotent", () => {
    const repo = make();
    repo.close();
    expect(() => repo.close()).not.toThrow();
  });
});

describe("SqliteRepository specifics", () => {
  it("persists full content, attachments and provenance across closing and reopening the file", () => {
    const file = tempDbPath();
    const p = prepared(
      {
        subject: "durable",
        body: "Body with ünïcode and\nnewlines",
        from: { address: "a@x.test", name: "Ada" },
        cc: [{ address: "c@x.test", name: null }],
        date: "2026-06-01T12:00:00Z",
        missing_headers: [],
        warnings: ["a warning"],
        body_truncated: true,
        attachments: [
          {
            filename: "invoice.pdf",
            mime_type: "application/pdf",
            size_bytes: 1234,
            text_origin: "extracted",
            extraction_status: "ok",
            error_message: "partial",
            truncated: true,
            extracted_text: "Invoice 42\nTotal: $5,000.00",
          },
          {
            filename: "scan.pdf",
            mime_type: "application/pdf",
            size_bytes: 99,
            text_origin: null,
            extraction_status: "ocr_unsupported",
            error_message: "no text layer",
            truncated: false,
            extracted_text: null,
          },
        ],
      },
      "P1",
    );
    const a = new SqliteRepository(file);
    a.insertEmail(p);
    a.close();

    const b = new SqliteRepository(file);
    cleanup.push(() => b.close());
    expect(b.countEmails()).toBe(1);
    const got = b.getEmail("P1")!;
    expect(got.subject).toBe("durable");
    expect(got.body).toBe("Body with ünïcode and\nnewlines");
    expect(got.body_truncated).toBe(true);
    expect(got.from).toEqual({ address: "a@x.test", name: "Ada" });
    expect(got.cc).toEqual([{ address: "c@x.test", name: null }]);
    expect(got.warnings).toEqual(["a warning"]);
    expect(got.raw_source).toBe(p.raw_source);
    expect(got.content_hash).toBe(p.content_hash);
    expect(got.attachments.map((x) => x.filename)).toEqual(["invoice.pdf", "scan.pdf"]);
    expect(got.attachments[0]).toMatchObject({
      extracted_text: "Invoice 42\nTotal: $5,000.00",
      text_origin: "extracted",
      truncated: true,
      size_bytes: 1234,
    });
    expect(got.attachments[1]).toMatchObject({
      extraction_status: "ocr_unsupported",
      extracted_text: null,
      error_message: "no text layer",
    });
    // The reopened database still deduplicates by content.
    expect(b.insertEmail(prepared({ ...p.email }, "OTHER")).reason).toBe("duplicate_content");
  });

  it("initializes repeatably and creates the foundation tables", () => {
    const file = tempDbPath();
    new SqliteRepository(file).close();
    const repo = new SqliteRepository(file); // second open runs init again
    cleanup.push(() => repo.close());
    const tables = (
      repo.rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    for (const t of ["emails", "attachments", "analyses", "entities", "entity_mentions", "relationships"]) {
      expect(tables).toContain(t);
    }
    expect(repo.rawDb.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(repo.rawDb.pragma("user_version", { simple: true })).toBe(1);
  });

  it("refuses a database written by a newer schema", () => {
    const file = tempDbPath();
    const a = new SqliteRepository(file);
    a.rawDb.pragma("user_version = 99");
    a.close();
    expect(() => new SqliteRepository(file)).toThrow(/newer than this build supports/);
  });

  it("cascades attachment rows when an email is deleted", () => {
    const repo = new SqliteRepository(":memory:");
    cleanup.push(() => repo.close());
    const res = repo.insertEmail(
      prepared({
        attachments: [
          {
            filename: "x.txt",
            mime_type: "text/plain",
            size_bytes: 1,
            text_origin: "extracted",
            extraction_status: "ok",
            error_message: null,
            truncated: false,
            extracted_text: "x",
          },
        ],
      }),
    );
    repo.rawDb.prepare("DELETE FROM emails WHERE id = ?").run(res.email.id);
    const n = repo.rawDb.prepare("SELECT COUNT(*) AS n FROM attachments").get() as { n: number };
    expect(n.n).toBe(0);
  });
});
