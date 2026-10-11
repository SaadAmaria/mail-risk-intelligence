import express from "express";
import type { HealthResponse } from "@mri/shared";
import { config } from "./config";

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

app.listen(config.port, config.host, () => {
  console.log(`server listening on http://${config.host}:${config.port}`);
});
