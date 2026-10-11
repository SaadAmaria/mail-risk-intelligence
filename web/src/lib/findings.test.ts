import { describe, expect, it } from "vitest";
import type { CrossEmailFinding } from "@mri/shared";
import { findingComparison } from "./findings";

const base: Omit<CrossEmailFinding, "rule_id" | "values"> = {
  id: "f",
  email_id: "E1",
  related_email_ids: ["E0"],
  identity: "consistent",
  vendor: { name: "V", domain: "v.example" },
  summary: "s",
  evidence: [],
};

describe("findingComparison", () => {
  it("uses only the values the server supplied for an account change", () => {
    const c = findingComparison({
      ...base,
      rule_id: "payment_account_changed",
      values: { prior_accounts: ["1111"], new_account: "2222", routing_unchanged: true, claims_bank_change: false },
    });
    expect(c.before).toEqual(["1111"]);
    expect(c.after).toBe("2222");
    expect(c.notes.map((n) => [n.label, n.value])).toEqual([
      ["Routing number", "Unchanged"],
      ["Message says bank details changed", "No"],
    ]);
  });

  it("does not invent notes when the server did not supply them", () => {
    const c = findingComparison({ ...base, rule_id: "payment_account_changed", values: { prior_accounts: [], new_account: "2" } });
    expect(c.notes).toEqual([]);
    expect(c.before).toEqual([]);
  });

  it("presents an amount anomaly as a heuristic with its ratio", () => {
    const c = findingComparison({
      ...base,
      rule_id: "invoice_amount_anomaly",
      values: { new_amount: 47300, prior_amounts: [12400, 13900], ratio: 3.4, heuristic: true },
    });
    expect(c.after).toBe("47,300");
    expect(c.before).toEqual(["12,400", "13,900"]);
    expect(c.caption).toBe("3.4× the largest earlier invoice · heuristic");
  });
});
