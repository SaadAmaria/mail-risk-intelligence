import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../api/app";
import { AnalysisService } from "../analysis/service";
import { loadLlmSettings } from "../llm/config";
import { ProviderStatusTracker } from "../llm/status";
import { MemoryRepository } from "../storage/memoryRepository";
import { startApi, PASTE_WIRE, type Started } from "./apiHarness";
import { FakeLlm, fail } from "./fakes/fakeLlm";
import { loadSeed } from "./riskFixtures";

const ALLOWED = "http://localhost:5173";
const EVIL = "http://evil.example";

let app: Started | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

/** A raw HTTP request, so tests control Host and Origin exactly (fetch forbids some headers). */
function raw(
  baseUrl: string,
  opts: { method?: string; path: string; headers?: Record<string, string>; body?: string | Buffer },
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: any }> {
  const u = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = request(
      { host: u.hostname, port: Number(u.port), method: opts.method ?? "POST", path: opts.path, headers: opts.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let body: any = null;
          try {
            body = text ? JSON.parse(text) : null;
          } catch {
            body = text;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        });
      },
    );
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

async function seeded(llm = new FakeLlm([fail("http"), fail("http"), fail("http")])) {
  const { repo } = await loadSeed();
  app = await startApi({ repo, llm, llmSettings: loadLlmSettings({ LLM_BASE_URL: "https://fake.example/v1", LLM_API_KEY: "test-key-not-real", LLM_MODEL: "m" }) });
  return { repo, llm, app: app! };
}

/** Nothing the rejected request could have caused has happened. */
async function expectNoSideEffects(ctx: Awaited<ReturnType<typeof seeded>>, emailsBefore: number) {
  await ctx.app.analysis.idle();
  expect(ctx.llm.callCount).toBe(0);
  expect(ctx.app.analysis.queueDepth).toEqual({ waiting: 0, running: 0 });
  expect(ctx.repo.getAnalysis("E009")).toBeNull();
  expect(ctx.repo.countEmails()).toBe(emailsBefore);
}

describe("every state-changing route is known and guarded", () => {
  it("lists exactly the mutating routes the tests below cover", () => {
    const repo = new MemoryRepository();
    const analysis = new AnalysisService(repo, null, { concurrency: 1, maxRuns: 3, queueCapacity: 5, maxCompletionTokens: 100 });
    const express = createApp({
      repo,
      analysis,
      orgDomains: [],
      maxRuns: 3,
      corsOrigins: [ALLOWED],
      llm: loadLlmSettings({}),
      providerStatus: () => new ProviderStatusTracker().snapshot(),
    });
    const stack = (express as unknown as { _router: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] } })._router.stack;
    const mutating = stack
      .filter((l) => l.route)
      .flatMap((l) => Object.keys(l.route!.methods).filter((m) => !["get", "head", "options"].includes(m)).map((m) => `${m.toUpperCase()} ${l.route!.path}`))
      .sort();
    expect(mutating).toEqual(["POST /api/emails", "POST /api/emails/:id/automatic-checks", "POST /api/emails/:id/reprocess"]);
  });
});

describe("untrusted browser origins cannot cause a side effect", () => {
  it("the audited attack: a cross-origin text/plain POST to reprocess is refused before anything is queued", async () => {
    const ctx = await seeded();
    const before = ctx.repo.countEmails();
    const r = await raw(ctx.app.baseUrl, {
      path: "/api/emails/E009/reprocess",
      headers: { origin: EVIL, "content-type": "text/plain", "content-length": "1" },
      body: "x",
    });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("origin_not_allowed");
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
    await expectNoSideEffects(ctx, before);
  });

  it("is refused whatever the content type is: changing it cannot bypass the origin check", async () => {
    const ctx = await seeded();
    const before = ctx.repo.countEmails();
    for (const ct of ["application/json", "text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      const r = await raw(ctx.app.baseUrl, {
        path: "/api/emails/E009/reprocess",
        headers: { origin: EVIL, "content-type": ct },
        body: "{}",
      });
      expect(r.status, ct).toBe(403);
    }
    await expectNoSideEffects(ctx, before);
  });

  it("is refused on every other mutating route, including upload and paste", async () => {
    const ctx = await seeded();
    const before = ctx.repo.countEmails();
    const automatic = await raw(ctx.app.baseUrl, { path: "/api/emails/E009/automatic-checks", headers: { origin: EVIL } });
    expect(automatic.status).toBe(403);
    const paste = await raw(ctx.app.baseUrl, {
      path: "/api/emails",
      headers: { origin: EVIL, "content-type": "application/json" },
      body: JSON.stringify({ raw_text: PASTE_WIRE, analyze: true }),
    });
    expect(paste.status).toBe(403);
    const upload = await raw(ctx.app.baseUrl, {
      path: "/api/emails",
      headers: { origin: EVIL, "content-type": "multipart/form-data; boundary=BOUND" },
      body: '--BOUND\r\nContent-Disposition: form-data; name="analyze"\r\n\r\ntrue\r\n--BOUND\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nFrom: a@b.example\r\n\r\nhi\r\n--BOUND--\r\n',
    });
    expect(upload.status).toBe(403);
    await expectNoSideEffects(ctx, before);
  });

  it("refuses an opaque 'null' origin and a DNS-rebinding page (Origin equals Host, but the host is not trusted)", async () => {
    const ctx = await seeded();
    const before = ctx.repo.countEmails();
    const nul = await raw(ctx.app.baseUrl, { path: "/api/emails/E009/reprocess", headers: { origin: "null" } });
    expect(nul.status).toBe(403);
    const rebind = await raw(ctx.app.baseUrl, {
      path: "/api/emails/E009/reprocess",
      headers: { origin: "http://evil.example:3001", host: "evil.example:3001" },
    });
    expect(rebind.status).toBe(403);
    await expectNoSideEffects(ctx, before);
  });

  it("refuses a request the browser itself marks as cross-site even when it carries no Origin", async () => {
    const ctx = await seeded();
    const before = ctx.repo.countEmails();
    for (const site of ["cross-site", "same-site"]) {
      const r = await raw(ctx.app.baseUrl, { path: "/api/emails/E009/reprocess", headers: { "sec-fetch-site": site } });
      expect(r.status, site).toBe(403);
    }
    await expectNoSideEffects(ctx, before);
  });

  it("does not grant a preflight to an untrusted origin", async () => {
    const ctx = await seeded();
    const r = await raw(ctx.app.baseUrl, {
      method: "OPTIONS",
      path: "/api/emails/E009/reprocess",
      headers: { origin: EVIL, "access-control-request-method": "POST" },
    });
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
    expect(ctx.llm.callCount).toBe(0);
  });
});

