import type { EntityType, FinalRiskLevel } from "@mri/shared";
import { buildGraphModel, type GraphModel } from "./model";

/**
 * Graph filters: pure and shared by the canvas and the list, so both always show exactly the same
 * entities and relationships. Filtering only removes; it never adds, merges or rewrites anything.
 */

export interface GraphFilters {
  types: string[];
  origins: string[];
  risks: string[];
  q: string;
  /** Keep only entities that have at least one relationship to another visible entity. */
  connectedOnly: boolean;
}

export const NO_FILTERS: GraphFilters = { types: [], origins: [], risks: [], q: "", connectedOnly: false };

export function isFiltering(f: GraphFilters): boolean {
  return f.types.length > 0 || f.origins.length > 0 || f.risks.length > 0 || f.q.trim() !== "" || f.connectedOnly;
}

export function activeFilterCount(f: GraphFilters): number {
  return (f.types.length ? 1 : 0) + (f.origins.length ? 1 : 0) + (f.risks.length ? 1 : 0) + (f.q.trim() ? 1 : 0) + (f.connectedOnly ? 1 : 0);
}

export interface Filtered {
  /** A model containing only the visible entities and relationships. */
  model: GraphModel;
  visibleIds: Set<string>;
  hiddenNodes: number;
  hiddenEdges: number;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function applyFilters(full: GraphModel, f: GraphFilters): Filtered {
  const q = norm(f.q);
  const attrOk = new Set<string>();
  for (const n of full.nodes) {
    if (f.types.length && !f.types.includes(n.type as EntityType)) continue;
    if (f.origins.length && !f.origins.includes(n.origin)) continue;
    if (f.risks.length && !f.risks.includes(n.maxRisk as FinalRiskLevel)) continue;
    if (q && !norm(n.label).includes(q)) continue;
    attrOk.add(n.id);
  }

  const visible = new Set<string>(attrOk);
  if (f.connectedOnly) {
    const linked = new Set<string>();
    for (const e of full.edges) {
      if (attrOk.has(e.source) && attrOk.has(e.target)) {
        linked.add(e.source);
        linked.add(e.target);
      }
    }
    for (const id of [...visible]) if (!linked.has(id)) visible.delete(id);
  }

  const nodes = full.nodes.filter((n) => visible.has(n.id));
  const edges = full.edges.filter((e) => visible.has(e.source) && visible.has(e.target));

  // Rebuild through the same pure builder so degree and components describe the visible subgraph.
  const model = buildGraphModel({
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      label: n.label,
      origin: n.origin,
      key_basis: n.keyBasis,
      email_ids: n.emailIds,
      mention_count: n.mentionCount,
      max_risk: n.maxRisk,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      predicate: e.predicate,
      email_ids: e.emailIds,
      count: e.count,
      origin: e.origin,
      evidence: e.evidence,
    })),
    meta: full.meta,
  });

  return { model, visibleIds: visible, hiddenNodes: full.nodes.length - nodes.length, hiddenEdges: full.edges.length - edges.length };
}

/** Entity types present, with counts, in a stable order (for the filter controls). */
export function typeCounts(full: GraphModel): { type: string; count: number }[] {
  const m = new Map<string, number>();
  for (const n of full.nodes) m.set(n.type, (m.get(n.type) ?? 0) + 1);
  const order = ["person", "organization", "account", "location", "amount"];
  return [...m.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
}
