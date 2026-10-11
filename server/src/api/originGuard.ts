import type { RequestHandler } from "express";
import { ApiError, sendError } from "./errors";

/**
 * Guard for every state-changing request (POST, PUT, PATCH, DELETE), run BEFORE the body is read
 * and before any route code, so a rejected request cannot enqueue work, store an email or reach a
 * provider.
 *
 * Why CORS is not enough: CORS only decides whether a page may READ a response. A "simple"
 * cross-origin POST (for example Content-Type: text/plain) is still delivered to the server and its
 * side effects happen. The server therefore decides, from the request itself, whether the browser
 * page that made it is trusted.
 *
 * Policy
 *  1. Origin header present (every browser POST has one):
 *       - allowed when it is in the configured allow-list (CORS_ORIGIN); or
 *       - allowed when it is the same origin as the Host the request was sent to AND that host is a
 *         loopback name or one of the allow-listed hosts (this is the Vite dev proxy on any port).
 *         The host check is what stops DNS rebinding: a page on evil.example rebound to 127.0.0.1
 *         has Origin == Host == evil.example and is refused because that host is not trusted;
 *       - anything else, including "null", is refused with 403.
 *  2. No Origin header (curl, scripts, tests, server-to-server): allowed, because there is no
 *     browser page to be tricked; but a request that the browser itself marks as coming from another
 *     site (Sec-Fetch-Site: cross-site / same-site) is refused.
 *  3. Content type: a state-changing request may carry no body, or an application/json body; the
 *     upload route additionally accepts multipart/form-data. Anything else (text/plain,
 *     application/x-www-form-urlencoded, ...) is refused with 415, so a form or a plain-text POST
 *     can never be what starts work, whatever its origin.
 *
 * This is not authentication or authorization: anyone who can reach the port with a non-browser
 * client can still call the API. It removes the browser-mediated attack, not the lack of accounts.
 */

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

const norm = (o: string) => o.trim().replace(/\/+$/, "").toLowerCase();

function hostnameOf(host: string): string {
  // "[::1]:3001" -> "[::1]", "localhost:5173" -> "localhost"
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end > 0 ? host.slice(0, end + 1) : host;
  }
  return host.split(":")[0] ?? host;
}

export interface OriginGuardOptions {
  allowedOrigins: string[];
  /** Paths (without query) that also accept multipart/form-data. */
  multipartPaths?: string[];
}

export function unsafeRequestGuard(opts: OriginGuardOptions): RequestHandler {
  const allowed = new Set(opts.allowedOrigins.map(norm));
  const allowedHosts = new Set<string>();
  for (const o of allowed) {
    try {
      allowedHosts.add(new URL(o).host.toLowerCase());
    } catch {
      /* an unparsable entry simply never matches */
    }
  }
  const multipart = new Set(opts.multipartPaths ?? []);

  return (req, res, next) => {
    if (!UNSAFE.has(req.method)) {
      next();
      return;
    }

    const origin = req.headers.origin;
    if (typeof origin === "string") {
      const o = norm(origin);
      let ok = allowed.has(o);
      if (!ok && o !== "null") {
        try {
          const host = new URL(o).host.toLowerCase();
          const sentTo = String(req.headers.host ?? "").toLowerCase();
          ok = host === sentTo && (LOOPBACK_HOSTNAMES.has(hostnameOf(host)) || allowedHosts.has(host));
        } catch {
          ok = false;
        }
      }
      if (!ok) {
        sendError(
          res,
          new ApiError(403, "origin_not_allowed", "This request came from a web page that is not allowed to change data here."),
        );
        return;
      }
    } else {
      const site = req.headers["sec-fetch-site"];
      if (site === "cross-site" || site === "same-site") {
        sendError(
          res,
          new ApiError(403, "origin_not_allowed", "This request came from a web page that is not allowed to change data here."),
        );
        return;
      }
    }

    const type = String(req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (type !== "") {
      const path = req.originalUrl.split("?")[0]!;
      const ok = type === "application/json" || (type === "multipart/form-data" && multipart.has(path));
      if (!ok) {
        sendError(
          res,
          new ApiError(
            415,
            "unsupported_content_type",
            "Send application/json (or no body). The upload route also accepts multipart/form-data.",
          ),
        );
        return;
      }
    }
    next();
  };
}
