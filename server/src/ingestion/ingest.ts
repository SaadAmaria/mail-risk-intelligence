import type { SourceKind } from "@mri/shared";
import type { EmailRepository, InsertResult } from "../storage/repository";
import { IngestError } from "./errors";
import { resolveLimits, type IngestLimits } from "./limits";
import { normalizeRaw } from "./normalize";
import { hasNoMailHeaders, parseMimeMessage } from "./parseMime";
import { seedToRaw, type SeedEmail } from "./parseSeed";
import { parseTextInput } from "./parseText";
import { extractPdfText } from "./pdf";
import { decodeText, sanitizeFilename } from "./text";
import type { RawParsed } from "./types";
import { validateRaw } from "./validate";

export interface IngestContext {
  repo: EmailRepository;
  limits?: Partial<IngestLimits>;
}

export type IngestOutcome = InsertResult;

export interface UploadedFile {
  filename: string;
  /** Declared Content-Type, if any. Parameters (e.g. charset) are ignored. */
  contentType?: string | null;
  data: Uint8Array;
}

type UploadKind = Extract<SourceKind, "txt" | "eml" | "pdf">;

const UPLOAD_RULES: Record<UploadKind, { ext: string; mimes: string[] }> = {
  txt: { ext: ".txt", mimes: ["text/plain", "application/octet-stream"] },
  eml: { ext: ".eml", mimes: ["message/rfc822", "text/plain", "application/octet-stream"] },
  pdf: { ext: ".pdf", mimes: ["application/pdf", "application/octet-stream"] },
};

/**
 * Stages, kept separate on purpose:
 *   parse (source-specific) -> validate (structure) -> normalize (shared contract) -> persist.
 */
async function finish(ctx: IngestContext, raw: RawParsed, id?: string): Promise<IngestOutcome> {
  const limits = resolveLimits(ctx.limits);
  validateRaw(raw);
  const n = await normalizeRaw(raw, limits);
  return ctx.repo.insertEmail({ id, email: n.email, raw_source: n.raw_source, content_hash: n.content_hash });
}

/** Pasted raw email text (with or without a header block). */
export async function ingestPastedText(ctx: IngestContext, text: string): Promise<IngestOutcome> {
  const limits = resolveLimits(ctx.limits);
  if (text.trim() === "") throw new IngestError("empty_input", "Nothing was pasted.");
  if (text.length > limits.maxPasteChars) {
    throw new IngestError("input_too_large", `Pasted text exceeds ${limits.maxPasteChars} characters.`);
  }
  const raw = await parseTextInput(text, { sourceKind: "paste", sourceFilename: null });
  return finish(ctx, raw);
}

/** A seed record. The record id is preserved as the stored email id. */
export async function ingestSeedRecord(ctx: IngestContext, record: SeedEmail): Promise<IngestOutcome> {
  return finish(ctx, seedToRaw(record), record.id);
}

function classifyUpload(file: UploadedFile): UploadKind {
  const name = sanitizeFilename(file.filename, "");
  const lower = name.toLowerCase();
  const kind = (Object.keys(UPLOAD_RULES) as UploadKind[]).find((k) => lower.endsWith(UPLOAD_RULES[k].ext));
  if (!kind) {
    throw new IngestError("unsupported_type", "Only .txt, .eml and .pdf files are supported.");
  }
  const declared = (file.contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (declared !== "" && !UPLOAD_RULES[kind].mimes.includes(declared)) {
    throw new IngestError(
      "type_mismatch",
      `Content type "${declared}" does not match a ${UPLOAD_RULES[kind].ext} file.`,
    );
  }
  return kind;
}

/** An uploaded .txt, .eml or text-layer .pdf file. */
export async function ingestUpload(ctx: IngestContext, file: UploadedFile): Promise<IngestOutcome> {
  const limits = resolveLimits(ctx.limits);
  const kind = classifyUpload(file);
  const filename = sanitizeFilename(file.filename);

  if (file.data.byteLength === 0) throw new IngestError("empty_input", "The file is empty.");
  if (file.data.byteLength > limits.maxUploadBytes) {
    throw new IngestError("input_too_large", `The file exceeds the ${limits.maxUploadBytes}-byte limit.`);
  }

  if (kind === "txt") {
    const text = decodeText(file.data);
    if (text.trim() === "") throw new IngestError("empty_input", "The file contains no text.");
    const raw = await parseTextInput(text, { sourceKind: "txt", sourceFilename: filename });
    return finish(ctx, raw);
  }

  if (kind === "eml") {
    const rawSource = decodeText(file.data);
    const raw = await parseMimeMessage(file.data, { sourceKind: "eml", sourceFilename: filename, rawSource });
    if (hasNoMailHeaders(raw)) {
      throw new IngestError("malformed_eml", "No email headers (From, To, Subject, Date) were found.");
    }
    return finish(ctx, raw);
  }

  // pdf: the file itself is the message (e.g. a printed email); recover its text layer.
  const pdf = await extractPdfText(file.data, limits);
  if (pdf.status === "invalid_pdf") throw new IngestError("invalid_pdf", pdf.message ?? "Invalid PDF.");
  if (pdf.status === "ocr_unsupported") throw new IngestError("ocr_unsupported", pdf.message ?? "No text layer.");
  if (pdf.status === "timeout") throw new IngestError("pdf_timeout", pdf.message ?? "PDF parsing timed out.");

  const raw = await parseTextInput(pdf.text, {
    sourceKind: "pdf",
    sourceFilename: filename,
    lenientHeaders: true,
  });
  raw.warnings.push("Content was recovered from the PDF text layer; original layout is not preserved.");
  if (pdf.message) raw.warnings.push(pdf.message);
  return finish(ctx, raw);
}
