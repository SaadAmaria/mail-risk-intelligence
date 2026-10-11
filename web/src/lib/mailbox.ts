import type { EmailListItem, EmailListResponse, FinalRiskLevel } from "@mri/shared";
import { api } from "./api";
import { IN_PROGRESS_STATUSES, RISK_ORDER } from "./copy";
import { usePolling, useResource, type Resource } from "./hooks";
import type { RouteState } from "./router";

/** The server's maximum page size; the overview asks for exactly this many. */
export const OVERVIEW_LIMIT = 500;
const LIST_LIMIT = 200;
const POLL_MS = 3000;

export interface RiskCounts {
  counts: Record<FinalRiskLevel, number>;
  /** Messages the counts were computed from. */
  basedOn: number;
  /** Messages in the whole mailbox. */
  mailboxTotal: number;
  /** False when the list was capped, so the counts are a lower bound and not global totals. */
  complete: boolean;
}

/** Counts per final risk level from a list response, honest about whether it is complete. */
export function riskCounts(overview: EmailListResponse): RiskCounts {
  const counts = Object.fromEntries(RISK_ORDER.map((l) => [l, 0])) as Record<FinalRiskLevel, number>;
  for (const e of overview.emails) counts[e.risk.final_level] += 1;
  return {
    counts,
    basedOn: overview.count,
    mailboxTotal: overview.total,
    complete: overview.total <= overview.count,
  };
}

export const isInProgress = (e: EmailListItem): boolean =>
  e.processing.in_progress || IN_PROGRESS_STATUSES.includes(e.processing.status);

export interface Mailbox {
  list: Resource<EmailListResponse>;
  overview: Resource<EmailListResponse>;
  /** Anything queued or running: the only reason the UI polls. */
  working: boolean;
  refresh: () => void;
}

/**
 * The filtered list plus an unfiltered overview used for the risk counts. Both are read-only
 * GETs; polling only runs while some message is queued or being analyzed.
 */
export function useMailbox(route: Pick<RouteState, "q" | "risk" | "status" | "order">, q: string): Mailbox {
  const list = useResource(
    (signal) => api.listEmails({ q, risk: route.risk, status: route.status, order: route.order, limit: LIST_LIMIT }, signal),
    [q, route.risk, route.status, route.order],
  );
  const overview = useResource((signal) => api.listEmails({ limit: OVERVIEW_LIMIT }, signal), []);

  const working = [list.data, overview.data].some((d) => d?.emails.some(isInProgress));
  usePolling(
    () => {
      list.reload();
      overview.reload();
    },
    working,
    POLL_MS,
  );

  return {
    list,
    overview,
    working,
    refresh: () => {
      list.reload();
      overview.reload();
    },
  };
}
