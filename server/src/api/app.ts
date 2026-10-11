import express, { type Express, type Request } from "express";
import multer from "multer";
import { healthHandler } from "../health";
import type { AnalysisService } from "../analysis/service";
import { ingestPastedText, ingestUpload } from "../ingestion/ingest";
import { DEFAULT_LIMITS, type IngestLimits } from "../ingestion/limits";
import type { LlmSettings } from "../llm/config";
import type { ProviderStatusSnapshot } from "../llm/status";
import type { MailboxRepository } from "../storage/repository";
import { corsMiddleware } from "./cors";
import { unsafeRequestGuard } from "./originGuard";
import { ApiError, asyncHandler, errorHandler, notFoundHandler } from "./errors";
import {
  emailDetail,
  graph,
  listEmails,
  processingSummary,
  RISK_FILTERS,
  STATUS_FILTERS,
  type ViewDeps,
} from "./views";
import type { AutomaticChecksResponse, IngestResponse, ReplayStatus, ReprocessResponse } from "@mri/shared";
import { AutomaticChecks } from "../analysis/automaticChecks";

export interface ApiDeps {
  repo: MailboxRepository;
  analysis: AnalysisService;
  orgDomains: string[];
  maxRuns: number;
  /** Frontend origins allowed to call the API from a browser. Exact match; no wildcard. */
  corsOrigins: string[];
  /** Upload/paste limits (defaults to the Phase 1 limits). */
  limits?: Partial<IngestLimits>;
  /** Used only by /api/health: validated settings and the last observed provider outcome. */
  llm: Pick<LlmSettings, "configured" | "host" | "model" | "problems">;
  providerStatus: () => ProviderStatusSnapshot;
  /** Recorded demo capability for /api/health (optional). */
  replay?: () => ReplayStatus | undefined;
  log?: (message: string) => void;
}

const ID_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

/**
 * The HTTP layer. Routes only parse and validate input, call the existing ingestion, storage,
 * orchestration and risk modules, and shape the response; they hold no business rules.
 *
 * Nothing in a read route (list, detail, graph, health) can cause a provider call. AI analysis is
 * started only by an explicit request: `POST /api/emails/:id/reprocess`, or `analyze: true` on
 * `POST /api/emails`. `POST /api/emails/:id/automatic-checks` is rules-only and has no path to a model.
 */
