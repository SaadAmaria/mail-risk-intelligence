import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  computeIntegrity,
  MANIFEST_FILE,
  MAX_FIXTURE_BYTES,
  RecordedFixture,
  RecordingManifest,
  type RecordedFixture as Fixture,
} from "./fixture";

export interface CompatibilityTarget {
  /** Stored email by id (the loader never reads emails itself). */
  lookup: (emailId: string) => { content_hash: string } | null;
  promptVersion: string;
  extractionSchemaVersion: number;
  riskSchemaVersion: number;
}

export interface LoadedRecordings {
  /** Fixtures that passed every check, by email id. */
  byEmail: Map<string, Fixture>;
  /** One line per rejected or ignored item. Ids and reasons only, never fixture content. */
  problems: string[];
}

export type EntryStatus =
  | { email_id: string; file: string; ok: true; fixture: Fixture }
  | { email_id: string; file: string; ok: false; reason: string };

export interface Inspection {
  /** `absent`: no manifest file. `unusable`: present but not a valid manifest. */
  manifest: "absent" | "unusable" | "ok";
  manifestReason?: string;
  /** One status per manifest entry, in manifest order. */
  entries: EntryStatus[];
  /** Fixture-looking files that the manifest does not list. */
  unlisted: string[];
}

/**
 * Examine a recordings directory without trusting it: every file is size-bounded, parsed with a
 * strict schema, checked against the manifest and against the CURRENT email and pipeline.
 */
export function inspectRecordings(dir: string, target: CompatibilityTarget): Inspection {
  if (!existsSync(dir)) return { manifest: "absent", entries: [], unlisted: [] };

  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return { manifest: "unusable", manifestReason: "recordings directory could not be read", entries: [], unlisted: [] };
  }
  const jsonFiles = names.filter((n) => n.endsWith(".json") && n !== MANIFEST_FILE);

  const manifestPath = path.join(dir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) return { manifest: "absent", entries: [], unlisted: jsonFiles };

  const manifest = readJson(manifestPath, RecordingManifest);
  if (!manifest.ok) return { manifest: "unusable", manifestReason: manifest.reason, entries: [], unlisted: jsonFiles };

  const entries: EntryStatus[] = [];
  const seen = new Set<string>();
  const listed = new Set<string>();
  for (const entry of manifest.value.files) {
    listed.add(entry.file);
    const bad = (reason: string) => entries.push({ email_id: entry.email_id, file: entry.file, ok: false, reason });
    if (seen.has(entry.email_id)) {
      bad("listed more than once");
      continue;
    }
    seen.add(entry.email_id);

    const parsed = readJson(path.join(dir, entry.file), RecordedFixture);
    if (!parsed.ok) {
      bad(parsed.reason);
      continue;
    }
    const f = parsed.value;
    if (f.email.id !== entry.email_id) {
      bad("file names a different email");
      continue;
    }
    const { integrity, ...body } = f;
    if (computeIntegrity(body) !== integrity || integrity !== entry.integrity) {
      bad("integrity check failed (file changed or corrupted)");
      continue;
    }
    const stored = target.lookup(f.email.id);
    if (!stored) {
      bad("no such message in this mailbox");
      continue;
    }
    if (stored.content_hash !== f.email.content_hash) {
      bad("stale (the message changed since it was recorded)");
      continue;
    }
    if (
      f.pipeline.prompt_version !== target.promptVersion ||
      f.pipeline.extraction_schema_version !== target.extractionSchemaVersion ||
      f.pipeline.risk_schema_version !== target.riskSchemaVersion
    ) {
      bad("incompatible (prompts or schemas changed since it was recorded)");
      continue;
    }
    entries.push({ email_id: entry.email_id, file: entry.file, ok: true, fixture: f });
  }

  return { manifest: "ok", entries, unlisted: jsonFiles.filter((n) => !listed.has(n)) };
}

/**
 * Load the usable recordings. A rejected file is skipped with a reason; it never prevents the
 * others from loading and is never partially used.
 */
export function loadRecordings(dir: string, target: CompatibilityTarget): LoadedRecordings {
  const ins = inspectRecordings(dir, target);
  const byEmail = new Map<string, Fixture>();
  const problems: string[] = [];

  if (ins.manifest === "absent") {
    if (ins.unlisted.length > 0) {
      problems.push(`manifest ${MANIFEST_FILE} is missing; ${ins.unlisted.length} recording file(s) ignored`);
    }
    return { byEmail, problems };
  }
  if (ins.manifest === "unusable") {
    return { byEmail, problems: [`manifest is unusable (${ins.manifestReason}); recordings ignored`] };
  }

  for (const e of ins.entries) {
    if (e.ok) byEmail.set(e.email_id, e.fixture);
    else problems.push(`${e.email_id}: ${e.reason}`);
  }
  for (const n of ins.unlisted) problems.push(`${n}: not listed in the manifest; ignored`);
  return { byEmail, problems };
}

type Read<T> = { ok: true; value: T } | { ok: false; reason: string };

function readJson<T>(file: string, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }): Read<T> {
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return { ok: false, reason: "file is missing" };
  }
  if (size > MAX_FIXTURE_BYTES) return { ok: false, reason: "file is larger than the allowed size" };
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return { ok: false, reason: "file could not be read" };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not valid JSON" };
  }
  const r = schema.safeParse(json);
  return r.success ? { ok: true, value: r.data } : { ok: false, reason: "does not match the fixture format" };
}
