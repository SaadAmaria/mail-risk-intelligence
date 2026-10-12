import type {
  EmailListItem,
  EntityType,
  FinalRiskLevel,
  GraphEdge,
  GraphNode,
  GraphResponse,
  RelationshipPredicate,
} from "@mri/shared";
import { needsReview } from "../review";

/**
 * The graph model: a pure, order-independent transformation of the API's `GraphResponse`.
 *
 * It preserves every API node and edge id, never merges or invents anything, and adds only
 * facts that can be derived from the response itself (degree, connected components) or joined
 * from the real email list (subject, sender, date).
 */

export interface GraphNodeModel {
  id: string;
  type: EntityType;
  label: string;
  /** "ai": seen by a validated AI assessment. "rules": derived automatically (e.g. a header address). */
  origin: GraphNode["origin"];
  keyBasis: string;
  emailIds: string[];
  mentionCount: number;
  /** Highest final risk among the source emails. A signal from those messages, not a verdict on the entity. */
  maxRisk: FinalRiskLevel;
  /** Number of distinct edges touching this node. */
  degree: number;
  /** Index into `GraphModel.components`. */
  component: number;
  edgeIds: string[];
}

export interface GraphEdgeModel {
  id: string;
  source: string;
  target: string;
  predicate: RelationshipPredicate;
  emailIds: string[];
  count: number;
  origin: GraphEdge["origin"];
  evidence: GraphEdge["evidence"];
  /** The server advises checking a citation before relying on the relationship type. */
  review: boolean;
}

export interface SourceInfo {
  id: string;
  /** False when the email list does not contain this id (it is then shown by id only). */
  known: boolean;
  subject: string | null;
  sender: string | null;
  date: string | null;
  risk: FinalRiskLevel | null;
}

export interface GraphModel {
  nodes: GraphNodeModel[];
  edges: GraphEdgeModel[];
  nodeById: Map<string, GraphNodeModel>;
  edgeById: Map<string, GraphEdgeModel>;
  /** Connected components as sorted node-id lists, largest first (ties by smallest id). */
  components: string[][];
  /** Edges the API returned whose endpoint is not among its nodes: dropped, and counted. */
  droppedEdges: number;
  meta: GraphResponse["meta"];
}

const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function buildGraphModel(graph: GraphResponse): GraphModel {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const edgesIn = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  const droppedEdges = graph.edges.length - edgesIn.length;

  const edges: GraphEdgeModel[] = [...edgesIn].sort(byId).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    predicate: e.predicate,
    emailIds: [...e.email_ids].sort(),
    count: e.count,
    origin: e.origin,
    review: needsReview(e),
    evidence: [...e.evidence].sort((a, b) =>
      a.email_id === b.email_id ? (a.snippet_id < b.snippet_id ? -1 : 1) : a.email_id < b.email_id ? -1 : 1,
    ),
  }));

  const edgeIdsByNode = new Map<string, string[]>();
  for (const e of edges) {
    for (const n of new Set([e.source, e.target])) {
      const list = edgeIdsByNode.get(n) ?? [];
      list.push(e.id);
      edgeIdsByNode.set(n, list);
    }
  }

  // Connected components (union-find over the kept edges, deterministic by sorted id).
  const sortedNodes = [...graph.nodes].sort(byId);
  const parent = new Map<string, string>(sortedNodes.map((n) => [n.id, n.id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) {
      const next = parent.get(c)!;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  for (const e of edges) {
    const a = find(e.source);
    const b = find(e.target);
    if (a !== b) parent.set(a < b ? b : a, a < b ? a : b);
  }
  const groups = new Map<string, string[]>();
  for (const n of sortedNodes) {
    const r = find(n.id);
    const g = groups.get(r) ?? [];
    g.push(n.id);
    groups.set(r, g);
  }
  const components = [...groups.values()].sort((a, b) => b.length - a.length || (a[0]! < b[0]! ? -1 : 1));
  const componentOf = new Map<string, number>();
  components.forEach((c, i) => c.forEach((id) => componentOf.set(id, i)));

  const nodes: GraphNodeModel[] = sortedNodes.map((n) => ({
    id: n.id,
    type: n.type,
    label: n.label,
    origin: n.origin,
    keyBasis: n.key_basis,
    emailIds: [...n.email_ids].sort(),
    mentionCount: n.mention_count,
    maxRisk: n.max_risk,
    degree: (edgeIdsByNode.get(n.id) ?? []).length,
    component: componentOf.get(n.id) ?? 0,
    edgeIds: [...(edgeIdsByNode.get(n.id) ?? [])],
  }));

  return {
    nodes,
    edges,
    nodeById: new Map(nodes.map((n) => [n.id, n])),
    edgeById: new Map(edges.map((e) => [e.id, e])),
    components,
    droppedEdges,
    meta: graph.meta,
  };
}

/** Join source email ids with the real email list. An id the list lacks is reported, not hidden. */
export function resolveSources(emailIds: string[], emails: EmailListItem[] | null): SourceInfo[] {
  const byEmail = new Map((emails ?? []).map((e) => [e.id, e]));
  return [...emailIds].sort().map((id) => {
    const e = byEmail.get(id);
    if (!e) return { id, known: false, subject: null, sender: null, date: null, risk: null };
    return {
      id,
      known: true,
      subject: e.subject,
      sender: e.from ? (e.from.name?.trim() || e.from.address) : null,
      date: e.date,
      risk: e.risk.final_level,
    };
  });
}

/** One incident relationship of a node, with the other endpoint resolved. */
export interface Connection {
  edge: GraphEdgeModel;
  direction: "out" | "in";
  other: GraphNodeModel | null;
}

export function connectionsOf(model: GraphModel, nodeId: string): Connection[] {
  const node = model.nodeById.get(nodeId);
  if (!node) return [];
  return node.edgeIds
    .map((id) => model.edgeById.get(id)!)
    .map((edge) => {
      const out = edge.source === nodeId;
      return { edge, direction: (out ? "out" : "in") as "out" | "in", other: model.nodeById.get(out ? edge.target : edge.source) ?? null };
    });
}
