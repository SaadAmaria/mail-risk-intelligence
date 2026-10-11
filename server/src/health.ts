import type { HealthResponse } from "@mri/shared";
import type { LlmSettings } from "./llm/config";
import type { ProviderStatusSnapshot } from "./llm/status";

/**
 * Health payload. Pure formatting of already-validated settings and of the last *observed*
 * provider outcome:
 *
 * - `configured` means "valid and usable configuration", never "reachable";
 * - `reachability` is "unchecked" until a real analysis call has happened, then reflects the last
 *   such call; building this payload NEVER contacts the provider;
 * - a malformed `LLM_BASE_URL` cannot throw here (it was rejected when settings were parsed);
 * - the API key is not read.
 */
export function buildHealth(
  llm: Pick<LlmSettings, "configured" | "host" | "model" | "problems">,
  observed?: ProviderStatusSnapshot,
): HealthResponse {
  const status: ProviderStatusSnapshot = llm.configured
    ? (observed ?? { reachability: "unchecked", last_call_at: null, last_error_kind: null })
    : { reachability: "unchecked", last_call_at: null, last_error_kind: null };

  return {
    status: "ok",
    service: "mail-risk-intelligence",
    llm: {
      configured: llm.configured,
      provider: llm.configured ? llm.host : null,
      model: llm.configured ? llm.model : null,
      reachability: status.reachability,
      last_call_at: status.last_call_at,
      last_error_kind: status.last_error_kind,
      problems: [...llm.problems],
    },
  };
}

/** Express-compatible handler factory (kept free of any express import for testability). */
export function healthHandler(
  llm: Pick<LlmSettings, "configured" | "host" | "model" | "problems">,
  snapshot: () => ProviderStatusSnapshot,
) {
  return (_req: unknown, res: { json: (body: HealthResponse) => void }): void => {
    res.json(buildHealth(llm, snapshot()));
  };
}
