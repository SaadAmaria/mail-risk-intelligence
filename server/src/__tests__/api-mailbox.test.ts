import { afterEach, describe, expect, it } from "vitest";
import { FakeLlm } from "./fakes/fakeLlm";
import { startApi, type Started } from "./apiHarness";
import { loadSeed } from "./riskFixtures";

let app: Started | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function seeded(): Promise<{ app: Started; llm: FakeLlm }> {
  const { repo } = await loadSeed();
  const llm = new FakeLlm([]); // any provider call would throw: the script is empty
  app = await startApi({ repo, llm });
  return { app, llm };
}

const ids = (body: any) => body.emails.map((e: any) => e.id);

describe("GET /api/emails", () => {
  it("returns all seed emails ordered by date, newest first", async () => {
    const { app } = await seeded();
    const r = await app.get("/api/emails");
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(10);
    expect(r.body.count).toBe(10);
    expect(ids(r.body)).toEqual(["E010", "E008", "E007", "E006", "E005", "E004", "E003", "E002", "E001", "E009"]);
  });

  it("supports ascending order", async () => {
    const { app } = await seeded();
    const r = await app.get("/api/emails?order=asc");
    expect(ids(r.body)).toEqual(["E009", "E001", "E002", "E003", "E004", "E005", "E006", "E007", "E008", "E010"]);
  });

  it("each item has sender, subject, date, processing state, risk and provenance", async () => {
    const { app } = await seeded();
    const r = await app.get("/api/emails");
    const e004 = r.body.emails.find((e: any) => e.id === "E004");
    expect(e004).toMatchObject({
      id: "E004",
      from: { address: "billing@northgate-suppliers.com" },
      subject: "Invoice #NS-4471 - please note updated payment details",
      date: "2026-06-04T11:20:00Z",
      source_kind: "seed",
      attachment_count: 1,
      processing: { status: "not_started", provenance: null, in_progress: false, can_reprocess: true },
      risk: { final_level: "medium", assessed: false, ai_level: null, rules_level: "medium", basis: "rules_only" },
    });
    expect(e004.risk.finding_count).toBe(2);
  });

  it("distinguishes unassessed from none: with no AI nothing is reported as 'none'", async () => {
    const { app } = await seeded();
    const r = await app.get("/api/emails");
    const level = (id: string) => r.body.emails.find((e: any) => e.id === id).risk.final_level;
    expect(["E001", "E003", "E004", "E005", "E006", "E008"].map(level)).toEqual(Array(6).fill("medium"));
    expect(["E002", "E007", "E009", "E010"].map(level)).toEqual(Array(4).fill("unassessed"));
    expect(r.body.emails.some((e: any) => e.risk.final_level === "none")).toBe(false);
    expect(r.body.emails.every((e: any) => e.risk.assessed === false)).toBe(true);
  });

  it("filters by risk level, including unassessed", async () => {
    const { app } = await seeded();
    expect(ids((await app.get("/api/emails?risk=medium")).body)).toEqual(["E008", "E006", "E005", "E004", "E003", "E001"]);
    expect(ids((await app.get("/api/emails?risk=unassessed")).body)).toEqual(["E010", "E007", "E002", "E009"]);
    expect((await app.get("/api/emails?risk=none")).body.total).toBe(0);
    expect((await app.get("/api/emails?risk=high")).body.total).toBe(0);
    expect((await app.get("/api/emails?risk=medium,unassessed")).body.total).toBe(10);
  });

  it("filters by processing status", async () => {
    const { app } = await seeded();
    expect((await app.get("/api/emails?status=not_started")).body.total).toBe(10);
    expect((await app.get("/api/emails?status=complete")).body.total).toBe(0);
    expect((await app.get("/api/emails?status=degraded,partial,failed")).body.total).toBe(0);
  });

  it("searches subject, sender and body, case-insensitively", async () => {
    const { app } = await seeded();
    expect(ids((await app.get("/api/emails?q=invoice")).body)).toEqual(["E004", "E009"]);
    expect(ids((await app.get("/api/emails?q=NORTHGATE")).body)).toEqual(["E004", "E009"]);
    expect(ids((await app.get("/api/emails?q=halvorsen")).body)).toEqual(["E005"]);
    expect((await app.get("/api/emails?q=zzzz-no-such-text")).body.total).toBe(0);
  });

  it("combines filters and applies the limit after filtering", async () => {
    const { app } = await seeded();
    const r = await app.get("/api/emails?risk=medium&q=arcline&limit=2");
    expect(r.body.count).toBe(2);
    expect(r.body.total).toBeGreaterThan(2);
    const all = await app.get("/api/emails?limit=3");
    expect(all.body).toMatchObject({ count: 3, total: 10 });
  });

  it.each([
    ["risk=critical"],
    ["status=done"],
    ["order=sideways"],
    ["limit=0"],
    ["limit=501"],
    ["limit=abc"],
    ["q=a&q=b"],
    ["q=" + "x".repeat(201)],
  ])("rejects an invalid query (%s) with the standard error shape", async (qs) => {
    const { app } = await seeded();
    const r = await app.get(`/api/emails?${qs}`);
    expect(r.status).toBe(400);
    expect(Object.keys(r.body)).toEqual(["error"]);
    expect(r.body.error.code).toBe("invalid_query");
    expect(typeof r.body.error.message).toBe("string");
  });

  it("never calls the LLM, however the mailbox is read", async () => {
    const { app, llm } = await seeded();
    await app.get("/api/emails");
    await app.get("/api/emails/E004");
    await app.get("/api/emails?risk=medium");
    await app.get("/api/graph");
    await app.get("/api/health");
    expect(llm.callCount).toBe(0);
    expect(app.analysis.queueDepth).toEqual({ waiting: 0, running: 0 });
  });
});

