import PostalMime from "postal-mime";
import type { SourceKind } from "@mri/shared";
import { IngestError } from "./errors";
import { htmlToText, normalizeNewlines } from "./text";
import type { RawAttachment, RawMailbox, RawParsed } from "./types";

type PmAddress = NonNullable<Awaited<ReturnType<typeof PostalMime.parse>>["to"]>[number];

function flatten(addresses: PmAddress[] | undefined): RawMailbox[] {
  const out: RawMailbox[] = [];
  for (const a of addresses ?? []) {
    if (a.group) {
      for (const m of a.group) out.push({ name: m.name || null, address: m.address });
    } else {
      out.push({ name: a.name || null, address: a.address });
    }
  }
  return out;
}

interface Base {
  sourceKind: SourceKind;
  sourceFilename: string | null;
  rawSource: string;
}

/**
 * Parse an RFC 5322 / MIME message (EML file, or pasted/TXT/PDF text that has a header block).
 * Parser bounds: nesting depth, header bytes, and part count are capped; embedded
 * `message/rfc822` parts are kept as attachments and never parsed inline.
 */
export async function parseMimeMessage(input: string | Uint8Array, base: Base): Promise<RawParsed> {
  let parsed: Awaited<ReturnType<typeof PostalMime.parse>>;
  try {
    parsed = await PostalMime.parse(input, {
      attachmentEncoding: "arraybuffer",
      forceRfc822Attachments: true,
      maxNestingDepth: 16,
      maxHeadersSize: 256 * 1024,
      maxPartCount: 200,
    });
  } catch {
    throw new IngestError("malformed_eml", "The message could not be parsed as an email.");
  }

  const from = flatten(parsed.from ? [parsed.from] : undefined)[0] ?? null;

  let body = parsed.text ?? "";
  let bodyFromHtml = false;
  if (!body.trim() && parsed.html) {
    body = htmlToText(parsed.html);
    bodyFromHtml = true;
  }

  const attachments: RawAttachment[] = parsed.attachments.map((a) => {
    const bytes =
      typeof a.content === "string"
        ? new TextEncoder().encode(a.content)
        : a.content instanceof Uint8Array
          ? a.content
          : new Uint8Array(a.content);
    return {
      filename: a.filename,
      mimeType: a.mimeType || null,
      data: bytes,
      providedText: null,
      sizeBytes: bytes.byteLength,
    };
  });

  const warnings: string[] = [];
  if (bodyFromHtml) warnings.push("Body was derived from the HTML part (no plain-text part).");

  return {
    sourceKind: base.sourceKind,
    sourceFilename: base.sourceFilename,
    externalId: null,
    rawSource: base.rawSource,
    from,
    to: flatten(parsed.to),
    cc: flatten(parsed.cc),
    // The raw header value, not the parser's pre-coerced `date`: the parser fills in missing
    // years/zones, and we must see exactly what the sender wrote.
    dateRaw: parsed.headers.find((h) => h.key === "date")?.value ?? null,
    subject: parsed.subject ?? null,
    // The MIME parser terminates text parts with a newline that is not part of the message.
    body: normalizeNewlines(body).replace(/\n+$/, ""),
    bodyFromHtml,
    attachments,
    warnings,
  };
}

/** True when the parse found no recognizable email header at all. */
export function hasNoMailHeaders(raw: RawParsed): boolean {
  return !raw.from && raw.to.length === 0 && !raw.subject && !raw.dateRaw;
}
