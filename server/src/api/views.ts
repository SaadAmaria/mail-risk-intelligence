import { aiAttempts, canRunAutomaticChecks, isAutomaticChecksRun } from "@mri/shared";
import type {
  AnalysisRecord,
  EmailDetailResponse,
  EmailListItem,
  EmailListResponse,
  FinalRiskLevel,
  GraphResponse,
  ProcessingStatus,
  ProcessingSummary,
  RiskView,
  StoredEmail,
} from "@mri/shared";
import type { AnalysisService } from "../analysis/service";
import { buildEntityGraph, type EntityGraphData } from "../risk/entities";
import { buildAllRiskViews, buildRiskView } from "../risk/riskView";
import type { MailboxRepository } from "../storage/repository";

/**
 * Read-side composition for the API. Every function here is a plain function of stored data:
 * it derives views from the repository using the Phase 3 modules and never calls a model, never
 * writes, and never changes the stored analysis.
 */
export interface ViewDeps {
  repo: MailboxRepository;
  analysis: AnalysisService;
  orgDomains: string[];
  /** Runs after which an email is no longer retried without `force`. */
  maxRuns: number;
}

export const RISK_FILTERS = ["none", "low", "medium", "high", "unassessed"] as const;
export const STATUS_FILTERS = [
  "not_started",
  "queued",
  "extracting",
  "analyzing",
  "complete",
  "partial",
  "degraded",
  "failed",
] as const;

export function processingSummary(
  deps: Pick<ViewDeps, "analysis" | "maxRuns">,
  emailId: string,
  a: AnalysisRecord | null,
): ProcessingSummary {
  const inProgress = deps.analysis.isActive(emailId);
  const status: ProcessingStatus = a?.status ?? "not_started";
  const runCount = a?.runs.length ?? 0;
  return {
    status,
    analysis_mode: a?.analysis_mode ?? null,
    provenance: a?.provenance ?? null,
    model: a?.model ?? null,
    prompt_version: a?.prompt_version ?? null,
    updated_at: a?.updated_at ?? null,
    in_progress: inProgress,
    run_count: runCount,
    // What an explicit reprocess WITHOUT force would accept.
    // Only AI attempts count against the allowance; automatic-checks runs do not.
    can_reprocess: !inProgress && status !== "complete" && (a ? aiAttempts(a.runs) : 0) < deps.maxRuns,
    automatic_checks_only:
      a !== null && a.status === "degraded" && a.provenance === "rules" && isAutomaticChecksRun(a.runs),
    automatic_checks_available: canRunAutomaticChecks(a, inProgress),
  };
}

function riskSummary(v: RiskView): EmailListItem["risk"] {
  return {
    final_level: v.final_level,
    assessed: v.assessed,
    ai_level: v.ai_level,
    rules_level: v.rules_level,
    basis: v.basis,
    escalated: v.escalated,
    needs_review: v.disagreement?.needs_review ?? false,
    indicator_count: v.indicators.length,
    finding_count: v.findings.length,
  };
}

export interface ListQuery {
  q: string | null;
  risk: string[] | null;
  status: string[] | null;
  order: "asc" | "desc";
  limit: number;
}

export function listEmails(deps: ViewDeps, query: ListQuery): EmailListResponse {
  const emails = deps.repo.listEmails({ order: query.order === "asc" ? "date_asc" : "date_desc" });
  const analyses = new Map(deps.repo.listAnalyses().map((a) => [a.email_id, a]));
  const risk = new Map(
    buildAllRiskViews(emails, [...analyses.values()], { orgDomains: deps.orgDomains }).map((v) => [v.email_id, v]),
  );

  const needle = query.q?.toLowerCase() ?? null;
  const items: EmailListItem[] = [];
  for (const e of emails) {
    const processing = processingSummary(deps, e.id, analyses.get(e.id) ?? null);
    const view = risk.get(e.id)!;
    if (query.status && !query.status.includes(processing.status)) continue;
    if (query.risk && !query.risk.includes(view.final_level)) continue;
    if (needle) {
      const hay = [e.subject, e.from?.address, e.from?.name, e.body].filter(Boolean).join("\n").toLowerCase();
      if (!hay.includes(needle)) continue;
    }
    items.push({
      id: e.id,
      from: e.from,
      subject: e.subject,
      date: e.date,
      source_kind: e.source_kind,
      attachment_count: e.attachments.length,
      missing_headers: e.missing_headers,
      processing,
      risk: riskSummary(view),
    });
  }
  const page = items.slice(0, query.limit);
  return { emails: page, total: items.length, count: page.length };
}

