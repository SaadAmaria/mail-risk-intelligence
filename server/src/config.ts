function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: intFromEnv("PORT", 3001),
  host: process.env.HOST?.trim() || "127.0.0.1",
  llm: {
    baseUrl: process.env.LLM_BASE_URL?.trim() || null,
    model: process.env.LLM_MODEL?.trim() || null,
    // Read once; never log or return this value.
    apiKey: process.env.LLM_API_KEY?.trim() || null,
    timeoutMs: intFromEnv("LLM_TIMEOUT_MS", 25000),
  },
} as const;
