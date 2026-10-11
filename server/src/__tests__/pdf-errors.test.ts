import { beforeEach, describe, expect, it, vi } from "vitest";

// The pdf.js entry point is replaced so the error mappings can be exercised deterministically:
// real encrypted PDFs and real parser stalls are impractical to generate in a unit test. This
// file therefore verifies OUR status/code mapping, not pdf.js behavior.
vi.mock("unpdf", () => ({ getDocumentProxy: vi.fn() }));

import { getDocumentProxy } from "unpdf";
import { ingestUpload } from "../ingestion/ingest";
import { DEFAULT_LIMITS } from "../ingestion/limits";
import { extractPdfText } from "../ingestion/pdf";
import { MemoryRepository } from "../storage/memoryRepository";
import { buildEml } from "./helpers";

const mocked = vi.mocked(getDocumentProxy);
const PDF_BYTES = Buffer.from("%PDF-1.4\n% content irrelevant: the parser is mocked\n");

function passwordError(): Error {
  return Object.assign(new Error("No password given"), { name: "PasswordException" });
}

beforeEach(() => {
  mocked.mockReset();
});

describe("PDF error mapping (mocked pdf.js)", () => {
  it("maps a password-protected PDF to invalid_pdf with a specific message", async () => {
    mocked.mockRejectedValue(passwordError());
    const r = await extractPdfText(PDF_BYTES, DEFAULT_LIMITS);
    expect(r.status).toBe("invalid_pdf");
    expect(r.message).toMatch(/password-protected/);
  });

  it("maps any other parser failure to invalid_pdf", async () => {
    mocked.mockRejectedValue(new Error("Invalid PDF structure"));
    const r = await extractPdfText(PDF_BYTES, DEFAULT_LIMITS);
    expect(r.status).toBe("invalid_pdf");
    expect(r.message).toMatch(/corrupted/);
  });

  it("times out a parser that never settles", async () => {
    mocked.mockReturnValue(new Promise(() => undefined) as never);
    const r = await extractPdfText(PDF_BYTES, { ...DEFAULT_LIMITS, pdfTimeoutMs: 30 });
    expect(r.status).toBe("timeout");
  });

  it("surfaces a timeout as pdf_timeout for an uploaded PDF and stores nothing", async () => {
    mocked.mockReturnValue(new Promise(() => undefined) as never);
    const repo = new MemoryRepository();
    const p = ingestUpload(
      { repo, limits: { pdfTimeoutMs: 30 } },
      { filename: "slow.pdf", contentType: "application/pdf", data: PDF_BYTES },
    );
    await expect(p).rejects.toMatchObject({ code: "pdf_timeout" });
    expect(repo.countEmails()).toBe(0);
  });

  it("records a PDF attachment that times out as failed, keeping the email", async () => {
    mocked.mockReturnValue(new Promise(() => undefined) as never);
    const repo = new MemoryRepository();
    const eml = buildEml({ attachments: [{ filename: "slow.pdf", mimeType: "application/pdf", data: PDF_BYTES }] });
    const { email } = await ingestUpload({ repo, limits: { pdfTimeoutMs: 30 } }, { filename: "m.eml", data: eml });
    expect(email.attachments[0]).toMatchObject({ filename: "slow.pdf", extraction_status: "failed" });
    expect(email.attachments[0]!.error_message).toMatch(/timed out/);
    expect(repo.countEmails()).toBe(1);
  });

  it("maps a password-protected top-level upload to invalid_pdf", async () => {
    mocked.mockRejectedValue(passwordError());
    const p = ingestUpload(
      { repo: new MemoryRepository() },
      { filename: "locked.pdf", contentType: "application/pdf", data: PDF_BYTES },
    );
    await expect(p).rejects.toMatchObject({ code: "invalid_pdf" });
  });
});
