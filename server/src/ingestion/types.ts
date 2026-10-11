import type { SourceKind } from "@mri/shared";

/** Result of the parse stage: source-specific structure, not yet normalized or validated. */
export interface RawMailbox {
  name: string | null;
  address: string;
}

export interface RawAttachment {
  filename: string | null;
  mimeType: string | null;
  /** Bytes to extract text from. Null when text was supplied with the source. */
  data: Uint8Array | null;
  /** Text supplied with the source (seed JSON). Never re-extracted. */
  providedText: string | null;
  sizeBytes: number | null;
}

export interface RawParsed {
  sourceKind: SourceKind;
  sourceFilename: string | null;
  externalId: string | null;
  /** Original source text kept for provenance (seed record JSON, pasted text, EML text, PDF text layer). */
  rawSource: string;
  from: RawMailbox | null;
  to: RawMailbox[];
  cc: RawMailbox[];
  dateRaw: string | null;
  subject: string | null;
  body: string;
  bodyFromHtml: boolean;
  attachments: RawAttachment[];
  warnings: string[];
}
