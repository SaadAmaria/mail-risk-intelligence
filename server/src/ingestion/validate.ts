import { IngestError } from "./errors";
import type { RawParsed } from "./types";

/**
 * Structural validation of a parsed input, before normalization. Size and type gates for
 * uploads live at the entry points; this stage only rejects inputs with nothing to analyze.
 */
export function validateRaw(raw: RawParsed): void {
  const hasBody = raw.body.trim().length > 0;
  if (!hasBody && raw.attachments.length === 0) {
    throw new IngestError("empty_input", "The message has no body and no attachments.");
  }
}