export function createApp(deps: ApiDeps): Express {
  const limits: IngestLimits = { ...DEFAULT_LIMITS, ...deps.limits };
  const view: ViewDeps = { repo: deps.repo, analysis: deps.analysis, orgDomains: deps.orgDomains, maxRuns: deps.maxRuns };
  const log = deps.log ?? (() => undefined);
  // The rules-only path is built from the repository alone: it is never handed an LLM client.
  const automatic = new AutomaticChecks(deps.repo, { isActive: (id) => deps.analysis.isActive(id) });

  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(corsMiddleware(deps.corsOrigins));
  // Before any body is read or route runs: untrusted browser origins and unsupported content types
  // cannot cause a side effect (see originGuard.ts for the policy and its limits).
  app.use(unsafeRequestGuard({ allowedOrigins: deps.corsOrigins, multipartPaths: ["/api/emails"] }));
  // A pasted message is capped in characters by ingestion; this bounds the raw JSON body.
  app.use(express.json({ limit: limits.maxUploadBytes }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: limits.maxUploadBytes, files: 1, fields: 6, parts: 8, fieldSize: 1024 },
  });

  // ---- health ---------------------------------------------------------------------------
  app.get("/api/health", healthHandler(deps.llm, deps.providerStatus, deps.replay));

  // ---- list -----------------------------------------------------------------------------
  app.get(
    "/api/emails",
    asyncHandler(async (req, res) => {
      const q = single(req.query.q, "q");
      const risk = csv(req.query.risk, "risk", RISK_FILTERS);
      const status = csv(req.query.status, "status", STATUS_FILTERS);
      const order = single(req.query.order, "order") ?? "desc";
      if (order !== "asc" && order !== "desc") throw invalidQuery("order must be asc or desc.");
      const limitRaw = single(req.query.limit, "limit");
      let limit = 100;
      if (limitRaw !== null) {
        limit = Number(limitRaw);
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw invalidQuery("limit must be an integer from 1 to 500.");
      }
      if (q !== null && q.length > 200) throw invalidQuery("q must be at most 200 characters.");
      res.json(listEmails(view, { q: q && q.trim() ? q.trim() : null, risk, status, order, limit }));
    }),
  );

  // ---- detail ---------------------------------------------------------------------------
  app.get(
    "/api/emails/:id",
    asyncHandler(async (req, res) => {
      const email = findEmail(deps.repo, req.params.id);
      res.json(emailDetail(view, email));
    }),
  );

  // ---- ingest ---------------------------------------------------------------------------
  app.post(
    "/api/emails",
    (req, res, next) => {
      if (req.is("multipart/form-data")) return upload.single("file")(req, res, next);
      next();
    },
    asyncHandler(async (req, res) => {
      const ctx = { repo: deps.repo, limits };
      let outcome;
      let wantsAnalysis = false;

      if (req.is("multipart/form-data")) {
        const file = (req as Request & { file?: Express.Multer.File }).file;
        if (!file) throw new ApiError(400, "no_input", 'Send the file in a multipart field named "file".');
        wantsAnalysis = truthy((req.body as Record<string, unknown> | undefined)?.analyze);
        outcome = await ingestUpload(ctx, {
          filename: file.originalname,
          contentType: file.mimetype,
          data: new Uint8Array(file.buffer),
        });
      } else if (req.is("application/json")) {
        const body = req.body as { raw_text?: unknown; analyze?: unknown } | undefined;
        if (!body || typeof body.raw_text !== "string") {
          throw new ApiError(400, "invalid_request", 'Send JSON of the form {"raw_text": "<email text>"}.');
        }
        wantsAnalysis = truthy(body.analyze);
        outcome = await ingestPastedText(ctx, body.raw_text);
      } else {
        throw new ApiError(
          415,
          "unsupported_content_type",
          "Send application/json with raw_text, or multipart/form-data with a file field.",
        );
      }

      const { email, created, reason } = outcome;
      let analysisResult: string | undefined;
      if (wantsAnalysis) analysisResult = deps.analysis.enqueue(email.id);

      const body: IngestResponse = {
        id: email.id,
        created,
        reason: reason ?? null,
        source_kind: email.source_kind,
        missing_headers: email.missing_headers,
        warnings: email.warnings,
        attachments: email.attachments.map((a) => ({
          filename: a.filename,
          extraction_status: a.extraction_status,
          error_message: a.error_message,
        })),
        processing: processingSummary(view, email.id, deps.repo.getAnalysis(email.id)),
        ...(analysisResult !== undefined ? { analysis: { requested: true as const, result: analysisResult } } : {}),
      };
      // 202: accepted for asynchronous processing. 201: stored. 200: identical content existed.
      const accepted = analysisResult === "queued" || analysisResult === "already_queued";
      res.status(accepted ? 202 : created ? 201 : 200).json(body);
    }),
  );

  // ---- explicit start / retry -----------------------------------------------------------
  app.post(
    "/api/emails/:id/reprocess",
    asyncHandler(async (req, res) => {
      const email = findEmail(deps.repo, req.params.id);
      const force = truthy(single(req.query.force, "force"));
      const result = deps.analysis.enqueue(email.id, { force });

      switch (result) {
        case "queued": {
          const body: ReprocessResponse = {
            id: email.id,
            result: "queued",
            processing: processingSummary(view, email.id, deps.repo.getAnalysis(email.id)),
          };
          res.status(202).json(body);
          return;
        }
        case "already_queued":
          throw new ApiError(409, "already_processing", "This email is already queued or being processed.");
        case "skipped_complete":
          throw new ApiError(
            409,
            "already_complete",
            "This email has already been analyzed. Use ?force=true to run the analysis again.",
          );
        case "max_runs_reached":
          throw new ApiError(
            409,
            "max_runs_reached",
            "This email has reached the automatic retry limit. Use ?force=true to run it again.",
          );
        case "queue_full":
          throw new ApiError(503, "queue_full", "The analysis queue is full. Try again shortly.", { "Retry-After": "10" });
        case "not_found":
          throw new ApiError(404, "not_found", "No such email.");
      }
    }),
  );

  // ---- explicit rules-only processing (never contacts a provider) --------------------------
  app.post(
    "/api/emails/:id/automatic-checks",
    asyncHandler(async (req, res) => {
      const email = findEmail(deps.repo, req.params.id);
      const out = automatic.run(email.id);
      switch (out.kind) {
        case "performed":
        case "unchanged": {
          const body: AutomaticChecksResponse = {
            id: email.id,
            result: out.kind,
            processing: processingSummary(view, email.id, deps.repo.getAnalysis(email.id)),
          };
          res.status(200).json(body);
          return;
        }
        case "busy":
          throw new ApiError(409, "already_processing", "This email is already queued or being processed.");
        case "complete":
          throw new ApiError(
            409,
            "already_complete",
            "This email already has a completed analysis, which automatic checks never replace.",
          );
        case "ai_extraction_present":
          throw new ApiError(
            409,
            "ai_extraction_present",
            "This email already has an AI-produced extraction, which automatic checks never replace.",
          );
        case "not_found":
          throw new ApiError(404, "not_found", "No such email.");
      }
    }),
  );

  // ---- graph ----------------------------------------------------------------------------
  app.get(
    "/api/graph",
    asyncHandler(async (req, res) => {
      const raw = single(req.query.include_amounts, "include_amounts");
      res.json(graph(view, { includeAmounts: truthy(raw) }));
    }),
  );

  app.use("/api", notFoundHandler());
  app.use(errorHandler(log));
  return app;
}

// ---- helpers -------------------------------------------------------------------------------

function findEmail(repo: MailboxRepository, id: string | undefined) {
  if (!id || !ID_PATTERN.test(id)) throw new ApiError(404, "not_found", "No such email.");
  const email = repo.getEmail(id);
  if (!email) throw new ApiError(404, "not_found", "No such email.");
  return email;
}

function invalidQuery(message: string): ApiError {
  return new ApiError(400, "invalid_query", message);
}

function truthy(v: unknown): boolean {
  return v === true || (typeof v === "string" && ["1", "true", "yes"].includes(v.toLowerCase()));
}

/** A query parameter that must appear at most once. */
function single(v: unknown, name: string): string | null {
  if (v === undefined) return null;
  if (typeof v === "string") return v;
  throw invalidQuery(`${name} must be given once, as plain text.`);
}

function csv(v: unknown, name: string, allowed: readonly string[]): string[] | null {
  const raw = single(v, name);
  if (raw === null || raw.trim() === "") return null;
  const values = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const bad = values.filter((x) => !allowed.includes(x));
  if (bad.length > 0) throw invalidQuery(`${name} must be a comma-separated list of: ${allowed.join(", ")}.`);
  return values;
}
