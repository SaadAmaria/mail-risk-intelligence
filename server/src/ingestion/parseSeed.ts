import { z } from "zod";
import type { RawParsed } from "./types";

export const SeedAttachment = z.object({
  filename: z.string(),
  extracted_text: z.string(),
});

export const SeedEmail = z.object({
  id: z.string().min(1),
  from: z.string(),
  to: z.array(z.string()),
  date: z.string(),
  subject: z.string(),
  body: z.string(),
  attachments: z.array(SeedAttachment).default([]),
});
export type SeedEmail = z.infer<typeof SeedEmail>;

export const SeedFile = z.object({ emails: z.array(z.unknown()) });

/**
 * Seed records already carry structured headers and pre-extracted attachment text; the text is
 * kept verbatim (`providedText`) and is never re-extracted.
 */
export function seedToRaw(record: SeedEmail): RawParsed {
  return {
    sourceKind: "seed",
    sourceFilename: null,
    externalId: record.id,
    rawSource: JSON.stringify(record),
    from: record.from ? { name: null, address: record.from } : null,
    to: record.to.map((address) => ({ name: null, address })),
    cc: [],
    dateRaw: record.date,
    subject: record.subject,
    body: record.body,
    bodyFromHtml: false,
    attachments: record.attachments.map((a) => ({
      filename: a.filename,
      mimeType: null,
      data: null,
      providedText: a.extracted_text,
      sizeBytes: null,
    })),
    warnings: [],
  };
}
