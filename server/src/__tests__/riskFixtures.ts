import { readFileSync } from "node:fs";
import type {
  AnalysisRecord,
  NormalizedEmail,
  RiskAnalysis,
  RiskLevel,
  StoredEmail,
} from "@mri/shared";
import { buildDeterministicExtraction } from "../agents/extractionAgent";
import { ingestPastedText, ingestSeedRecord } from "../ingestion/ingest";
import { SeedEmail } from "../ingestion/parseSeed";
import type { IndicatorOptions } from "../risk/indicators";
import { MemoryRepository } from "../storage/memoryRepository";
import { SEED_PATH } from "./helpers";

export const OPTS: IndicatorOptions = { orgDomains: ["arcline.com"] };

interface SeedRaw {
  id: string;
  from: string;
  to: string[];
  date: string;
  subject: string;
  body: string;
  attachments: { filename: string; extracted_text: string }[];
}

export const seedRaw = (JSON.parse(readFileSync(SEED_PATH, "utf8")) as { emails: SeedRaw[] }).emails;

/** Seed emails (all, or only the given ids, in the given order) as stored emails. */
export async function loadSeed(ids?: string[]): Promise<{ repo: MemoryRepository; emails: StoredEmail[] }> {
  const repo = new MemoryRepository();
  const wanted = ids ? ids.map((id) => seedRaw.find((e) => e.id === id)!) : seedRaw;
  for (const rec of wanted) await ingestSeedRecord({ repo }, SeedEmail.parse(rec));
  return { repo, emails: wanted.map((r) => repo.getEmail(r.id)!) };
}

export async function pasted(repo: MemoryRepository, text: string): Promise<StoredEmail> {
  return (await ingestPastedText({ repo }, text)).email;
}

/** A syntactically valid, grounded AI assessment for tests (built directly, not via a model). */
export function aiComplete(
  email: StoredEmail | NormalizedEmail & { id: string },
  level: RiskLevel,
  opts: { evidence?: boolean; entities?: RiskAnalysis["entities"]; relationships?: RiskAnalysis["relationships"] } = {},
): AnalysisRecord {
  const extraction = buildDeterministicExtraction(email, "test fixture");
  const withEvidence = opts.evidence ?? level !== "none";
  if (extraction.evidence_snippets.length === 0 && email.body.trim().length > 0) {
    // Emails without any extractable value still need a real snippet to cite.
    const text = email.body.trim().slice(0, 80);
    const start = email.body.indexOf(text);
    extraction.evidence_snippets.push({
      id: "s1",
      text,
      location: { where: "body", start, end: start + text.length },
      origin: "rules",
    });
  }
  const snippet = extraction.evidence_snippets[0];
  const assessment: RiskAnalysis = {
    schema_version: 1,
    risk: {
      level,
      rationale: `Test assessment: ${level}`,
      tags: [],
      evidence: withEvidence && snippet ? [{ snippet_id: snippet.id, quote: snippet.text.slice(0, 20) }] : [],
      confidence: "medium",
    },
    entities: opts.entities ?? [],
    relationships: opts.relationships ?? [],
  };
  return {
    email_id: email.id,
    status: "complete",
    analysis_mode: "complete",
    provenance: "live",
    extraction,
    assessment,
    warnings: [],
    runs: [],
    model: "test",
    prompt_version: "test",
    updated_at: "2026-10-11T12:00:00.000Z",
  };
}

export function notComplete(
  email: StoredEmail,
  status: "queued" | "partial" | "degraded" | "failed",
): AnalysisRecord {
  const terminal = status !== "queued";
  return {
    email_id: email.id,
    status,
    analysis_mode: terminal ? status : null,
    provenance: status === "partial" ? "live" : status === "degraded" ? "rules" : null,
    extraction: status === "partial" || status === "degraded" ? buildDeterministicExtraction(email, "test fixture") : null,
    assessment: null,
    warnings: [],
    runs: [],
    model: null,
    prompt_version: null,
    updated_at: "2026-10-11T12:00:00.000Z",
  };
}
