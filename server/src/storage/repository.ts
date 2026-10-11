import { randomUUID } from "node:crypto";
import type { NormalizedEmail, StoredEmail } from "@mri/shared";

/** What the ingestion pipeline hands to storage. */
export interface PreparedEmail {
  /** Preserve a caller-supplied id (seed ids such as "E001"). Generated when omitted. */
  id?: string;
  email: NormalizedEmail;
  raw_source: string;
  content_hash: string;
}

export interface InsertResult {
  email: StoredEmail;
  created: boolean;
  /** Why nothing was inserted. */
  reason?: "id_exists" | "duplicate_content";
}

export interface ListOptions {
  /** Chronological order by message date; emails without a date sort last. Default: date_desc. */
  order?: "date_asc" | "date_desc";
}

/**
 * Persistence boundary for emails and their attachment text. Analyses, entities, mentions and
 * relationships have schema foundations in the SQLite implementation but no repository methods
 * until the phases that produce them.
 */
export interface EmailRepository {
  insertEmail(prepared: PreparedEmail): InsertResult;
  getEmail(id: string): StoredEmail | null;
  listEmails(options?: ListOptions): StoredEmail[];
  countEmails(): number;
  /** Idempotent. */
  close(): void;
}

export function generateEmailId(): string {
  return `em_${randomUUID()}`;
}

/** Date ordering shared by implementations: nulls last, then id for stable ties. */
export function compareByDate(order: "date_asc" | "date_desc") {
  return (a: StoredEmail, b: StoredEmail): number => {
    if (a.date === null && b.date === null) return a.id.localeCompare(b.id);
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    if (a.date !== b.date) return order === "date_asc" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date);
    return a.id.localeCompare(b.id);
  };
}
