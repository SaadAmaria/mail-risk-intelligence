import type { ErrorRequestHandler, RequestHandler, Response } from "express";
import type { IngestErrorCode } from "@mri/shared";
import { IngestError } from "../ingestion/errors";

/**
 * Every error response has exactly this shape: { error: { code, message } }.
 * `message` is written for a person and never contains stack traces, file paths, prompts,
 * credentials or email content.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const INGEST_STATUS: Record<IngestErrorCode, number> = {
  empty_input: 400,
  input_too_large: 413,
  unsupported_type: 415,
  type_mismatch: 415,
  binary_content: 415,
  invalid_pdf: 422,
  ocr_unsupported: 422,
  pdf_timeout: 422,
  malformed_eml: 422,
};

export function fromIngestError(err: IngestError): ApiError {
  return new ApiError(INGEST_STATUS[err.code] ?? 400, err.code, err.message);
}

export function sendError(res: Response, err: ApiError): void {
  for (const [k, v] of Object.entries(err.headers)) res.setHeader(k, v);
  res.status(err.status).json({ error: { code: err.code, message: err.message } });
}

/** Forward rejected promises from async handlers to the error middleware (Express 4). */
export const asyncHandler =
  (fn: (...args: Parameters<RequestHandler>) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function notFoundHandler(): RequestHandler {
  return (req, res) => {
    // originalUrl keeps the /api prefix that the router mount strips from req.path.
    const path = req.originalUrl.split("?")[0]!.slice(0, 100);
    sendError(res, new ApiError(404, "not_found", `No such endpoint: ${req.method} ${path}`));
  };
}

/**
 * Last-resort error middleware. Known failures are mapped to their status and code; anything
 * else becomes a generic 500. The underlying error is reported to `log` by NAME only, so a stack
 * trace, a path, or text from an email can never reach a client or the log by this route.
 */
export function errorHandler(log: (message: string) => void): ErrorRequestHandler {
  return (err: unknown, _req, res, _next) => {
    if (res.headersSent) return;

    if (err instanceof ApiError) return sendError(res, err);
    if (err instanceof IngestError) return sendError(res, fromIngestError(err));

    // body-parser errors carry a `type`; multer errors carry a `code`.
    const e = err as { type?: string; code?: string; status?: number } | null;
    if (e?.type === "entity.too.large") {
      return sendError(res, new ApiError(413, "input_too_large", "The request body is too large."));
    }
    if (e?.type === "entity.parse.failed" || e?.type === "encoding.unsupported") {
      return sendError(res, new ApiError(400, "invalid_json", "The request body is not valid JSON."));
    }
    if (e?.code === "LIMIT_FILE_SIZE") {
      return sendError(res, new ApiError(413, "input_too_large", "The uploaded file is too large."));
    }
    if (typeof e?.code === "string" && e.code.startsWith("LIMIT_")) {
      return sendError(res, new ApiError(400, "invalid_request", "The upload does not match the expected form."));
    }

    log(`api: unexpected error (${err instanceof Error ? err.name : typeof err})`);
    sendError(res, new ApiError(500, "internal_error", "An internal error occurred."));
  };
}
