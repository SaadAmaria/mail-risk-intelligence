import { predicateLabel } from "../copy";
import type { GraphModel } from "./model";
import type { Box } from "./viewport";

/**
 * Deterministic, relationship-focused layout for the spatial canvas.
 *
 * Entities that have at least one relationship are arranged in layers that follow the direction
 * of the relationships (who acts on what). Entities with no relationship are NOT placed here:
 * they are returned in `isolated` so the page can present them as a clearly labelled secondary
 * collection instead of letting them dilute the connected structure.
 *
 * Everything depends only on sorted ids: the same graph always gives the same coordinates, and
 * input order, selection and filtering state cannot move anything. Nothing is invented: every
 * path is a real API edge between two real API nodes.
 */

export type Orientation = "horizontal" | "vertical";

export interface SpatialOptions {
  orientation?: Orientation;
  cardW?: number;
  cardH?: number;
  /** Space between consecutive layers along the flow direction. */
  layerGap?: number;
  /** Space between cards of one layer. */
  crossGap?: number;
  componentGap?: number;
  /** A layer with more cards than this wraps into additional adjacent layers. */
  maxPerLayer?: number;
}

export interface SpatialNode {
  id: string;
  /** Top-left corner of the card. */
  x: number;
  y: number;
  w: number;
  h: number;
  layer: number;
  component: number;
}

export interface SpatialEdge {
  id: string;
  source: string;
  target: string;
  /** SVG path (cubic Bézier) from the source card edge to the target card edge. */
  path: string;
  /** Centre of the relationship label. */
  labelX: number;
  labelY: number;
  labelW: number;
  labelH: number;
  label: string;
}

export interface SpatialLayout {
  orientation: Orientation;
  nodes: Map<string, SpatialNode>;
  edges: SpatialEdge[];
  /** Ids of entities without any relationship, in a stable presentational order. */
  isolated: string[];
  /** Bounding box of every card and label of the connected structure. */
  bounds: Box;
  cardW: number;
  cardH: number;
}

const DEFAULTS: Record<Orientation, Required<Omit<SpatialOptions, "orientation">>> = {
  horizontal: { cardW: 248, cardH: 92, layerGap: 184, crossGap: 36, componentGap: 72, maxPerLayer: 5 },
  vertical: { cardW: 156, cardH: 112, layerGap: 120, crossGap: 16, componentGap: 56, maxPerLayer: 2 },
};

const TYPE_ORDER = ["person", "organization", "account", "location", "amount"];
const LABEL_H = 28;
const LABEL_CHAR_W = 7.2;
const LABEL_MAX_W = 190;