describe("legitimate callers keep working", () => {
  it("accepts the configured frontend origin (JSON and bodyless) and reflects it for CORS", async () => {
    const ctx = await seeded();
    const r = await raw(ctx.app.baseUrl, {
      path: "/api/emails/E009/reprocess",
      headers: { origin: ALLOWED, "content-type": "application/json" },
      body: "{}",
    });
    expect(r.status).toBe(202);
    expect(r.headers["access-control-allow-origin"]).toBe(ALLOWED);
    await ctx.app.analysis.idle();
    const auto = await raw(ctx.app.baseUrl, { path: "/api/emails/E010/automatic-checks", headers: { origin: ALLOWED } });
    expect(auto.status).toBe(200);
  });

  it("accepts a same-origin request to a loopback host on any port (the app served from the API host itself)", async () => {
    const ctx = await seeded();
    const r = await raw(ctx.app.baseUrl, {
      path: "/api/emails/E010/automatic-checks",
      headers: { origin: "http://127.0.0.1:5199", host: "127.0.0.1:5199" },
    });
    expect(r.status).toBe(200);
    const v6 = await raw(ctx.app.baseUrl, {
      path: "/api/emails/E010/automatic-checks",
      headers: { origin: "http://localhost:5555", host: "localhost:5555" },
    });
    expect(v6.status).toBe(200);
  });

  it("accepts a request with no Origin (scripts, curl) and the documented JSON and upload forms", async () => {
    const ctx = await seeded();
    const a = await raw(ctx.app.baseUrl, { path: "/api/emails/E010/automatic-checks" });
    expect(a.status).toBe(200);
    const paste = await raw(ctx.app.baseUrl, {
      path: "/api/emails",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raw_text: PASTE_WIRE }),
    });
    expect([200, 201]).toContain(paste.status);
    const upload = await raw(ctx.app.baseUrl, {
      path: "/api/emails",
      headers: { origin: ALLOWED, "content-type": "multipart/form-data; boundary=BOUND" },
      body: '--BOUND\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nFrom: Zed <z@zed.example>\r\nTo: ap@arcline.com\r\nDate: Tue, 02 Jun 2026 08:14:00 +0000\r\nSubject: hello\r\n\r\nHi there.\r\n--BOUND--\r\n',
    });
    expect([200, 201]).toContain(upload.status);
  });

  it("leaves reads untouched: a GET from any origin is served, with no CORS grant for an untrusted one", async () => {
    const ctx = await seeded();
    const r = await raw(ctx.app.baseUrl, { method: "GET", path: "/api/emails?limit=1", headers: { origin: EVIL } });
    expect(r.status).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("content types", () => {
  it("refuses unsupported content types on every mutating route, with no side effect, even with no Origin", async () => {
    const ctx = await seeded();
    const before = ctx.repo.countEmails();
    for (const ct of ["text/plain", "application/x-www-form-urlencoded", "text/html", "application/xml"]) {
      for (const path of ["/api/emails/E009/reprocess", "/api/emails/E009/automatic-checks", "/api/emails"]) {
        const r = await raw(ctx.app.baseUrl, { path, headers: { "content-type": ct }, body: "x=1" });
        expect(r.status, `${path} ${ct}`).toBe(415);
        expect(r.body.error.code).toBe("unsupported_content_type");
      }
    }
    await expectNoSideEffects(ctx, before);
  });

  it("allows multipart only on the upload route", async () => {
    const ctx = await seeded();
    const r = await raw(ctx.app.baseUrl, {
      path: "/api/emails/E009/reprocess",
      headers: { "content-type": "multipart/form-data; boundary=B" },
      body: "--B--\r\n",
    });
    expect(r.status).toBe(415);
    await expectNoSideEffects(ctx, (await loadSeed()).repo.countEmails());
  });

  it("keeps malformed JSON a plain 400 from a trusted origin", async () => {
    const ctx = await seeded();
    const r = await raw(ctx.app.baseUrl, {
      path: "/api/emails",
      headers: { origin: ALLOWED, "content-type": "application/json" },
      body: "{not json",
    });
    expect(r.status).toBe(400);
  });
});
