import { createHash } from "node:crypto";
import {
  HEADER_FIELDS,
  NormalizedEmail,
  type HeaderField,
  type MailboxAddress,
} from "@mri/shared";
import { normalizeAttachment } from "./attachments";
import type { IngestLimits } from "./limits";
import { clampText } from "./text";
import type { RawMailbox, RawParsed } from "./types";

const ADDRESS_SHAPE = /^[^\s@<>]+@[^\s@<>]+$/;

function mailbox(m: RawMailbox, warnings: string[]): MailboxAddress | null {
  const address = m.address.trim();
  if (!ADDRESS_SHAPE.test(address)) {
    const shown = (address || m.name || "").slice(0, 80);
    warnings.push(`Ignored a sender/recipient without a valid email address: "${shown}".`);
    return null;
  }
  return { address, name: m.name?.trim() || null };
}

// ---- Dates --------------------------------------------------------------
// Only explicit, unambiguous date-times are accepted. Anything that would require guessing a
// year, a timezone, or day/month order becomes null (plus a warning). Parsing is done by hand
// from the matched components, never by `Date.parse`, so results are identical on every machine
// and timezone and calendar rollover (e.g. 31 Feb) is rejected.

const ISO_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;

const RFC5322_DATETIME =
  /^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(Z|UTC?|GMT|[+-]\d{4}|[ECMP][SD]T)(?:\s*\(.*\))?$/i;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const NAMED_ZONES: Record<string, number> = {
  Z: 0, UT: 0, UTC: 0, GMT: 0,
  EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420,
};

function zoneOffsetMinutes(zone: string): number | null {
  const named = NAMED_ZONES[zone.toUpperCase()];
  if (named !== undefined) return named;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(zone);
  if (!m) return null;
  const hours = Number(m[2]);
  const minutes = Number(m[3]);
  if (hours > 14 || minutes > 59) return null;
  return (m[1] === "-" ? -1 : 1) * (hours * 60 + minutes);
}

function toEpochMs(
  y: number, mo: number, d: number, h: number, mi: number, s: number, offsetMinutes: number,
): number | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const utc = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(utc);
  // Reject calendar rollover (31 Feb -> 3 Mar) and 2-digit-year coercion.
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return utc - offsetMinutes * 60_000;
}

/**
 * Normalize a Date header to UTC ISO-8601 at second resolution (RFC 5322 has no sub-seconds),
 * so string order equals chronological order. Accepts RFC 5322 date-times with an explicit zone
 * and ISO 8601 date-times with `Z` or a numeric offset. Everything else -> null + warning.
 */
export function normalizeDate(raw: string | null, warnings: string[]): string | null {
  if (raw === null || raw.trim() === "") return null;
  const text = raw.trim();

  let epoch: number | null = null;
  const iso = ISO_DATETIME.exec(text);
  const rfc = iso ? null : RFC5322_DATETIME.exec(text);
  if (iso) {
    const off = zoneOffsetMinutes(iso[7]!);
    if (off !== null) {
      epoch = toEpochMs(+iso[1]!, +iso[2]!, +iso[3]!, +iso[4]!, +iso[5]!, iso[6] ? +iso[6] : 0, off);
    }
  } else if (rfc) {
    const month = MONTHS.indexOf(rfc[2]!.toLowerCase()) + 1;
    const off = zoneOffsetMinutes(rfc[7]!);
    if (month > 0 && off !== null) {
      epoch = toEpochMs(+rfc[3]!, month, +rfc[1]!, +rfc[4]!, +rfc[5]!, rfc[6] ? +rfc[6] : 0, off);
    }
  }

  if (epoch === null) {
    warnings.push(
      `Date ignored (not an unambiguous date-time with an explicit timezone): "${text.slice(0, 80)}".`,
    );
    return null;
  }
  return new Date(epoch).toISOString().slice(0, 19) + "Z";
}

/**
 * Content hash used for duplicate detection. Seed messages are scoped to their own id so that
 * user-supplied content can never occupy a seed message's identity; a pasted copy of a seed
 * email is therefore stored separately (documented trade-off, D18). Non-seed hashes are
 * unchanged by the scope key, so previously stored rows keep their hashes.
 */
export function computeContentHash(e: NormalizedEmail): string {
  const canonical = {
    from: e.from?.address.toLowerCase() ?? null,
    to: e.to.map((a) => a.address.toLowerCase()).sort(),
    cc: e.cc.map((a) => a.address.toLowerCase()).sort(),
    date: e.date,
    subject: e.subject?.trim() ?? null,
    body: e.body.trim(),
    attachments: e.attachments.map((a) => [a.filename, a.extracted_text ?? ""]),
    ...(e.source_kind === "seed" ? { seed_scope: e.external_id } : {}),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export interface Normalized {
  email: NormalizedEmail;
  content_hash: string;
  raw_source: string;
  external_id: string | null;
}

/** Normalize a parsed input into the shared contract, extracting attachment text on the way. */
export async function normalizeRaw(raw: RawParsed, limits: IngestLimits): Promise<Normalized> {
  const warnings = [...raw.warnings];

  const from = raw.from ? mailbox(raw.from, warnings) : null;
  const to = raw.to.map((m) => mailbox(m, warnings)).filter((m): m is MailboxAddress => m !== null);
  const cc = raw.cc.map((m) => mailbox(m, warnings)).filter((m): m is MailboxAddress => m !== null);
  const date = normalizeDate(raw.dateRaw, warnings);
  const subject = raw.subject?.trim() ? raw.subject.trim() : null;

  const body = clampText(raw.body, limits.maxTextChars);
  if (body.truncated) warnings.push("Body exceeded the stored limit and was truncated.");

  const attachments = [];
  for (let i = 0; i < raw.attachments.length; i++) {
    attachments.push(await normalizeAttachment(raw.attachments[i]!, i, limits));
  }

  const present: Record<HeaderField, boolean> = {
    from: from !== null,
    to: to.length > 0,
    date: date !== null,
    subject: subject !== null,
  };
  const missing_headers = HEADER_FIELDS.filter((f) => !present[f]);

  const email = NormalizedEmail.parse({
    source_kind: raw.sourceKind,
    source_filename: raw.sourceFilename,
    external_id: raw.externalId,
    from,
    to,
    cc,
    date,
    subject,
    body: body.text,
    body_truncated: body.truncated,
    missing_headers,
    attachments,
    warnings,
  });

  return {
    email,
    content_hash: computeContentHash(email),
    raw_source: raw.rawSource,
    external_id: raw.externalId,
  };
}
