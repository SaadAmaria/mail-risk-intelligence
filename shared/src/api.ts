import { z } from "zod";

export const LLM_REACHABILITY = ["unchecked", "reachable", "unreachable", "credentials_rejected"] as const;
export const LlmReachability = z.enum(LLM_REACHABILITY);
export type LlmReachability = z.infer<typeof LlmReachability>;

/**
 * Recorded demo capability. Additive and optional. `available` means compatible recordings
 * exist; it says nothing about any provider, and replay is never reported as "reachable".
 */
export const ReplayStatus = z.object({
  available: z.boolean(),
  /** Seed messages that have a usable recording (the only ones that can be replayed). */
  email_ids: z.array(z.string()),
  model: z.string().nullable(),
  captured_at: z.string().nullable(),
  /** Why some recordings were not used (ids and reasons only). */
  problems: z.array(z.string()),
});
export type ReplayStatus = z.infer<typeof ReplayStatus>;

export const HealthResponse = z.object({
  status: z.literal("ok"),
  service: z.string(),
  llm: z.object({
    // A valid, usable provider configuration (endpoint + model, and a key for a hosted
    // endpoint). It says NOTHING about whether the provider can actually be reached.
    configured: z.boolean(),
    provider: z.string().nullable(),
    model: z.string().nullable(),

    // Additive fields (optional, so older clients and payloads remain valid).
    // What was last *observed* from real analysis calls. Reading health never calls the
    // provider: "unchecked" means no real call has happened since the server started.
    reachability: LlmReachability.optional(),
    last_call_at: z.string().nullable().optional(),
    last_error_kind: z.string().nullable().optional(),
    // Why the configuration is not usable (messages never contain secret values).
    problems: z.array(z.string()).optional(),
  }),
  replay: ReplayStatus.optional(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const ApiError = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof ApiError>;
