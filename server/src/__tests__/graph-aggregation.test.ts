import { afterEach, describe, expect, it } from "vitest";
import type { AnalysisRecord, RiskAnalysis, StoredEmail } from "@mri/shared";
import { FakeLlm } from "./fakes/fakeLlm";
import { startApi, type Started } from "./apiHarness";
import { aiComplete, loadSeed, notComplete } from "./riskFixtures";

/**
 * Phase 9A acceptance: the cross-email aggregation claim, tested with isolated records (no
 * recordings, no provider). The same normalized entity appearing in two processed messages must be
 * ONE node that cites BOTH messages, each message's own relationships must remain, and nothing may
 * be manufactured between them.
 */
let app: Started | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

type E = RiskAnalysis["entities"][number];
type R = RiskAnalysis["relationships"][number];
const record = (e: StoredEmail, entities: E[], relationships: R[]): AnalysisRecord =>
  aiComplete(e, "none", { entities, relationships, evidence: false });

const org = (ref: string, name: string): E => ({ ref, type: "organization", name });
const person = (ref: string, name: string, email?: string): E => ({ ref, type: "person", name, ...(email ? { attributes: { email } } : {}) });
const acct = (ref: string, name: string): E => ({ ref, type: "account", name });
const rel = (from: string, predicate: R["predicate"], to: string, quote: string): R => ({ from_ref: from, predicate, to_ref: to, snippet_id: "s1", quote });

const VENDOR = "organization:name:northgate suppliers";

async function twoMessages() {
  const { repo } = await loadSeed(["E004", "E009"]);
  const e004 = repo.getEmail("E004")!;
  const e009 = repo.getEmail("E009")!;
  // The vendor is written differently in each message; both normalize to the same name.
  repo.saveAnalysis(
    record(
      e004,
      [org("v", "Northgate Suppliers Inc."), acct("a", "account ending 9902"), org("c", "Arcline")],
      [rel("v", "requests_transfer_to", "a", "New payment account: routing 044000037, account ending 9902"), rel("v", "sent_email_to", "c", "Invoice #NS-4471")],
    ),
  );
  repo.saveAnalysis(
    record(
      e009,
      [org("v", "NORTHGATE SUPPLIERS, INC."), person("p", "Billing", "billing@northgate-suppliers.com"), org("c", "Arcline")],
      [rel("v", "sent_email_to", "c", "Invoice #NS-4188")],
    ),
  );
  return { repo, e004, e009 };
}

