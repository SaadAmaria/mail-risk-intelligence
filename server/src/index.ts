import express from "express";
import { AnalysisService } from "./analysis/service";
import { config } from "./config";
import { healthHandler } from "./health";
import { OpenAICompatClient } from "./llm/client";
import { describeSettings } from "./llm/config";
import { ProviderStatusTracker } from "./llm/status";
import { initialize, StartupError } from "./startup";

// Mandatory initialization is strict: a missing, invalid, or incomplete seed mailbox (or an
// unusable database) stops the process with a clear message instead of serving an empty demo.
let started;
try {
  started = await initialize({ dbPath: config.dbPath, seedPath: config.seedPath });
} catch (err) {
  if (err instanceof StartupError) {
    console.error(`startup failed [${err.code}]: ${err.message}`);
    for (const d of err.details) console.error(`  - ${d}`);
  } else {
    // Unexpected: report the message only (no stack, no data).
    console.error(`startup failed: ${err instanceof Error ? err.message.slice(0, 300) : "unknown error"}`);
  }
  process.exit(1);
}

const { repo, report } = started;
console.log(`seed: ${report.created} created, ${report.existing} already present (of ${report.total})`);

// LLM + analysis. A missing or malformed LLM configuration is not fatal: analysis then runs in
// degraded (code-only) mode and every affected email is stored as "degraded", never as safe.
console.log(describeSettings(config.llm));
for (const p of config.llm.problems) console.warn(`llm config: ${p}`);

// Health reports the last OBSERVED provider outcome; it never calls the provider itself.
const providerStatus = new ProviderStatusTracker();

const analysis = new AnalysisService(
  repo,
  config.llm.configured
    ? OpenAICompatClient.fromSettings(config.llm, { onResult: (o) => providerStatus.record(o) })
    : null,
  {
    concurrency: config.analysis.concurrency,
    maxRuns: config.analysis.maxRuns,
    queueCapacity: config.analysis.queueCapacity,
    maxCompletionTokens: config.llm.maxCompletionTokens,
    log: (m) => console.warn(m),
  },
);

const recovered = analysis.recoverInterrupted();
if (recovered.length > 0) console.log(`analysis: re-queued ${recovered.length} interrupted email(s)`);
if (config.analysis.autostart) {
  const queued = analysis.enqueueUnanalyzed();
  console.log(`analysis: autostart queued ${queued.length} email(s)`);
} else {
  console.log("analysis: autostart is off (set ANALYSIS_AUTOSTART=true to analyze at start-up)");
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", healthHandler(config.llm, () => providerStatus.snapshot()));

const server = app.listen(config.port, config.host, () => {
  console.log(`server listening on http://${config.host}:${config.port} (${repo.countEmails()} emails stored)`);
});

async function shutdown(): Promise<void> {
  // Let a running analysis finish its current call (bounded), then close the database.
  await analysis.stop(4000);
  server.close(() => {
    repo.close();
    process.exit(0);
  });
  setTimeout(() => {
    repo.close();
    process.exit(0);
  }, 2000).unref();
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
