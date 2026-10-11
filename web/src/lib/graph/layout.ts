import type { GraphModel } from "./model";

/**
 * Deterministic graph layout. No randomness and no dependence on input order: nodes are always
 * processed by sorted id, the force simulation runs a fixed number of iterations from a fixed
 * starting arrangement, and components are packed by size then id. Selection never changes it.
 */

export interface Point {
  x: number;
  y: number;
}


export interface Layout {
  positions: Map<string, Point>;
  viewBox: { x: number; y: number; width: number; height: number };
  /** Component bounding boxes in final coordinates (for tests and debugging). */
  boxes: { component: number; x: number; y: number; width: number; height: number }[];
}

export const NODE_RADIUS = 16;
const LABEL_MAX_CHARS = 22;
const CHAR_W = 6.4;
const PAD = 24;
const COMPONENT_GAP = 28;
const IDEAL = 120;
const ITERATIONS = 220;

const round = (n: number) => Math.round(n * 10) / 10;

export function labelHalfWidth(label: string): number {
  return (Math.min(label.length, LABEL_MAX_CHARS) * CHAR_W) / 2;
}

/** Shorten a label for the canvas; the full text stays available as a title and in the inspector. */
export function shortLabel(label: string): string {
  return label.length > LABEL_MAX_CHARS ? `${label.slice(0, LABEL_MAX_CHARS - 1)}…` : label;
}

/** Fruchterman-Reingold on one component, fixed iterations, fixed circular start. */
function layoutComponent(ids: string[], edges: [string, string][]): Map<string, Point> {
  const n = ids.length;
  const pos = new Map<string, Point>();
  if (n === 1) {
    pos.set(ids[0]!, { x: 0, y: 0 });
    return pos;
  }
  const radius = Math.max(IDEAL * 0.6, (n * IDEAL) / (2 * Math.PI));
  ids.forEach((id, i) => {
    const a = (2 * Math.PI * i) / n - Math.PI / 2;
    pos.set(id, { x: radius * Math.cos(a), y: radius * Math.sin(a) });
  });

  let temp = IDEAL;
  for (let it = 0; it < ITERATIONS; it++) {
    const disp = new Map<string, Point>(ids.map((id) => [id, { x: 0, y: 0 }]));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pos.get(ids[i]!)!;
        const b = pos.get(ids[j]!)!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d = Math.hypot(dx, dy);
        if (d < 0.01) {
          // Coincident points: separate along a fixed, index-derived direction (deterministic).
          dx = Math.cos(i + j);
          dy = Math.sin(i + j);
          d = 0.01;
        }
        const f = (IDEAL * IDEAL) / d;
        const ux = dx / d;
        const uy = dy / d;
        disp.get(ids[i]!)!.x += ux * f;
        disp.get(ids[i]!)!.y += uy * f;
        disp.get(ids[j]!)!.x -= ux * f;
        disp.get(ids[j]!)!.y -= uy * f;
      }
    }
    for (const [s, t] of edges) {
      const a = pos.get(s)!;
      const b = pos.get(t)!;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d = Math.max(0.01, Math.hypot(dx, dy));
      const f = (d * d) / IDEAL;
      const ux = dx / d;
      const uy = dy / d;
      disp.get(s)!.x -= ux * f;
      disp.get(s)!.y -= uy * f;
      disp.get(t)!.x += ux * f;
      disp.get(t)!.y += uy * f;
    }
    for (const id of ids) {
      const p = pos.get(id)!;
      const d = disp.get(id)!;
      const len = Math.max(0.01, Math.hypot(d.x, d.y));
      const step = Math.min(len, temp);
      p.x += (d.x / len) * step;
      p.y += (d.y / len) * step;
    }
    temp = Math.max(1, temp * 0.97);
  }
  return pos;
}

export function computeLayout(model: GraphModel, opts: { maxRowWidth?: number } = {}): Layout {
  const maxRow = opts.maxRowWidth ?? 760;

  type Block = { component: number; pts: Map<string, Point>; w: number; h: number; minX: number; minY: number };
  const blocks: Block[] = model.components.map((ids, ci) => {
    const edges: [string, string][] = model.edges
      .filter((e) => model.nodeById.get(e.source)?.component === ci)
      .map((e) => [e.source, e.target]);
    const pts = layoutComponent(ids, edges);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const id of ids) {
      const p = pts.get(id)!;
      const half = Math.max(NODE_RADIUS, labelHalfWidth(model.nodeById.get(id)!.label));
      minX = Math.min(minX, p.x - half);
      maxX = Math.max(maxX, p.x + half);
      minY = Math.min(minY, p.y - NODE_RADIUS - 6);
      maxY = Math.max(maxY, p.y + NODE_RADIUS + 26); // room for the label below
    }
    return { component: ci, pts, w: maxX - minX, h: maxY - minY, minX, minY };
  });

  // Shelf packing: components are already ordered largest first.
  const positions = new Map<string, Point>();
  const boxes: Layout["boxes"] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  let totalW = 0;
  for (const b of blocks) {
    if (x > 0 && x + b.w > maxRow) {
      x = 0;
      y += rowH + COMPONENT_GAP;
      rowH = 0;
    }
    const ox = x - b.minX;
    const oy = y - b.minY;
    for (const [id, p] of b.pts) positions.set(id, { x: round(p.x + ox), y: round(p.y + oy) });
    boxes.push({ component: b.component, x: round(x), y: round(y), width: round(b.w), height: round(b.h) });
    x += b.w + COMPONENT_GAP;
    rowH = Math.max(rowH, b.h);
    totalW = Math.max(totalW, x - COMPONENT_GAP);
  }
  const totalH = y + rowH;

  if (blocks.length === 0) {
    return { positions, boxes, viewBox: { x: 0, y: 0, width: 400, height: 240 } };
  }
  return {
    positions,
    boxes,
    viewBox: {
      x: round(-PAD),
      y: round(-PAD),
      width: round(Math.max(totalW, 200) + PAD * 2),
      height: round(Math.max(totalH, 120) + PAD * 2),
    },
  };
}
