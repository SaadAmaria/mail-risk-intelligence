import { describe, expect, it } from "vitest";
import { IngestError } from "../ingestion/errors";
import { ingestPastedText, ingestUpload } from "../ingestion/ingest";
import { normalizeDate } from "../ingestion/normalize";
import { splitHeaderBlock } from "../ingestion/parseText";
import { MemoryRepository } from "../storage/memoryRepository";
import { fixture } from "./helpers";

function ctx() {
  return { repo: new MemoryRepository() };
}

describe("pasted text", () => {
  it("parses a header block into the normalized contract", async () => {
    const c = ctx();
    const text = fixture("wire-followup.txt").toString("utf8");
    const { email, created } = await ingestPastedText(c, text);
    expect(created).toBe(true);
    expect(email.source_kind).toBe("paste");
    expect(email.from).toEqual({ address: "priya.nair@northwind-logistics.example", name: "Priya Nair" });
    expect(email.to).toEqual([{ address: "ap@arcline.com", name: "AP Team" }]);
    expect(email.cc.map((a) => a.address)).toEqual(["tom.becker@arcline.com"]);
    expect(email.date).toBe("2026-06-09T14:22:05Z");
    expect(email.subject).toBe("Re: PO 7781 - delivery confirmation");
    expect(email.body).toContain("remaining\n$6,250.00");
    expect(email.missing_headers).toEqual([]);
    expect(email.raw_source).toBe(text);
  });

  it("uses explicit missing values for header-less text and invents nothing", async () => {
    const text = fixture("headerless-note.txt").toString("utf8");
    const { email } = await ingestPastedText(ctx(), text);
    expect(email.from).toBeNull();
    expect(email.to).toEqual([]);
    expect(email.date).toBeNull();
    expect(email.subject).toBeNull();
    expect(email.missing_headers).toEqual(["from", "to", "date", "subject"]);
    expect(email.body).toBe(text.replace(/\r\n/g, "\n"));
  });

  it("marks only the headers that are actually missing", async () => {
    const { email } = await ingestPastedText(ctx(), "Subject: Just a subject\n\nBody line.");
    expect(email.subject).toBe("Just a subject");
    expect(email.missing_headers).toEqual(["from", "to", "date"]);
  });

  it("maps Outlook-style 'Sent:' to the date", async () => {
    const { email } = await ingestPastedText(
      ctx(),
      "From: a@x.test\nSent: Mon, 08 Jun 2026 07:33:00 +0000\nTo: b@y.test\nSubject: s\n\nhello",
    );
    expect(email.date).toBe("2026-06-08T07:33:00Z");
  });

  it("does not mistake a header-looking line deep in prose for a header block", () => {
    const text = "Please see the thread below.\nFrom: someone@x.test\nSubject: older message\n\nbody";
    expect(splitHeaderBlock(text).headers).toBeNull();
  });

  it("only ends a header block without a blank line in lenient (PDF) mode", () => {
    const text = "From: a@x.test\nSubject: s\nThe body starts here.";
    expect(splitHeaderBlock(text).headers).toBeNull();
    const lenient = splitHeaderBlock(text, { lenient: true });
    expect(lenient.headers).toBe("From: a@x.test\nSubject: s");
    expect(lenient.body).toBe("The body starts here.");
  });

  it("warns about, and nulls, an unparseable date", async () => {
    const { email } = await ingestPastedText(ctx(), "From: a@x.test\nDate: sometime next week\nSubject: s\n\nhi");
    expect(email.date).toBeNull();
    expect(email.missing_headers).toContain("date");
    expect(email.warnings.join(" ")).toMatch(/Date ignored/);
  });

  it("ignores a malformed address with a warning rather than storing it", async () => {
    const { email } = await ingestPastedText(ctx(), "From: not-an-address\nTo: ok@x.test\nSubject: s\n\nhi");
    expect(email.from).toBeNull();
    expect(email.missing_headers).toContain("from");
    expect(email.warnings.join(" ")).toMatch(/without a valid email address: "not-an-address"/);
  });

  // Regression (reproduced defect F3): "Date: June 5" used to become 2001-06-04T21:00:00Z.
  it.each([
    ["June 5"],
    ["06/07/2026"],
    ["2026-06-01 12:00"],
    ["2026-06-01T12:00:00"],
    ["2026-06-01"],
    ["May 2026"],
    ["12"],
    ["Monday"],
    ["01 Jun 26 10:00:00 +0000"],
    ["31 Feb 2026 10:00:00 +0000"],
    ["2026-02-31T10:00:00Z"],
    ["2026-06-01T25:00:00Z"],
  ])("never invents a date from %j: null plus a warning", async (raw) => {
    const { email } = await ingestPastedText(ctx(), `From: a@x.test\nDate: ${raw}\nSubject: s\n\nbody`);
    expect(email.date).toBeNull();
    expect(email.missing_headers).toContain("date");
    expect(email.warnings.join(" ")).toMatch(/Date ignored/);
  });

  it.each([
    ["Mon, 08 Jun 2026 07:33:00 +0000", "2026-06-08T07:33:00Z"],
    ["8 Jun 2026 09:33 +0200", "2026-06-08T07:33:00Z"],
    ["Tue, 09 Jun 2026 14:22:05 -0500", "2026-06-09T19:22:05Z"],
    ["Tue, 09 Jun 2026 14:22:05 GMT", "2026-06-09T14:22:05Z"],
    ["Tue, 09 Jun 2026 08:00:00 EST (Eastern)", "2026-06-09T13:00:00Z"],
    ["2026-06-02T08:14:00Z", "2026-06-02T08:14:00Z"],
    ["2026-06-02T10:14:00+02:00", "2026-06-02T08:14:00Z"],
    ["2026-06-02T10:14:00.250+0200", "2026-06-02T08:14:00Z"],
    ["2026-06-02 08:14:00Z", "2026-06-02T08:14:00Z"],
  ])("accepts the explicit-zone date %j", async (raw, expected) => {
    const { email } = await ingestPastedText(ctx(), `From: a@x.test\nDate: ${raw}\nSubject: s\n\nbody`);
    expect(email.date).toBe(expected);
    expect(email.warnings).toEqual([]);
  });

  it("produces the same result in every machine timezone", () => {
    const original = process.env.TZ;
    try {
      const results = ["UTC", "America/Los_Angeles", "Asia/Kolkata", "Pacific/Auckland"].map((tz) => {
        process.env.TZ = tz;
        const w: string[] = [];
        return [
          normalizeDate("Mon, 08 Jun 2026 07:33:00 +0000", w),
          normalizeDate("2026-06-01 12:00", w), // no zone: must stay null everywhere
          normalizeDate("June 5", w),
        ];
      });
      for (const r of results) expect(r).toEqual(["2026-06-08T07:33:00Z", null, null]);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("rejects empty and whitespace-only input", async () => {
    await expect(ingestPastedText(ctx(), "")).rejects.toMatchObject({ code: "empty_input" });
    await expect(ingestPastedText(ctx(), "  \n\t \n")).rejects.toMatchObject({ code: "empty_input" });
  });

  it("rejects headers with no body", async () => {
    const p = ingestPastedText(ctx(), "From: a@x.test\nSubject: nothing here\n");
    await expect(p).rejects.toBeInstanceOf(IngestError);
    await expect(p).rejects.toMatchObject({ code: "empty_input" });
  });

  it("rejects pasted text above the size limit", async () => {
    const p = ingestPastedText({ ...ctx(), limits: { maxPasteChars: 100 } }, "x".repeat(101));
    await expect(p).rejects.toMatchObject({ code: "input_too_large" });
  });
});

describe(".txt uploads", () => {
  it("ingests the header-bearing fixture as txt", async () => {
    const { email } = await ingestUpload(ctx(), {
      filename: "wire-followup.txt",
      contentType: "text/plain; charset=utf-8",
      data: fixture("wire-followup.txt"),
    });
    expect(email.source_kind).toBe("txt");
    expect(email.source_filename).toBe("wire-followup.txt");
    expect(email.subject).toBe("Re: PO 7781 - delivery confirmation");
  });

  it("normalizes a UTF-8 BOM and CRLF line endings to the same content", async () => {
    const lf = "From: a@x.test\nTo: b@y.test\nDate: Mon, 01 Jun 2026 08:00:00 +0000\nSubject: Same\n\nline one\nline two\n";
    const crlf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(lf.replace(/\n/g, "\r\n"))]);
    const c = ctx();
    const a = await ingestPastedText(c, lf);
    const b = await ingestUpload(c, { filename: "same.txt", data: crlf });
    expect(b.created).toBe(false);
    expect(b.reason).toBe("duplicate_content");
    expect(b.email.id).toBe(a.email.id);
  });

  it("decodes windows-1252 text that is not valid UTF-8", async () => {
    const data = Buffer.from("Subject: caf\xe9\n\nm\xe9nu du jour", "latin1");
    const { email } = await ingestUpload(ctx(), { filename: "latin.txt", data });
    expect(email.subject).toBe("café");
    expect(email.body).toBe("ménu du jour");
  });
});

describe("duplicate handling", () => {
  it("returns the existing message when the same text is ingested twice", async () => {
    const c = ctx();
    const text = fixture("wire-followup.txt").toString("utf8");
    const first = await ingestPastedText(c, text);
    const second = await ingestPastedText(c, text);
    expect(second.created).toBe(false);
    expect(second.reason).toBe("duplicate_content");
    expect(second.email.id).toBe(first.email.id);
    expect(c.repo.countEmails()).toBe(1);
  });

  it("does not treat different messages as duplicates", async () => {
    const c = ctx();
    await ingestPastedText(c, "Subject: one\n\nbody a");
    await ingestPastedText(c, "Subject: one\n\nbody b");
    expect(c.repo.countEmails()).toBe(2);
  });
});
