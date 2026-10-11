import { describe, expect, it } from "vitest";
import { buildClaims, resolveRelationshipEvidence } from "./claims";
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

describe("resolveRelationshipEvidence", () => {
  const QUOTE = "wire $13,900 to account 9902";
  function withRelationship(over: { badOffsets?: boolean; quote?: string; snippet?: string } = {}) {
    const d = assessedDetail({ badOffsets: over.badOffsets });
    d.relationships = [
      { key: "r1", predicate: "requests_transfer_to", source: "a", target: "b", evidence: [{ snippet_id: over.snippet ?? "s1", quote: over.quote ?? QUOTE }], also_in: [] },
    ];
    return d;
  }

  it("resolves a recorded relationship's evidence to a verified highlight target", () => {
    const r = resolveRelationshipEvidence(withRelationship(), "s1", QUOTE);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.claim.target).not.toBeNull();
    const d = withRelationship();
    expect(d.email.body.slice(r.claim.target!.start, r.claim.target!.end)).toBe(QUOTE);
  });

  it("never highlights when the snippet is not at its recorded position", () => {
    const r = resolveRelationshipEvidence(withRelationship({ badOffsets: true }), "s1", QUOTE);
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.claim.target).toBeNull();
      expect(r.claim.quote).toBe(QUOTE); // still shown as a quote
    }
  });

  it("does not trust a quote or snippet id that is not evidence of one of the email's relationships", () => {
    expect(resolveRelationshipEvidence(withRelationship(), "s1", "something I made up in the URL")).toEqual({ status: "unavailable", reason: "not_a_recorded_relationship" });
    expect(resolveRelationshipEvidence(withRelationship(), "s9", QUOTE)).toEqual({ status: "unavailable", reason: "not_a_recorded_relationship" });
  });

  it("reports a stale reference whose snippet no longer exists, and a missing extraction", () => {
    const stale = withRelationship({ snippet: "s7" });
    expect(resolveRelationshipEvidence(stale, "s7", QUOTE)).toEqual({ status: "unavailable", reason: "unknown_snippet" });
    const noEx = withRelationship();
    noEx.extraction = null;
    expect(resolveRelationshipEvidence(noEx, "s1", QUOTE)).toEqual({ status: "unavailable", reason: "no_extraction" });
  });

  it("produces no target for header evidence", () => {
    const d = withRelationship();
    d.extraction!.evidence_snippets[0] = { ...d.extraction!.evidence_snippets[0]!, location: { where: "header", start: 0, end: 5 } };
    const r = resolveRelationshipEvidence(d, "s1", QUOTE);
    expect(r.status === "ok" && r.claim.target).toBeNull();
  });
});
