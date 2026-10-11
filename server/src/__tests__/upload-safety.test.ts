import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LIMITS } from "../ingestion/limits";
import { ingestUpload } from "../ingestion/ingest";
import { sanitizeFilename } from "../ingestion/text";
import { MemoryRepository } from "../storage/memoryRepository";
import { buildEml, buildPdf } from "./helpers";

function setup() {
  const repo = new MemoryRepository();
  return { repo, ctx: { repo } };
}

const text = (s: string) => Buffer.from(s, "utf8");

describe("upload gates", () => {
  it("rejects files above the upload size limit before parsing", async () => {
    const { repo, ctx } = setup();
    const big = Buffer.alloc(DEFAULT_LIMITS.maxUploadBytes + 1, 0x61);
    await expect(ingestUpload(ctx, { filename: "big.txt", data: big })).rejects.toMatchObject({
      code: "input_too_large",
    });
    expect(repo.countEmails()).toBe(0);
  });

  it("accepts a file of exactly maxUploadBytes and rejects one byte more", async () => {
    const { ctx } = setup();
    const limits = { maxUploadBytes: 64 };
    const prefix = "Subject: s\n\n";
    const exact = Buffer.from(prefix + "x".repeat(64 - prefix.length));
    const over = Buffer.from(prefix + "x".repeat(64 - prefix.length + 1));
    expect(exact.byteLength).toBe(64);
    expect(over.byteLength).toBe(65);
    await expect(ingestUpload({ ...ctx, limits }, { filename: "exact.txt", data: exact })).resolves.toMatchObject({
      created: true,
    });
    await expect(ingestUpload({ ...ctx, limits }, { filename: "over.txt", data: over })).rejects.toMatchObject({
      code: "input_too_large",
    });
  });

  it("applies the same inclusive boundary to attachments", async () => {
    const { ctx } = setup();
    const limits = { maxAttachmentBytes: 16 };
    const at = { filename: "at.txt", mimeType: "text/plain", data: Buffer.alloc(16, 0x61) };
    const over = { filename: "over.txt", mimeType: "text/plain", data: Buffer.alloc(17, 0x61) };
    const { email } = await ingestUpload(
      { ...ctx, limits },
      { filename: "m.eml", data: buildEml({ attachments: [at, over] }) },
    );
    expect(email.attachments.map((a) => a.extraction_status)).toEqual(["ok", "too_large"]);
  });

  it("records an undecodable text attachment as failed rather than dropping it", async () => {
    const { ctx } = setup();
    const binary = { filename: "notes.txt", mimeType: "text/plain", data: Buffer.from([0x41, 0x00, 0x42, 0x00]) };
    const { email } = await ingestUpload({ ...ctx }, { filename: "m.eml", data: buildEml({ attachments: [binary] }) });
    expect(email.attachments).toHaveLength(1);
    expect(email.attachments[0]).toMatchObject({ extraction_status: "failed", extracted_text: null });
    expect(email.attachments[0]!.error_message).toMatch(/binary/);
  });

  it.each(["malware.exe", "report.docx", "page.html", "archive.zip", "noextension", "photo.png"])(
    "rejects unsupported file type: %s",
    async (filename) => {
      const { repo, ctx } = setup();
      await expect(ingestUpload(ctx, { filename, data: text("hello") })).rejects.toMatchObject({
        code: "unsupported_type",
      });
      expect(repo.countEmails()).toBe(0);
    },
  );

  it("rejects a Content-Type that contradicts the extension", async () => {
    const { ctx } = setup();
    await expect(
      ingestUpload(ctx, { filename: "note.txt", contentType: "image/png", data: text("hi") }),
    ).rejects.toMatchObject({ code: "type_mismatch" });
    await expect(
      ingestUpload(ctx, { filename: "doc.pdf", contentType: "text/html", data: buildPdf([["x"]]) }),
    ).rejects.toMatchObject({ code: "type_mismatch" });
    await expect(
      ingestUpload(ctx, { filename: "m.eml", contentType: "application/zip", data: buildEml() }),
    ).rejects.toMatchObject({ code: "type_mismatch" });
  });

  it("accepts a charset parameter and a missing Content-Type", async () => {
    const { ctx } = setup();
    await expect(
      ingestUpload(ctx, { filename: "a.txt", contentType: "text/plain; charset=UTF-8", data: text("Subject: a\n\nhi") }),
    ).resolves.toBeTruthy();
    await expect(
      ingestUpload(ctx, { filename: "b.txt", contentType: null, data: text("Subject: b\n\nhi") }),
    ).resolves.toBeTruthy();
  });

  it("rejects binary data posing as text", async () => {
    const { repo, ctx } = setup();
    const binary = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x01, 0x02, 0x00, 0x7f]);
    await expect(ingestUpload(ctx, { filename: "data.txt", data: binary })).rejects.toMatchObject({
      code: "binary_content",
    });
    await expect(ingestUpload(ctx, { filename: "data.eml", data: binary })).rejects.toMatchObject({
      code: "binary_content",
    });
    expect(repo.countEmails()).toBe(0);
  });

  it("rejects empty and text-less files", async () => {
    const { ctx } = setup();
    await expect(ingestUpload(ctx, { filename: "empty.txt", data: Buffer.alloc(0) })).rejects.toMatchObject({
      code: "empty_input",
    });
    await expect(ingestUpload(ctx, { filename: "blank.txt", data: text("  \n \n") })).rejects.toMatchObject({
      code: "empty_input",
    });
  });

  it("never uses the supplied filename as a path: it is reduced to a display name", async () => {
    const { ctx } = setup();
    const { email } = await ingestUpload(ctx, {
      filename: "..\\..\\etc/passwd\u0000.txt",
      data: text("Subject: s\n\nbody"),
    });
    expect(email.source_filename).toBe("passwd.txt");
    expect(sanitizeFilename("a/b/../c\n.eml")).toBe("c.eml");
    expect(sanitizeFilename("   ", "fallback")).toBe("fallback");
  });

  it("does not execute or fetch embedded content: HTML links stay inert text", async () => {
    const { ctx } = setup();
    const eml = buildEml({
      html: '<p>See <a href="http://evil.example/track?id=1">invoice</a><img src="http://evil.example/p.gif"></p>',
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const { email } = await ingestUpload(ctx, { filename: "m.eml", data: eml });
      expect(email.body).toBe("See invoice");
      expect(email.body).not.toContain("evil.example");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
