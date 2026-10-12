import { describe, expect, it } from "vitest";
import type { AnalysisRecord, RiskAnalysis, StoredEmail } from "@mri/shared";
import { buildEntityGraph } from "../risk/entities";
import { MemoryRepository } from "../storage/memoryRepository";
import { aiComplete, pasted } from "./riskFixtures";

/**
 * Phase 9B: identity requires evidence, not co-occurrence; weak organization and masked-account
 * identities are not over-merged; verified merges still work.
 */
type E = RiskAnalysis["entities"][number];
type R = RiskAnalysis["relationships"][number];

const rec = (e: StoredEmail, entities: E[], relationships: R[] = []): AnalysisRecord =>
  aiComplete(e, "none", { entities, relationships, evidence: false });
const person = (ref: string, name: string, email?: string): E => ({ ref, type: "person", name, ...(email ? { attributes: { email } } : {}) });
const org = (ref: string, name: string): E => ({ ref, type: "organization", name });
const acct = (ref: string, name: string): E => ({ ref, type: "account", name });
const owns = (o: string, a: string): R => ({ from_ref: o, predicate: "owns_account", to_ref: a, snippet_id: "s1", quote: "x" });

const mail = (repo: MemoryRepository, from: string, body: string, name = "Sender") =>
  pasted(repo, `From: ${name} <${from}>\nTo: Lena Ortiz <lena.ortiz@arcline.com>\nCc: cfo@arcline.com\nDate: Mon, 08 Jun 2026 09:00:00 +0000\nSubject: Hello\n\n${body}`);

describe("person identity needs evidence, not co-occurrence", () => {
  it("a model-supplied address that merely appears in the message does not identify the person", async () => {
    const repo = new MemoryRepository();
    const e = await mail(repo, "d.cole@acme-parts.example", "Hello. Please also copy cfo@arcline.com.", "Dana Cole");
    const g = buildEntityGraph([rec(e, [person("p", "Jane Roe", "cfo@arcline.com")])]);
    const jane = g.entities.find((x) => x.display_name === "Jane Roe")!;
    expect(jane.key_basis).toBe("email_scoped");
    expect(jane.key).not.toContain("cfo@arcline.com");
  });

  it("an attribute that points at the SENDER's address does not merge a differently named person into the sender", async () => {
    const repo = new MemoryRepository();
    const e = await mail(repo, "d.cole@acme-parts.example", "Hello.", "Dana Cole");
    const g = buildEntityGraph([rec(e, [person("p", "Marcus Bell", "d.cole@acme-parts.example")])]);
    expect(g.entities.find((x) => x.display_name === "Marcus Bell")!.key_basis).toBe("email_scoped");
    const sender = g.entities.find((x) => x.key === "person:email:d.cole@acme-parts.example")!;
    expect(sender.mentions.every((m) => m.origin === "rules")).toBe(true);
  });

  it("a recipient's own display name resolves to the recipient's address", async () => {
    const repo = new MemoryRepository();
    const e = await mail(repo, "d.cole@acme-parts.example", "Hello Lena.", "Dana Cole");
    const g = buildEntityGraph([rec(e, [person("p", "Lena Ortiz")])]);
    const lena = g.entities.find((x) => x.key === "person:email:lena.ortiz@arcline.com")!;
    expect(lena.mentions.map((m) => m.origin).sort()).toEqual(["ai", "rules"]);
  });

  it("a titled alias of the header name still resolves (exact name after title normalisation)", async () => {
    const repo = new MemoryRepository();
    const e = await mail(repo, "d.cole@acme-parts.example", "Hello.", "Dana Cole");
    const g = buildEntityGraph([rec(e, [person("p", "Dr. Dana Cole")])]);
    const dana = g.entities.find((x) => x.key === "person:email:d.cole@acme-parts.example")!;
    expect(dana.mentions.map((m) => m.surface_form).sort()).toEqual(["Dana Cole", "Dr. Dana Cole"].sort());
  });

  it("a first name alone is not an alias", async () => {
    const repo = new MemoryRepository();
    const e = await mail(repo, "d.cole@acme-parts.example", "Hello.", "Dana Cole");
    const g = buildEntityGraph([rec(e, [person("p", "Dana")])]);
    expect(g.entities.find((x) => x.display_name === "Dana")!.key_basis).toBe("email_scoped");
  });

  it("an address written as the name merges across messages only where that message contains it", async () => {
    const repo = new MemoryRepository();
    const a = await mail(repo, "x@one.example", "Write to ops@partner.example please.");
    const b = await mail(repo, "y@two.example", "Nothing relevant here.");
    const g = buildEntityGraph([rec(a, [person("p", "ops@partner.example")]), rec(b, [person("p", "ops@partner.example")])]);
    const merged = g.entities.find((x) => x.key === "person:email:ops@partner.example")!;
    expect(merged.email_ids).toEqual([a.id]);
    expect(g.entities.filter((x) => x.display_name === "ops@partner.example")).toHaveLength(2);
  });

  it("a name/address pair stated in the evidence text merges the same person across two messages", async () => {
    const repo = new MemoryRepository();
    const a = await mail(repo, "a@one.example", "Please contact Priya Nair at priya.nair@partner.example for access.");
    const b = await mail(repo, "b@two.example", "Copying Priya Nair (priya.nair@partner.example) as discussed.");
    const withSnippet = (e: StoredEmail) => {
      const r = rec(e, [person("p", "Priya Nair")]);
      r.extraction!.evidence_snippets.push({ id: "s9", text: e.body, location: { where: "body", start: 0, end: e.body.length }, origin: "rules" });
      return r;
    };
    const g = buildEntityGraph([withSnippet(a), withSnippet(b)]);
    expect(g.entities.find((x) => x.key === "person:email:priya.nair@partner.example")!.email_ids.sort()).toEqual([a.id, b.id].sort());
  });

  it("the same name next to two different addresses in one message is ambiguous and merges with neither", async () => {
    const repo = new MemoryRepository();
    const e = await mail(repo, "a@one.example", "Alex Kim <alex@one.example> forwarded to Alex Kim <alex.kim@other.example>.");
    const r = rec(e, [person("p", "Alex Kim")]);
    r.extraction!.evidence_snippets.push({ id: "s9", text: e.body, location: { where: "body", start: 0, end: e.body.length }, origin: "rules" });
    const g = buildEntityGraph([r]);
    expect(g.entities.find((x) => x.display_name === "Alex Kim")!.key_basis).toBe("email_scoped");
  });
});