describe("cross-email aggregation", () => {
  it("one normalized entity in two messages is exactly one node citing both sources", async () => {
    const { repo } = await twoMessages();
    app = await startApi({ repo });
    const g = (await app.get("/api/graph")).body;

    const vendors = g.nodes.filter((n: any) => n.type === "organization" && /northgate/i.test(n.label));
    expect(vendors).toHaveLength(1);
    expect(vendors[0].id).toBe(VENDOR);
    expect(vendors[0].email_ids).toEqual(["E004", "E009"]);
    expect(vendors[0].mention_count).toBe(2);
    expect(vendors[0].origin).toBe("ai");

    const arcline = g.nodes.filter((n: any) => n.label === "Arcline");
    expect(arcline).toHaveLength(1);
    expect(arcline[0].email_ids).toEqual(["E004", "E009"]);
  });

  it("keeps every real relationship, aggregated with per-message evidence, and invents none", async () => {
    const { repo } = await twoMessages();
    app = await startApi({ repo });
    const g = (await app.get("/api/graph?include_amounts=true")).body;

    const sent = g.edges.find((e: any) => e.predicate === "sent_email_to");
    expect(sent.source).toBe(VENDOR);
    expect(sent.count).toBe(2);
    expect(sent.email_ids).toEqual(["E004", "E009"]);
    expect(sent.evidence.map((x: any) => [x.email_id, x.quote]).sort()).toEqual([
      ["E004", "Invoice #NS-4471"],
      ["E009", "Invoice #NS-4188"],
    ]);
    const transfer = g.edges.find((e: any) => e.predicate === "requests_transfer_to");
    expect(transfer.email_ids).toEqual(["E004"]); // only one message said it

    // exactly the two relationships that were extracted, all AI-derived, none touching header people
    expect(g.edges).toHaveLength(2);
    expect(g.edges.every((e: any) => e.origin === "ai")).toBe(true);
    const pairs = new Set(g.edges.map((e: any) => `${e.source}|${e.target}`));
    const people = g.nodes.filter((n: any) => n.type === "person").map((n: any) => n.id);
    for (const e of g.edges) {
      expect(people.includes(e.source) || people.includes(e.target)).toBe(false);
    }
    expect(pairs.size).toBe(2);
  });

  it("an identical verified address merges people, labelled as rules-derived with both sources", async () => {
    const { repo } = await twoMessages();
    app = await startApi({ repo });
    const g = (await app.get("/api/graph")).body;
    const sender = g.nodes.find((n: any) => n.id === "person:email:billing@northgate-suppliers.com");
    expect(sender.email_ids).toEqual(["E004", "E009"]);
    expect(sender.key_basis).toBe("email_address");
    // header-derived on E004 (rules), also named by the AI on E009: the node is AI because an AI
    // mention exists, and still lists the rules-derived mention in the message detail
    const d004 = (await app.get("/api/emails/E004")).body;
    const mention = d004.entities.find((e: any) => e.key === sender.id);
    expect(mention.also_in).toEqual(["E009"]);
    expect(mention.mentions.every((m: any) => m.origin === "rules")).toBe(true);
    expect(g.edges.every((e: any) => e.origin === "ai")).toBe(true);
  });

  it("each message detail exposes the shared entity and where else it appears", async () => {
    const { repo } = await twoMessages();
    app = await startApi({ repo });
    for (const [id, other] of [["E004", "E009"], ["E009", "E004"]] as const) {
      const d = (await app.get(`/api/emails/${id}`)).body;
      const v = d.entities.find((e: any) => e.key === VENDOR);
      expect(v.also_in).toEqual([other]);
      const r = d.relationships.find((x: any) => x.predicate === "sent_email_to");
      expect(r.also_in).toEqual([other]);
      expect(r.evidence).toHaveLength(1); // only this message's own quote
    }
  });

  it("dropping one source (it stops being a complete AI analysis) removes only its contribution", async () => {
    const { repo, e009 } = await twoMessages();
    app = await startApi({ repo });
    repo.saveAnalysis(notComplete(e009, "degraded"));
    const g = (await app.get("/api/graph")).body;

    const vendor = g.nodes.find((n: any) => n.id === VENDOR);
    expect(vendor.email_ids).toEqual(["E004"]);
    expect(vendor.mention_count).toBe(1);
    const sent = g.edges.find((e: any) => e.predicate === "sent_email_to");
    expect(sent.count).toBe(1);
    expect(sent.email_ids).toEqual(["E004"]);
    expect(sent.evidence.map((x: any) => x.email_id)).toEqual(["E004"]);
    // E009's header people remain as rules-derived nodes; no AI edge comes from them
    expect(g.nodes.some((n: any) => n.origin === "rules" && n.email_ids.includes("E009"))).toBe(true);
    expect(g.edges.every((e: any) => e.email_ids.every((i: string) => i === "E004"))).toBe(true);
  });

  it("the same name without a shared identity is NOT merged for people (two different 'Jane Roe')", async () => {
    const { repo: seeded } = await loadSeed(["E004", "E009"]);
    const a = seeded.getEmail("E004")!;
    const b = seeded.getEmail("E009")!;
    seeded.saveAnalysis(record(a, [person("p", "Jane Roe"), org("o", "Acme")], [rel("p", "employed_by", "o", "joins Acme")]));
    seeded.saveAnalysis(record(b, [person("p", "Jane Roe"), org("o", "Beta")], [rel("p", "employed_by", "o", "is at Beta")]));
    app = await startApi({ repo: seeded });
    const g = (await app.get("/api/graph")).body;
    const janes = g.nodes.filter((n: any) => n.label === "Jane Roe");
    expect(janes).toHaveLength(2);
    expect(janes.map((j: any) => j.email_ids).sort()).toEqual([["E004"], ["E009"]]);
  });

  it("is a pure read: no provider call, no stored change", async () => {
    const { repo } = await twoMessages();
    const llm = new FakeLlm([]);
    app = await startApi({ repo, llm });
    const before = JSON.stringify(repo.listAnalyses());
    await app.get("/api/graph");
    await app.get("/api/graph?include_amounts=true");
    expect(llm.callCount).toBe(0);
    expect(JSON.stringify(repo.listAnalyses())).toBe(before);
  });
});