const r1 = (n: number) => Math.round(n * 10) / 10;
const byStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Longest-path layers. Back edges found by a DFS in sorted order are ignored (cycle breaking). */
function layerize(ids: string[], edges: { source: string; target: string }[]): Map<string, number> {
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) if (e.source !== e.target) out.get(e.source)?.push(e.target);
  for (const list of out.values()) list.sort(byStr);

  const state = new Map<string, 0 | 1 | 2>(); // 1 = on stack, 2 = done
  const back = new Set<string>();
  const visit = (u: string): void => {
    state.set(u, 1);
    for (const v of out.get(u) ?? []) {
      const st = state.get(v);
      if (st === 1) back.add(`${u}\u0000${v}`);
      else if (st === undefined) visit(v);
    }
    state.set(u, 2);
  };
  for (const id of ids) if (!state.has(id)) visit(id);

  const forward = edges.filter((e) => e.source !== e.target && !back.has(`${e.source}\u0000${e.target}`));
  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  // Relaxation over a DAG converges in at most |V| passes.
  for (let pass = 0; pass < ids.length; pass++) {
    let changed = false;
    for (const e of forward) {
      const next = (layer.get(e.source) ?? 0) + 1;
      if (next > (layer.get(e.target) ?? 0)) {
        layer.set(e.target, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return layer;
}

/** Barycentre ordering of each layer (a fixed number of sweeps, ties broken by id). */
function orderLayers(layers: string[][], edges: { source: string; target: string }[]): string[][] {
  const neighbours = new Map<string, string[]>();
  for (const e of edges) {
    if (e.source === e.target) continue;
    (neighbours.get(e.source) ?? neighbours.set(e.source, []).get(e.source)!).push(e.target);
    (neighbours.get(e.target) ?? neighbours.set(e.target, []).get(e.target)!).push(e.source);
  }
  const out = layers.map((l) => [...l].sort(byStr));
  const indexIn = (l: number) => new Map(out[l]!.map((id, i) => [id, i]));

  const sweep = (l: number, ref: number) => {
    const refIdx = indexIn(ref);
    const cur = indexIn(l);
    const key = (id: string): number => {
      const ns = (neighbours.get(id) ?? []).filter((n) => refIdx.has(n));
      if (ns.length === 0) return cur.get(id)!;
      return ns.reduce((sum, n) => sum + refIdx.get(n)!, 0) / ns.length;
    };
    const keys = new Map(out[l]!.map((id) => [id, key(id)]));
    out[l] = [...out[l]!].sort((a, b) => keys.get(a)! - keys.get(b)! || byStr(a, b));
  };

  for (let s = 0; s < 4; s++) {
    for (let l = 1; l < out.length; l++) sweep(l, l - 1);
    for (let l = out.length - 2; l >= 0; l--) sweep(l, l + 1);
  }
  return out;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Pt = { x: number; y: number };

function at(p: [Pt, Pt, Pt, Pt], t: number): Pt {
  const u = 1 - t;
  const [p0, p1, p2, p3] = p;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt) {
  const pts: [Pt, Pt, Pt, Pt] = [p0, p1, p2, p3];
  const d = `M${r1(p0.x)},${r1(p0.y)} C${r1(p1.x)},${r1(p1.y)} ${r1(p2.x)},${r1(p2.y)} ${r1(p3.x)},${r1(p3.y)}`;
  return { d, pts };
}

function connector(a: Rect, b: Rect, orientation: Orientation, offset: number) {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const sepX = Math.abs(bc.x - ac.x) > (a.w + b.w) / 2;
  const sepY = Math.abs(bc.y - ac.y) > (a.h + b.h) / 2;
  const useHorizontal = orientation === "horizontal" ? sepX || !sepY : !sepY && sepX;

  if (useHorizontal) {
    const dir = bc.x >= ac.x ? 1 : -1;
    const p0 = { x: dir > 0 ? a.x + a.w : a.x, y: ac.y };
    const p3 = { x: dir > 0 ? b.x : b.x + b.w, y: bc.y };
    const c = Math.max(48, Math.abs(p3.x - p0.x) * 0.5);
    return cubic(p0, { x: p0.x + dir * c, y: p0.y + offset }, { x: p3.x - dir * c, y: p3.y + offset }, p3);
  }
  const dir = bc.y >= ac.y ? 1 : -1;
  const p0 = { x: ac.x, y: dir > 0 ? a.y + a.h : a.y };
  const p3 = { x: bc.x, y: dir > 0 ? b.y : b.y + b.h };
  const c = Math.max(32, Math.abs(p3.y - p0.y) * 0.5);
  return cubic(p0, { x: p0.x + offset, y: p0.y + dir * c }, { x: p3.x + offset, y: p3.y - dir * c }, p3);
}

export function computeSpatialLayout(model: GraphModel, opts: SpatialOptions = {}): SpatialLayout {
  const orientation = opts.orientation ?? "horizontal";
  const d = DEFAULTS[orientation];
  const cardW = opts.cardW ?? d.cardW;
  const cardH = opts.cardH ?? d.cardH;
  const layerGap = opts.layerGap ?? d.layerGap;
  const crossGap = opts.crossGap ?? d.crossGap;
  const componentGap = opts.componentGap ?? d.componentGap;
  const maxPerLayer = Math.max(1, opts.maxPerLayer ?? d.maxPerLayer);

  const isolated = model.nodes
    .filter((n) => n.degree === 0)
    .sort(
      (a, b) =>
        TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) ||
        a.label.toLowerCase().localeCompare(b.label.toLowerCase()) ||
        byStr(a.id, b.id),
    )
    .map((n) => n.id);

  const nodes = new Map<string, SpatialNode>();
  let yCursor = 0;
  let maxExtent = 0;
  const widthOf = new Map<number, number>();

  const componentIds = model.components.filter((c) => c.length > 1 || (model.nodeById.get(c[0]!)?.degree ?? 0) > 0);
  componentIds.forEach((ids, ci) => {
    const idSet = new Set(ids);
    const edges = model.edges.filter((e) => idSet.has(e.source) && idSet.has(e.target));
    const layerOf = layerize(ids, edges);
    const depth = Math.max(0, ...layerOf.values()) + 1;
    const layers: string[][] = Array.from({ length: depth }, () => []);
    for (const id of ids) layers[layerOf.get(id)!]!.push(id);
    const ordered = orderLayers(layers, edges).filter((l) => l.length > 0);

    // Wrap long layers into adjacent columns/rows.
    const columns: { ids: string[]; layer: number }[] = [];
    ordered.forEach((l, li) => {
      for (let i = 0; i < l.length; i += maxPerLayer) columns.push({ ids: l.slice(i, i + maxPerLayer), layer: li });
    });

    const crossCount = Math.max(...columns.map((c) => c.ids.length));
    const flowStep = (orientation === "horizontal" ? cardW : cardH) + layerGap;
    const crossStep = (orientation === "horizontal" ? cardH : cardW) + crossGap;
    const crossExtent = crossCount * crossStep - crossGap;
    const flowExtent = columns.length * flowStep - layerGap;

    columns.forEach((col, ci2) => {
      const pad = ((crossCount - col.ids.length) * crossStep) / 2;
      col.ids.forEach((id, i) => {
        const flow = ci2 * flowStep;
        const cross = pad + i * crossStep;
        nodes.set(id, {
          id,
          x: orientation === "horizontal" ? flow : cross,
          y: yCursor + (orientation === "horizontal" ? cross : flow),
          w: cardW,
          h: cardH,
          layer: col.layer,
          component: ci,
        });
      });
    });

    const height = orientation === "horizontal" ? crossExtent : flowExtent;
    const width = orientation === "horizontal" ? flowExtent : crossExtent;
    maxExtent = Math.max(maxExtent, width);
    widthOf.set(ci, width);
    yCursor += height + componentGap;
  });

  // centre components against the widest
  for (const n of nodes.values()) {
    const w = widthOf.get(n.component) ?? maxExtent;
    n.x = r1(n.x + (maxExtent - w) / 2);
    n.y = r1(n.y);
  }

  // Edges: parallel relationships between the same pair fan out symmetrically.
  const groups = new Map<string, typeof model.edges>();
  for (const e of model.edges) {
    if (!nodes.has(e.source) || !nodes.has(e.target)) continue;
    const k = e.source < e.target ? `${e.source}\u0000${e.target}` : `${e.target}\u0000${e.source}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(e);
  }
  const edgesOut: SpatialEdge[] = [];
  const curves = new Map<string, [Pt, Pt, Pt, Pt]>();
  for (const g of groups.values()) {
    g.forEach((e, i) => {
      const a = nodes.get(e.source)!;
      const b = nodes.get(e.target)!;
      const flip = e.source < e.target ? 1 : -1;
      // An edge that skips a layer, or runs against the flow (a cycle), arcs around the cards between.
      const detour = Math.abs(b.layer - a.layer) > 1 || b.layer <= a.layer;
      const bow = detour ? -((orientation === "horizontal" ? a.h : a.w) * 0.75 + 36) : 0;
      const offset = (i - (g.length - 1) / 2) * 44 * flip + bow;
      const { d: path, pts } = connector(a, b, orientation, offset);
      const label = predicateLabel(e.predicate);
      const labelW = Math.min(LABEL_MAX_W, Math.round(18 + label.length * LABEL_CHAR_W));
      const mid = at(pts, 0.5);
      curves.set(e.id, pts);
      edgesOut.push({ id: e.id, source: e.source, target: e.target, path, labelX: r1(mid.x), labelY: r1(mid.y), labelW, labelH: LABEL_H, label });
    });
  }
  edgesOut.sort((p, q) => byStr(p.id, q.id));

  // Labels sit on their own line, but never on top of a card or of another label: each one slides
  // along its curve to the nearest free spot (a fixed candidate order, so the result is stable).
  const hits = (x: number, y: number, w: number, h: number, placed: Rect[]) =>
    placed.some((r) => x - w / 2 < r.x + r.w + 4 && x + w / 2 > r.x - 4 && y - h / 2 < r.y + r.h + 4 && y + h / 2 > r.y - 4);
  const placed: Rect[] = [...nodes.values()].map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }));
  for (const e of edgesOut) {
    const pts = curves.get(e.id)!;
    let chosen: Pt | null = null;
    for (const t of [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82]) {
      const p = at(pts, t);
      if (!hits(p.x, p.y, e.labelW, e.labelH, placed)) {
        chosen = p;
        break;
      }
    }
    const p = chosen ?? at(pts, 0.5);
    e.labelX = r1(p.x);
    e.labelY = r1(p.y);
    placed.push({ x: p.x - e.labelW / 2, y: p.y - e.labelH / 2, w: e.labelW, h: e.labelH });
  }

  // Bounds of cards and labels.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes.values()) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }
  for (const e of edgesOut) {
    // the curve itself (an arc around other cards can leave the box the cards span)
    const pts = curves.get(e.id)!;
    for (let s = 0; s <= 10; s++) {
      const p = at(pts, s / 10);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    minX = Math.min(minX, e.labelX - e.labelW / 2);
    minY = Math.min(minY, e.labelY - e.labelH / 2);
    maxX = Math.max(maxX, e.labelX + e.labelW / 2);
    maxY = Math.max(maxY, e.labelY + e.labelH / 2);
  }
  const bounds: Box =
    nodes.size === 0 ? { x: 0, y: 0, width: 0, height: 0 } : { x: r1(minX), y: r1(minY), width: r1(maxX - minX), height: r1(maxY - minY) };

  return { orientation, nodes, edges: edgesOut, isolated, bounds, cardW, cardH };
}

/**
 * The base transform that fits `bounds` into a stage, centred. The scale is never above `maxScale`
 * (a small graph is not blown up) nor below `minScale`.
 */
export function fitTo(
  bounds: Box,
  stage: { width: number; height: number },
  opts: { pad?: number; minScale?: number; maxScale?: number } = {},
): { x: number; y: number; k: number } {
  const pad = opts.pad ?? 28;
  const minScale = opts.minScale ?? 0.4;
  const maxScale = opts.maxScale ?? 1;
  if (bounds.width <= 0 || bounds.height <= 0 || stage.width <= 0 || stage.height <= 0) return { x: 0, y: 0, k: 1 };
  const k = Math.min(maxScale, Math.max(minScale, Math.min((stage.width - 2 * pad) / bounds.width, (stage.height - 2 * pad) / bounds.height)));
  return {
    k,
    x: r1((stage.width - bounds.width * k) / 2 - bounds.x * k),
    y: r1((stage.height - bounds.height * k) / 2 - bounds.y * k),
  };
}
