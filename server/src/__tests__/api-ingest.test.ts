import { afterEach, describe, expect, it } from "vitest";
import { A_OK, B_NONE } from "./agentFixtures";
import { FakeLlm, ok } from "./fakes/fakeLlm";
import { PASTE_BENIGN, PASTE_WIRE, startApi, waitFor, type Started } from "./apiHarness";
import { buildCorruptPdf, buildEml, buildPdf, fixture } from "./helpers";

let app: Started | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function boot(opts: Parameters<typeof startApi>[0] = {}) {
  const llm = opts.llm === undefined ? new FakeLlm([]) : opts.llm;
  app = await startApi({ ...opts, llm });
  return { app, llm: llm as FakeLlm };
}

describe("POST /api/emails: pasted text", () => {
  it("stores the message and returns its id and processing state (no analysis started)", async () => {
    const { app, llm } = await boot();
    const r = await app.postJson("/api/emails", { raw_text: PASTE_WIRE });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      created: true,
      reason: null,
      source_kind: "paste",
      missing_headers: [],
      processing: { status: "not_started", in_progress: false },
    });
    expect(typeof r.body.id).toBe("string");
    expect(r.body.analysis).toBeUndefined();
    expect(llm.callCount).toBe(0);

    const detail = await app.get(`/api/emails/${r.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.email).toMatchObject({
      subject: "URGENT wire before noon",
      from: { address: "d.cole@acme-parts.example", name: "Dana Cole" },
      date: "2026-06-02T08:14:00Z",
    });
    // Rule-based indicators are visible immediately, and clearly not an AI assessment.
    expect(detail.body.risk).toMatchObject({ assessed: false, ai_level: null, final_level: "medium", basis: "rules_only" });
  });

  it("uses explicit missing headers for header-less text", async () => {
    const { app } = await boot();
    const r = await app.postJson("/api/emails", { raw_text: "quick note: the vendor called about RMT-2291." });
    expect(r.status).toBe(201);
    expect(r.body.missing_headers).toEqual(["from", "to", "date", "subject"]);
    const d = await app.get(`/api/emails/${r.body.id}`);
    expect(d.body.email.from).toBeNull();
    expect(d.body.email.date).toBeNull();
  });

  it("does not store duplicate content: the existing id is returned with 200", async () => {
    const { app } = await boot();
    const first = await app.postJson("/api/emails", { raw_text: PASTE_BENIGN });
    const second = await app.postJson("/api/emails", { raw_text: PASTE_BENIGN });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ id: first.body.id, created: false, reason: "duplicate_content" });
    expect((await app.get("/api/emails")).body.total).toBe(1);
  });

  it("returns pasted markup as inert text in a JSON response", async () => {
    const { app } = await boot();
    const evil = "<script>alert(1)</script><img src=x onerror=alert(2)> http://example.test";
    const r = await app.postJson("/api/emails", { raw_text: evil });
    const d = await app.get(`/api/emails/${r.body.id}`);
    expect(d.headers.get("content-type")).toMatch(/^application\/json/);
    expect(d.headers.get("x-content-type-options")).toBe("nosniff");
    expect(d.body.email.body).toBe(evil);
  });

  it.each([
    [{}, 400, "invalid_request"],
    [{ raw_text: 42 }, 400, "invalid_request"],
    [{ raw_text: "" }, 400, "empty_input"],
    [{ raw_text: "   \n  " }, 400, "empty_input"],
  ])("rejects %j with %i %s", async (payload, status, code) => {
    const { app } = await boot();
    const r = await app.postJson("/api/emails", payload);
    expect(r.status).toBe(status);
    expect(r.body).toEqual({ error: { code, message: expect.any(String) } });
  });

  it("rejects malformed JSON and unsupported content types", async () => {
    const { app } = await boot();
    const bad = await app.postRaw("/api/emails", '{"raw_text": ', "application/json");
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("invalid_json");

    const plain = await app.postRaw("/api/emails", "just text", "text/plain");
    expect(plain.status).toBe(415);
    expect(plain.body.error.code).toBe("unsupported_content_type");
  });

  it("rejects pasted text above the configured limit with 413", async () => {
    const { app } = await boot({ limits: { maxPasteChars: 100 } });
    const r = await app.postJson("/api/emails", { raw_text: "x".repeat(101) });
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe("input_too_large");
    expect((await app.get("/api/emails")).body.total).toBe(0);
  });
});

describe("POST /api/emails: file uploads (same Phase 1 pipeline)", () => {
  it("accepts a .txt upload", async () => {
    const { app } = await boot();
    const r = await app.postFile("/api/emails", {
      name: "wire-followup.txt",
      data: fixture("wire-followup.txt"),
      type: "text/plain",
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ created: true, source_kind: "txt", missing_headers: [] });
    const d = await app.get(`/api/emails/${r.body.id}`);
    expect(d.body.email).toMatchObject({ source_filename: "wire-followup.txt", subject: "Re: PO 7781 - delivery confirmation" });
  });

  it("accepts an .eml upload and decodes it", async () => {
    const { app } = await boot();
    const r = await app.postFile("/api/emails", {
      name: "statement-notice.eml",
      data: fixture("statement-notice.eml"),
      type: "message/rfc822",
    });
    expect(r.status).toBe(201);
    expect(r.body.source_kind).toBe("eml");
    const d = await app.get(`/api/emails/${r.body.id}`);
    expect(d.body.email.subject).toBe("Statement for May – action needed");
    expect(d.body.email.from).toMatchObject({ name: "José García" });
  });

  it("accepts an .eml with a PDF attachment and reports attachment extraction", async () => {
    const { app } = await boot();
    const eml = buildEml({
      attachments: [
        { filename: "invoice.pdf", mimeType: "application/pdf", data: buildPdf([["Invoice 77", "Amount due: $500.00"]]) },
        { filename: "scan.pdf", mimeType: "application/pdf", data: buildPdf(["blank"]) },
      ],
    });
    const r = await app.postFile("/api/emails", { name: "with-pdf.eml", data: eml, type: "message/rfc822" });
    expect(r.status).toBe(201);
    expect(r.body.attachments).toEqual([
      { filename: "invoice.pdf", extraction_status: "ok", error_message: null },
      { filename: "scan.pdf", extraction_status: "ocr_unsupported", error_message: expect.stringMatching(/OCR is not supported/) },
    ]);
    const d = await app.get(`/api/emails/${r.body.id}`);
    expect(d.body.email.attachments[0].extracted_text).toContain("Amount due: $500.00");
  });

  it("accepts a text-layer PDF whose content is an email", async () => {
    const { app } = await boot();
    const pdf = buildPdf([
      ["From: Marta Lindqvist <marta@vendor.example>", "To: ap@arcline.com", "Date: Fri, 12 Jun 2026 08:00:00 +0000", "Subject: Remittance advice", "Payment of $1,250.00 was sent."],
    ]);
    const r = await app.postFile("/api/emails", { name: "mail.pdf", data: pdf, type: "application/pdf" });
    expect(r.status).toBe(201);
    expect(r.body.source_kind).toBe("pdf");
    const d = await app.get(`/api/emails/${r.body.id}`);
    expect(d.body.email.subject).toBe("Remittance advice");
  });

  it("deduplicates an identical upload", async () => {
    const { app } = await boot();
    const file = { name: "n.txt", data: fixture("wire-followup.txt"), type: "text/plain" };
    const a = await app.postFile("/api/emails", file);
    const b = await app.postFile("/api/emails", file);
    expect(b.status).toBe(200);
    expect(b.body).toMatchObject({ id: a.body.id, created: false });
  });

  it.each([
    ["scanned PDF (no text layer)", { name: "scan.pdf", data: buildPdf(["blank"]), type: "application/pdf" }, 422, "ocr_unsupported"],
    ["corrupted PDF", { name: "bad.pdf", data: buildCorruptPdf(), type: "application/pdf" }, 422, "invalid_pdf"],
    ["unsupported extension", { name: "run.exe", data: Buffer.from("MZ"), type: "application/octet-stream" }, 415, "unsupported_type"],
    ["content type mismatch", { name: "note.txt", data: Buffer.from("hi"), type: "image/png" }, 415, "type_mismatch"],
    ["binary content", { name: "data.txt", data: Buffer.from([0x50, 0x4b, 0, 1, 2]), type: "text/plain" }, 415, "binary_content"],
    ["empty file", { name: "empty.txt", data: Buffer.alloc(0), type: "text/plain" }, 400, "empty_input"],
    ["not an email", { name: "x.eml", data: Buffer.from("just a sentence, no headers"), type: "message/rfc822" }, 422, "malformed_eml"],
  ])("rejects %s", async (_label, file, status, code) => {
    const { app } = await boot();
    const r = await app.postFile("/api/emails", file);
    expect(r.status).toBe(status);
    expect(r.body).toEqual({ error: { code, message: expect.any(String) } });
    expect((await app.get("/api/emails")).body.total).toBe(0);
  });

  it("rejects an oversized upload with 413", async () => {
    const { app } = await boot({ limits: { maxUploadBytes: 1024 } });
    const r = await app.postFile("/api/emails", { name: "big.txt", data: Buffer.alloc(2048, 0x61), type: "text/plain" });
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe("input_too_large");
  });

  it("accepts a file of exactly the limit and rejects one byte more", async () => {
    const { app } = await boot({ limits: { maxUploadBytes: 64 } });
    const prefix = "Subject: s\n\n";
    const exact = Buffer.from(prefix + "x".repeat(64 - prefix.length));
    const over = Buffer.from(prefix + "x".repeat(64 - prefix.length + 1));
    expect((await app.postFile("/api/emails", { name: "a.txt", data: exact, type: "text/plain" })).status).toBe(201);
    expect((await app.postFile("/api/emails", { name: "b.txt", data: over, type: "text/plain" })).status).toBe(413);
  });

  it("requires the file field and only one file", async () => {
    const { app } = await boot();
    const none = await app.postRaw("/api/emails", "--x--", "multipart/form-data; boundary=x");
    expect(none.status).toBe(400);
    expect(none.body.error.code).toBe("no_input");

    const form = new FormData();
    form.append("file", new Blob(["Subject: a\n\nbody"]), "a.txt");
    form.append("file", new Blob(["Subject: b\n\nbody"]), "b.txt");
    const res = await fetch(`${app.baseUrl}/api/emails`, { method: "POST", body: form });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
  });
});

describe("POST /api/emails with analyze=true", () => {
  it("accepts for processing (202) and reaches a validated, complete analysis by polling", async () => {
    const llm = new FakeLlm([ok(A_OK), ok(B_NONE)]);
    const { app } = await boot({ llm });
    const r = await app.postJson("/api/emails", { raw_text: PASTE_BENIGN, analyze: true });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ created: true, analysis: { requested: true, result: "queued" } });
    expect(["queued", "extracting", "analyzing", "complete"]).toContain(r.body.processing.status);

    const done = await waitFor(async () => {
      const d = await app.get(`/api/emails/${r.body.id}`);
      return d.body.processing.status === "complete" ? d.body : null;
    });
    expect(done.assessment.risk.level).toBe("none");
    expect(done.risk).toMatchObject({ assessed: true, ai_level: "none", final_level: "none" });
    expect(llm.callCount).toBe(2);
  });

  it("accepts the flag on multipart uploads too", async () => {
    const llm = new FakeLlm([ok(A_OK), ok(B_NONE)]);
    const { app } = await boot({ llm });
    const r = await app.postFile(
      "/api/emails",
      { name: "n.txt", data: fixture("wire-followup.txt"), type: "text/plain" },
      { analyze: "true" },
    );
    expect(r.status).toBe(202);
    await waitFor(async () => (await app.get(`/api/emails/${r.body.id}`)).body.processing.status === "complete");
  });

  it("does not start analysis unless asked, even when an LLM is configured", async () => {
    const llm = new FakeLlm([]);
    const { app } = await boot({ llm });
    await app.postJson("/api/emails", { raw_text: PASTE_BENIGN });
    await new Promise((r) => setTimeout(r, 50));
    expect(llm.callCount).toBe(0);
  });
});
