import { fileURLToPath } from "node:url";
import { loadLlmSettings } from "./llm/config";

function intFromEnv(name: string, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const raw = process.env[name];
  const n = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

const llm = loadLlmSettings(process.env);

export const config = {
  port: intFromEnv("PORT", 3001),
  host: process.env.HOST?.trim() || "127.0.0.1",
  // Relative paths resolve against the server workspace directory (server/).
  dbPath: process.env.DB_PATH?.trim() || "./data/mail-risk.db",
  // Defaults to the original assignment file in the repository root. Read-only.
  seedPath:
    process.env.SEED_PATH?.trim() ||
    fileURLToPath(new URL("../../mock_mailbox_data.json", import.meta.url)),
  // Recorded fixtures (used only when no live LLM is configured). Read-only.
  replayDir: process.env.REPLAY_DIR?.trim() || fileURLToPath(new URL("../../fixtures/recorded", import.meta.url)),
  // Contains the API key: never log, serialize, or return this object. Use describeSettings()
  // or the health payload for anything user-visible.
  llm,
  // The organization's own domains: the reference for look-alike detection. Assumption: the
  // brief names the fictional organization "Arcline" and its mailboxes use arcline.com.
  orgDomains: (process.env.ORG_DOMAINS ?? "arcline.com")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)),
  // Browser origins allowed to call the API (exact match, no wildcard). The Vite dev proxy makes
  // the frontend same-origin, so this matters only when it is served from another origin.
  corsOrigins: (process.env.CORS_ORIGIN ?? "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => /^https?:\/\/[^\s/]+$/.test(o)),
  analysis: {
    // When "true", the server queues unanalyzed emails (and retries retriable ones) at start-up.
    // Default off so a start-up never sends mailbox content to a provider unprompted.
    autostart: process.env.ANALYSIS_AUTOSTART?.trim().toLowerCase() === "true",
    concurrency: intFromEnv("ANALYSIS_CONCURRENCY", 1, 1, 2),
    maxRuns: intFromEnv("ANALYSIS_MAX_RUNS", 3, 1, 10),
    queueCapacity: intFromEnv("ANALYSIS_QUEUE_CAPACITY", 200, 1, 10_000),
  },
} as const;
