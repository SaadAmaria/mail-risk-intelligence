import type { CrossEmailFinding } from "@mri/shared";

export interface Comparison {
  kind: "account" | "amount";
  beforeLabel: string;
  before: string[];
  afterLabel: string;
  after: string;
  /** Short qualitative notes, each a labelled yes/no or value taken from the finding. */
  notes: { label: string; value: string; tone: "neutral" | "same" | "changed" }[];
  /** Extra caption for a heuristic check, e.g. "3.4× the largest earlier invoice". */
  caption: string | null;
}

const fmt = (v: unknown): string =>
  typeof v === "number" ? v.toLocaleString("en-US") : v === null || v === undefined ? "Unknown" : String(v);

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(fmt) : []);

/**
 * The values a cross-email finding rests on, arranged as "earlier → this message". Only values
 * the server computed are used; nothing is derived or assumed here.
 */
export function findingComparison(f: CrossEmailFinding): Comparison {
  const v = f.values;
  if (f.rule_id === "payment_account_changed") {
    const notes: Comparison["notes"] = [];
    if (typeof v.routing_unchanged === "boolean") {
      notes.push({
        label: "Routing number",
        value: v.routing_unchanged ? "Unchanged" : "Changed",
        tone: v.routing_unchanged ? "same" : "changed",
      });
    }
    if (typeof v.claims_bank_change === "boolean") {
      notes.push({
        label: "Message says bank details changed",
        value: v.claims_bank_change ? "Yes" : "No",
        tone: "neutral",
      });
    }
    return {
      kind: "account",
      beforeLabel: "Account on earlier invoices",
      before: list(v.prior_accounts),
      afterLabel: "Account in this message",
      after: fmt(v.new_account),
      notes,
      caption: null,
    };
  }
  const ratio = typeof v.ratio === "number" ? `${v.ratio}× the largest earlier invoice` : null;
  return {
    kind: "amount",
    beforeLabel: "Amounts on earlier invoices",
    before: list(v.prior_amounts),
    afterLabel: "Amount in this message",
    after: fmt(v.new_amount),
    notes: [],
    caption: v.heuristic === true && ratio ? `${ratio} · heuristic` : ratio,
  };
}
