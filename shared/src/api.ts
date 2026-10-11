import { z } from "zod";

export const HealthResponse = z.object({
  status: z.literal("ok"),
  service: z.string(),
  llm: z.object({
    configured: z.boolean(),
    provider: z.string().nullable(),
    model: z.string().nullable(),
  }),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const ApiError = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof ApiError>;
