export interface IngestLimits {
  /** Max size of an uploaded file, in bytes. */
  maxUploadBytes: number;
  /** Max length of pasted text, in characters. */
  maxPasteChars: number;
  /** Max characters kept for a body or for one attachment's text; the rest is dropped and flagged. */
  maxTextChars: number;
  /** Attachments beyond this count are recorded as `skipped_limit`, not parsed. */
  maxAttachments: number;
  /** Attachments larger than this are recorded as `too_large`, not parsed. */
  maxAttachmentBytes: number;
  /** PDF pages read; further pages are dropped and flagged as truncation. */
  maxPdfPages: number;
  /** Wall-clock budget for opening and reading one PDF. */
  pdfTimeoutMs: number;
}

export const DEFAULT_LIMITS: IngestLimits = {
  maxUploadBytes: 5 * 1024 * 1024,
  maxPasteChars: 1_000_000,
  maxTextChars: 200_000,
  maxAttachments: 10,
  maxAttachmentBytes: 5 * 1024 * 1024,
  maxPdfPages: 30,
  pdfTimeoutMs: 15_000,
};

export function resolveLimits(overrides?: Partial<IngestLimits>): IngestLimits {
  return { ...DEFAULT_LIMITS, ...overrides };
}
