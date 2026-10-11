import { useCallback, useSyncExternalStore } from "react";

/**
 * URL-driven navigation with the History API (no router library). The URL is the source of
 * truth for the selection and the filters, so deep links, Back/Forward and reloads all work:
 *
 *   /                      mailbox
 *   /emails/:id            investigation of one message
 *   /graph                 knowledge graph (?node=<id> selection, ?view=list for the list view)
 *   ?q=&risk=&status=&order=   filters (shareable)
 *   ?add=1                 the Add email dialog
 */
export interface RouteState {
  emailId: string | null;
  q: string;
  risk: string[];
  status: string[];
  order: "asc" | "desc";
  add: boolean;
  /** Which top-level page: the mailbox (default) or the knowledge graph. */
  page: "inbox" | "graph";
  /** Graph page only: selected node id. */
  node: string | null;
  /** Graph page only: selected relationship (edge) id. */
  gedge: string | null;
  /** Graph page only: graph canvas or the accessible list. */
  gview: "graph" | "list";
  /** Graph page, narrow screens only: which of the three sections is shown. */
  gtab: "overview" | "map" | "entities";
  /** Graph page filters (all optional, all in the URL). */
  gtypes: string[];
  gorigin: string[];
  grisk: string[];
  gq: string;
  gconn: boolean;
  gamounts: boolean;
}

export const DEFAULT_ROUTE: RouteState = {
  emailId: null,
  q: "",
  risk: [],
  status: [],
  order: "desc",
  add: false,
  page: "inbox",
  node: null,
  gedge: null,
  gview: "graph",
  gtab: "overview",
  gtypes: [],
  gorigin: [],
  grisk: [],
  gq: "",
  gconn: false,
  gamounts: false,
};

const csv = (v: string | null): string[] =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export function parseLocation(pathname: string, search: string): RouteState {
  const m = /^\/emails\/([^/]+)\/?$/.exec(pathname);
  const sp = new URLSearchParams(search);
  const isGraph = /^\/graph\/?$/.test(pathname);
  let emailId: string | null = null;
  if (m) {
    try {
      emailId = decodeURIComponent(m[1]!);
    } catch {
      emailId = null;
    }
  }
  return {
    emailId,
    q: sp.get("q") ?? "",
    risk: csv(sp.get("risk")),
    status: csv(sp.get("status")),
    order: sp.get("order") === "asc" ? "asc" : "desc",
    add: sp.get("add") === "1",
    page: isGraph ? "graph" : "inbox",
    node: isGraph ? sp.get("node") || null : null,
    gedge: isGraph ? sp.get("edge") || null : null,
    gview: isGraph && sp.get("view") === "list" ? "list" : "graph",
    gtab: isGraph && sp.get("tab") === "map" ? "map" : isGraph && sp.get("tab") === "entities" ? "entities" : "overview",
    gtypes: isGraph ? csv(sp.get("types")) : [],
    gorigin: isGraph ? csv(sp.get("origin")) : [],
    grisk: isGraph ? csv(sp.get("grisk")) : [],
    gq: isGraph ? (sp.get("gq") ?? "") : "",
    gconn: isGraph && sp.get("connected") === "1",
    gamounts: isGraph && sp.get("amounts") === "1",
  };
}

export function buildUrl(s: RouteState): string {
  // A message path always wins; the graph page keeps only its own parameters.
  if (!s.emailId && s.page === "graph") {
    const gp = new URLSearchParams();
    if (s.node) gp.set("node", s.node);
    if (s.gedge) gp.set("edge", s.gedge);
    if (s.gtab !== "overview") gp.set("tab", s.gtab);
    if (s.gview === "list") gp.set("view", "list");
    if (s.gtypes.length) gp.set("types", s.gtypes.join(","));
    if (s.gorigin.length) gp.set("origin", s.gorigin.join(","));
    if (s.grisk.length) gp.set("grisk", s.grisk.join(","));
    if (s.gq.trim()) gp.set("gq", s.gq.trim());
    if (s.gconn) gp.set("connected", "1");
    if (s.gamounts) gp.set("amounts", "1");
    if (s.add) gp.set("add", "1");
    const g = gp.toString();
    return g ? `/graph?${g}` : "/graph";
  }
  const path = s.emailId ? `/emails/${encodeURIComponent(s.emailId)}` : "/";
  const sp = new URLSearchParams();
  if (s.q.trim()) sp.set("q", s.q.trim());
  if (s.risk.length) sp.set("risk", s.risk.join(","));
  if (s.status.length) sp.set("status", s.status.join(","));
  if (s.order === "asc") sp.set("order", "asc");
  if (s.add) sp.set("add", "1");
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

const EVENT = "mri:locationchange";

function subscribe(cb: () => void): () => void {
  window.addEventListener("popstate", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(EVENT, cb);
  };
}

const snapshot = () => window.location.pathname + window.location.search;

export function navigateTo(url: string, opts: { replace?: boolean } = {}): void {
  if (url === snapshot()) return;
  if (opts.replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  window.dispatchEvent(new Event(EVENT));
}

/** Current route plus a `go(patch)` that merges a change into it and updates the URL. */
export function useRoute(): [RouteState, (patch: Partial<RouteState>, opts?: { replace?: boolean }) => void] {
  const loc = useSyncExternalStore(subscribe, snapshot, () => "/");
  const [path, search = ""] = [loc.split("?")[0]!, loc.includes("?") ? loc.slice(loc.indexOf("?")) : ""];
  const route = parseLocation(path, search);

  const go = useCallback((patch: Partial<RouteState>, opts: { replace?: boolean } = {}) => {
    const current = parseLocation(window.location.pathname, window.location.search);
    navigateTo(buildUrl({ ...current, ...patch }), opts);
  }, []);

  return [route, go];
}

/**
 * Evidence deep link: `/emails/E004?ev=<snippet id>&evq=<quote>`. These are deliberately NOT part
 * of RouteState, so building any other link from the current route can never carry them along.
 */
export function evidenceHref(emailId: string, snippetId: string, quote: string): string {
  const sp = new URLSearchParams({ ev: snippetId, evq: quote.slice(0, 400) });
  return `/emails/${encodeURIComponent(emailId)}?${sp.toString()}`;
}

export function readEvidenceParams(search: string): { snippetId: string; quote: string } | null {
  const sp = new URLSearchParams(search);
  const snippetId = sp.get("ev");
  const quote = sp.get("evq");
  return snippetId && quote ? { snippetId, quote } : null;
}

/** The current location's query string, re-read on every navigation. */
export function useSearch(): string {
  return useSyncExternalStore(subscribe, () => window.location.search, () => "");
}
