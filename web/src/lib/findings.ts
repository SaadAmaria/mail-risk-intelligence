import type { CrossEmailFinding } from "@mri/shared";

export interface FactRow {
  label: string;
  value: string;
}

const yesNo = (v: unknown): string => (v === true ? "Yes" : v === false ? "No" : "Unknown");
const list = (v: unknown): string =>
  Array.isArray(v) && v.length ? v.map((x) => (typeof x === "number" ? x.toLocaleString("en-US") : String(x))).join(", ") : "None";
const num = (v: unknown): string => (typeof v === "number" ? v.toLocaleString("en-US") : "Unknown");

/**
 * The values a cross-email finding is based on, as labelled rows. Only values the server
 * computed are shown; nothing is derived here.
 */
export function findingFacts(f: CrossEmailFinding): FactRow[] {
  const v = f.values;
  if (f.rule_id === "payment_account_changed") {
    return [
      { label: "Account on earlier invoices", value: list(v.prior_accounts) },
      { label: "Account in this message", value: String(v.new_account ?? "Unknown") },
      { label: "Routing number unchanged", value: yesNo(v.routing_unchanged) },
      { label: "Message says bank details changed", value: yesNo(v.claims_bank_change) },
    ];
  }
  const rows: FactRow[] = [
    { label: "Amount in this message", value: num(v.new_amount) },
    { label: "Amounts on earlier invoices", value: list(v.prior_amounts) },
    { label: "Compared with earlier", value: typeof v.ratio === "number" ? `${v.ratio}×` : "Unknown" },
  ];
  if (v.heuristic === true) rows.push({ label: "Kind of check", value: "Heuristic, not proof" });
  return rows;
}
