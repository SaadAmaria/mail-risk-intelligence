import type { RequestHandler } from "express";

/**
 * Minimal CORS for the configured frontend origin(s) only.
 *
 * - An exact-match allow-list; there is never a wildcard.
 * - A request without an Origin header (same-origin, curl, the Vite dev proxy) is untouched.
 * - A disallowed origin gets no CORS headers at all, so a browser blocks the response; the server
 *   does not need to reject it.
 * - No credentials are allowed (there is no authentication in this application).
 */
export function corsMiddleware(allowedOrigins: string[]): RequestHandler {
  const allowed = new Set(allowedOrigins.map((o) => o.replace(/\/+$/, "").toLowerCase()));
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (typeof origin === "string") {
      res.append("Vary", "Origin");
      if (allowed.has(origin.replace(/\/+$/, "").toLowerCase())) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        if (req.method === "OPTIONS") {
          res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type");
          res.setHeader("Access-Control-Max-Age", "600");
          res.status(204).end();
          return;
        }
      } else if (req.method === "OPTIONS") {
        // Preflight from a disallowed origin: answer without granting anything.
        res.status(204).end();
        return;
      }
    }
    next();
  };
}