describe("GET /api/emails/:id", () => {
  it("returns original content, attachments, risk, cross-email findings and an empty analysis", async () => {
    const { app } = await seeded();
    const r = await app.get("/api/emails/E004");
    expect(r.status).toBe(200);
    const b = r.body;
    expect(b.email).toMatchObject({
      id: "E004",
      external_id: "E004",
      subject: "Invoice #NS-4471 - please note updated payment details",
      from: { address: "billing@northgate-suppliers.com" },
      to: [{ address: "accounts-payable@arcline.com" }],
      date: "2026-06-04T11:20:00Z",
    });
    expect(b.email.body).toContain("recently changed banking providers");
    expect(b.email.attachments).toHaveLength(1);
    expect(b.email.attachments[0]).toMatchObject({ filename: "invoice_NS-4471.pdf", extraction_status: "ok", text_origin: "provided" });
    expect(b.email.attachments[0].extracted_text).toContain("account ending 9902");

    expect(b.processing).toMatchObject({ status: "not_started", provenance: null, runs: [] });
    expect(b.extraction).toBeNull();
    expect(b.assessment).toBeNull();

    expect(b.risk.final_level).toBe("medium");
    expect(b.risk.assessed).toBe(false);
    const rules = b.risk.findings.map((f: any) => f.rule_id).sort();
    expect(rules).toEqual(["invoice_amount_anomaly", "payment_account_changed"]);
    const acct = b.risk.findings.find((f: any) => f.rule_id === "payment_account_changed");
    expect(acct.related_email_ids).toEqual(["E009"]);
    expect(acct.identity).toBe("consistent");
    expect(new Set(acct.evidence.map((e: any) => e.email_id))).toEqual(new Set(["E004", "E009"]));
  });

  it("does not expose internal fields", async () => {
    const { app } = await seeded();
    const r = await app.get("/api/emails/E004");
    for (const secret of ["raw_source", "content_hash", "prompt_version\":\"extract", "SECURITY RULES", "stack"]) {
      expect(r.text).not.toContain(secret);
    }
  });

  it.each([["E999"], ["nope"], ["..%2F..%2Fetc%2Fpasswd"], ["x".repeat(300)], ["a b"]])(
    "returns a consistent 404 for %j",
    async (id) => {
      const { app } = await seeded();
      const r = await app.get(`/api/emails/${id}`);
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: { code: "not_found", message: "No such email." } });
    },
  );

  it("returns a JSON 404 for an unknown endpoint", async () => {
    const { app } = await seeded();
    const r = await app.get("/api/nope");
    expect(r.status).toBe(404);
    expect(Object.keys(r.body)).toEqual(["error"]);
    expect(r.body.error.code).toBe("not_found");
    expect(r.body.error.message).toBe("No such endpoint: GET /api/nope");
    const put = await app.get("/api/emails/E004", { method: "DELETE" });
    expect(put.status).toBe(404);
    expect(put.body.error.code).toBe("not_found");
  });
});
