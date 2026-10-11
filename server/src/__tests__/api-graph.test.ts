import { afterEach, describe, expect, it } from "vitest";
import type { AnalysisRecord, RiskAnalysis, StoredEmail } from "@mri/shared";
import { FakeLlm } from "./fakes/fakeLlm";
import { startApi, type Started } from "./apiHarness";
import { aiComplete, loadSeed, notComplete, pasted } from "./riskFixtures";
import { MemoryRepository } from "../storage/memoryRepository";

let app: Started | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

type E = RiskAnalysis["entities"][number];
type R = RiskAnalysis["relationships"][number];

function withEntities(e: StoredEmail, entities: E[], relationships: R[] = [], level: "none" | "low" = "none"): AnalysisRecord {
  return aiComplete(e, level, { entities, relationships, evidence: false });
}

const org = (ref: string, name = "Northgate Suppliers Inc."): E => ({ ref, type: "organization", name });
const acct = (ref: string, name: string): E => ({ ref, type: "account", name });
const owns = (from: string, to: string, quote: string): R => ({ from_ref: from, predicate: "owns_account", to_ref: to, snippet_id: "s1", quote });

async function seededWithGraph() {
  const { repo, emails } = await loadSeed();
  const e004 = repo.getEmail("E004")!;
  const e009 = repo.getEmail("E009")!;
  repo.saveAnalysis(
    withEntities(e009, [org("o"), acct("a", "account ending 6621")], [owns("o", "a", "account ending 6621")]),
  );
  repo.saveAnalysis(
    withEntities(
      e004,
      [org("o"), acct("a", "account ending 6621"), acct("b", "account ending 9902"), { ref: "m", type: "amount", name: "$47,300" }],
      [owns("o", "a", "account ending 6621"), owns("o", "b", "account ending 9902")],
      "low",
    ),
  );
  // a degraded email: header-derived people only, no relationships
  repo.saveAnalysis(notComplete(repo.getEmail("E001")!, "degraded"));
  return { repo, emails };
}

