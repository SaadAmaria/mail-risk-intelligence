import { z } from "zod";
import {
  ENTITY_TYPES,
  RELATIONSHIP_PREDICATES,
  RISK_LEVELS,
  RISK_TAGS,
  RiskAnalysis,
  type Extraction,
  type TokenUsage,
} from "@mri/shared";
import type { LlmClient } from "../llm/types";
import { callJsonAgent, type ParseResult } from "./callJson";
import { AgentError } from "./errors";
import { numbersInText } from "./deterministic";
import { buildRiskPrompt, RISK_PROMPT_VERSION } from "./prompts/risk";
import { checkRelationship } from "../risk/relationshipRules";
import { normalizeForMatch } from "./source";

export { RISK_PROMPT_VERSION };

const MAX_RATIONALE = 500;

// Permissive on shape; every claim is verified in `validateRisk`.
const LlmRisk = z.object({
  risk: z.object({
    level: z.string(),
    rationale: z.string().default(""),
    tags: z.array(z.string()).default([]),
    evidence: z.array(z.object({ snippet_id: z.string(), quote: z.string() })).default([]),
    confidence: z.string().default("low"),
  }),
  entities: z
    .array(
      z.object({
        ref: z.string(),
        type: z.string(),
        name: z.string(),
        attributes: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
      }),
    )
    .default([]),
  relationships: z
    .array(
      z.object({
        from_ref: z.string(),
        predicate: z.string(),
        to_ref: z.string(),
        snippet_id: z.string(),
        quote: z.string(),
      }),
    )
    .default([]),
});
type LlmRisk = z.infer<typeof LlmRisk>;

const LEVELS = new Set<string>(RISK_LEVELS);
const TAGS = new Set<string>(RISK_TAGS);
const TYPES = new Set<string>(ENTITY_TYPES);
const PREDICATES = new Set<string>(RELATIONSHIP_PREDICATES);

export interface ValidatedRisk {
  analysis: RiskAnalysis;
  dropped: number;
  warnings: string[];
}

function amountOf(text: string): number | null {
  const m = /(\d[\d,]*(?:\.\d+)?)\s*([KkMmBb])?/.exec(text);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ""));
  const mult = m[2] ? { k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase() as "k" | "m" | "b"] : 1;
  return Number.isFinite(n) ? n * mult : null;
}

/**
 * Check an Agent B answer against the Extraction it was given (its only input). Unsupported
 * evidence, entities and relationships are removed and counted; an invalid risk level is a hard
 * failure (the caller may repair).
 */
