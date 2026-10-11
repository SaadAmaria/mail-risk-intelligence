import type { EmailListItem, FinalRiskLevel } from "@mri/shared";
import { resolveSources, type GraphEdgeModel, type GraphModel, type GraphNodeModel, type SourceInfo } from "./model";

/**
 * Derived, read-only views for the investigation navigator and the start state. Everything is a
 * function of the graph the API returned and the real message list: nothing is scored or inferred.
 */

/** Review order for a message-level signal: flagged first, then not assessed, then "no risk found". */
const PRIORITY: FinalRiskLevel[] = ["high", "medium", "low", "unassessed", "none"];

export function strongest(levels: (FinalRiskLevel | null)[]): FinalRiskLevel {
  let best: FinalRiskLevel = "unassessed";
  let bestRank = Infinity;
  for (const l of levels) {
    if (!l) continue;
    const r = PRIORITY.indexOf(l);
    if (r < bestRank) {
      best = l;
      bestRank = r;
    }
  }
  return best;
}

export interface RankedRelationship {
  edge: GraphEdgeModel;
  source: GraphNodeModel;
  target: GraphNodeModel;
  /** Highest risk among the messages that support the relationship (a property of the messages). */
  risk: FinalRiskLevel;
  messages: SourceInfo[];
}

/** Relationships ordered for review: by the risk of their source messages, then by id. */
export function rankRelationships(model: GraphModel, emails: EmailListItem[] | null): RankedRelationship[] {
  const out: RankedRelationship[] = [];
  for (const edge of model.edges) {
    const source = model.nodeById.get(edge.source);
    const target = model.nodeById.get(edge.target);
    if (!source || !target) continue;
    const messages = resolveSources(edge.emailIds, emails);
    out.push({ edge, source, target, risk: strongest(messages.map((m) => m.risk)), messages });
  }
  return out.sort((a, b) => PRIORITY.indexOf(a.risk) - PRIORITY.indexOf(b.risk) || (a.edge.id < b.edge.id ? -1 : a.edge.id > b.edge.id ? 1 : 0));
}

export interface InvestigationSummary {
  total: number;
  aiAssessed: number;
  aiRecorded: number;
  aiLive: number;
  automaticOnly: number;
  /** Everything else: not started, queued, partial, failed, or degraded by an AI failure. */
  notAnalyzed: number;
}

export function summarizeMailbox(emails: EmailListItem[] | null): InvestigationSummary | null {
  if (!emails) return null;
  const complete = emails.filter((e) => e.processing.status === "complete");
  const automaticOnly = emails.filter((e) => e.processing.automatic_checks_only).length;
  return {
    total: emails.length,
    aiAssessed: complete.length,
    aiRecorded: complete.filter((e) => e.processing.provenance === "recorded").length,
    aiLive: complete.filter((e) => e.processing.provenance === "live").length,
    automaticOnly,
    notAnalyzed: emails.length - complete.length - automaticOnly,
  };
}

/** Every message that any entity in the graph was found in, joined with the real list. */
export function graphMessages(model: GraphModel, emails: EmailListItem[] | null): SourceInfo[] {
  const ids = new Set<string>();
  for (const n of model.nodes) for (const id of n.emailIds) ids.add(id);
  return resolveSources([...ids], emails);
}
