import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../api/app";
import { AnalysisService } from "../analysis/service";
import type { IngestLimits } from "../ingestion/limits";
import { loadLlmSettings, type LlmSettings } from "../llm/config";
import { ProviderStatusTracker } from "../llm/status";
import type { LlmClient, LlmRequest, LlmResult } from "../llm/types";
import { MemoryRepository } from "../storage/memoryRepository";
import type { MailboxRepository } from "../storage/repository";
import { WIRE_BODY } from "./agentFixtures";

export interface Started {
  baseUrl: string;
  repo: MailboxRepository;
  analysis: AnalysisService;
  tracker: ProviderStatusTracker;
  logs: string[];
  get(path: string, init?: RequestInit): Promise<{ status: number; headers: Headers; body: any; text: string }>;
  postJson(path: string, body: unknown): Promise<{ status: number; headers: Headers; body: any; text: string }>;
  postRaw(path: string, text: string, contentType: string): Promise<{ status: number; headers: Headers; body: any; text: string }>;
  postFile(
    path: string,
    file: { name: string; data: Uint8Array | Buffer; type?: string },
    fields?: Record<string, string>,
  ): Promise<{ status: number; headers: Headers; body: any; text: string }>;
  close(): Promise<void>;
}

export interface StartOptions {
  repo?: MailboxRepository;
  llm?: LlmClient | null;
  limits?: Partial<IngestLimits>;
  corsOrigins?: string[];
  llmSettings?: Pick<LlmSettings, "configured" | "host" | "model" | "problems">;
  maxRuns?: number;
  queueCapacity?: number;
}

async function read(res: Response) {
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, headers: res.headers, body, text };
}

/** Starts the real Express app (real routes, real repository) on an ephemeral loopback port. */
export async function startApi(opts: StartOptions = {}): Promise<Started> {
  const repo = opts.repo ?? new MemoryRepository();
  const maxRuns = opts.maxRuns ?? 3;
  const tracker = new ProviderStatusTracker();
  const logs: string[] = [];
  const analysis = new AnalysisService(repo, opts.llm ?? null, {
    concurrency: 1,
    maxRuns,
    queueCapacity: opts.queueCapacity ?? 50,
    maxCompletionTokens: 1000,
    log: (m) => logs.push(m),
  });
  const app = createApp({
    repo,
    analysis,
    orgDomains: ["arcline.com"],
    maxRuns,
    corsOrigins: opts.corsOrigins ?? ["http://localhost:5173"],
    limits: opts.limits,
    llm: opts.llmSettings ?? loadLlmSettings({}),
    providerStatus: () => tracker.snapshot(),
    log: (m) => logs.push(m),
  });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    baseUrl,
    repo,
    analysis,
    tracker,
    logs,
    get: async (path, init) => read(await fetch(baseUrl + path, init)),
    postJson: async (path, body) =>
      read(await fetch(baseUrl + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })),
    postRaw: async (path, text, contentType) =>
      read(await fetch(baseUrl + path, { method: "POST", headers: { "content-type": contentType }, body: text })),
    postFile: async (path, file, fields = {}) => {
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) form.append(k, v);
      form.append("file", new Blob([new Uint8Array(file.data)], { type: file.type ?? "application/octet-stream" }), file.name);
      return read(await fetch(baseUrl + path, { method: "POST", body: form }));
    },
    close: async () => {
      await analysis.stop(1000).catch(() => undefined);
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

/** Poll until `fn` returns a truthy value (or throw after `ms`). */
export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 3000, label = "condition"): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/**
 * Wraps a scripted client so each call waits for `release()`. Lets a test observe the
 * intermediate processing states (queued / extracting / analyzing) deterministically.
 */
export class GatedLlm implements LlmClient {
  readonly model: string;
  private waiters: (() => void)[] = [];
  private open = false;
  entered = 0;

  constructor(
    private readonly inner: LlmClient,
    private readonly startsOpen = false,
  ) {
    this.model = inner.model;
    this.open = startsOpen;
  }

  get callCount(): number {
    return (this.inner as unknown as { callCount: number }).callCount ?? 0;
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    this.entered++;
    if (!this.open) await new Promise<void>((resolve) => this.waiters.push(resolve));
    return this.inner.complete(request);
  }

  release(): void {
    this.open = true;
    for (const w of this.waiters.splice(0)) w();
  }
}

export const PASTE_WIRE =
  "From: Dana Cole <d.cole@acme-parts.example>\nTo: ap@arcline.com\nDate: Tue, 02 Jun 2026 08:14:00 +0000\n" +
  `Subject: URGENT wire before noon\n\n${WIRE_BODY}`;

export const PASTE_BENIGN =
  "From: Facilities <facilities@arcline.com>\nTo: all-staff@arcline.com\nDate: Wed, 03 Jun 2026 09:00:00 +0000\n" +
  "Subject: Kitchen rota\n\nHi all, the June kitchen rota is on the fridge. Thanks!";
