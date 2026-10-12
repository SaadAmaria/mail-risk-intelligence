import { describe, expect, it } from "vitest";
import { gEdge, gGraph, gNode, sampleGraph } from "../../test/graphFixtures";
import { activeFilterCount, applyFilters, isFiltering, NO_FILTERS, typeCounts } from "./filters";
import { buildGraphModel } from "./model";

const full = () => buildGraphModel(sampleGraph());
const ids = (m: { nodes: { id: string }[] }) => m.nodes.map((n) => n.id).sort();

describe("applyFilters", () => {
  it("with no filters returns everything unchanged", () => {
    const m = full();
    const f = applyFilters(m, NO_FILTERS);
    expect(ids(f.model)).toEqual(ids(m));
    expect(f.model.edges.length).toBe(m.edges.length);
    expect(f.hiddenNodes).toBe(0);
    expect(f.hiddenEdges).toBe(0);
    expect(isFiltering(NO_FILTERS)).toBe(false);
  });

  it("filters by entity type", () => {
    const f = applyFilters(full(), { ...NO_FILTERS, types: ["organization"] });
    expect(f.model.nodes.every((n) => n.type === "organization")).toBe(true);
    expect(f.model.nodes.length).toBe(2);
    expect(f.hiddenNodes).toBe(4);
  });

  it("filters by source origin (AI vs automatic)", () => {
    const ai = applyFilters(full(), { ...NO_FILTERS, origins: ["ai"] });
    expect(ai.model.nodes.every((n) => n.origin === "ai")).toBe(true);
    const rules = applyFilters(full(), { ...NO_FILTERS, origins: ["rules"] });
    expect(rules.model.nodes.every((n) => n.origin === "rules")).toBe(true);
    expect(ai.model.nodes.length + rules.model.nodes.length).toBe(6);
  });

  it("filters by risk signal, keeping 'none' and 'unassessed' distinct", () => {
    const g = sampleGraph();
    g.nodes.push(gNode("person:email:u@x.com", { type: "person", label: "u@x.com", origin: "rules", max_risk: "unassessed" }));
    const m = buildGraphModel(g);
    expect(applyFilters(m, { ...NO_FILTERS, risks: ["none"] }).model.nodes.map((n) => n.label)).toEqual(["hr@arcline.com"]);
    expect(applyFilters(m, { ...NO_FILTERS, risks: ["unassessed"] }).model.nodes.map((n) => n.label)).toEqual(["u@x.com"]);
    expect(applyFilters(m, { ...NO_FILTERS, risks: ["high"] }).model.nodes.length).toBe(2);
  });

  it("searches entity labels, case- and whitespace-insensitively, as a substring", () => {
    const f = applyFilters(full(), { ...NO_FILTERS, q: "  NORTHGATE  " });
    expect(f.model.nodes.map((n) => n.label).sort()).toEqual(["Northgate Suppliers Inc.", "billing@northgate-suppliers.com"]);
    expect(applyFilters(full(), { ...NO_FILTERS, q: "zzz" }).model.nodes).toEqual([]);
  });

  it("connected-only keeps entities with a relationship to another visible entity", () => {
    const f = applyFilters(full(), { ...NO_FILTERS, connectedOnly: true });
    expect(f.model.nodes.length).toBe(4);
    expect(f.model.nodes.every((n) => n.degree > 0)).toBe(true);
  });

  it("connected-only is evaluated after the other filters (no edge to a hidden entity counts)", () => {
    const f = applyFilters(full(), { ...NO_FILTERS, types: ["organization"], connectedOnly: true });
    // Northgate and Arcline are linked to each other (organization -> organization).
    expect(f.model.nodes.map((n) => n.label).sort()).toEqual(["Arcline", "Northgate Suppliers Inc."]);
    expect(f.model.edges.length).toBe(1);
    const only = applyFilters(full(), { ...NO_FILTERS, types: ["account"], connectedOnly: true });
    expect(only.model.nodes).toEqual([]);
  });

  it("never leaves an edge whose endpoint is hidden, and recomputes degree for what remains", () => {
    const f = applyFilters(full(), { ...NO_FILTERS, types: ["organization", "account"] });
    for (const e of f.model.edges) {
      expect(f.visibleIds.has(e.source) && f.visibleIds.has(e.target)).toBe(true);
    }
    const arc = f.model.nodeById.get("organization:name:arcline")!;
    expect(arc.degree).toBe(1); // James is hidden, Northgate remains
    expect(f.hiddenEdges).toBe(1);
  });

  it("combines filters conjunctively and reports a count of active filters", () => {
    const f = { ...NO_FILTERS, types: ["person"], origins: ["rules"], risks: ["high"] };
    expect(applyFilters(full(), f).model.nodes.map((n) => n.label)).toEqual([]);
    expect(activeFilterCount(f)).toBe(3);
    expect(activeFilterCount({ ...f, q: "x", connectedOnly: true })).toBe(5);
  });

  it("is order-independent and does not mutate the full model", () => {
    const m = full();
    const before = JSON.stringify(m.nodes);
    const a = applyFilters(m, { ...NO_FILTERS, origins: ["ai"] });
    const g = sampleGraph();
    const b = applyFilters(buildGraphModel({ ...g, nodes: [...g.nodes].reverse(), edges: [...g.edges].reverse() }), { ...NO_FILTERS, origins: ["ai"] });
    expect(ids(a.model)).toEqual(ids(b.model));
    expect(JSON.stringify(m.nodes)).toBe(before);
  });

  it("counts entity types in a stable order for the controls", () => {
    expect(typeCounts(full())).toEqual([
      { type: "person", count: 3 },
      { type: "organization", count: 2 },
      { type: "account", count: 1 },
    ]);
    expect(typeCounts(buildGraphModel(gGraph([gNode("a", { type: "amount" }), gNode("b", { type: "person" })], [gEdge("a", "b")])))).toEqual([
      { type: "person", count: 1 },
      { type: "amount", count: 1 },
    ]);
  });
});

describe("filters keep each relationship's review metadata", () => {
  const support = { participants: "none" as const, order: "unknown" as const, wording: "none_found" as const, review: true, notes: ["n"] };
  const m = () =>
    buildGraphModel(
      gGraph(
        [gNode("o:n", { label: "Northgate" }), gNode("o:a", { label: "Arcline" }), gNode("o:z", { label: "Zeta" })],
        [
          gEdge("o:n", "o:a", { id: "legacy", review: true }), // edge-level flag only, no per-quote metadata
          gEdge("o:a", "o:z", { id: "quote", evidence: [{ email_id: "E004", snippet_id: "s9", quote: "q", support }] }),
          gEdge("o:n", "o:z", { id: "clean" }),
        ],
      ),
    );

  it.each([
    ["no filters", NO_FILTERS],
    ["a search", { ...NO_FILTERS, q: "a" }],
    ["connected only", { ...NO_FILTERS, connectedOnly: true }],
  ])("%s: flags and per-quote support survive unchanged", (_n, f) => {
    const out = applyFilters(m(), f).model;
    const by = (id: string) => out.edgeById.get(id)!;
    expect(by("legacy").review).toBe(true);
    expect(by("quote").review).toBe(true);
    expect(by("quote").evidence[0]!.support).toEqual(support);
    expect(by("clean").review).toBe(false);
  });
});
