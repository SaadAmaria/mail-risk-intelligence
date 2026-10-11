import { describe, expect, it } from "vitest";
import type { RiskIndicator, RiskLevel } from "@mri/shared";
import { aggregateRisk, rulesLevel, usableAiLevel } from "../risk/aggregate";
import { buildRiskView } from "../risk/riskView";
import { aiComplete, loadSeed, notComplete, OPTS } from "./riskFixtures";

let n = 0;
function ind(category: RiskIndicator["category"], over: Partial<RiskIndicator> = {}): RiskIndicator {
  n++;
  return {
    id: `x:${category}:${n}`,
    rule_id: `rule_${category}`,
    category,
    label: category,
    detail: "test",
    evidence: [{ email_id: "x", where: "body", start: 0, end: 4, text: "test" }],
    related_email_ids: [],
    counts_toward_medium: true,
    sufficient_for_medium: false,
    ...over,
  };
}

const LEVELS: RiskLevel[] = ["none", "low", "medium", "high"];

describe("rulesLevel", () => {
  it("none without indicators, low for one category, medium for two distinct categories", () => {
    expect(rulesLevel([])).toBe("none");
    expect(rulesLevel([ind("pressure")])).toBe("low");
    expect(rulesLevel([ind("pressure"), ind("pressure")])).toBe("low"); // same category twice
    expect(rulesLevel([ind("pressure"), ind("action")])).toBe("medium");
  });

  it("tentative (non-counting) indicators can make low but never medium", () => {
    const t = (c: RiskIndicator["category"]) => ind(c, { counts_toward_medium: false, identity: "tentative" });
    expect(rulesLevel([t("payment_redirect")])).toBe("low");
    expect(rulesLevel([t("payment_redirect"), t("observation"), t("action")])).toBe("low");
    expect(rulesLevel([t("payment_redirect"), ind("pressure")])).toBe("low"); // only one counted category
  });

  it("a single specific indicator can justify medium on its own", () => {
    expect(rulesLevel([ind("threat", { sufficient_for_medium: true })])).toBe("medium");
  });

  it("can never return 'high', however many indicators there are", () => {
    const many = (["observation", "payment_redirect", "action", "pressure", "impersonation", "information", "threat", "tampering"] as const).map((c) =>
      ind(c, { sufficient_for_medium: true }),
    );
    expect(rulesLevel(many)).toBe("medium");
  });
});

describe("aggregateRisk: with a validated AI assessment", () => {
  it.each(LEVELS)("AI %s with no indicators keeps the AI level, and records both levels", async (level) => {
    const { repo } = await loadSeed(["E002"]);
    const e = repo.getEmail("E002")!;
    const v = aggregateRisk({ email_id: "E002", analysis: aiComplete(e, level), indicators: [] });
    expect(v).toMatchObject({ ai_level: level, rules_level: "none", final_level: level, assessed: true, escalated: false });
  });

  it("raises an AI 'low' to 'medium' with a recorded rationale and the indicator ids", async () => {
    const { repo } = await loadSeed(["E002"]);
    const e = repo.getEmail("E002")!;
    const indicators = [ind("action"), ind("pressure")];
    const v = aggregateRisk({ email_id: "E002", analysis: aiComplete(e, "low"), indicators });
    expect(v.ai_level).toBe("low");
    expect(v.rules_level).toBe("medium");
    expect(v.final_level).toBe("medium");
    expect(v.escalated).toBe(true);
    expect(v.escalations).toHaveLength(1);
    expect(v.escalations[0]).toMatchObject({ from: "low", to: "medium", indicator_ids: indicators.map((i) => i.id) });
    expect(v.escalations[0]!.rationale).toMatch(/not proof of misconduct/);
    expect(v.escalations[0]!.rationale).toMatch(/2 distinct categories \(action, pressure\)/);
  });

  it("an AI 'none' cannot override validated medium-level indicators (and the disagreement is recorded)", async () => {
    const { repo } = await loadSeed(["E002"]);
    const e = repo.getEmail("E002")!;
    const v = aggregateRisk({ email_id: "E002", analysis: aiComplete(e, "none"), indicators: [ind("action"), ind("pressure")] });
    expect(v.ai_level).toBe("none");
    expect(v.final_level).toBe("medium");
    expect(v.disagreement).toMatchObject({ direction: "ai_lower", ai_level: "none", rules_level: "medium", needs_review: true });
  });

  it("an AI 'high' without deterministic corroboration stays high and is marked for review", async () => {
    const { repo } = await loadSeed(["E002"]);
    const e = repo.getEmail("E002")!;
    const v = aggregateRisk({ email_id: "E002", analysis: aiComplete(e, "high"), indicators: [] });
    expect(v.final_level).toBe("high");
    expect(v.escalated).toBe(false);
    expect(v.disagreement).toMatchObject({ direction: "ai_higher", needs_review: true });
  });

  it("rules can raise the level to medium but never to high", async () => {
    const { repo } = await loadSeed(["E002"]);
    const e = repo.getEmail("E002")!;
    for (const ai of ["none", "low", "medium"] as const) {
      const v = aggregateRisk({
        email_id: "E002",
        analysis: aiComplete(e, ai),
        indicators: [ind("observation"), ind("payment_redirect"), ind("action"), ind("pressure")],
      });
      expect(v.final_level).toBe("medium");
      expect(v.final_level).not.toBe("high");
    }
  });

  it("keeps the AI level when it is already at or above the rules level (no escalation)", async () => {
    const { repo } = await loadSeed(["E002"]);
    const e = repo.getEmail("E002")!;
    const v = aggregateRisk({ email_id: "E002", analysis: aiComplete(e, "medium"), indicators: [ind("action"), ind("pressure")] });
    expect(v).toMatchObject({ ai_level: "medium", rules_level: "medium", final_level: "medium", escalated: false, disagreement: null });
  });
});

