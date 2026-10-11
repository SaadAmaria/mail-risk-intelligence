import express from "express";
import type { HealthResponse } from "@mri/shared";
import { config } from "./config";
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

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  const body: HealthResponse = {
    status: "ok",
    service: "mail-risk-intelligence",
    llm: {
      configured: Boolean(config.llm.baseUrl && config.llm.model),
      provider: config.llm.baseUrl ? new URL(config.llm.baseUrl).host : null,
      model: config.llm.model,
    },
  };
  res.json(body);
});

const server = app.listen(config.port, config.host, () => {
  console.log(`server listening on http://${config.host}:${config.port} (${repo.countEmails()} emails stored)`);
});

function shutdown(): void {
  server.close(() => {
    repo.close();
    process.exit(0);
  });
  // Do not hang on keep-alive connections.
  setTimeout(() => {
    repo.close();
    process.exit(0);
  }, 2000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