export function validateRisk(raw: LlmRisk, extraction: Extraction): ParseResult<ValidatedRisk> {
  const warnings: string[] = [];
  let dropped = 0;

  if (!LEVELS.has(raw.risk.level)) {
    return { ok: false, errors: [`risk.level: must be one of ${RISK_LEVELS.join(", ")}`] };
  }

  const snippetText = new Map(extraction.evidence_snippets.map((s) => [s.id, normalizeForMatch(s.text)]));
  const quoteOk = (snippetId: string, quote: string): boolean => {
    const text = snippetText.get(snippetId);
    const q = normalizeForMatch(quote);
    return text !== undefined && q.length > 0 && text.includes(q);
  };

  // Evidence
  const evidence: RiskAnalysis["risk"]["evidence"] = [];
  for (const e of raw.risk.evidence) {
    if (quoteOk(e.snippet_id, e.quote)) evidence.push({ snippet_id: e.snippet_id, quote: e.quote.trim() });
    else {
      dropped++;
      warnings.push("An evidence item was removed: it does not quote the snippet it cites.");
    }
  }

  // Tags
  const tags: RiskAnalysis["risk"]["tags"] = [];
  for (const t of raw.risk.tags) {
    if (TAGS.has(t)) {
      if (!tags.includes(t as never)) tags.push(t as never);
    } else {
      dropped++;
      warnings.push("A tag outside the allowed list was removed.");
    }
  }

  // Entities must be grounded in the Extraction (snippets, facts, sender, recipients).
  const groundTexts: string[] = [
    ...extraction.evidence_snippets.map((s) => normalizeForMatch(s.text)),
    ...[extraction.sender, ...extraction.recipients].flatMap((a) =>
      a ? [normalizeForMatch(a.address), ...(a.name ? [normalizeForMatch(a.name)] : [])] : [],
    ),
    ...(extraction.subject ? [normalizeForMatch(extraction.subject)] : []),
  ];
  const factAmounts = extraction.facts.amounts.map((a) => a.value);
  const factRefs = extraction.facts.references
    .filter((r) => r.kind === "account" || r.kind === "routing")
    .map((r) => normalizeForMatch(r.value));
  const snippetNumbers = extraction.evidence_snippets.flatMap((s) => numbersInText(s.text));

  const grounded = (type: string, name: string): boolean => {
    const n = normalizeForMatch(name);
    if (n.length === 0) return false;
    if (groundTexts.some((t) => t.includes(n))) return true;
    if (type === "amount") {
      const v = amountOf(name);
      return v !== null && [...factAmounts, ...snippetNumbers].some((x) => Math.abs(x - v) <= 0.005);
    }
    if (type === "account") return factRefs.some((r) => n.includes(r) || r.includes(n));
    return false;
  };

  const entities: RiskAnalysis["entities"] = [];
  const refs = new Set<string>();
  for (const e of raw.entities) {
    if (!TYPES.has(e.type) || refs.has(e.ref) || !grounded(e.type, e.name)) {
      dropped++;
      warnings.push("An entity was removed: unsupported type, duplicate ref, or not found in the extracted content.");
      continue;
    }
    refs.add(e.ref);
    entities.push({
      ref: e.ref,
      type: e.type as RiskAnalysis["entities"][number]["type"],
      name: e.name.trim(),
      ...(e.attributes ? { attributes: e.attributes } : {}),
    });
  }

  // Relationships need real endpoints, a quote of the cited snippet, a known predicate and endpoint
  // types the predicate can connect. See risk/relationshipRules.ts: code proves the quote occurs and
  // the structure fits; it does NOT prove that the quote means the predicate (the read-time
  // advisory in relationshipSupport.ts flags weak support). An unknown predicate is dropped.
  const typeOfRef = new Map(entities.map((e) => [e.ref, e.type]));
  const relationships: RiskAnalysis["relationships"] = [];
  for (const r of raw.relationships) {
    if (!(refs.has(r.from_ref) && refs.has(r.to_ref) && quoteOk(r.snippet_id, r.quote))) {
      dropped++;
      warnings.push("A relationship was removed: unknown entity ref or unsupported quote.");
      continue;
    }
    if (!PREDICATES.has(r.predicate)) {
      dropped++;
      warnings.push("A relationship was removed: its type is not one of the supported relationship types.");
      continue;
    }
    const predicate = r.predicate as RiskAnalysis["relationships"][number]["predicate"];
    const check = checkRelationship(predicate, typeOfRef.get(r.from_ref)!, typeOfRef.get(r.to_ref)!, r.quote, r.from_ref === r.to_ref);
    if (!check.ok) {
      dropped++;
      warnings.push(
        check.reason === "self_reference"
          ? "A relationship from an entity to itself was removed."
          : `A "${predicate}" relationship was removed: it cannot connect those kinds of entity.`,
      );
      continue;
    }
    relationships.push({
      from_ref: r.from_ref,
      predicate,
      to_ref: r.to_ref,
      snippet_id: r.snippet_id,
      quote: r.quote.trim(),
    });
  }

  let confidence: "low" | "medium" | "high" = "low";
  if (raw.risk.confidence === "low" || raw.risk.confidence === "medium" || raw.risk.confidence === "high") {
    confidence = raw.risk.confidence;
  } else {
    warnings.push("An invalid confidence value was replaced with 'low'.");
  }

  let rationale = raw.risk.rationale.trim();
  if (rationale.length > MAX_RATIONALE) {
    rationale = rationale.slice(0, MAX_RATIONALE);
    warnings.push("Rationale exceeded 500 characters and was truncated.");
  }
  // Evidence-quality invariant: a finding above "none" must be backed by at least one quote that
  // verifiably appears in the snippet it cites. Otherwise it is not a validated assessment. It
  // is rejected here (one repair attempt follows) and, if it stays ungrounded, withheld by the
  // caller; the level is never silently changed and no evidence is invented.
  if (raw.risk.level !== "none" && evidence.length === 0) {
    return {
      ok: false,
      errors: [
        `risk.evidence: a risk level above "none" must cite at least one verbatim quote from a snippet ` +
          `(${raw.risk.evidence.length} cited, 0 matched the snippets)`,
      ],
      detail: {
        proposed: {
          level: raw.risk.level,
          confidence: raw.risk.confidence,
          tags: raw.risk.tags.filter((t) => TAGS.has(t)),
          evidenceCited: raw.risk.evidence.length,
          evidenceValid: 0,
        },
      },
    };
  }

  const parsed = RiskAnalysis.safeParse({
    schema_version: 1,
    risk: { level: raw.risk.level, rationale, tags, evidence, confidence },
    entities,
    relationships,
  });
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 6).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  return { ok: true, value: { analysis: parsed.data, dropped, warnings } };
}

export interface RiskOutcome extends ValidatedRisk {
  usage: TokenUsage | null;
  calls: number;
  latencyMs: number;
  model: string | null;
  repaired: boolean;
}

export interface RiskAgentOptions {
  maxCompletionTokens: number;
}

/**
 * Agent B. Input: ONLY a validated Extraction (never the raw email). Output: a validated risk
 * assessment with grounded evidence, entities and relationships.
 */
export async function runRiskAgent(
  client: LlmClient,
  extraction: Extraction,
  options: RiskAgentOptions,
): Promise<RiskOutcome> {
  const messages = buildRiskPrompt(extraction);

  const parse = (json: unknown): ParseResult<ValidatedRisk> => {
    const shape = LlmRisk.safeParse(json);
    if (!shape.success) {
      return {
        ok: false,
        errors: shape.error.issues.slice(0, 6).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
      };
    }
    return validateRisk(shape.data, extraction);
  };

  let result;
  try {
    result = await callJsonAgent<ValidatedRisk>({
      client,
      messages,
      maxCompletionTokens: options.maxCompletionTokens,
      parse,
    });
  } catch (err) {
    const proposed = err instanceof AgentError ? err.detail?.proposed : undefined;
    if (err instanceof AgentError && err.kind === "invalid_output" && proposed) {
      // Only enum-like values appear here (level, confidence, allowed tags); never free text.
      throw new AgentError(
        "ungrounded_assessment",
        `The model proposed risk level "${proposed.level}" (confidence ${proposed.confidence}` +
          `${proposed.tags.length ? `; tags: ${proposed.tags.join(", ")}` : ""}) but cited no evidence ` +
          `that could be verified against the extraction; the finding was withheld and not recorded as an assessment.`,
        { calls: err.calls, usage: err.usage, detail: err.detail },
      );
    }
    throw err;
  }

  return {
    ...result.value,
    usage: result.usage,
    calls: result.calls,
    latencyMs: result.latencyMs,
    model: result.model,
    repaired: result.repaired,
  };
}
