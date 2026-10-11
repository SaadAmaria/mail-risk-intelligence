import { z } from "zod";

export const LLM_REACHABILITY = ["unchecked", "reachable", "unreachable", "credentials_rejected"] as const;
export const LlmReachability = z.enum(LLM_REACHABILITY);
export type LlmReachability = z.infer<typeof LlmReachability>;

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
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const ApiError = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof ApiError>;
