import { loadSeedFile, seedRecords, SeedFileError, type SeedReport } from "./ingestion/seed";
import { SqliteRepository } from "./storage/sqliteRepository";

export type StartupErrorCode =
  | "database_unavailable"
  | "seed_missing"
  | "seed_unreadable"
  | "seed_invalid"
  | "seed_incomplete";

/**
 * A condition under which the mandatory demo data cannot be guaranteed. The process must exit
 * non-zero rather than serve a healthy-looking empty or partial mailbox. Messages contain
 * paths, ids, and field names only: never email bodies, headers, or credentials.
 */
export class StartupError extends Error {
  readonly code: StartupErrorCode;
  readonly details: string[];

  constructor(code: StartupErrorCode, message: string, details: string[] = []) {
    super(message);
    this.name = "StartupError";
    this.code = code;
    this.details = details;
  }
}

export interface StartupResult {
  repo: SqliteRepository;
  report: SeedReport;
}

/** Strict, fail-fast initialization: database first, then the mandatory seed mailbox. */
export async function initialize(options: { dbPath: string; seedPath: string }): Promise<StartupResult> {
  let repo: SqliteRepository;
  try {
    repo = new SqliteRepository(options.dbPath);
  } catch (err) {
    const reason = err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    throw new StartupError(
      "database_unavailable",
      `Database could not be opened or initialized at ${options.dbPath}`,
      [reason, "Check DB_PATH and file permissions, or remove a corrupted database file."],
    );
  }

  try {
    // Validate the whole seed file before writing anything, so a bad file never leaves a
    // half-seeded database behind.
    let loaded;
    try {
      loaded = loadSeedFile(options.seedPath);
    } catch (err) {
      if (err instanceof SeedFileError) throw new StartupError(err.code, err.message, err.details);
      throw err;
    }

    if (loaded.total === 0) {
      throw new StartupError("seed_invalid", `Seed file contains no emails: ${options.seedPath}`);
    }
    if (loaded.errors.length > 0) {
      throw new StartupError(
        "seed_invalid",
        `Seed file has ${loaded.errors.length} invalid record(s) of ${loaded.total}: ${options.seedPath}`,
        loaded.errors.map((e) => `${e.id ?? `record #${e.index}`}: ${e.message}`),
      );
    }

    const report = await seedRecords({ repo }, loaded);

    // Do not trust counters: confirm every mandatory id is actually stored.
    const missing = loaded.records.map((r) => r.id).filter((id) => repo.getEmail(id) === null);
    if (report.errors.length > 0 || missing.length > 0) {
      throw new StartupError(
        "seed_incomplete",
        `Seeding did not complete: ${missing.length} of ${loaded.total} mandatory email(s) missing`,
        [
          ...report.errors.map((e) => `${e.id ?? `record #${e.index}`}: ${e.message}`),
          ...(missing.length > 0 ? [`missing ids: ${missing.join(", ")}`] : []),
        ],
      );
    }

    return { repo, report };
  } catch (err) {
    repo.close();
    throw err;
  }
}
