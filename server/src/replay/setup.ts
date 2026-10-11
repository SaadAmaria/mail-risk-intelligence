import { ExtractionSchemaVersion, RiskAnalysisSchemaVersion, type ReplayStatus } from "@mri/shared";
import { PROMPT_VERSION } from "../analysis/service";
import type { MailboxRepository } from "../storage/repository";
import { loadRecordings } from "./loader";
import { RecordedLlmClient } from "./recordedClient";

export interface ReplaySetup {
  /** A client to hand to the analysis service, or null when no usable recording exists. */
  client: RecordedLlmClient | null;
  /** What /api/health reports. Never claims provider reachability. */
  status: ReplayStatus;
}

/**
 * Recorded demo capability. Only consulted when no live LLM is configured (the caller decides),
 * and only against the CURRENT stored emails and pipeline versions.
 */
export function setupReplay(dir: string, repo: Pick<MailboxRepository, "getEmail">): ReplaySetup {
  const loaded = loadRecordings(dir, {
    lookup: (id) => repo.getEmail(id),
    promptVersion: PROMPT_VERSION,
    extractionSchemaVersion: ExtractionSchemaVersion,
    riskSchemaVersion: RiskAnalysisSchemaVersion,
  });
  const fixtures = [...loaded.byEmail.values()];
  if (fixtures.length === 0) {
    return {
      client: null,
      status: { available: false, email_ids: [], model: null, captured_at: null, problems: loaded.problems },
    };
  }
  const client = new RecordedLlmClient(fixtures);
  const captured = fixtures.map((f) => f.capture.captured_at).sort();
  return {
    client,
    status: {
      available: true,
      email_ids: fixtures.map((f) => f.email.id).sort(),
      model: client.model,
      captured_at: captured[captured.length - 1] ?? null,
      problems: loaded.problems,
    },
  };
}
