import { useCallback, useSyncExternalStore } from "react";

/**
 * URL-driven navigation with the History API (no router library). The URL is the source of
 * truth for the selection and the filters, so deep links, Back/Forward and reloads all work:
 *
 *   /                      mailbox
 *   /emails/:id            investigation of one message
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
}

export const DEFAULT_ROUTE: RouteState = { emailId: null, q: "", risk: [], status: [], order: "desc", add: false };

const csv = (v: string | null): string[] =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export function parseLocation(pathname: string, search: string): RouteState {
  const m = /^\/emails\/([^/]+)\/?$/.exec(pathname);
  const sp = new URLSearchParams(search);
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
  };
}

export function buildUrl(s: RouteState): string {
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
