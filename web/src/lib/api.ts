import { HealthResponse } from "@mri/shared";
import type {
  EmailDetailResponse,
  EmailListResponse,
  GraphResponse,
  IngestResponse,
  AutomaticChecksResponse,
  ReprocessResponse,
} from "@mri/shared";

/** A failed API call. `code` is the server's stable error code, or `network_error`/`http_error`. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

interface RequestOptions {
  method?: "GET" | "POST";
  json?: unknown;
  form?: FormData;
  signal?: AbortSignal;
}

/**
 * One typed request helper. It reads the standard `{ error: { code, message } }` shape and
 * never echoes anything else from a failing response. Reads (GET) are the only thing the UI
 * does on its own; every POST is the direct result of a user action.
 */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    body = opts.form; // the browser sets the multipart boundary
  }

  let res: Response;
  try {
    res = await fetch(path, { method: opts.method ?? "GET", headers, body, signal: opts.signal });
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new ApiRequestError(0, "network_error", "Could not reach the server. Check that the API is running.");
  }

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const e = (parsed as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    // A gateway/proxy error with no API error body means the API itself is not answering.
    if (typeof e?.code !== "string" && [500, 502, 503, 504].includes(res.status)) {
      throw new ApiRequestError(res.status, "server_unavailable", "The server is not responding. Check that the API is running.");
    }
    throw new ApiRequestError(
      res.status,
      typeof e?.code === "string" ? e.code : "http_error",
      typeof e?.message === "string" ? e.message : `The server returned an error (${res.status}).`,
    );
  }
  return parsed as T;
}

export interface ListParams {
  q?: string;
  risk?: string[];
  status?: string[];
  order?: "asc" | "desc";
  limit?: number;
}

function queryString(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const api = {
  health: (signal?: AbortSignal) =>
    request<unknown>("/api/health", { signal }).then((json) => HealthResponse.parse(json)),

  listEmails: (p: ListParams = {}, signal?: AbortSignal) =>
    request<EmailListResponse>(
      "/api/emails" +
        queryString({
          q: p.q?.trim() || undefined,
          risk: p.risk?.length ? p.risk.join(",") : undefined,
          status: p.status?.length ? p.status.join(",") : undefined,
          order: p.order,
          limit: p.limit !== undefined ? String(p.limit) : undefined,
        }),
      { signal },
    ),

  /** Read-only. Amounts are omitted by the server unless asked for. */
  getGraph: (opts: { includeAmounts?: boolean } = {}, signal?: AbortSignal) =>
    request<GraphResponse>(`/api/graph${opts.includeAmounts ? "?include_amounts=true" : ""}`, { signal }),

  getEmail: (id: string, signal?: AbortSignal) =>
    request<EmailDetailResponse>(`/api/emails/${encodeURIComponent(id)}`, { signal }),

  /** Stores pasted text. Analysis starts only when `analyze` is true. */
  addPaste: (rawText: string, analyze: boolean, signal?: AbortSignal) =>
    request<IngestResponse>("/api/emails", { method: "POST", json: { raw_text: rawText, analyze }, signal }),

  /** Stores an uploaded .txt/.eml/.pdf. Analysis starts only when `analyze` is true. */
  addFile: (file: File, analyze: boolean, signal?: AbortSignal) => {
    const form = new FormData();
    if (analyze) form.append("analyze", "true");
    form.append("file", file, file.name);
    return request<IngestResponse>("/api/emails", { method: "POST", form, signal });
  },

  /** Explicit start or retry of analysis for one email. */
  reprocess: (id: string, opts: { force?: boolean } = {}, signal?: AbortSignal) =>
    request<ReprocessResponse>(
      `/api/emails/${encodeURIComponent(id)}/reprocess${opts.force ? "?force=true" : ""}`,
      { method: "POST", json: {}, signal },
    ),

  /**
   * Rules-only processing of one email. Synchronous; the server runs it on a path that has no
   * access to any AI provider, so it is safe to offer whatever the AI configuration is.
   */
  automaticChecks: (id: string, signal?: AbortSignal) =>
    request<AutomaticChecksResponse>(`/api/emails/${encodeURIComponent(id)}/automatic-checks`, {
      method: "POST",
      json: {},
      signal,
    }),
};
