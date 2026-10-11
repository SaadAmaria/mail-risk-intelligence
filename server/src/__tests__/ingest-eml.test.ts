import { describe, expect, it } from "vitest";
import { ingestUpload } from "../ingestion/ingest";
import { MemoryRepository } from "../storage/memoryRepository";
import { buildCorruptPdf, buildEml, buildPdf, fixture } from "./helpers";

function ctx(limits?: Parameters<typeof ingestUpload>[0]["limits"]) {
  return { repo: new MemoryRepository(), limits };
}

const upload = (c: ReturnType<typeof ctx>, data: Buffer, filename = "msg.eml") =>
  ingestUpload(c, { filename, contentType: "message/rfc822", data });

describe("EML parsing", () => {
  it("decodes encoded-word headers and quoted-printable bodies (fixture file)", async () => {
    const { email } = await upload(ctx(), fixture("statement-notice.eml"), "statement-notice.eml");
    expect(email.source_kind).toBe("eml");
    expect(email.from).toEqual({ address: "jose.garcia@suppliers.example", name: "José García" });
    expect(email.subject).toBe("Statement for May – action needed");
    expect(email.date).toBe("2026-06-10T07:05:00Z");
    expect(email.body).toContain("€3,480.00");
    expect(email.missing_headers).toEqual([]);
    expect(email.attachments).toEqual([]);
  });

  it("falls back to the HTML part as text, and says so", async () => {
    const eml = buildEml({
      html: "<html><head><style>p{color:red}</style></head><body><p>Hello&nbsp;team</p><script>alert(1)</script><p>Pay <b>$100</b> &amp; confirm</p></body></html>",
    });
    const { email } = await upload(ctx(), eml);
    expect(email.body).toContain("Hello team");
    expect(email.body).toContain("Pay $100 & confirm");
    expect(email.body).not.toMatch(/alert|<|color:red/);
    expect(email.warnings.join(" ")).toMatch(/derived from the HTML part/);
  });

  it("extracts a text-layer PDF attachment", async () => {
    const pdf = buildPdf([["Invoice 9921", "Amount due: $5,000.00", "Account ending 1234"]]);
    const eml = buildEml({ attachments: [{ filename: "invoice_9921.pdf", mimeType: "application/pdf", data: pdf }] });
    const { email } = await upload(ctx(), eml);
    expect(email.attachments).toHaveLength(1);
    const a = email.attachments[0]!;
    expect(a.filename).toBe("invoice_9921.pdf");
    expect(a.extraction_status).toBe("ok");
    expect(a.text_origin).toBe("extracted");
    expect(a.extracted_text).toContain("Invoice 9921");
    expect(a.extracted_text).toContain("Amount due: $5,000.00");
    expect(a.size_bytes).toBe(pdf.byteLength);
  });

  it("records a text-less PDF attachment as ocr_unsupported and still stores the email", async () => {
    const eml = buildEml({
      attachments: [{ filename: "scan.pdf", mimeType: "application/pdf", data: buildPdf(["blank"]) }],
    });
    const { email, created } = await upload(ctx(), eml);
    expect(created).toBe(true);
    const a = email.attachments[0]!;
    expect(a.extraction_status).toBe("ocr_unsupported");
    expect(a.extracted_text).toBeNull();
    expect(a.error_message).toMatch(/OCR is not supported/);
  });

  it("records a corrupted PDF attachment as invalid_pdf (distinct from ocr_unsupported)", async () => {
    const eml = buildEml({
      attachments: [
        { filename: "broken.pdf", mimeType: "application/pdf", data: buildCorruptPdf() },
        { filename: "fake.pdf", mimeType: "application/pdf", data: Buffer.from("just some text, not a pdf") },
      ],
    });
    const { email } = await upload(ctx(), eml);
    expect(email.attachments.map((a) => a.extraction_status)).toEqual(["invalid_pdf", "invalid_pdf"]);
  });

  it("never silently drops attachments it cannot read", async () => {
    const eml = buildEml({
      attachments: [
        { filename: "photo.png", mimeType: "image/png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) },
        { filename: "notes.txt", mimeType: "text/plain", data: Buffer.from("remember the escrow call") },
        { filename: "sheet.xlsx", mimeType: "application/vnd.ms-excel", data: Buffer.from("PK..") },
      ],
    });
    const { email } = await upload(ctx(), eml);
    expect(email.attachments.map((a) => [a.filename, a.extraction_status])).toEqual([
      ["photo.png", "unsupported_type"],
      ["notes.txt", "ok"],
      ["sheet.xlsx", "unsupported_type"],
    ]);
    expect(email.attachments[1]!.extracted_text).toBe("remember the escrow call");
    expect(email.attachments[0]!.error_message).toMatch(/not supported/);
  });

  it("bounds attachment processing: count and size limits are recorded, not ignored", async () => {
    const three = ["a.txt", "b.txt", "c.txt"].map((filename) => ({
      filename,
      mimeType: "text/plain",
      data: Buffer.from("small"),
    }));
    const byCount = await upload(ctx({ maxAttachments: 2 }), buildEml({ attachments: three }));
    expect(byCount.email.attachments.map((a) => a.extraction_status)).toEqual(["ok", "ok", "skipped_limit"]);

    const big = { filename: "big.txt", mimeType: "text/plain", data: Buffer.alloc(2048, 0x61) };
    const bySize = await upload(ctx({ maxAttachmentBytes: 1024 }), buildEml({ attachments: [big] }));
    expect(bySize.email.attachments[0]!.extraction_status).toBe("too_large");
    expect(bySize.email.attachments[0]!.extracted_text).toBeNull();
  });

  it("keeps an embedded message as an unparsed attachment (no inline recursion)", async () => {
    const inner = Buffer.from("From: x@y.test\r\nSubject: inner\r\n\r\ninner body");
    const eml = buildEml({
      attachments: [{ filename: "forwarded.eml", mimeType: "message/rfc822", data: inner }],
    });
    const { email } = await upload(ctx(), eml);
    expect(email.body).not.toContain("inner body");
    expect(email.attachments).toHaveLength(1);
    expect(email.attachments[0]!.extraction_status).toBe("unsupported_type");
  });

  it("rejects a file that has no email headers as malformed_eml", async () => {
    const p = upload(ctx(), Buffer.from("this is not an email at all, just a sentence."));
    await expect(p).rejects.toMatchObject({ code: "malformed_eml" });
  });
});
