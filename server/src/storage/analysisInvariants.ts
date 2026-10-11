import type { AnalysisRecord } from "@mri/shared";

const NON_TERMINAL = new Set(["queued", "extracting", "analyzing"]);

/**
 * Rules every persisted analysis must satisfy. They exist so that nothing which failed, was
 * interrupted, or was never AI-assessed can be stored in a shape that reads as "safe":
 *
 * - a risk assessment (and therefore a level, including `none`) exists only for `complete`;
 * - `complete` requires both a validated extraction and a validated assessment;
 * - `partial` keeps the extraction but no assessment; `degraded`/`failed` carry no assessment;
 * - an assessment may only come from a live (or, later, recorded) AI run, never from `rules`.
 */
export function assertAnalysisInvariants(r: AnalysisRecord): void {
  const fail = (why: string): never => {
    throw new Error(`Invalid analysis record for ${r.email_id}: ${why}`);
  };

  const terminal = !NON_TERMINAL.has(r.status);
  if (terminal && r.analysis_mode !== r.status) fail("analysis_mode must equal a terminal status");
  if (!terminal && r.analysis_mode !== null) fail("analysis_mode must be null while in progress");

  if (r.assessment !== null) {
    if (r.status !== "complete") fail(`an assessment is not allowed with status "${r.status}"`);
    if (r.provenance !== "live" && r.provenance !== "recorded") fail("an assessment requires live or recorded provenance");
  }

  switch (r.status) {
    case "complete":
      if (!r.extraction || !r.assessment) fail("complete requires an extraction and an assessment");
      break;
    case "partial":
      if (!r.extraction) fail("partial requires an extraction");
      break;
    default:
      break;
  }
}
