import { describe, expect, it } from "vitest";
import type { EmailListItem } from "@mri/shared";
import { gEdge, gGraph, gNode } from "../../test/graphFixtures";
import { listItem, processing } from "../../test/fixtures";
import { graphMessages, rankRelationships, strongest, summarizeMailbox } from "./ledger";
import { buildGraphModel } from "./model";

const emails: EmailListItem[] = [
  listItem("E001", "high"),
  listItem("E004", "medium"),
  listItem("E007", "none"),
  listItem("E009", "unassessed", {
    processing: processing({ status: "degraded", analysis_mode: "degraded", provenance: "rules", automatic_checks_only: true }),
  }),
  listItem("E010", "unassessed"),
];
emails[0]!.processing = processing({ status: "complete", provenance: "recorded" });
emails[1]!.processing = processing({ status: "complete", provenance: "recorded" });
emails[2]!.processing = processing({ status: "complete", provenance: "recorded" });

describe("strongest", () => {
  it("orders flagged first, then not assessed, then no risk found", () => {
    expect(strongest(["none", "unassessed", "medium"])).toBe("medium");
    expect(strongest(["none", "unassessed"])).toBe("unassessed");
    expect(strongest(["none"])).toBe("none");
    expect(strongest([null, null])).toBe("unassessed");
  });
});

describe("rankRelationships", () => {
  const g = gGraph(
    [
      gNode("a", { label: "A", email_ids: ["E007"] }),
      gNode("b", { label: "B", email_ids: ["E007"] }),
      gNode("c", { label: "C", email_ids: ["E001"] }),
      gNode("d", { label: "D", email_ids: ["E001"] }),
      gNode("e", { label: "E", email_ids: ["E004"] }),
      gNode("f", { label: "F", email_ids: ["E004"] }),
    ],
    [
      gEdge("a", "b", { id: "a-none", predicate: "sent_email_to", email_ids: ["E007"] }),
      gEdge("e", "f", { id: "b-medium", email_ids: ["E004"] }),
      gEdge("c", "d", { id: "z-high", predicate: "sent_email_to", email_ids: ["E001"] }),
    ],
  );

  it("orders relationships by the risk of their source messages, then by id", () => {
    const ranked = rankRelationships(buildGraphModel(g), emails);
    expect(ranked.map((r) => r.edge.id)).toEqual(["z-high", "b-medium", "a-none"]);
    expect(ranked.map((r) => r.risk)).toEqual(["high", "medium", "none"]);
    expect(ranked[0]!.source.label).toBe("C");
  });

  it("treats a message missing from the list as not assessed, never as safe", () => {
    const ranked = rankRelationships(buildGraphModel(g), []);
    expect(ranked.every((r) => r.risk === "unassessed")).toBe(true);
  });

  it("does not depend on edge order", () => {
    const rev = { ...g, edges: [...g.edges].reverse() };
    expect(rankRelationships(buildGraphModel(rev), emails).map((r) => r.edge.id)).toEqual(
      rankRelationships(buildGraphModel(g), emails).map((r) => r.edge.id),
    );
  });
});

describe("summarizeMailbox and graphMessages", () => {
  it("counts only what the list says", () => {
    const s = summarizeMailbox(emails)!;
    expect(s).toEqual({ total: 5, aiAssessed: 3, aiRecorded: 3, aiLive: 0, automaticOnly: 1, notAnalyzed: 1 });
    expect(summarizeMailbox(null)).toBeNull();
  });

  it("lists every message that any entity appears in, joined with the real list", () => {
    const g = gGraph([gNode("a", { email_ids: ["E004", "E999"] }), gNode("b", { email_ids: ["E001"] })], []);
    const m = graphMessages(buildGraphModel(g), emails);
    expect(m.map((x) => x.id)).toEqual(["E001", "E004", "E999"]);
    expect(m.find((x) => x.id === "E999")!.known).toBe(false);
  });
});
