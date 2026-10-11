import { describe, expect, it } from "vitest";
import { buildClaims } from "./claims";
import { assessedDetail, detail } from "../test/fixtures";

describe("buildClaims", () => {
  it("targets an AI quote only when its snippet is verifiably at its recorded position", () => {
    const good = buildClaims(assessedDetail()).find((c) => c.group === "ai")!;
    expect(good.target).not.toBeNull();
    const bad = buildClaims(assessedDetail({ badOffsets: true })).find((c) => c.group === "ai")!;
    expect(bad.target).toBeNull();
    expect(bad.quote).toBe(good.quote); // the quote is still shown
  });

  it("never gives header evidence a highlight target", () => {
    const d = detail();
    d.risk.indicators = [
      {
        id: "i1",
        rule_id: "r",
        category: "observation",
        label: "Header thing",
        detail: "",
        evidence: [{ email_id: "E1", where: "header", start: 0, end: 4, text: "From" }],
        related_email_ids: [],
        counts_toward_medium: false,
        sufficient_for_medium: false,
      },
    ];
    const [c] = buildClaims(d);
    expect(c!.where).toBe("header");
    expect(c!.target).toBeNull();
  });

  it("shows an identical passage once per indicator", () => {
    const d = detail();
    const ev = { email_id: "E1", where: "body" as const, start: 0, end: 5, text: "Hello" };
    d.risk.indicators = [
      {
        id: "i1",
        rule_id: "r",
        category: "action",
        label: "x",
        detail: "",
        evidence: [ev, { ...ev }],
        related_email_ids: [],
        counts_toward_medium: true,
        sufficient_for_medium: false,
      },
    ];
    expect(buildClaims(d)).toHaveLength(1);
  });

  it("drops evidence that belongs to another email", () => {
    const d = detail();
    d.risk.indicators = [
      {
        id: "i1",
        rule_id: "r",
        category: "action",
        label: "x",
        detail: "",
        evidence: [{ email_id: "OTHER", where: "body", start: 0, end: 5, text: "Hello" }],
        related_email_ids: [],
        counts_toward_medium: true,
        sufficient_for_medium: false,
      },
    ];
    expect(buildClaims(d)).toHaveLength(0);
  });
});
