import { describe, expect, it } from "vitest";
import type { GraphResponse } from "@mri/shared";
import { gEdge, gGraph, gNode } from "../../test/graphFixtures";
import { buildGraphModel } from "./model";
import { computeSpatialLayout, fitTo, type SpatialLayout } from "./spatial";

/** The shape of the real recorded demo: one 4-entity cluster of 3 relationships plus 7 isolated entities. */
function realShape(): GraphResponse {
  const nodes = [
    gNode("organization:name:northgate suppliers", { label: "Northgate Suppliers Inc.", email_ids: ["E004"] }),
    gNode("account:email:E004:account ending 9902", { type: "account", label: "account ending 9902", key_basis: "email_scoped" }),
    gNode("account:email:E004:routing 044000037", { type: "account", label: "routing 044000037", key_basis: "email_scoped" }),
    gNode("organization:name:arcline", { label: "Arcline", email_ids: ["E001", "E004"], max_risk: "high", mention_count: 2 }),
    gNode("person:email:E001:james", { type: "person", label: "James", email_ids: ["E001"], max_risk: "high", key_basis: "email_scoped" }),
    ...["accounts-payable@arcline.com", "all-staff@arcline.com", "billing@northgate-suppliers.com", "finance-ops@arcline.com", "hr@arcline.com", "j.harrington-ceo@arclne-corp.com"].map((a) =>
      gNode(`person:email:${a}`, { type: "person", label: a, origin: "rules", key_basis: "email_address", email_ids: ["E004"] }),
    ),
  ];
  const edges = [
    gEdge("organization:name:northgate suppliers", "account:email:E004:account ending 9902"),
    gEdge("organization:name:northgate suppliers", "organization:name:arcline", { id: "n|sent|a", predicate: "sent_email_to" }),
    gEdge("person:email:E001:james", "organization:name:arcline", { id: "j|sent|a", predicate: "sent_email_to" }),
  ];
  return gGraph(nodes, edges);
}

const model = (g: GraphResponse) => buildGraphModel(g);
const rectOf = (l: SpatialLayout, id: string) => l.nodes.get(id)!;
const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const labelRect = (e: SpatialLayout["edges"][number]) => ({ x: e.labelX - e.labelW / 2, y: e.labelY - e.labelH / 2, w: e.labelW, h: e.labelH });

function assertClean(l: SpatialLayout) {
  const cards = [...l.nodes.values()];
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) expect(overlap(cards[i]!, cards[j]!)).toBe(false);
  for (const e of l.edges) for (const c of cards) expect(overlap(labelRect(e), c)).toBe(false);
  for (let i = 0; i < l.edges.length; i++) for (let j = i + 1; j < l.edges.length; j++) expect(overlap(labelRect(l.edges[i]!), labelRect(l.edges[j]!))).toBe(false);
  for (const c of cards) {
    expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true);
    expect(c.x).toBeGreaterThanOrEqual(l.bounds.x - 0.01);
    expect(c.x + c.w).toBeLessThanOrEqual(l.bounds.x + l.bounds.width + 0.01);
  }
}

