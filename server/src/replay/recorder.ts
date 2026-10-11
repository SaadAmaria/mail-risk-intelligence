import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  ExtractionSchemaVersion,
  RiskAnalysisSchemaVersion,
  type AnalysisRecord,
  type TokenUsage,
} from "@mri/shared";
import { AnalysisService, PROMPT_VERSION } from "../analysis/service";
import { seedRecords } from "../ingestion/seed";
import type { SeedEmail } from "../ingestion/parseSeed";
import type { LlmClient, LlmRequest, LlmResult } from "../llm/types";
import { MemoryRepository } from "../storage/memoryRepository";
import {
  canonicalJson,
  FIXTURE_FORMAT_VERSION,
  MANIFEST_FILE,
  normalizedRequestHash,
  RecordedFixture,
  resultDigest,
  seal,
  type RecordedCall,
  type RecordingManifest,
} from "./fixture";
import { inspectRecordings, type CompatibilityTarget, type Inspection } from "./loader";
import { RecordedLlmClient } from "./recordedClient";

/** Wraps a client and keeps what it returned, per email, without altering anything. */
export class RecordingLlmClient implements LlmClient {
  readonly provenance = "live" as const;
  readonly model: string;
  private current: string | null = null;
  private readonly captured = new Map<string, RecordedCall[]>();

  constructor(private readonly inner: LlmClient) {
    this.model = inner.model;
  }

  begin(emailId: string): void {
    this.current = emailId;
    this.captured.set(emailId, []);
  }

  take(emailId: string): RecordedCall[] {
    return this.captured.get(emailId) ?? [];
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    const result = await this.inner.complete(request); // a failed call has no completion to record
    if (this.current) {
      const usage: TokenUsage | null = result.usage;
      this.captured.get(this.current)?.push({
        stage: request.messages.some((m) => m.role === "system" && m.content.includes("Risk & Graph Agent"))
          ? "risk"
          : "extraction",
        request_hash: normalizedRequestHash(request.messages),
        content: result.content,
        finish_reason: result.finishReason,
        response_model: result.model,
        usage,
        latency_ms: result.latencyMs,
      });
    }
    return result;
  }
}

const SECRET_PATTERNS: [string, RegExp][] = [
  ["groq-style key", /gsk_[A-Za-z0-9]{16,}/],
  ["sk-style key", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["bearer token", /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/],
  ["aws access key", /AKIA[0-9A-Z]{16}/],
  ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["windows user path", /[A-Za-z]:\\+(?:Users|desktop)/i],
  ["unix home path", /\/(?:home|Users)\/[A-Za-z0-9_.-]+/],
  ["authorization header", /authorization\s*[:=]/i],
];

/** Names of the checks that matched; never the matched text. */
export function scanForSecrets(text: string, knownSecrets: string[] = []): string[] {
  const found = SECRET_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name);
  for (const s of knownSecrets) if (s.length >= 8 && text.includes(s)) found.push("configured secret value");
  return found;
}

export interface RecordOptions {
  /** All seed records (the recorder has no other input path). */
  seed: SeedEmail[];
  /** Subset of ids to record; default all. */
  ids?: string[];
  client: LlmClient;
  /** Where verified fixtures are written; null verifies without writing. */
  outDir: string | null;
  now?: () => Date;
  tool: string;
  providerHost: string | null;
  requestedModel: string;
  /** Literal secret values that must not appear in any fixture. */
  secrets?: string[];
  /**
   * Ids whose existing recording may be replaced. An id that already has a recording and is not
   * listed here is refused BEFORE any provider call, so a repeat is never made by accident.
   */
  overwrite?: string[];
  /**
   * Attempt number declared by the operator for an overwritten id whose previous recording can
   * no longer be read. Without it such a repeat is refused rather than recorded as attempt 1.
   */
  declaredAttempt?: number;
  /** Test seam: called after fixture files are written and before the manifest is published. */
  beforeManifestPublish?: () => void;
}

export type RecordOutcome =
  | { id: string; ok: true; status: string; calls: number; attempt: number; replaced: boolean }
  | { id: string; ok: false; reason: string };

export interface RecordReport {
  outcomes: RecordOutcome[];
  written: string[];
  /** Existing valid recordings that were kept in the manifest. */
  preserved: string[];
  /** Why the existing set blocked publication, if it did (ids and reasons only). */
  existingProblems: string[];
}

const NO_PROBLEMS: string[] = [];

/** What a directory already holds, for the dry run and for the pre-flight of a real run. */
export function describeExisting(dir: string, target: CompatibilityTarget): Inspection {
  return inspectRecordings(dir, target);
}

/**
 * Record through the REAL pipeline (ingestion, agents, validation, orchestration) into an
 * isolated in-memory database, then replay each capture into a second isolated database and
 * require an identical persisted result before the fixture is allowed out.
 *
 * Publication is incremental and safe: existing valid recordings are kept, an existing
 * recording is never replaced unless named in `overwrite`, new fixture files are written under
 * names that cannot collide with live files, and the manifest is replaced last in one atomic
 * rename. A failure at any earlier point leaves the previous set exactly as it was.
 */
