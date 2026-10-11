export type ReasoningEffort = "low" | "medium" | "high";

export interface LlmSettings {
  /** True only when a request could actually be attempted (endpoint + model valid). */
  configured: boolean;
  /** Validated base URL, or null when absent or malformed. */
  baseUrl: string | null;
  /** Host part of the base URL: the only endpoint detail ever shown (health, logs). */
  host: string | null;
  model: string | null;
  /** Secret. Read once; must never be logged, serialized, or returned from the API. */
  apiKey: string | null;
  timeoutMs: number;
  reasoningEffort: ReasoningEffort | null;
  maxRetries: number;
  maxCompletionTokens: number;
  /** Human-readable configuration problems (never include secret values). */
  problems: string[];
}

function int(raw: string | undefined, fallback: number, min: number, max: number, name: string, problems: string[]): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) {
    problems.push(`${name} must be an integer between ${min} and ${max}; using ${fallback}.`);
    return fallback;
  }
  return n;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Parse LLM settings from environment-like input. Pure and side-effect free, so a malformed
 * `LLM_BASE_URL` can never throw from a request handler: it simply yields `configured: false`
 * plus a problem message.
 */
export function loadLlmSettings(env: Record<string, string | undefined>): LlmSettings {
  const problems: string[] = [];

  const rawUrl = env.LLM_BASE_URL?.trim() || null;
  let baseUrl: string | null = null;
  let host: string | null = null;
  if (rawUrl) {
    try {
      const u = new URL(rawUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        problems.push("LLM_BASE_URL must use http or https.");
      } else {
        baseUrl = rawUrl.replace(/\/+$/, "");
        host = u.host;
      }
    } catch {
      problems.push("LLM_BASE_URL is not a valid URL.");
    }
  }

  const model = env.LLM_MODEL?.trim() || null;
  const apiKey = env.LLM_API_KEY?.trim() || null;

  const effortRaw = (env.LLM_REASONING_EFFORT?.trim() || "low").toLowerCase();
  let reasoningEffort: ReasoningEffort | null = null;
  if (effortRaw === "low" || effortRaw === "medium" || effortRaw === "high") reasoningEffort = effortRaw;
  else if (effortRaw !== "none") problems.push("LLM_REASONING_EFFORT must be low, medium, high or none; using low.");
  if (effortRaw !== "none" && reasoningEffort === null) reasoningEffort = "low";

  let configured = baseUrl !== null && model !== null;
  if (baseUrl && !model) problems.push("LLM_MODEL is required when LLM_BASE_URL is set.");

  // A hosted endpoint without a key would only produce 401s; treat it as not configured.
  const hostname = host ? host.replace(/:\d+$/, "") : "";
  if (configured && !apiKey && !LOCAL_HOSTS.has(hostname)) {
    configured = false;
    problems.push("LLM_API_KEY is required for a non-local endpoint.");
  }

  return {
    configured,
    baseUrl,
    host,
    model,
    apiKey,
    timeoutMs: int(env.LLM_TIMEOUT_MS, 25_000, 1_000, 300_000, "LLM_TIMEOUT_MS", problems),
    reasoningEffort,
    maxRetries: int(env.LLM_MAX_RETRIES, 2, 0, 5, "LLM_MAX_RETRIES", problems),
    maxCompletionTokens: int(env.LLM_MAX_COMPLETION_TOKENS, 3_000, 200, 16_000, "LLM_MAX_COMPLETION_TOKENS", problems),
    problems,
  };
}

/** Safe-to-print summary: never includes the key. */
export function describeSettings(s: LlmSettings): string {
  return s.configured
    ? `LLM configured: ${s.model} via ${s.host} (reasoning=${s.reasoningEffort ?? "off"}, timeout=${s.timeoutMs}ms, retries=${s.maxRetries})`
    : "LLM not configured: analysis will run in degraded (rules-only) mode";
}