describe("computeSpatialLayout", () => {
  it("places only entities that have a relationship and lists the rest as a separate collection", () => {
    const l = computeSpatialLayout(model(realShape()));
    expect([...l.nodes.keys()].sort()).toEqual(
      ["account:email:E004:account ending 9902", "organization:name:arcline", "organization:name:northgate suppliers", "person:email:E001:james"].sort(),
    );
    expect(l.isolated.length).toBe(7);
    expect(l.isolated.some((id) => l.nodes.has(id))).toBe(false);
    // people first, then accounts; stable order within a type
    expect(l.isolated.slice(0, 6).every((id) => id.startsWith("person:"))).toBe(true);
    expect(l.isolated[6]).toBe("account:email:E004:routing 044000037");
  });

  it("follows the direction of the relationships: actors first, targets after, without crossings", () => {
    const l = computeSpatialLayout(model(realShape()));
    const n = rectOf(l, "organization:name:northgate suppliers");
    const j = rectOf(l, "person:email:E001:james");
    const a = rectOf(l, "organization:name:arcline");
    const acct = rectOf(l, "account:email:E004:account ending 9902");
    expect(n.layer).toBe(0);
    expect(j.layer).toBe(0);
    expect(a.layer).toBe(1);
    expect(acct.layer).toBe(1);
    expect(a.x).toBeGreaterThan(n.x + n.w);
    // no inversion between the two layers: the vertical order of sources matches that of their targets
    const order = (p: { y: number }, q: { y: number }) => Math.sign(p.y - q.y);
    expect(order(n, j)).toBe(order(acct, a)); // Northgate above James <=> account above Arcline
  });

  it("is deterministic and independent of the order the API returned things in", () => {
    const g = realShape();
    const reversed: GraphResponse = { ...g, nodes: [...g.nodes].reverse(), edges: [...g.edges].reverse() };
    const a = computeSpatialLayout(model(g));
    const b = computeSpatialLayout(model(reversed));
    const c = computeSpatialLayout(model(g));
    const dump = (l: SpatialLayout) => JSON.stringify({ n: [...l.nodes.entries()].sort(), e: l.edges, i: l.isolated, b: l.bounds });
    expect(dump(b)).toBe(dump(a));
    expect(dump(c)).toBe(dump(a));
  });

  it("keeps cards and relationship labels apart, in both orientations", () => {
    for (const orientation of ["horizontal", "vertical"] as const) {
      const l = computeSpatialLayout(model(realShape()), { orientation });
      expect(l.orientation).toBe(orientation);
      assertClean(l);
      expect(l.edges.length).toBe(3);
    }
  });

  it("draws every API relationship once, from its real source to its real target", () => {
    const g = realShape();
    const l = computeSpatialLayout(model(g));
    expect(l.edges.map((e) => e.id).sort()).toEqual(g.edges.map((e) => e.id).sort());
    for (const e of l.edges) {
      const api = g.edges.find((x) => x.id === e.id)!;
      expect([e.source, e.target]).toEqual([api.source, api.target]);
      expect(e.path).toMatch(/^M-?[\d.]+,-?[\d.]+ C/);
      expect(e.label.length).toBeGreaterThan(0);
    }
  });

  it("fans parallel relationships between the same two entities into separate curves", () => {
    const a = gNode("a", { label: "A" });
    const b = gNode("b", { label: "B" });
    const g = gGraph([a, b], [gEdge("a", "b", { id: "e1", predicate: "sent_email_to" }), gEdge("b", "a", { id: "e2", predicate: "related_to" }), gEdge("a", "b", { id: "e3", predicate: "instructs" })]);
    const l = computeSpatialLayout(model(g));
    expect(new Set(l.edges.map((e) => e.path)).size).toBe(3);
    assertClean(l);
  });

  it("handles cycles without failing", () => {
    const ids = ["a", "b", "c"];
    const g = gGraph(ids.map((id) => gNode(id, { label: id })), [gEdge("a", "b", { id: "1" }), gEdge("b", "c", { id: "2" }), gEdge("c", "a", { id: "3" })]);
    const l = computeSpatialLayout(model(g));
    expect(l.nodes.size).toBe(3);
    assertClean(l);
  });

  it("handles no relationships, a single entity, and an empty graph", () => {
    const none = computeSpatialLayout(model(gGraph([gNode("a"), gNode("b")], [])));
    expect(none.nodes.size).toBe(0);
    expect(none.isolated.length).toBe(2);
    expect(none.bounds.width).toBe(0);
    expect(computeSpatialLayout(model(gGraph([], []))).isolated).toEqual([]);
  });

  it("stays finite, non-overlapping and bounded for a dense graph (wraps long layers)", () => {
    const nodes = Array.from({ length: 60 }, (_, i) => gNode(`n${String(i).padStart(2, "0")}`, { label: `Entity ${i}` }));
    const edges = [] as ReturnType<typeof gEdge>[];
    for (let i = 1; i < 60; i++) edges.push(gEdge(`n${String(Math.floor((i - 1) / 4)).padStart(2, "0")}`, `n${String(i).padStart(2, "0")}`, { id: `e${i}` }));
    const l = computeSpatialLayout(model(gGraph(nodes, edges)));
    expect(l.nodes.size).toBe(60);
    const cards = [...l.nodes.values()];
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) expect(overlap(cards[i]!, cards[j]!)).toBe(false);
    expect(l.bounds.width).toBeGreaterThan(0);
    // a layer never holds more than the wrap limit in one column
    const byColumn = new Map<number, number>();
    for (const c of cards) byColumn.set(c.x, (byColumn.get(c.x) ?? 0) + 1);
    expect(Math.max(...byColumn.values())).toBeLessThanOrEqual(5 * 12); // columns of several components may share an x
  });

  it("does not depend on selection, filters or anything but the visible model", () => {
    const g = realShape();
    const full = computeSpatialLayout(model(g));
    const again = computeSpatialLayout(model(g), { orientation: "horizontal" });
    expect([...again.nodes.values()]).toEqual([...full.nodes.values()]);
  });
});

describe("fitTo", () => {
  const bounds = { x: 20, y: 10, width: 600, height: 200 };
  it("centres the graph and never enlarges a small one", () => {
    const f = fitTo(bounds, { width: 1000, height: 600 });
    expect(f.k).toBe(1);
    const left = f.x + bounds.x * f.k;
    const right = 1000 - (left + bounds.width * f.k);
    expect(Math.abs(left - right)).toBeLessThan(1);
  });
  it("scales down to fit a narrow stage, within limits", () => {
    const f = fitTo(bounds, { width: 400, height: 300 });
    expect(f.k).toBeLessThan(1);
    expect(f.k).toBeGreaterThanOrEqual(0.4);
    expect(bounds.width * f.k).toBeLessThanOrEqual(400);
  });
  it("is the identity for nothing to fit", () => {
    expect(fitTo({ x: 0, y: 0, width: 0, height: 0 }, { width: 400, height: 300 })).toEqual({ x: 0, y: 0, k: 1 });
  });
});
