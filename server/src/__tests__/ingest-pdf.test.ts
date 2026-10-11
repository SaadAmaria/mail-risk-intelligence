import { describe, expect, it } from "vitest";
import { ingestUpload } from "../ingestion/ingest";
import { extractPdfText, hasPdfSignature } from "../ingestion/pdf";
import { DEFAULT_LIMITS } from "../ingestion/limits";
import { MemoryRepository } from "../storage/memoryRepository";
import { buildCorruptPdf, buildPdf } from "./helpers";

const upload = (data: Buffer, limits?: Parameters<typeof ingestUpload>[0]["limits"], filename = "mail.pdf") => {
  const repo = new MemoryRepository();
  return { repo, run: () => ingestUpload({ repo, limits }, { filename, contentType: "application/pdf", data }) };
};

describe("PDF uploads (message is the PDF)", () => {
  it("extracts the text layer, including a header block", async () => {
    // No blank line between header and body: pdf.js does not emit one, so header detection
    // for PDFs ends the block at the first non-header line.
    const pdf = buildPdf([
      [
        "From: Marta Lindqvist <marta.lindqvist@vendor.example>",
        "To: ap@arcline.com",
        "Date: Fri, 12 Jun 2026 08:00:00 +0000",
        "Subject: Remittance advice RMT-2291",
        "Payment of $1,250.00 was sent on 11 June.",
      ],
    ]);
    const { repo, run } = upload(pdf);
    const { email } = await run();
    expect(email.source_kind).toBe("pdf");
    expect(email.source_filename).toBe("mail.pdf");
    expect(email.from?.address).toBe("marta.lindqvist@vendor.example");
    expect(email.subject).toBe("Remittance advice RMT-2291");
    expect(email.date).toBe("2026-06-12T08:00:00Z");
    expect(email.body).toContain("Payment of $1,250.00");
    expect(email.warnings.join(" ")).toMatch(/PDF text layer/);
    expect(repo.countEmails()).toBe(1);
  });

  // Regression (reproduced defect F3): "Re: ..." right after the headers used to be absorbed as
  // a header and silently removed from the body.
  it.each([
    ["Re: your payment is overdue"],
    ["Note: the account number changed"],
    ["Regards: Finance Team"],
    ["Attachments: invoice.pdf"],
    ["   indented first body line"],
  ])("keeps %j in the body when it follows the headers", async (line) => {
    const { run } = upload(
      buildPdf([["From: a@x.test", "Subject: Invoice 1234", line, "Please pay today."]]),
    );
    const { email } = await run();
    expect(email.subject).toBe("Invoice 1234");
    expect(email.body).toContain(line.trim());
    expect(email.body).toContain("Please pay today.");
  });

  it("does not turn a memo's non-address To/From into a sender or recipient", async () => {
    const { run } = upload(
      buildPdf([["To: All staff", "From: HR Department", "Subject: Holiday schedule", "The office closes Friday."]]),
    );
    const { email } = await run();
    expect(email.from).toBeNull();
    expect(email.to).toEqual([]);
    expect(email.missing_headers).toEqual(expect.arrayContaining(["from", "to", "date"]));
    expect(email.subject).toBe("Holiday schedule");
    expect(email.body).toBe("The office closes Friday.");
  });

  it("never promotes addresses or header words found in prose", async () => {
    const { run } = upload(
      buildPdf([
        [
          "Meeting notes for the vendor review.",
          "Contact bob@vendor.example about the invoice.",
          "Subject: to be decided next week",
          "Date: sometime in June",
        ],
      ]),
    );
    const { email } = await run();
    expect(email.from).toBeNull();
    expect(email.to).toEqual([]);
    expect(email.subject).toBeNull();
    expect(email.date).toBeNull();
    expect(email.missing_headers).toEqual(["from", "to", "date", "subject"]);
    expect(email.body).toContain("bob@vendor.example");
  });

  it("does not guess a date from an ambiguous PDF header", async () => {
    const { run } = upload(buildPdf([["From: a@x.test", "Date: 06/07/2026", "Subject: s", "text"]]));
    const { email } = await run();
    expect(email.date).toBeNull();
    expect(email.missing_headers).toContain("date");
  });

  it("uses explicit missing headers when the PDF text has none", async () => {
    const { run } = upload(buildPdf([["Called the vendor about RMT-2291.", "Needs follow-up."]]));
    const { email } = await run();
    expect(email.from).toBeNull();
    expect(email.missing_headers).toEqual(["from", "to", "date", "subject"]);
    expect(email.body).toContain("RMT-2291");
  });

  it("reports ocr_unsupported for a valid PDF with no text layer", async () => {
    const { repo, run } = upload(buildPdf(["blank"]));
    await expect(run()).rejects.toMatchObject({ code: "ocr_unsupported" });
    expect(repo.countEmails()).toBe(0);
  });

  it("reports invalid_pdf for corrupted content, not ocr_unsupported", async () => {
    const { repo, run } = upload(buildCorruptPdf());
    await expect(run()).rejects.toMatchObject({ code: "invalid_pdf" });
    expect(repo.countEmails()).toBe(0);
  });

  it("reports invalid_pdf when a .pdf file lacks the %PDF- signature", async () => {
    const { run } = upload(Buffer.from("Subject: not really a pdf\n\nbody text"));
    await expect(run()).rejects.toMatchObject({ code: "invalid_pdf" });
  });

  it("reads only the first maxPdfPages pages and flags the truncation", async () => {
    const pages = [1, 2, 3, 4, 5].map((n) => [`Page ${n} content`]);
    const { run } = upload(buildPdf(pages), { maxPdfPages: 2 });
    const { email } = await run();
    expect(email.body).toContain("Page 1 content");
    expect(email.body).toContain("Page 2 content");
    expect(email.body).not.toContain("Page 3 content");
    expect(email.warnings.join(" ")).toMatch(/2 of 5 pages/);
  });
});

describe("extractPdfText", () => {
  it("detects the signature within the first 1024 bytes only", () => {
    expect(hasPdfSignature(Buffer.from("%PDF-1.7\n"))).toBe(true);
    expect(hasPdfSignature(Buffer.concat([Buffer.alloc(100, 0x20), Buffer.from("%PDF-1.4")]))).toBe(true);
    expect(hasPdfSignature(Buffer.concat([Buffer.alloc(2000, 0x20), Buffer.from("%PDF-1.4")]))).toBe(false);
    expect(hasPdfSignature(Buffer.from("hello"))).toBe(false);
  });

  it("returns distinct statuses for ok / ocr_unsupported / invalid_pdf", async () => {
    const ok = await extractPdfText(buildPdf([["hello world"]]), DEFAULT_LIMITS);
    const blank = await extractPdfText(buildPdf(["blank"]), DEFAULT_LIMITS);
    const bad = await extractPdfText(buildCorruptPdf(), DEFAULT_LIMITS);
    expect([ok.status, blank.status, bad.status]).toEqual(["ok", "ocr_unsupported", "invalid_pdf"]);
    expect(ok.text).toContain("hello world");
    expect(blank.totalPages).toBe(1);
  });
});