describe("GET /api/graph", () => {
  it("aggregates verified entities and relationships across emails, with provenance and evidence", async () => {
    const { repo } = await seededWithGraph();
    app = await startApi({ repo, llm: new FakeLlm([]) });
    const g = (await app.get("/api/graph")).body;

    const northgate = g.nodes.find((n: any) => n.id === "organization:name:northgate suppliers");
    expect(northgate).toMatchObject({ type: "organization", label: "Northgate Suppliers Inc.", origin: "ai", key_basis: "organization_name" });
    expect(northgate.email_ids).toEqual(["E004", "E009"]);
    expect(northgate.mention_count).toBe(2);

    const old = g.nodes.find((n: any) => n.id === "account:6621@organization:name:northgate suppliers");
    const changed = g.nodes.find((n: any) => n.id === "account:9902@organization:name:northgate suppliers");
    expect(old.email_ids).toEqual(["E004", "E009"]); // the shared account: one node
    expect(changed.email_ids).toEqual(["E004"]); // the new account is a separate node

    const edge = g.edges.find((e: any) => e.target === old.id);
    expect(edge).toMatchObject({ predicate: "owns_account", source: northgate.id, count: 2, origin: "ai" });
    expect(edge.email_ids).toEqual(["E004", "E009"]);
    expect(edge.evidence.map((x: any) => x.email_id).sort()).toEqual(["E004", "E009"]);
    expect(edge.evidence[0].quote).toContain("account ending 6621");
  });

  it("is deterministic: same bytes on repeated calls and independent of ingestion order", async () => {
    const a = await seededWithGraph();
    app = await startApi({ repo: a.repo });
    const first = (await app.get("/api/graph")).text;
    const second = (await app.get("/api/graph")).text;
    expect(second).toBe(first);

    // A repository built in the reverse order yields the identical response.
    const order = a.emails.map((e) => e.id).reverse();
    const { repo: rev } = await loadSeed(order);
    rev.saveAnalysis(withEntities(rev.getEmail("E004")!, [org("o"), acct("a", "account ending 6621"), acct("b", "account ending 9902"), { ref: "m", type: "amount", name: "$47,300" }], [owns("o", "a", "account ending 6621"), owns("o", "b", "account ending 9902")], "low"));
    rev.saveAnalysis(withEntities(rev.getEmail("E009")!, [org("o"), acct("a", "account ending 6621")], [owns("o", "a", "account ending 6621")]));
    rev.saveAnalysis(notComplete(rev.getEmail("E001")!, "degraded"));
    const other = await startApi({ repo: rev });
    try {
      expect((await other.get("/api/graph")).text).toBe(first);
    } finally {
      await other.close();
    }
  });

  it("omits amounts by default and includes them on request, never leaving dangling edges", async () => {
    const { repo } = await seededWithGraph();
    app = await startApi({ repo });
    const without = (await app.get("/api/graph")).body;
    expect(without.nodes.some((n: any) => n.type === "amount")).toBe(false);
    const withAmounts = (await app.get("/api/graph?include_amounts=true")).body;
    expect(withAmounts.nodes.some((n: any) => n.type === "amount")).toBe(true);
    for (const g of [without, withAmounts]) {
      const ids = new Set(g.nodes.map((n: any) => n.id));
      for (const e of g.edges) {
        expect(ids.has(e.source)).toBe(true);
        expect(ids.has(e.target)).toBe(true);
      }
    }
  });

  it("does not invent edges for unverified identities: same name, no shared verified address", async () => {
    const repo = new MemoryRepository();
    const a = await pasted(repo, "From: a@one.example\nTo: x@arcline.com\nDate: Mon, 08 Jun 2026 09:00:00 +0000\nSubject: one\n\nJane Roe joins Acme.");
    const b = await pasted(repo, "From: b@two.example\nTo: x@arcline.com\nDate: Tue, 09 Jun 2026 09:00:00 +0000\nSubject: two\n\nJane Roe is at Beta.");
    const person = (name: string): E => ({ ref: "p", type: "person", name });
    const emp = (quote: string): R => ({ from_ref: "p", predicate: "employed_by", to_ref: "o", snippet_id: "s1", quote });
    repo.saveAnalysis(withEntities(a, [person("Jane Roe"), org("o", "Acme")], [emp("joins Acme")]));
    repo.saveAnalysis(withEntities(b, [person("Jane Roe"), org("o", "Beta")], [emp("is at Beta")]));
    app = await startApi({ repo });
    const g = (await app.get("/api/graph")).body;

    const janes = g.nodes.filter((n: any) => n.label === "Jane Roe");
    expect(janes).toHaveLength(2); // two people, not one
    expect(janes.every((n: any) => n.email_ids.length === 1)).toBe(true);
    // Each person's only edge goes to their own organization.
    for (const j of janes) {
      const out = g.edges.filter((e: any) => e.source === j.id);
      expect(out).toHaveLength(1);
      expect(out[0].email_ids).toEqual(j.email_ids);
    }
  });

  it("includes rule-derived people for emails without an AI assessment, labelled as rules, and no edges for them", async () => {
    const { repo } = await seededWithGraph();
    app = await startApi({ repo });
    const g = (await app.get("/api/graph")).body;
    const fromRules = g.nodes.filter((n: any) => n.origin === "rules");
    expect(fromRules.length).toBeGreaterThan(0);
    expect(fromRules.every((n: any) => n.type === "person" && n.key_basis === "email_address")).toBe(true);
    expect(g.edges.every((e: any) => e.origin === "ai")).toBe(true);
  });

  it("reports the highest source risk, treating unassessed as not safe", async () => {
    const { repo } = await seededWithGraph();
    app = await startApi({ repo });
    const g = (await app.get("/api/graph")).body;
    const northgate = g.nodes.find((n: any) => n.id === "organization:name:northgate suppliers");
    expect(northgate.max_risk).toBe("medium"); // E004 is medium (cross-email), E009 unassessed
    // A node seen only in an unassessed email is "unassessed", never "none".
    const e001Person = g.nodes.find((n: any) => n.email_ids.length === 1 && n.email_ids[0] === "E001");
    expect(e001Person.max_risk).toBe("medium"); // E001 has rules-only medium indicators
    expect(g.nodes.every((n: any) => n.max_risk !== "none")).toBe(true);
  });

  it("is empty but well-formed for an empty mailbox", async () => {
    app = await startApi({});
    const g = (await app.get("/api/graph")).body;
    expect(g).toMatchObject({ nodes: [], edges: [], meta: { email_count: 0, node_count: 0, edge_count: 0 } });
    expect(typeof g.meta.basis).toBe("string");
  });

  it("makes no model call", async () => {
    const { repo } = await seededWithGraph();
    const llm = new FakeLlm([]);
    app = await startApi({ repo, llm });
    await app.get("/api/graph");
    expect(llm.callCount).toBe(0);
  });
});
