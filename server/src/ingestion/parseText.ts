import type { SourceKind } from "@mri/shared";
import { parseMimeMessage } from "./parseMime";
import { normalizeNewlines } from "./text";
import type { RawParsed } from "./types";

const HEADER_LINE = /^([A-Za-z][A-Za-z0-9-]*):[ \t]*(.*)$/;
const CONTINUATION = /^[ \t]+\S/;
const KNOWN_HEADERS = new Set(["from", "to", "cc", "subject", "date", "sent"]);

/**
 * Header names accepted while splitting text recovered from a PDF (lenient mode). Any other
 * "Word: value" line ends the header block and stays in the body, so ordinary sentences such
 * as "Re: your payment is overdue" or "Note: ..." are never swallowed as headers.
 */
const RECOGNIZED_HEADERS = new Set([
  ...KNOWN_HEADERS,
  "bcc",
  "reply-to",
  "sender",
  "message-id",
  "in-reply-to",
  "references",
  "return-path",
]);

/**
 * Decide whether text starts with an email header block. Requires the very first line to be a
 * header, every line up to the first blank line to be a header or continuation, and at least one
 * well-known mail header. Anything else is treated as a header-less body: nothing is guessed.
 */
export function splitHeaderBlock(
  text: string,
  options: { lenient?: boolean } = {},
): { headers: string | null; body: string } {
  const lines = normalizeNewlines(text).split("\n");
  let first = 0;
  while (first < lines.length && lines[first]!.trim() === "") first++;
  if (first >= lines.length) return { headers: null, body: text };

  let i = first;
  let known = false;
  let endedByBodyLine = false;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") break;
    const m = HEADER_LINE.exec(line);
    const name = m ? m[1]!.toLowerCase() : null;
    if (options.lenient) {
      // Text recovered from a PDF loses blank lines, so the block ends at the first line that
      // is not a recognized header. Folded continuation lines are not honored here: a body
      // line that merely starts with whitespace must not be pulled into the headers.
      if (name !== null && RECOGNIZED_HEADERS.has(name)) {
        if (KNOWN_HEADERS.has(name)) known = true;
        continue;
      }
      if (known) {
        endedByBodyLine = true;
        break;
      }
      return { headers: null, body: text };
    }
    if (m) {
      if (KNOWN_HEADERS.has(name!)) known = true;
    } else if (!(i > first && CONTINUATION.test(line))) {
      return { headers: null, body: text };
    }
  }
  if (!known) return { headers: null, body: text };

  const headerLines = lines.slice(first, i);
  const body = lines.slice(endedByBodyLine ? i : i + 1).join("\n");
  return { headers: headerLines.join("\n"), body };
}

/** Outlook-style "Sent:" is an alias of "Date:" when no Date header is present. */
function aliasSent(headers: string): string {
  if (/^date:/im.test(headers)) return headers;
  return headers.replace(/^sent:/im, "Date:");
}

/**
 * Parse pasted text, a .txt file, or text recovered from a PDF. If a header block is present it
 * goes through the same MIME parser as EML; otherwise every header is explicitly missing.
 */
export async function parseTextInput(
  text: string,
  base: { sourceKind: SourceKind; sourceFilename: string | null; lenientHeaders?: boolean },
): Promise<RawParsed> {
  const { headers, body } = splitHeaderBlock(text, { lenient: base.lenientHeaders });

  if (headers === null) {
    return {
      sourceKind: base.sourceKind,
      sourceFilename: base.sourceFilename,
      externalId: null,
      rawSource: text,
      from: null,
      to: [],
      cc: [],
      dateRaw: null,
      subject: null,
      body: normalizeNewlines(text),
      bodyFromHtml: false,
      attachments: [],
      warnings: [],
    };
  }

  const wire = `${aliasSent(headers)}\r\n\r\n${body.replace(/\n/g, "\r\n")}`;
  const parsed = await parseMimeMessage(wire, {
    sourceKind: base.sourceKind,
    sourceFilename: base.sourceFilename,
    rawSource: text,
  });
  return parsed;
}