describe("ambiguous organizations and masked accounts", () => {
  async function two() {
    const repo = new MemoryRepository();
    const a = await pasted(repo, "From: a@one.example\nTo: x@arcline.com\nDate: Mon, 08 Jun 2026 09:00:00 +0000\nSubject: one\n\nAcme invoice.");
    const b = await pasted(repo, "From: b@two.example\nTo: x@arcline.com\nDate: Tue, 09 Jun 2026 09:00:00 +0000\nSubject: two\n\nAcme invoice again.");
    return { a, b };
  }

  it("Acme Inc. and Acme LLC are different organizations; each keeps its own node", async () => {
    const { a, b } = await two();
    const g = buildEntityGraph([rec(a, [org("o", "Acme Inc.")]), rec(b, [org("o", "Acme LLC")])]);
    const acmes = g.entities.filter((e) => e.type === "organization");
    expect(acmes.map((e) => e.key).sort()).toEqual(["organization:name:acme inc", "organization:name:acme llc"]);
    expect(acmes.every((e) => e.email_ids.length === 1)).toBe(true);
  });

  it("the same legal form, written differently, still merges", async () => {
    const { a, b } = await two();
    const g = buildEntityGraph([rec(a, [org("o", "Acme Inc.")]), rec(b, [org("o", "ACME INCORPORATED")])]);
    const acmes = g.entities.filter((e) => e.type === "organization");
    expect(acmes).toHaveLength(1);
    expect(acmes[0]!.key).toBe("organization:name:acme");
    expect(acmes[0]!.email_ids).toHaveLength(2);
  });

  it("with no competing legal form the suffix is ignored, as before", async () => {
    const { a, b } = await two();
    const g = buildEntityGraph([rec(a, [org("o", "Northgate Suppliers Inc.")]), rec(b, [org("o", "Northgate Suppliers")])]);
    expect(g.entities.filter((e) => e.type === "organization")).toHaveLength(1);
  });

  it("a suffix-less 'Acme' is not guessed to be either legal form when both exist", async () => {
    const { a, b } = await two();
    const g = buildEntityGraph([rec(a, [org("o", "Acme Inc."), org("p", "Acme")]), rec(b, [org("o", "Acme LLC")])]);
    expect(g.entities.filter((e) => e.type === "organization").map((e) => e.key).sort()).toEqual([
      "organization:name:acme",
      "organization:name:acme inc",
      "organization:name:acme llc",
    ]);
  });

  it("the same masked account of the SAME organization merges across messages", async () => {
    const { a, b } = await two();
    const r = (e: StoredEmail) => rec(e, [org("o", "Northgate Suppliers"), acct("a", "account ending 6621")], [owns("o", "a")]);
    const accounts = buildEntityGraph([r(a), r(b)]).entities.filter((e) => e.type === "account");
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.email_ids).toHaveLength(2);
  });

  it("the same last digits under DIFFERENT organizations do not merge", async () => {
    const { a, b } = await two();
    const g = buildEntityGraph([
      rec(a, [org("o", "Northgate Suppliers"), acct("a", "account ending 6621")], [owns("o", "a")]),
      rec(b, [org("o", "Westbank Holdings"), acct("a", "account ending 6621")], [owns("o", "a")]),
    ]);
    expect(g.entities.filter((e) => e.type === "account")).toHaveLength(2);
  });

  it("two differently described accounts of one owner in ONE message stay apart in every message", async () => {
    const { a, b } = await two();
    const g = buildEntityGraph([
      rec(a, [org("o", "Northgate Suppliers"), acct("c", "checking account ending 1234"), acct("s", "savings account ending 1234")], [owns("o", "c"), owns("o", "s")]),
      rec(b, [org("o", "Northgate Suppliers"), acct("c", "checking account ending 1234")], [owns("o", "c")]),
    ]);
    const accounts = g.entities.filter((e) => e.type === "account");
    expect(accounts).toHaveLength(2);
    expect(accounts.find((e) => e.key.endsWith("#checking"))!.email_ids).toHaveLength(2);
    expect(accounts.find((e) => e.key.endsWith("#savings"))!.email_ids).toHaveLength(1);
  });

  it("an account whose owner is unknown stays scoped to its message", async () => {
    const { a, b } = await two();
    const g = buildEntityGraph([rec(a, [acct("a", "account ending 6621")]), rec(b, [acct("a", "account ending 6621")])]);
    const accounts = g.entities.filter((e) => e.type === "account");
    expect(accounts).toHaveLength(2);
    expect(accounts.every((e) => e.key_basis === "email_scoped")).toBe(true);
  });

  it("is independent of the order the analyses are given in", async () => {
    const { a, b } = await two();
    const ra = rec(a, [org("o", "Acme Inc.")]);
    const rb = rec(b, [org("o", "Acme LLC")]);
    const keys = (xs: AnalysisRecord[]) => buildEntityGraph(xs).entities.map((e) => e.key);
    expect(keys([rb, ra])).toEqual(keys([ra, rb]));
  });
});
