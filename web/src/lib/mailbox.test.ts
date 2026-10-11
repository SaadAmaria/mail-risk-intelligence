import { describe, expect, it } from "vitest";
import type { EmailListItem, EmailListResponse, FinalRiskLevel } from "@mri/shared";
import { riskCounts } from "./mailbox";

function item(id: string, level: FinalRiskLevel): EmailListItem {
  return {
    id,
    from: null,
    subject: null,
    date: null,
    source_kind: "eml",
    attachment_count: 0,
    missing_headers: [],
    processing: {
      status: "not_started",
      analysis_mode: null,
      provenance: null,
      model: null,
      prompt_version: null,
      updated_at: null,
      in_progress: false,
      run_count: 0,
      can_reprocess: true,
    },
    risk: {
      final_level: level,
      assessed: level !== "unassessed",
      ai_level: null,
      rules_level: "none",
      basis: "unassessed",
      escalated: false,
      needs_review: false,
      indicator_count: 0,
      finding_count: 0,
    },
  } as EmailListItem;
}

describe("riskCounts", () => {
  it("counts each level and reports complete when nothing was cut off", () => {
    const res: EmailListResponse = {
      emails: [item("a", "high"), item("b", "unassessed"), item("c", "unassessed")],
      total: 3,
      count: 3,
    };
    const c = riskCounts(res);
    expect(c.counts.high).toBe(1);
    expect(c.counts.unassessed).toBe(2);
    expect(c.counts.none).toBe(0);
    expect(c.complete).toBe(true);
  });

  it("marks counts incomplete when the list was capped, so they are not global totals", () => {
    const res: EmailListResponse = { emails: [item("a", "low")], total: 900, count: 1 };
    const c = riskCounts(res);
    expect(c.complete).toBe(false);
    expect(c.basedOn).toBe(1);
    expect(c.mailboxTotal).toBe(900);
  });
});
