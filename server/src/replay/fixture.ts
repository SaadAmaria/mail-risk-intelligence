import { createHash } from "node:crypto";
import { z } from "zod";
import { ANALYSIS_STATUSES } from "@mri/shared";
import type { ChatMessage } from "../llm/types";

/**
 * Recorded fixtures: previously captured model completions for ONE seed email, replayed at the
 * `LlmClient` boundary so every answer still passes the normal validation.
 *
 * What a fixture holds: raw completion text, response model, token counts, a hash of the
 * (nonce-normalized) request, capture metadata and the outcome of the capture run.
 * What it never holds: API keys, headers, prompt text (only its hash), environment values.
 *
 * `integrity` proves the file is internally consistent. It is NOT proof of provider authorship:
 * anyone who can write the repository can produce a consistent fixture.
 */
export const FIXTURE_FORMAT_VERSION = 1 as const;

export const MAX_FIXTURE_BYTES = 512 * 1024;
export const MAX_FIXTURE_CALLS = 8;
export const MAX_CALL_CONTENT_CHARS = 64 * 1024;
export const MAX_MANIFEST_ENTRIES = 1000;

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const Usage = z
  .object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
    reasoning_tokens: z.number().int().nonnegative().nullable(),
  })
  .nullable();

export const RecordedCall = z.object({
  stage: z.enum(["extraction", "risk"]),
  /** SHA-256 of the request messages with the per-request delimiter nonce normalized. */
  request_hash: Sha256,
  content: z.string().max(MAX_CALL_CONTENT_CHARS),
  finish_reason: z.string().max(40).nullable(),
  response_model: z.string().min(1).max(200),
  usage: Usage,
  latency_ms: z.number().nonnegative().nullable(),
});
export type RecordedCall = z.infer<typeof RecordedCall>;

export const RecordedFixture = z.object({
  format_version: z.literal(FIXTURE_FORMAT_VERSION),
  email: z.object({
    id: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/),
    content_hash: Sha256,
  }),
  pipeline: z.object({
    prompt_version: z.string().min(1).max(100),
    extraction_schema_version: z.number().int(),
    risk_schema_version: z.number().int(),
  }),
  capture: z.object({
    captured_at: z.string().min(1).max(40),
    tool: z.string().min(1).max(100),
    provider_host: z.string().max(200).nullable(),
    requested_model: z.string().min(1).max(200),
    /** Which try this is, and how many tries were made for this email (no silent best-of-N). */
    attempt: z.number().int().min(1),
    attempts_made: z.number().int().min(1),
  }),
  calls: z.array(RecordedCall).min(1).max(MAX_FIXTURE_CALLS),
  /** What the capture run actually produced, as persisted by the real pipeline. */
  result: z.object({
    status: z.enum(ANALYSIS_STATUSES),
    stages: z
      .array(
        z.object({
          stage: z.enum(["extraction", "risk"]),
          outcome: z.enum(["ok", "failed", "skipped"]),
          calls: z.number().int().nonnegative(),
          dropped_items: z.number().int().nonnegative(),
          error_kind: z.string().max(60).nullable(),
        }),
      )
      .max(4),
    warnings_count: z.number().int().nonnegative(),
    /** SHA-256 of {status, extraction, assessment, warnings} of the capture run. */
    digest: Sha256,
  }),
  integrity: Sha256,
});
export type RecordedFixture = z.infer<typeof RecordedFixture>;

export const RecordingManifest = z.object({
  format_version: z.literal(FIXTURE_FORMAT_VERSION),
  files: z
    .array(
      z.object({
        email_id: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/),
        file: z.string().regex(/^[A-Za-z0-9_.-]{1,140}\.json$/),
        integrity: Sha256,
      }),
    )
    .max(MAX_MANIFEST_ENTRIES),
});
export type RecordingManifest = z.infer<typeof RecordingManifest>;

export const MANIFEST_FILE = "index.json";

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** JSON with object keys sorted recursively, so a hash does not depend on key order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

const NONCE = /DATA_[0-9a-f]{16}/g;

/**
 * Identity of a model request that is stable across runs: the prompts embed a random delimiter
 * nonce, which is replaced by a constant before hashing. The hash covers the whole email text
 * (it is inside the prompt), so a different or edited message can never match.
 */
export function normalizedRequestHash(messages: ChatMessage[]): string {
  const normalized = messages.map((m) => ({ role: m.role, content: m.content.replace(NONCE, "DATA_<nonce>") }));
  return sha256(canonicalJson(normalized));
}

export function computeIntegrity(fixture: Omit<RecordedFixture, "integrity">): string {
  return sha256(canonicalJson(fixture));
}

export function seal(fixture: Omit<RecordedFixture, "integrity">): RecordedFixture {
  return { ...fixture, integrity: computeIntegrity(fixture) };
}

/** Digest of what a run persisted; provenance is excluded (replay is "recorded" by design). */
export function resultDigest(r: {
  status: string;
  extraction: unknown;
  assessment: unknown;
  warnings: string[];
}): string {
  return sha256(canonicalJson({ status: r.status, extraction: r.extraction, assessment: r.assessment, warnings: r.warnings }));
}
