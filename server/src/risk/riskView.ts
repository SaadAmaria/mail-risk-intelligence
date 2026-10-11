import type { AnalysisRecord, CrossEmailFinding, RiskIndicator, RiskView, StoredEmail } from "@mri/shared";
import { aggregateRisk } from "./aggregate";
import { computeIndicators, type IndicatorOptions } from "./indicators";
import { crossEmailFindings } from "./vendor";

/** A cross-email finding expressed as an indicator, so the aggregator treats it uniformly. */
export function findingToIndicator(f: CrossEmailFinding): RiskIndicator {
  const consistent = f.identity === "consistent";
  const isAccount = f.rule_id === "payment_account_changed";
  return {
    id: f.id,
    rule_id: f.rule_id,
    // A changed destination is its own category; an amount anomaly is an observation.
    category: isAccount ? "payment_redirect" : "observation",
    label: isAccount ? "Payment account differs from earlier invoices" : "Invoice amount far above earlier invoices",
    detail:
      f.summary +
      (isAccount
        ? ""
        : " This is a size heuristic (a ratio threshold), not evidence of fraud: a larger invoice can be " +
          "legitimate, for example a bigger order or a price change.") +
      (consistent
        ? " The vendor's claimed identity is consistent across the documents, which does not prove it is authentic."
        : " The vendor match is tentative, so this is shown for context and does not raise the level on its own."),
    evidence: f.evidence,
    related_email_ids: f.related_email_ids,
    identity: f.identity,
    // Tentative matches never push an email to medium.
    counts_toward_medium: consistent,
    sufficient_for_medium: false,
  };
}

/**
 * Risk view for one email, computed from stored data at read time. The stored AI analysis is
 * read, never modified; no LLM is called; results change as soon as other emails exist.
 */
export function buildRiskView(
  email: StoredEmail,
  analysis: AnalysisRecord | null,
  allEmails: StoredEmail[],
  options: IndicatorOptions,
): RiskView {
  const own = computeIndicators(email, options);
  const findings = crossEmailFindings(email, allEmails);
  return aggregateRisk({
    email_id: email.id,
    analysis,
    indicators: [...own, ...findings.map(findingToIndicator)],
    findings,
  });
}

/** Risk views for every stored email (order-independent: depends only on content and dates). */
export function buildAllRiskViews(
  emails: StoredEmail[],
  analyses: AnalysisRecord[],
  options: IndicatorOptions,
): RiskView[] {
  const byId = new Map(analyses.map((a) => [a.email_id, a]));
  return [...emails]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((e) => buildRiskView(e, byId.get(e.id) ?? null, emails, options));
}
