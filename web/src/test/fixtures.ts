import type {
  EmailDetailResponse,
  EmailListItem,
  EmailListResponse,
  FinalRiskLevel,
  HealthResponse,
  ProcessingSummary,
} from "@mri/shared";

export function processing(over: Partial<ProcessingSummary> = {}): ProcessingSummary {
  return {
    status: "not_started",
    analysis_mode: null,
    provenance: null,
    model: null,
    prompt_version: null,
    updated_at: null,
    in_progress: false,
    run_count: 0,
    can_reprocess: true,
    ...over,
  };
}

export function listItem(id: string, level: FinalRiskLevel = "unassessed", over: Partial<EmailListItem> = {}): EmailListItem {
  return {
    id,
    from: { address: `${id}@example.com`, name: `Sender ${id}` },
    subject: `Subject ${id}`,
    date: "2026-06-04T11:20:00Z",
    source_kind: "seed",
    attachment_count: 0,
    missing_headers: [],
    processing: processing(),
    risk: {
      final_level: level,
      assessed: false,
      ai_level: null,
      rules_level: "none",
      basis: level === "unassessed" ? "unassessed" : "rules_only",
      escalated: false,
      needs_review: false,
      indicator_count: 0,
      finding_count: 0,
    },
    ...over,
  };
}

export function listResponse(items: EmailListItem[], total = items.length): EmailListResponse {
  return { emails: items, total, count: items.length };
}

export const HEALTH_RECORDED: HealthResponse = {
  status: "ok",
  service: "mail-risk-intelligence",
  llm: { configured: false, provider: null, model: null, reachability: "unchecked" },
  replay: { available: true, email_ids: ["E1"], model: "recorded-model", captured_at: null, problems: [] },
};

export const HEALTH_AI: HealthResponse = {
  status: "ok",
  service: "mail-risk-intelligence",
  llm: { configured: true, provider: "groq", model: "m", reachability: "unchecked" },
};

export const BODY = "Hello team,\nPlease wire $13,900 to account 9902 today.\nThanks";

export function detail(over: Partial<EmailDetailResponse> = {}): EmailDetailResponse {
  const base: EmailDetailResponse = {
    email: {
      id: "E1",
      external_id: "E1",
      source_kind: "seed",
      source_filename: null,
      from: { address: "vendor@example.com", name: "Vendor" },
      to: [{ address: "ap@example.com", name: null }],
      cc: [],
      date: "2026-06-04T11:20:00Z",
      subject: "Invoice",
      body: BODY,
      body_truncated: false,
      missing_headers: [],
      warnings: [],
      attachments: [],
      created_at: "2026-06-04T11:20:00Z",
    },
    processing: { ...processing(), warnings: [], runs: [] },
    extraction: null,
    assessment: null,
    risk: {
      email_id: "E1",
      assessed: false,
      ai_status: null,
      ai_level: null,
      rules_level: "none",
      final_level: "unassessed",
      basis: "unassessed",
      escalated: false,
      escalations: [],
      disagreement: null,
      indicators: [],
      findings: [],
    },
    entities: [],
    relationships: [],
  };
  return { ...base, ...over };
}

/** A completed AI assessment citing a quote that really sits in BODY, plus one that does not. */
export function assessedDetail(
  opts: { badOffsets?: boolean; provenance?: "live" | "recorded" } = {},
): EmailDetailResponse {
  const quote = "wire $13,900 to account 9902";
  const at = BODY.indexOf(quote);
  const start = opts.badOffsets ? at + 5 : at;
  const d = detail();
  d.processing = { ...processing({ status: "complete", provenance: opts.provenance ?? "live", can_reprocess: false, run_count: 1 }), warnings: [], runs: [] };
  d.extraction = {
    schema_version: 1,
    sender: null,
    recipients: [],
    date: null,
    subject: null,
    missing_headers: [],
    summary: "A request to wire money.",
    facts: { amounts: [], dates: [], references: [], attachments: [] },
    evidence_snippets: [
      { id: "s1", text: quote, location: { where: "body", start, end: start + quote.length }, origin: "llm" },
    ],
    notes: [],
  };
  d.assessment = {
    schema_version: 1,
    risk: {
      level: "high",
      rationale: "Asks for an urgent wire to a new account.",
      tags: ["payment-redirect"],
      evidence: [{ snippet_id: "s1", quote }],
      confidence: "high",
    },
    entities: [],
    relationships: [],
  };
  d.risk = {
    ...d.risk,
    assessed: true,
    ai_status: "complete",
    ai_level: "high",
    final_level: "high",
    basis: "ai_and_rules",
  };
  return d;
}
