import { describe, expect, it } from "vitest";
import { gEdge, gGraph, gNode, sampleGraph } from "../../test/graphFixtures";
import { computeLayout, labelHalfWidth, NODE_RADIUS, shortLabel } from "./layout";
import { buildGraphModel } from "./model";

const entries = (m: Map<string, { x: number; y: number }>) => [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));

describe("computeLayout", () => {
  it("is deterministic: identical output on every run", () => {
    const m = buildGraphModel(sampleGraph());
    const a = computeLayout(m);
    const b = computeLayout(m);
    expect(entries(b.positions)).toEqual(entries(a.positions));
    expect(b.viewBox).toEqual(a.viewBox);
  });

  it("does not depend on the order the API returned nodes and edges in", () => {
    const g = sampleGraph();
    const a = computeLayout(buildGraphModel(g));
    const b = computeLayout(buildGraphModel({ ...g, nodes: [...g.nodes].reverse(), edges: [...g.edges].reverse() }));
    expect(entries(b.positions)).toEqual(entries(a.positions));
  });

  it("gives every node a finite position inside the view box", () => {
    const m = buildGraphModel(sampleGraph());
    const l = computeLayout(m);
    expect(l.positions.size).toBe(m.nodes.length);
    for (const p of l.positions.values()) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      expect(p.x - NODE_RADIUS).toBeGreaterThanOrEqual(l.viewBox.x);
      expect(p.x + NODE_RADIUS).toBeLessThanOrEqual(l.viewBox.x + l.viewBox.width);
      expect(p.y - NODE_RADIUS).toBeGreaterThanOrEqual(l.viewBox.y);
      expect(p.y + NODE_RADIUS).toBeLessThanOrEqual(l.viewBox.y + l.viewBox.height);
    }
  });

  it("keeps disconnected components apart (their boxes never overlap)", () => {
    const l = computeLayout(buildGraphModel(sampleGraph()));
    expect(l.boxes.length).toBe(3);
    for (let i = 0; i < l.boxes.length; i++) {
      for (let j = i + 1; j < l.boxes.length; j++) {
        const a = l.boxes[i]!;
        const b = l.boxes[j]!;
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlap).toBe(false);
      }
    }
  });

  it("separates the nodes of a connected component by at least a node diameter", () => {
    const l = computeLayout(buildGraphModel(sampleGraph()));
    const pts = [...l.positions.values()];
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        expect(Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y)).toBeGreaterThan(NODE_RADIUS * 2);
      }
    }
  });

  it("handles empty, single-node and edge-less graphs", () => {
    expect(computeLayout(buildGraphModel(gGraph([], []))).positions.size).toBe(0);
    const one = computeLayout(buildGraphModel(gGraph([gNode("a")], [])));
    expect(one.positions.get("a")).toBeDefined();
    const many = computeLayout(buildGraphModel(gGraph(Array.from({ length: 12 }, (_, i) => gNode(`n${i}`)), [])));
    expect(many.positions.size).toBe(12);
    // Rows wrap rather than producing one very wide strip.
    expect(many.viewBox.width).toBeLessThan(1000);
  });

  it("stays stable and finite for a larger synthetic graph (60 nodes)", () => {
    const nodes = Array.from({ length: 60 }, (_, i) => gNode(`n${String(i).padStart(2, "0")}`));
    const edges = nodes.slice(1).map((n, i) => gEdge(nodes[Math.floor(i / 3)]!.id, n.id));
    const a = computeLayout(buildGraphModel(gGraph(nodes, edges)));
    const b = computeLayout(buildGraphModel(gGraph([...nodes].reverse(), [...edges].reverse())));
    expect(entries(b.positions)).toEqual(entries(a.positions));
    for (const p of a.positions.values()) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });

  it("label helpers bound the drawn label and keep the full text elsewhere", () => {
    expect(shortLabel("short")).toBe("short");
    expect(shortLabel("billing@northgate-suppliers.com").length).toBeLessThanOrEqual(22);
    expect(shortLabel("billing@northgate-suppliers.com").endsWith("…")).toBe(true);
    expect(labelHalfWidth("x".repeat(100))).toBe(labelHalfWidth("x".repeat(22)));
  });
});