describe("aggregateRisk: missing, failed or invalid AI analysis is never 'none'", () => {
  const statuses = ["queued", "partial", "degraded", "failed"] as const;

  it.each(statuses)("%s with no indicators -> unassessed", async (status) => {
    const { repo } = await loadSeed(["E002"]);
    const v = aggregateRisk({ email_id: "E002", analysis: notComplete(repo.getEmail("E002")!, status), indicators: [] });
    expect(v).toMatchObject({ assessed: false, ai_level: null, final_level: "unassessed", basis: "unassessed", ai_status: status });
  });

  it("no analysis at all -> unassessed", () => {
    const v = aggregateRisk({ email_id: "E002", analysis: null, indicators: [] });
    expect(v).toMatchObject({ assessed: false, ai_level: null, final_level: "unassessed", ai_status: null });
  });

  it.each(statuses)("%s with indicators -> rules level, labelled rules-only and not assessed", async (status) => {
    const { repo } = await loadSeed(["E002"]);
    const v = aggregateRisk({
      email_id: "E002",
      analysis: notComplete(repo.getEmail("E002")!, status),
      indicators: [ind("action"), ind("pressure")],
    });
    expect(v).toMatchObject({ assessed: false, ai_level: null, rules_level: "medium", final_level: "medium", basis: "rules_only" });
    expect(v.final_level).not.toBe("high");
  });

  it("an evidence-free positive finding is not trusted as an assessment", async () => {
    const { repo } = await loadSeed(["E002"]);
    const e = repo.getEmail("E002")!;
    const bad = aiComplete(e, "high", { evidence: false }); // a record that violates the Phase 2 invariant
    expect(usableAiLevel(bad)).toBeNull();
    const v = aggregateRisk({ email_id: "E002", analysis: bad, indicators: [] });
    expect(v).toMatchObject({ assessed: false, ai_level: null, final_level: "unassessed" });
  });

  it("a 'complete' record with rules provenance or a missing assessment is not trusted", async () => {
    const { repo } = await loadSeed(["E002"]);
    const e = repo.getEmail("E002")!;
    const good = aiComplete(e, "none");
    expect(usableAiLevel({ ...good, provenance: "rules" })).toBeNull();
    expect(usableAiLevel({ ...good, assessment: null })).toBeNull();
    expect(usableAiLevel({ ...good, status: "partial", analysis_mode: "partial" })).toBeNull();
    expect(usableAiLevel(good)).toBe("none");
  });

  it("'none' is reachable only from a validated AI none with zero indicators", async () => {
    const { repo } = await loadSeed(["E002"]);
    const e = repo.getEmail("E002")!;
    const reached: string[] = [];
    const cases: [string, ReturnType<typeof aggregateRisk>][] = [
      ["no analysis", aggregateRisk({ email_id: "E002", analysis: null, indicators: [] })],
      ["degraded", aggregateRisk({ email_id: "E002", analysis: notComplete(e, "degraded"), indicators: [] })],
      ["partial", aggregateRisk({ email_id: "E002", analysis: notComplete(e, "partial"), indicators: [] })],
      ["failed", aggregateRisk({ email_id: "E002", analysis: notComplete(e, "failed"), indicators: [] })],
      ["ai none + indicator", aggregateRisk({ email_id: "E002", analysis: aiComplete(e, "none"), indicators: [ind("pressure")] })],
      ["ai none, none", aggregateRisk({ email_id: "E002", analysis: aiComplete(e, "none"), indicators: [] })],
    ];
    for (const [label, v] of cases) if (v.final_level === "none") reached.push(label);
    expect(reached).toEqual(["ai none, none"]);
  });
});

describe("the original AI analysis is never modified", () => {
  it("aggregation and read-time enrichment leave the stored record untouched", async () => {
    const { repo, emails } = await loadSeed();
    const e = repo.getEmail("E001")!;
    const analysis = aiComplete(e, "low");
    const before = JSON.stringify(analysis);
    const v = buildRiskView(e, analysis, emails, OPTS);
    expect(v.escalated).toBe(true);
    expect(JSON.stringify(analysis)).toBe(before);
    expect(analysis.assessment!.risk.level).toBe("low");
  });
});
