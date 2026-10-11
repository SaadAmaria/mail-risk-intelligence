import { readFileSync } from "node:fs";
import type { ZodError } from "zod";
import { ingestSeedRecord, type IngestContext } from "./ingest";
import { SeedEmail, SeedFile } from "./parseSeed";

export interface SeedRecordError {
  index: number;
  id: string | null;
  message: string;
}

export interface SeedReport {
  total: number;
  created: number;
  /** Already stored under the same id (idempotent re-run). */
  existing: number;
  errors: SeedRecordError[];
}

export interface LoadedSeed {
  total: number;
  records: SeedEmail[];
  errors: SeedRecordError[];
}

export type SeedFileErrorCode = "seed_missing" | "seed_unreadable" | "seed_invalid";

/** The seed file as a whole is unusable. Messages never include email content. */
export class SeedFileError extends Error {
  readonly code: SeedFileErrorCode;
  readonly details: string[];

  constructor(code: SeedFileErrorCode, message: string, details: string[] = []) {
    super(message);
    this.name = "SeedFileError";
    this.code = code;
    this.details = details;
  }
}

/** "emails[2].body: Required" — field paths and reasons only, never the offending values. */
export function formatZodIssues(error: ZodError, prefix = ""): string[] {
  return error.issues.map((issue) => {
    const where = issue.path
      .map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`))
      .join("");
    return `${prefix}${where || "(root)"}: ${issue.message}`;
  });
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Read and validate a seed file without touching the repository. Never modifies the file.
 * File-level problems throw `SeedFileError`; per-record problems are returned in `errors`.
 * Duplicate record ids are reported as errors (the second copy would otherwise be skipped
 * silently as "already present").
 */
export function loadSeedFile(filePath: string): LoadedSeed {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new SeedFileError("seed_missing", `Seed file not found: ${filePath}`);
    }
    throw new SeedFileError("seed_unreadable", `Seed file could not be read: ${filePath}`, [
      code ?? (err instanceof Error ? err.message.slice(0, 200) : "unknown error"),
    ]);
  }

  let json: unknown;
  try {
    json = JSON.parse(stripBom(text));
  } catch (err) {
    throw new SeedFileError("seed_invalid", `Seed file is not valid JSON: ${filePath}`, [
      err instanceof Error ? err.message.slice(0, 200) : "parse error",
    ]);
  }

  const shape = SeedFile.safeParse(json);
  if (!shape.success) {
    throw new SeedFileError(
      "seed_invalid",
      `Seed file does not have the expected shape ({ "emails": [...] }): ${filePath}`,
      formatZodIssues(shape.error),
    );
  }

  const records: SeedEmail[] = [];
  const errors: SeedRecordError[] = [];
  const seenIds = new Set<string>();

  shape.data.emails.forEach((candidate, index) => {
    const parsed = SeedEmail.safeParse(candidate);
    if (!parsed.success) {
      const id =
        typeof candidate === "object" && candidate !== null && typeof (candidate as { id?: unknown }).id === "string"
          ? (candidate as { id: string }).id
          : null;
      errors.push({
        index,
        id,
        message: formatZodIssues(parsed.error).join("; "),
      });
      return;
    }
    if (seenIds.has(parsed.data.id)) {
      errors.push({ index, id: parsed.data.id, message: `id: duplicate record id "${parsed.data.id}"` });
      return;
    }
    seenIds.add(parsed.data.id);
    records.push(parsed.data);
  });

  return { total: shape.data.emails.length, records, errors };
}

/**
 * Insert loaded seed records. Idempotent: ids already stored are skipped, so restarts never
 * duplicate messages. A record whose result is neither "created" nor "id_exists" (for example a
 * content collision with a legacy row) is reported as an error, never as "existing".
 */
export async function seedRecords(ctx: IngestContext, loaded: LoadedSeed): Promise<SeedReport> {
  const report: SeedReport = {
    total: loaded.total,
    created: 0,
    existing: 0,
    errors: [...loaded.errors],
  };

  for (const record of loaded.records) {
    try {
      const outcome = await ingestSeedRecord(ctx, record);
      if (outcome.created) report.created++;
      else if (outcome.reason === "id_exists") report.existing++;
      else {
        report.errors.push({
          index: loaded.records.indexOf(record),
          id: record.id,
          message: `could not be stored under its own id: identical content already stored as ${outcome.email.id}`,
        });
      }
    } catch (err) {
      report.errors.push({
        index: loaded.records.indexOf(record),
        id: record.id,
        message: err instanceof Error ? err.message.slice(0, 200) : "insert failed",
      });
    }
  }
  return report;
}

/** Convenience: load and insert in one call. Per-record errors do not abort the others. */
export async function seedFromFile(ctx: IngestContext, filePath: string): Promise<SeedReport> {
  return seedRecords(ctx, loadSeedFile(filePath));
}
