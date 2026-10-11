import type { NormalizedAttachment } from "@mri/shared";
import { IngestError } from "./errors";
import type { IngestLimits } from "./limits";
import { extractPdfText } from "./pdf";
import { clampText, decodeText, normalizeNewlines, sanitizeFilename } from "./text";
import type { RawAttachment } from "./types";

function isPdf(a: RawAttachment): boolean {
  return a.mimeType === "application/pdf" || /\.pdf$/i.test(a.filename ?? "");
}

function isPlainText(a: RawAttachment): boolean {
  return a.mimeType === "text/plain" || /\.txt$/i.test(a.filename ?? "");
}

const base = (a: RawAttachment, filename: string): NormalizedAttachment => ({
  filename,
  mime_type: a.mimeType,
  size_bytes: a.sizeBytes,
  text_origin: null,
  extraction_status: "failed",
  error_message: null,
  truncated: false,
  extracted_text: null,
});

/**
 * Resolve one attachment to a normalized record. Every attachment yields a record: failures
 * are expressed as an explicit status and message, never by dropping the attachment.
 */
export async function normalizeAttachment(
  a: RawAttachment,
  index: number,
  limits: IngestLimits,
): Promise<NormalizedAttachment> {
  const filename = sanitizeFilename(a.filename, `attachment-${index + 1}`);
  const out = base(a, filename);

  if (a.providedText !== null) {
    const c = clampText(a.providedText, limits.maxTextChars);
    return {
      ...out,
      text_origin: "provided",
      extraction_status: "ok",
      extracted_text: c.text,
      truncated: c.truncated,
      error_message: c.truncated ? "Attachment text exceeded the stored limit and was truncated." : null,
    };
  }

  if (index >= limits.maxAttachments) {
    return {
      ...out,
      extraction_status: "skipped_limit",
      error_message: `Not processed: more than ${limits.maxAttachments} attachments.`,
    };
  }

  const data = a.data;
  if (!data) {
    return { ...out, extraction_status: "failed", error_message: "Attachment had no content." };
  }
  if (data.byteLength > limits.maxAttachmentBytes) {
    return {
      ...out,
      size_bytes: data.byteLength,
      extraction_status: "too_large",
      error_message: `Attachment exceeds the ${limits.maxAttachmentBytes}-byte limit; content not read.`,
    };
  }

  const sized = { ...out, size_bytes: data.byteLength };

  if (isPdf(a)) {
    const r = await extractPdfText(data, limits);
    if (r.status === "ok") {
      return {
        ...sized,
        text_origin: "extracted",
        extraction_status: "ok",
        extracted_text: r.text,
        truncated: r.truncated,
        error_message: r.message,
      };
    }
    const status = r.status === "timeout" ? "failed" : r.status;
    return { ...sized, extraction_status: status, error_message: r.message };
  }

  if (isPlainText(a)) {
    try {
      const c = clampText(normalizeNewlines(decodeText(data)), limits.maxTextChars);
      return {
        ...sized,
        text_origin: "extracted",
        extraction_status: "ok",
        extracted_text: c.text,
        truncated: c.truncated,
        error_message: c.truncated ? "Attachment text exceeded the stored limit and was truncated." : null,
      };
    } catch (err) {
      const message = err instanceof IngestError ? err.message : "Attachment text could not be decoded.";
      return { ...sized, extraction_status: "failed", error_message: message };
    }
  }

  return {
    ...sized,
    extraction_status: "unsupported_type",
    error_message: `Attachment type ${a.mimeType ?? "unknown"} is not supported; content not analyzed.`,
  };
}
