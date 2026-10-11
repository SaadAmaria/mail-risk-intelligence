import { describe, expect, it } from "vitest";
import { gEdge, gGraph, gNode, sampleGraph } from "../../test/graphFixtures";
import { listItem } from "../../test/fixtures";
import { buildGraphModel, connectionsOf, resolveSources } from "./model";

describe("buildGraphModel", () => {
  it("preserves every API node and edge id and invents nothing", () => {
    const g = sampleGraph();
    const m = buildGraphModel(g);
    expect(m.nodes.map((n) => n.id).sort()).toEqual(g.nodes.map((n) => n.id).sort());
    expect(m.edges.map((e) => e.id).sort()).toEqual(g.edges.map((e) => e.id).sort());
    expect(m.droppedEdges).toBe(0);
    for (const n of m.nodes) expect(g.nodes.find((x) => x.id === n.id)).toBeTruthy();
  });

  it("carries origin, key basis and max risk through unchanged (no re-labelling)", () => {
    const m = buildGraphModel(sampleGraph());
    const hr = m.nodeById.get("person:email:hr@arcline.com")!;
    expect(hr).toMatchObject({ origin: "rules", keyBasis: "email_address", maxRisk: "none" });
    expect(m.nodeById.get("organization:name:arcline")).toMatchObject({ origin: "ai", maxRisk: "high" });
  });

  it("computes degree and connected components, keeping isolated nodes", () => {
    const m = buildGraphModel(sampleGraph());
    expect(m.nodeById.get("organization:name:arcline")!.degree).toBe(2);
    expect(m.nodeById.get("organization:name:northgate suppliers")!.degree).toBe(2);
    expect(m.nodeById.get("person:email:hr@arcline.com")!.degree).toBe(0);
    // one cluster of 4 (northgate, account, arcline, james) then two singletons
    expect(m.components.map((c) => c.length)).toEqual([4, 1, 1]);
    expect(m.nodes.length).toBe(6);
  });

  it("is independent of input ordering", () => {
    const g = sampleGraph();
    const shuffled = { ...g, nodes: [...g.nodes].reverse(), edges: [...g.edges].reverse() };
    const a = buildGraphModel(g);
    const b = buildGraphModel(shuffled);
    expect(b.nodes).toEqual(a.nodes);
    expect(b.edges).toEqual(a.edges);
    expect(b.components).toEqual(a.components);
  });

  it("handles 0 nodes, 0 edges, and nodes without edges", () => {
    expect(buildGraphModel(gGraph([], [])).components).toEqual([]);
    const only = buildGraphModel(gGraph([gNode("a"), gNode("b")], []));
    expect(only.components).toEqual([["a"], ["b"]]);
    expect(only.nodes.every((n) => n.degree === 0)).toBe(true);
  });

  it("drops (and counts) an edge whose endpoint is not a node, rather than drawing it", () => {
    const m = buildGraphModel(gGraph([gNode("a")], [gEdge("a", "ghost")]));
    expect(m.edges).toEqual([]);
    expect(m.droppedEdges).toBe(1);
    expect(m.nodeById.get("a")!.degree).toBe(0);
  });

  it("counts an edge once toward each endpoint and handles a self-pair safely", () => {
    const m = buildGraphModel(gGraph([gNode("a"), gNode("b")], [gEdge("a", "b"), gEdge("a", "a", { id: "self" })]));
    expect(m.nodeById.get("a")!.degree).toBe(2);
    expect(m.nodeById.get("b")!.degree).toBe(1);
  });

  it("does not merge nodes that merely look alike", () => {
    const m = buildGraphModel(gGraph([gNode("organization:name:northgate", { label: "Northgate" }), gNode("organization:name:northgate suppliers", { label: "Northgate" })], []));
    expect(m.nodes).toHaveLength(2);
  });
});

describe("resolveSources / connectionsOf", () => {
  it("joins source ids with the real email list and reports unknown ids", () => {
    const list = [listItem("E004", "medium", { subject: "Invoice #NS-4471" })];
    const [known, unknown] = resolveSources(["E999", "E004"], list).sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(known).toMatchObject({ id: "E004", known: true, subject: "Invoice #NS-4471", risk: "medium" });
    expect(unknown).toMatchObject({ id: "E999", known: false, subject: null, risk: null });
  });

  it("works before the email list has loaded", () => {
    expect(resolveSources(["E004"], null)).toEqual([{ id: "E004", known: false, subject: null, sender: null, date: null, risk: null }]);
  });

  it("lists incident relationships with direction and the other endpoint", () => {
    const m = buildGraphModel(sampleGraph());
    const conns = connectionsOf(m, "organization:name:arcline");
    expect(conns.map((c) => [c.direction, c.other?.label]).sort()).toEqual([
      ["in", "James"],
      ["in", "Northgate Suppliers Inc."],
    ]);
    expect(connectionsOf(m, "missing")).toEqual([]);
  });
});
