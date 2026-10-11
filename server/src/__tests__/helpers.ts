import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NormalizedEmail } from "@mri/shared";
import { computeContentHash } from "../ingestion/normalize";
import type { PreparedEmail } from "../storage/repository";

const here = path.dirname(fileURLToPath(import.meta.url));

export const SEED_PATH = path.resolve(here, "../../../mock_mailbox_data.json");
export const FIXTURES_DIR = path.join(here, "fixtures");

export function fixture(name: string): Buffer {
  return readFileSync(path.join(FIXTURES_DIR, name));
}

export function sha256File(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

// ---- PDF builder --------------------------------------------------------
// Builds a minimal, valid PDF deterministically (correct xref offsets) so tests need no binary
// fixtures. A page is either an array of text lines, or "blank" (graphics only, no text layer).

function escapePdfString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function buildPdf(pages: (string[] | "blank")[]): Buffer {
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${4 + 2 * i} 0 R`).join(" ");
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((page, i) => {
    const content =
      page === "blank"
        ? "0.8 g 100 100 200 200 re f"
        : `BT /F1 12 Tf 72 720 Td 16 TL ${page.map((l) => `(${escapePdfString(l)}) Tj T*`).join(" ")} ET`;
    objs[4 + 2 * i] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`;
    objs[5 + 2 * i] = `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
  });

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let n = 1; n < objs.length; n++) {
    offsets[n] = Buffer.byteLength(out);
    out += `${n} 0 obj\n${objs[n]}\nendobj\n`;
  }
  const xrefAt = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objs.length; n++) out += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** Starts like a PDF but is not parseable. */
export function buildCorruptPdf(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog \n(this file was truncated in transit)", "latin1");
}

// ---- EML builder --------------------------------------------------------

export interface EmlAttachment {
  filename: string;
  mimeType: string;
  data: Buffer;
}

export interface EmlOptions {
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  date?: string;
  text?: string;
  html?: string;
  attachments?: EmlAttachment[];
}

function wrap76(s: string): string {
  return s.replace(/(.{76})/g, "$1\r\n");
}

export function buildEml(o: EmlOptions = {}): Buffer {
  const boundary = "----=_Part_7f3a";
  const headers = [
    `From: ${o.from ?? "Dana Whitfield <dana.whitfield@clientco.example>"}`,
    `To: ${o.to ?? "compliance@arcline.com"}`,
    ...(o.cc ? [`Cc: ${o.cc}`] : []),
    `Date: ${o.date ?? "Thu, 11 Jun 2026 10:30:00 +0000"}`,
    `Subject: ${o.subject ?? "Quarterly reconciliation attached"}`,
    "MIME-Version: 1.0",
  ];
  const attachments = o.attachments ?? [];

  if (attachments.length === 0 && o.html === undefined) {
    return Buffer.from(
      [...headers, "Content-Type: text/plain; charset=utf-8", "", o.text ?? "See below.", ""].join("\r\n"),
    );
  }
  if (attachments.length === 0 && o.html !== undefined) {
    return Buffer.from(
      [...headers, "Content-Type: text/html; charset=utf-8", "", o.html, ""].join("\r\n"),
    );
  }

  const parts: string[] = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    o.text ?? "Please see the attached.",
  ];
  for (const a of attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${a.mimeType}; name="${a.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${a.filename}"`,
      "",
      wrap76(a.data.toString("base64")),
    );
  }
  parts.push(`--${boundary}--`, "");

  return Buffer.from(
    [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts].join("\r\n"),
  );
}

// ---- Prepared-email factory for storage tests ---------------------------

export function makeNormalized(over: Partial<NormalizedEmail> = {}): NormalizedEmail {
  return {
    source_kind: "paste",
    source_filename: null,
    external_id: null,
    from: { address: "sender@example.test", name: "Sender" },
    to: [{ address: "rcpt@example.test", name: null }],
    cc: [],
    date: "2026-06-01T12:00:00Z",
    subject: "Subject",
    body: "Body text",
    body_truncated: false,
    missing_headers: [],
    attachments: [],
    warnings: [],
    ...over,
  };
}

export function prepared(over: Partial<NormalizedEmail> = {}, id?: string): PreparedEmail {
  const email = makeNormalized(over);
  return { id, email, raw_source: `raw:${email.subject}:${email.body}`, content_hash: computeContentHash(email) };
}
