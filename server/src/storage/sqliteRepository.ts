import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  Extraction,
  RiskAnalysis,
  type AnalysisRecord,
  type MailboxAddress,
  type NormalizedAttachment,
  type RunLog,
  type StoredAttachment,
  type StoredEmail,
} from "@mri/shared";
import { assertAnalysisInvariants } from "./analysisInvariants";
import {
  generateEmailId,
  type InsertResult,
  type ListOptions,
  type MailboxRepository,
  type PreparedEmail,
} from "./repository";
import { SCHEMA_V1, SCHEMA_VERSION } from "./schema";

interface AnalysisRow {
  email_id: string;
  status: AnalysisRecord["status"];
  analysis_mode: AnalysisRecord["analysis_mode"];
  provenance: AnalysisRecord["provenance"];
  extraction_json: string | null;
  assessment_json: string | null;
  warnings_json: string | null;
  attempts_json: string | null;
  model: string | null;
  prompt_version: string | null;
  updated_at: string;
}

interface EmailRow {
  id: string;
  external_id: string | null;
  content_hash: string;
  source_kind: StoredEmail["source_kind"];
  source_filename: string | null;
  from_address: string | null;
  from_name: string | null;
  to_json: string;
  cc_json: string;
  date: string | null;
  subject: string | null;
  body: string;
  body_truncated: number;
  missing_headers_json: string;
  warnings_json: string;
  raw_source: string;
  created_at: string;
}

interface AttachmentRow {
  id: number;
  email_id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  text_origin: NormalizedAttachment["text_origin"];
  extraction_status: NormalizedAttachment["extraction_status"];
  error_message: string | null;
  truncated: number;
  extracted_text: string | null;
}

export class SqliteRepository implements MailboxRepository {
  private readonly db: Database.Database;
  private closed = false;

  /** `location` is a file path or ":memory:". Parent directories are created for file paths. */
  constructor(location: string) {
    if (location !== ":memory:") mkdirSync(path.dirname(path.resolve(location)), { recursive: true });
    this.db = new Database(location);
    try {
      this.db.pragma("foreign_keys = ON");
      if (location !== ":memory:") this.db.pragma("journal_mode = WAL");
      this.migrate();
    } catch (err) {
      // Do not leak the handle (it would keep the file locked on Windows).
      this.db.close();
      this.closed = true;
      throw err;
    }
  }

  /** Repeatable: safe to run on every start. Refuses a database from a newer schema. */
  private migrate(): void {
    const current = this.db.pragma("user_version", { simple: true }) as number;
    if (current > SCHEMA_VERSION) {
      throw new Error(
        `Database schema version ${current} is newer than this build supports (${SCHEMA_VERSION}).`,
      );
    }
    this.db.exec(SCHEMA_V1);
    if (current < SCHEMA_VERSION) this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }

  insertEmail(p: PreparedEmail): InsertResult {
    const run = this.db.transaction((): InsertResult => {
      if (p.id) {
        const byId = this.loadById(p.id);
        if (byId) return { email: byId, created: false, reason: "id_exists" };
      }
      const hashRow = this.db
        .prepare("SELECT id FROM emails WHERE content_hash = ?")
        .get(p.content_hash) as { id: string } | undefined;
      if (hashRow) {
        return { email: this.loadById(hashRow.id)!, created: false, reason: "duplicate_content" };
      }

      const id = p.id ?? generateEmailId();
      const e = p.email;
      this.db
        .prepare(
          `INSERT INTO emails (id, external_id, content_hash, source_kind, source_filename,
             from_address, from_name, to_json, cc_json, date, subject, body, body_truncated,
             missing_headers_json, warnings_json, raw_source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          e.external_id,
          p.content_hash,
          e.source_kind,
          e.source_filename,
          e.from?.address ?? null,
          e.from?.name ?? null,
          JSON.stringify(e.to),
          JSON.stringify(e.cc),
          e.date,
          e.subject,
          e.body,
          e.body_truncated ? 1 : 0,
          JSON.stringify(e.missing_headers),
          JSON.stringify(e.warnings),
          p.raw_source,
          new Date().toISOString(),
        );

      const insertAttachment = this.db.prepare(
        `INSERT INTO attachments (email_id, position, filename, mime_type, size_bytes, text_origin,
           extraction_status, error_message, truncated, extracted_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      e.attachments.forEach((a, position) => {
        insertAttachment.run(
          id,
          position,
          a.filename,
          a.mime_type,
          a.size_bytes,
          a.text_origin,
          a.extraction_status,
          a.error_message,
          a.truncated ? 1 : 0,
          a.extracted_text,
        );
      });

      return { email: this.loadById(id)!, created: true };
    });
    return run();
  }

  getEmail(id: string): StoredEmail | null {
    return this.loadById(id);
  }

  listEmails(options?: ListOptions): StoredEmail[] {
    const dir = (options?.order ?? "date_desc") === "date_asc" ? "ASC" : "DESC";
    const rows = this.db
      .prepare(`SELECT * FROM emails ORDER BY date IS NULL, date ${dir}, id ASC`)
      .all() as EmailRow[];
    return rows.map((r) => this.hydrate(r));
  }

  countEmails(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM emails").get() as { n: number };
    return row.n;
  }

  getAnalysis(emailId: string): AnalysisRecord | null {
    const row = this.db.prepare("SELECT * FROM analyses WHERE email_id = ?").get(emailId) as AnalysisRow | undefined;
    return row ? this.hydrateAnalysis(row) : null;
  }

  listAnalyses(): AnalysisRecord[] {
    const rows = this.db.prepare("SELECT * FROM analyses ORDER BY email_id ASC").all() as AnalysisRow[];
    return rows.map((r) => this.hydrateAnalysis(r));
  }

  saveAnalysis(record: AnalysisRecord): void {
    assertAnalysisInvariants(record);
    this.db
      .prepare(
        `INSERT INTO analyses (email_id, status, analysis_mode, provenance, extraction_json,
           assessment_json, warnings_json, attempts_json, model, prompt_version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(email_id) DO UPDATE SET
           status = excluded.status,
           analysis_mode = excluded.analysis_mode,
           provenance = excluded.provenance,
           extraction_json = excluded.extraction_json,
           assessment_json = excluded.assessment_json,
           warnings_json = excluded.warnings_json,
           attempts_json = excluded.attempts_json,
           model = excluded.model,
           prompt_version = excluded.prompt_version,
           updated_at = excluded.updated_at`,
      )
      .run(
        record.email_id,
        record.status,
        record.analysis_mode,
        record.provenance,
        record.extraction ? JSON.stringify(record.extraction) : null,
        record.assessment ? JSON.stringify(record.assessment) : null,
        JSON.stringify(record.warnings),
        JSON.stringify(record.runs),
        record.model,
        record.prompt_version,
        record.updated_at,
      );
  }

  /**
   * Stored JSON is re-validated on read. If a stored value no longer satisfies the contract it
   * is dropped and the record is downgraded, so a corrupted or outdated row can never surface
   * as a complete assessment.
   */
  private hydrateAnalysis(r: AnalysisRow): AnalysisRecord {
    const warnings: string[] = r.warnings_json ? (JSON.parse(r.warnings_json) as string[]) : [];
    let extraction: Extraction | null = null;
    let assessment: RiskAnalysis | null = null;

    if (r.extraction_json) {
      const p = Extraction.safeParse(JSON.parse(r.extraction_json));
      if (p.success) extraction = p.data;
      else warnings.push("Stored extraction no longer matches the current schema and was ignored.");
    }
    if (r.assessment_json) {
      const p = RiskAnalysis.safeParse(JSON.parse(r.assessment_json));
      if (p.success) assessment = p.data;
      else warnings.push("Stored assessment no longer matches the current schema and was ignored.");
    }

    let status = r.status;
    let mode = r.analysis_mode;
    if (status === "complete" && (!extraction || !assessment)) {
      status = "failed";
      mode = "failed";
      assessment = null;
    }

    return {
      email_id: r.email_id,
      status,
      analysis_mode: mode,
      provenance: r.provenance,
      extraction,
      assessment,
      warnings,
      runs: r.attempts_json ? (JSON.parse(r.attempts_json) as RunLog[]) : [],
      model: r.model,
      prompt_version: r.prompt_version,
      updated_at: r.updated_at,
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  /** Test/diagnostic access to the underlying handle. Not part of the repository contract. */
  get rawDb(): Database.Database {
    return this.db;
  }

  private loadById(id: string): StoredEmail | null {
    const row = this.db.prepare("SELECT * FROM emails WHERE id = ?").get(id) as EmailRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  private hydrate(r: EmailRow): StoredEmail {
    const attachments = (
      this.db
        .prepare("SELECT * FROM attachments WHERE email_id = ? ORDER BY position ASC")
        .all(r.id) as AttachmentRow[]
    ).map(
      (a): StoredAttachment => ({
        id: a.id,
        filename: a.filename,
        mime_type: a.mime_type,
        size_bytes: a.size_bytes,
        text_origin: a.text_origin,
        extraction_status: a.extraction_status,
        error_message: a.error_message,
        truncated: a.truncated === 1,
        extracted_text: a.extracted_text,
      }),
    );

    const from: MailboxAddress | null = r.from_address ? { address: r.from_address, name: r.from_name } : null;
    return {
      id: r.id,
      external_id: r.external_id,
      content_hash: r.content_hash,
      created_at: r.created_at,
      raw_source: r.raw_source,
      source_kind: r.source_kind,
      source_filename: r.source_filename,
      from,
      to: JSON.parse(r.to_json) as MailboxAddress[],
      cc: JSON.parse(r.cc_json) as MailboxAddress[],
      date: r.date,
      subject: r.subject,
      body: r.body,
      body_truncated: r.body_truncated === 1,
      missing_headers: JSON.parse(r.missing_headers_json) as StoredEmail["missing_headers"],
      warnings: JSON.parse(r.warnings_json) as string[],
      attachments,
    };
  }
}
