import type { AnalysisRecord, StoredEmail } from "@mri/shared";
import { assertAnalysisInvariants } from "./analysisInvariants";
import {
  compareByDate,
  generateEmailId,
  type InsertResult,
  type ListOptions,
  type MailboxRepository,
  type PreparedEmail,
} from "./repository";

/** Map-backed repository for tests and tooling that don't need SQLite. */
export class MemoryRepository implements MailboxRepository {
  private readonly byId = new Map<string, StoredEmail>();
  private readonly analyses = new Map<string, AnalysisRecord>();
  private readonly byHash = new Map<string, string>();
  private nextAttachmentId = 1;

  insertEmail(p: PreparedEmail): InsertResult {
    if (p.id) {
      const existing = this.byId.get(p.id);
      if (existing) return { email: existing, created: false, reason: "id_exists" };
    }
    const dupId = this.byHash.get(p.content_hash);
    if (dupId) return { email: this.byId.get(dupId)!, created: false, reason: "duplicate_content" };

    const id = p.id ?? generateEmailId();
    const stored: StoredEmail = structuredClone({
      ...p.email,
      id,
      content_hash: p.content_hash,
      created_at: new Date().toISOString(),
      raw_source: p.raw_source,
      attachments: p.email.attachments.map((a) => ({ ...a, id: this.nextAttachmentId++ })),
    });
    this.byId.set(id, stored);
    this.byHash.set(p.content_hash, id);
    return { email: structuredClone(stored), created: true };
  }

  getEmail(id: string): StoredEmail | null {
    const e = this.byId.get(id);
    return e ? structuredClone(e) : null;
  }

  listEmails(options?: ListOptions): StoredEmail[] {
    const order = options?.order ?? "date_desc";
    return [...this.byId.values()].map((e) => structuredClone(e)).sort(compareByDate(order));
  }

  countEmails(): number {
    return this.byId.size;
  }

  getAnalysis(emailId: string): AnalysisRecord | null {
    const a = this.analyses.get(emailId);
    return a ? structuredClone(a) : null;
  }

  saveAnalysis(record: AnalysisRecord): void {
    assertAnalysisInvariants(record);
    if (!this.byId.has(record.email_id)) throw new Error(`Unknown email id: ${record.email_id}`);
    this.analyses.set(record.email_id, structuredClone(record));
  }

  listAnalyses(): AnalysisRecord[] {
    return [...this.analyses.values()].map((a) => structuredClone(a));
  }

  close(): void {
    // Nothing to release; kept for interface parity.
  }
}
