import type {
  AnalysisRecord,
  Disagreement,
  Escalation,
  FinalRiskLevel,
  RiskIndicator,
  RiskLevel,
  RiskView,
  RulesLevel,
} from "@mri/shared";

const RANK: Record<RiskLevel, number> = { none: 0, low: 1, medium: 2, high: 3 };
const RULE_RANK: Record<RulesLevel, number> = { none: 0, low: 1, medium: 2 };

/**
 * Level supported by deterministic indicators alone. Capped at `medium` BY CONSTRUCTION: this
 * function cannot return `high`.
 *
 *   none   - no indicators;
 *   low    - at least one indicator (including tentative cross-email signals);
 *   medium - indicators from two or more distinct categories (tentative signals do not count),
 *            or a single indicator specific enough on its own (e.g. several distinct threats).
 */
export function rulesLevel(indicators: RiskIndicator[]): RulesLevel {
  if (indicators.length === 0) return "none";
  const counted = indicators.filter((i) => i.counts_toward_medium);
  const categories = new Set(counted.map((i) => i.category));
  if (categories.size >= 2 || counted.some((i) => i.sufficient_for_medium)) return "medium";
  return "low";
}

/**
 * The validated AI level, or null when there is no assessment that may be trusted as one.
 * Stored invariants already guarantee this, but the aggregator does not rely on them: it
 * re-checks status, provenance and grounding so a malformed record can never be read as
 * "assessed" (and in particular never as "none").
 */
export function usableAiLevel(analysis: AnalysisRecord | null): RiskLevel | null {
  if (!analysis || analysis.status !== "complete") return null;
  if (analysis.provenance !== "live" && analysis.provenance !== "recorded") return null;
  const a = analysis.assessment;
  if (!a) return null;
  if (a.risk.level !== "none" && a.risk.evidence.length === 0) return null; // evidence-free positive finding
  return a.risk.level;
}

export interface AggregateInput {
  email_id: string;
  analysis: AnalysisRecord | null;
  indicators: RiskIndicator[];
  findings?: RiskView["findings"];
}

/**
 * Combine the validated AI assessment with deterministic indicators. Pure and total.
 *
 * - `high` can only come from a validated, grounded AI `high`; rules never exceed `medium`.
 * - With an AI assessment: final = max(AI, rules). The AI level, rules level and final level
 *   are all kept, with the escalation reason and any disagreement.
 * - Without one (queued, partial, degraded, failed, absent, or ungrounded): the AI level is
 *   null; the final level is the rules level if there is any indicator, otherwise
 *   "unassessed". It is NEVER "none": "none" is only reachable from a validated AI `none` with
 *   no deterministic indicators at all.
 */
export function aggregateRisk(input: AggregateInput): RiskView {
  const { indicators } = input;
  const ai = usableAiLevel(input.analysis);
  const rules = rulesLevel(indicators);
  const base = {
    email_id: input.email_id,
    ai_status: input.analysis?.status ?? null,
    rules_level: rules,
    indicators,
    findings: input.findings ?? [],
  };

  if (ai === null) {
    const final: FinalRiskLevel = rules === "none" ? "unassessed" : rules;
    return {
      ...base,
      assessed: false,
      ai_level: null,
      final_level: final,
      basis: rules === "none" ? "unassessed" : "rules_only",
      escalated: false,
      escalations: [],
      disagreement: null,
    };
  }

  const final: RiskLevel = RANK[ai] >= RULE_RANK[rules] ? ai : (rules as RiskLevel);
  const escalations: Escalation[] = [];
  if (RANK[final] > RANK[ai]) {
    const counted = indicators.filter((i) => i.counts_toward_medium);
    const cats = [...new Set(counted.map((i) => i.category))];
    escalations.push({
      rule_id: "rules_level_exceeds_ai_level",
      from: ai,
      to: final,
      rationale:
        `Deterministic indicators support "${rules}" while the validated AI assessment is "${ai}". ` +
        `The level was raised to "${final}" because ${
          counted.some((i) => i.sufficient_for_medium) && cats.length < 2
            ? "a single specific indicator was found"
            : `indicators from ${cats.length} distinct categories (${cats.join(", ")}) were found`
        }. Indicators are evidence for review, not proof of misconduct.`,
      indicator_ids: indicators.map((i) => i.id),
    });
  }

  let disagreement: Disagreement | null = null;
  const gap = RANK[ai] - RULE_RANK[rules];
  if (gap < 0) {
    disagreement = {
      direction: "ai_lower",
      ai_level: ai,
      rules_level: rules,
      needs_review: true,
      summary: `AI assessed "${ai}" but deterministic indicators support "${rules}".`,
    };
  } else if (gap >= 2) {
    disagreement = {
      direction: "ai_higher",
      ai_level: ai,
      rules_level: rules,
      needs_review: ai === "high",
      summary:
        `AI assessed "${ai}" without deterministic corroboration (rules: "${rules}"). ` +
        "The AI judgment may rest on meaning that pattern rules cannot see.",
    };
  }

  return {
    ...base,
    assessed: true,
    ai_level: ai,
    final_level: final,
    basis: "ai_and_rules",
    escalated: escalations.length > 0,
    escalations,
    disagreement,
  };
}