export async function recordFixtures(opts: RecordOptions): Promise<RecordReport> {
  const now = opts.now ?? (() => new Date());
  const wantedIds = opts.ids ?? opts.seed.map((s) => s.id);
  const wanted = opts.seed.filter((s) => wantedIds.includes(s.id));
  const outcomes: RecordOutcome[] = wantedIds
    .filter((id) => !opts.seed.some((s) => s.id === id))
    .map((id) => ({ id, ok: false as const, reason: "not a seed email id" }));
  const overwrite = new Set(opts.overwrite ?? []);

  // Reference mailbox with every seed record: used to judge whether existing recordings are
  // still compatible with the current message text.
  const reference = new MemoryRepository();
  await seedRecords({ repo: reference }, { total: opts.seed.length, records: opts.seed, errors: [] });
  const target: CompatibilityTarget = {
    lookup: (id) => reference.getEmail(id),
    promptVersion: PROMPT_VERSION,
    extractionSchemaVersion: ExtractionSchemaVersion,
    riskSchemaVersion: RiskAnalysisSchemaVersion,
  };

  // ---- pre-flight: decide what may be recorded BEFORE any provider call --------------------
  const attemptFor = new Map<string, number>();
  const toRecord: SeedEmail[] = [];
  let existing: Inspection | null = null;

  if (opts.outDir) {
    existing = inspectRecordings(opts.outDir, target);
    const abort = (problems: string[]): RecordReport => ({
      outcomes: [...outcomes, ...wanted.map((r) => ({ id: r.id, ok: false as const, reason: problems[0]! }))],
      written: [],
      preserved: [],
      existingProblems: problems,
    });

    if (existing.manifest === "unusable") {
      return abort([`the existing manifest is unusable (${existing.manifestReason}); nothing was recorded or written`]);
    }
    const unusable = existing.entries.filter((e) => !e.ok && !overwrite.has(e.email_id));
    if (unusable.length > 0) {
      return abort(
        unusable.map(
          (e) =>
            `existing recording ${e.email_id} is unusable (${(e as { reason: string }).reason}); fix or remove it, or pass overwrite for ${e.email_id}`,
        ),
      );
    }
    for (const id of overwrite) {
      if (!wanted.some((r) => r.id === id)) {
        return abort([`overwrite names ${id}, which is not among the emails being recorded`]);
      }
    }
  }

  for (const rec of wanted) {
    const entry = existing?.entries.find((e) => e.email_id === rec.id);
    const fileExists = opts.outDir ? existsSync(path.join(opts.outDir, `${rec.id}.json`)) : false;
    const already = Boolean(entry) || fileExists;

    if (already && !overwrite.has(rec.id)) {
      outcomes.push({
        id: rec.id,
        ok: false,
        reason: `already recorded; nothing was sent. Repeat only with an explicit overwrite for ${rec.id} (it will be recorded as a repeat attempt)`,
      });
      continue;
    }
    if (overwrite.has(rec.id) && !already) {
      outcomes.push({ id: rec.id, ok: false, reason: "nothing to overwrite: no existing recording" });
      continue;
    }
    if (already) {
      // A repeat. Its attempt number comes from the recording it replaces, or the operator.
      const prior = entry && entry.ok ? entry.fixture.capture.attempts_made : null;
      const n = prior !== null ? prior + 1 : (opts.declaredAttempt ?? null);
      if (n === null || !Number.isInteger(n) || n < 2) {
        outcomes.push({
          id: rec.id,
          ok: false,
          reason:
            "the attempt number cannot be determined because the existing recording is unreadable; declare it explicitly (an integer of 2 or more) rather than have it recorded as the first attempt",
        });
        continue;
      }
      attemptFor.set(rec.id, n);
    } else {
      attemptFor.set(rec.id, 1);
    }
    toRecord.push(rec);
  }

  // ---- capture and verify -----------------------------------------------------------------
  const repo = new MemoryRepository();
  await seedRecords({ repo }, { total: toRecord.length, records: toRecord, errors: [] });
  const recording = new RecordingLlmClient(opts.client);
  const service = new AnalysisService(repo, recording, {
    concurrency: 1,
    maxRuns: 3,
    queueCapacity: Math.max(10, toRecord.length),
    maxCompletionTokens: 3000,
    now,
  });

  const fixtures: RecordedFixture[] = [];
  for (const rec of toRecord) {
    recording.begin(rec.id);
    const queued = service.enqueue(rec.id);
    if (queued !== "queued") {
      outcomes.push({ id: rec.id, ok: false, reason: `could not queue (${queued})` });
      continue;
    }
    await service.idle();
    const analysis = repo.getAnalysis(rec.id);
    const calls = recording.take(rec.id);
    const stored = repo.getEmail(rec.id);
    if (!analysis || !stored) {
      outcomes.push({ id: rec.id, ok: false, reason: "no result was produced" });
      continue;
    }
    if (calls.length === 0) {
      outcomes.push({ id: rec.id, ok: false, reason: `no completion was captured (run ended ${analysis.status})` });
      continue;
    }

    const attempt = attemptFor.get(rec.id) ?? 1;
    const fixture = seal({
      format_version: FIXTURE_FORMAT_VERSION,
      email: { id: rec.id, content_hash: stored.content_hash },
      pipeline: {
        prompt_version: PROMPT_VERSION,
        extraction_schema_version: ExtractionSchemaVersion,
        risk_schema_version: RiskAnalysisSchemaVersion,
      },
      capture: {
        captured_at: now().toISOString(),
        tool: opts.tool,
        provider_host: opts.providerHost,
        requested_model: opts.requestedModel,
        // `attempts_made` counts the recordings made for this email in this directory,
        // including this one; the latest recording is therefore always attempt === attempts_made.
        attempt,
        attempts_made: attempt,
      },
      calls,
      result: {
        status: analysis.status,
        stages: (analysis.runs[analysis.runs.length - 1]?.stages ?? []).map((s) => ({
          stage: s.stage,
          outcome: s.outcome,
          calls: s.calls,
          dropped_items: s.dropped_items,
          error_kind: s.error_kind,
        })),
        warnings_count: analysis.warnings.length,
        digest: resultDigest(analysis),
      },
    });

    const problem = await verify(fixture, rec, analysis, opts.secrets ?? []);
    if (problem) outcomes.push({ id: rec.id, ok: false, reason: problem });
    else {
      fixtures.push(fixture);
      outcomes.push({
        id: rec.id,
        ok: true,
        status: analysis.status,
        calls: calls.length,
        attempt,
        replaced: overwrite.has(rec.id),
      });
    }
  }

  // ---- publication ------------------------------------------------------------------------
  const written: string[] = [];
  const preserved = existing
    ? existing.entries.filter((e) => e.ok && !overwrite.has(e.email_id)).map((e) => e.email_id)
    : [];
  if (opts.outDir && fixtures.length > 0) {
    mkdirSync(opts.outDir, { recursive: true });
    const keep = (existing?.entries ?? []).filter((e) => e.ok && !overwrite.has(e.email_id));
    const entries: RecordingManifest["files"] = keep.map((e) => ({
      email_id: e.email_id,
      file: e.file,
      integrity: (e as { fixture: RecordedFixture }).fixture.integrity,
    }));
    const superseded: string[] = [];

    for (const f of fixtures) {
      const plain = `${f.email.id}.json`;
      // Never write over a file the current manifest may still point at.
      const name = existsSync(path.join(opts.outDir, plain)) ? `${f.email.id}.${f.integrity.slice(0, 12)}.json` : plain;
      writeAtomic(path.join(opts.outDir, name), JSON.stringify(f, null, 2) + "\n");
      written.push(name);
      entries.push({ email_id: f.email.id, file: name, integrity: f.integrity });
      const old = existing?.entries.find((e) => e.email_id === f.email.id);
      if (old) superseded.push(old.file);
      else if (name !== plain) superseded.push(plain);
    }

    entries.sort((a, b) => (a.email_id < b.email_id ? -1 : a.email_id > b.email_id ? 1 : 0));
    const manifest: RecordingManifest = { format_version: FIXTURE_FORMAT_VERSION, files: entries };
    opts.beforeManifestPublish?.();
    writeAtomic(path.join(opts.outDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + "\n");
    written.push(MANIFEST_FILE);

    // Only now, with the new manifest in place, are the replaced files unreferenced.
    for (const file of superseded) {
      if (!entries.some((e) => e.file === file)) rmSync(path.join(opts.outDir, file), { force: true });
    }
  }
  return { outcomes, written, preserved, existingProblems: NO_PROBLEMS };
}

/** Returns a reason when the fixture must not be published, otherwise null. */
async function verify(
  fixture: RecordedFixture,
  rec: SeedEmail,
  captured: AnalysisRecord,
  secrets: string[],
): Promise<string | null> {
  const hits = scanForSecrets(canonicalJson(fixture), secrets);
  if (hits.length > 0) return `possible secret or local path in the fixture (${hits.join(", ")})`;

  const parsed = RecordedFixture.safeParse(JSON.parse(JSON.stringify(fixture)));
  if (!parsed.success) return "fixture does not match its own schema";

  const repo = new MemoryRepository();
  await seedRecords({ repo }, { total: 1, records: [rec], errors: [] });
  const replayClient = new RecordedLlmClient([fixture]);
  const service = new AnalysisService(repo, replayClient, {
    concurrency: 1,
    maxRuns: 3,
    queueCapacity: 10,
    maxCompletionTokens: 3000,
  });
  service.enqueue(rec.id);
  await service.idle();
  const replayed = repo.getAnalysis(rec.id);
  if (!replayed) return "replay produced no result";
  if (replayed.provenance !== "recorded" && replayed.provenance !== "rules") return "replay was not labelled recorded";
  if (replayed.status !== captured.status) return `replay status differs (${replayed.status} vs ${captured.status})`;
  if (resultDigest(replayed) !== fixture.result.digest) return "replay result differs from the captured result";
  return null;
}

function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, file);
}