function entityGraph(deps: ViewDeps): EntityGraphData {
  return buildEntityGraph(deps.repo.listAnalyses());
}

export function emailDetail(deps: ViewDeps, email: StoredEmail): EmailDetailResponse {
  const analysis = deps.repo.getAnalysis(email.id);
  const all = deps.repo.listEmails();
  const risk = buildRiskView(email, analysis, all, { orgDomains: deps.orgDomains });
  const graph = entityGraph(deps);
  const proc = processingSummary(deps, email.id, analysis);

  return {
    email: {
      id: email.id,
      external_id: email.external_id,
      source_kind: email.source_kind,
      source_filename: email.source_filename,
      from: email.from,
      to: email.to,
      cc: email.cc,
      date: email.date,
      subject: email.subject,
      body: email.body,
      body_truncated: email.body_truncated,
      missing_headers: email.missing_headers,
      warnings: email.warnings,
      attachments: email.attachments.map(({ id: _id, ...a }) => a),
      created_at: email.created_at,
      ...(email.read_issues ? { read_issues: email.read_issues } : {}),
    },
    processing: { ...proc, warnings: analysis?.warnings ?? [], runs: analysis?.runs ?? [] },
    extraction: analysis?.extraction ?? null,
    // Only a complete, validated assessment is exposed as an assessment.
    assessment: analysis?.status === "complete" ? analysis.assessment : null,
    risk,
    entities: graph.entities
      .filter((e) => e.email_ids.includes(email.id))
      .map((e) => ({
        key: e.key,
        type: e.type,
        display_name: e.display_name,
        origin: e.origin,
        key_basis: e.key_basis,
        mentions: e.mentions
          .filter((m) => m.email_id === email.id)
          .map((m) => ({ surface_form: m.surface_form, origin: m.origin, ref: m.ref })),
        also_in: e.email_ids.filter((id) => id !== email.id),
      })),
    relationships: graph.relationships
      .filter((r) => r.email_ids.includes(email.id))
      .map((r) => ({
        key: r.key,
        predicate: r.predicate,
        source: r.source,
        target: r.target,
        evidence: r.evidence.filter((x) => x.email_id === email.id).map(({ snippet_id, quote, support }) => ({ snippet_id, quote, support })),
        review: r.evidence.some((x) => x.email_id === email.id && x.support.review),
        also_in: r.email_ids.filter((id) => id !== email.id),
      })),
  };
}

const SEVERITY: Record<string, number> = { low: 1, medium: 2, high: 3 };

/** Highest level among the source emails; "unassessed" if nothing assessed is above none. */
function maxRisk(levels: FinalRiskLevel[]): FinalRiskLevel {
  let best: FinalRiskLevel | null = null;
  for (const l of levels) {
    if ((SEVERITY[l] ?? 0) > (best ? (SEVERITY[best] ?? 0) : 0)) best = l;
  }
  if (best) return best;
  return levels.some((l) => l === "unassessed") ? "unassessed" : "none";
}

export function graph(deps: ViewDeps, opts: { includeAmounts: boolean }): GraphResponse {
  const emails = deps.repo.listEmails();
  const analyses = deps.repo.listAnalyses();
  const risks = new Map(
    buildAllRiskViews(emails, analyses, { orgDomains: deps.orgDomains }).map((v) => [v.email_id, v.final_level]),
  );
  const data = buildEntityGraph(analyses);

  const entities = data.entities.filter((e) => opts.includeAmounts || e.type !== "amount");
  const keep = new Set(entities.map((e) => e.key));

  const nodes = entities.map((e) => ({
    id: e.key,
    type: e.type,
    label: e.display_name,
    origin: e.origin,
    key_basis: e.key_basis,
    email_ids: e.email_ids,
    mention_count: e.mentions.length,
    max_risk: maxRisk(e.email_ids.map((id) => risks.get(id) ?? "unassessed")),
  }));
  const edges = data.relationships
    .filter((r) => keep.has(r.source) && keep.has(r.target))
    .map((r) => ({
      id: r.key,
      source: r.source,
      target: r.target,
      predicate: r.predicate,
      email_ids: r.email_ids,
      count: r.count,
      origin: r.origin,
      evidence: r.evidence,
      review: r.review,
    }));

  return {
    nodes,
    edges,
    meta: {
      email_count: emails.length,
      node_count: nodes.length,
      edge_count: edges.length,
      excluded_relationships: data.excluded_relationships,
      basis:
        "Entities and relationships from validated AI assessments (complete analyses only) plus header-derived " +
        "people. People are linked across emails only by an identical verified e-mail address.",
    },
  };
}
