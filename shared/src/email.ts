import { z } from "zod";

// The normalized email contract: every ingestion source (seed JSON, pasted text,
// TXT, EML, text-layer PDF) is reduced to this one shape before persistence.

export const SOURCE_KINDS = ["seed", "paste", "txt", "eml", "pdf"] as const;
export const SourceKind = z.enum(SOURCE_KINDS);
export type SourceKind = z.infer<typeof SourceKind>;

export const HEADER_FIELDS = ["from", "to", "date", "subject"] as const;
export const HeaderField = z.enum(HEADER_FIELDS);
export type HeaderField = z.infer<typeof HeaderField>;

export const ATTACHMENT_EXTRACTION_STATUSES = [
  "ok",
  "ocr_unsupported",
  "invalid_pdf",
  "unsupported_type",
  "too_large",
  "skipped_limit",
  "failed",
] as const;
export const AttachmentExtractionStatus = z.enum(ATTACHMENT_EXTRACTION_STATUSES);
export type AttachmentExtractionStatus = z.infer<typeof AttachmentExtractionStatus>;

export const MailboxAddress = z.object({
  address: z.string().min(1),
  name: z.string().nullable(),
});
export type MailboxAddress = z.infer<typeof MailboxAddress>;

export const NormalizedAttachment = z.object({
  filename: z.string(),
  mime_type: z.string().nullable(),
  size_bytes: z.number().int().nonnegative().nullable(),
  // "provided": text was supplied with the source (seed JSON).
  // "extracted": text was produced by this system from attachment bytes.
  text_origin: z.enum(["provided", "extracted"]).nullable(),
  extraction_status: AttachmentExtractionStatus,
  error_message: z.string().nullable(),
  truncated: z.boolean(),
  extracted_text: z.string().nullable(),
});
export type NormalizedAttachment = z.infer<typeof NormalizedAttachment>;

export const NormalizedEmail = z.object({
  source_kind: SourceKind,
  source_filename: z.string().nullable(),
  external_id: z.string().nullable(),
  // Missing headers are explicit: the value is null/empty AND the field is listed
  // in `missing_headers`. Nothing is invented.
  from: MailboxAddress.nullable(),
  to: z.array(MailboxAddress),
  cc: z.array(MailboxAddress),
  date: z.string().nullable(),
  subject: z.string().nullable(),
  body: z.string(),
  body_truncated: z.boolean(),
  missing_headers: z.array(HeaderField),
  attachments: z.array(NormalizedAttachment),
  warnings: z.array(z.string()),
});
export type NormalizedEmail = z.infer<typeof NormalizedEmail>;

export type StoredAttachment = NormalizedAttachment & { id: number };

export type StoredEmail = Omit<NormalizedEmail, "attachments"> & {
  id: string;
  content_hash: string;
  created_at: string;
  raw_source: string;
  attachments: StoredAttachment[];
};

// Machine-readable ingestion failure codes (surface in the API in Phase 4).
export const INGEST_ERROR_CODES = [
  "empty_input",
  "input_too_large",
  "unsupported_type",
  "type_mismatch",
  "binary_content",
  "invalid_pdf",
  "ocr_unsupported",
  "pdf_timeout",
  "malformed_eml",
] as const;
export const IngestErrorCode = z.enum(INGEST_ERROR_CODES);
export type IngestErrorCode = z.infer<typeof IngestErrorCode>;
