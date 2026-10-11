import { describe, expect, it } from "vitest";
import type { AnalysisRecord, RiskAnalysis, StoredEmail } from "@mri/shared";
import { buildEntityGraph, normalizePersonName } from "../risk/entities";
import { MemoryRepository } from "../storage/memoryRepository";
import { aiComplete, loadSeed, notComplete, pasted } from "./riskFixtures";

type E = RiskAnalysis["entities"][number];
type R = RiskAnalysis["relationships"][number];

async function emails(): Promise<{ repo: MemoryRepository; byId: Record<string, StoredEmail> }> {
  const { repo, emails } = await loadSeed();
  return { repo, byId: Object.fromEntries(emails.map((e) => [e.id, e])) };
}

function withEntities(e: StoredEmail, entities: E[], relationships: R[] = [], level: "none" | "low" = "none"): AnalysisRecord {
  return aiComplete(e, level, { entities, relationships, evidence: false });
}

const person = (ref: string, name: string, email?: string): E => ({
  ref,
  type: "person",
  name,
  ...(email ? { attributes: { email } } : {}),
});

describe("person identity: only a verified e-mail address merges people across emails", () => {
  const mailWith = (repo: MemoryRepository, from: string, body = "Hello") =>
    pasted(repo, `From: ${from}\nTo: staff@arcline.com\nDate: Mon, 08 Jun 2026 09:00:00 +0000\nSubject: Hi\n\n${body}`);

  it("merges the same address when each email actually contains it", async () => {
    const repo = new MemoryRepository();
    const a = await mailWith(repo, "J. Harrington <j.harrington@example.test>", "First note");
    const b = await mailWith(repo, "James H. <J.Harrington@Example.test>", "Second note");
    const g = buildEntityGraph([
      withEntities(a, [person("p", "J. Harrington", "j.harrington@example.test")]),
      withEntities(b, [person("q", "James H.", "J.Harrington@Example.test")]),
    ]);
    const merged = g.entities.find((e) => e.key === "person:email:j.harrington@example.test")!;
    expect(merged).toBeDefined();
    expect(merged.email_ids.sort()).toEqual([a.id, b.id].sort());
    expect(merged.key_basis).toBe("email_address");
    expect(merged.mentions.map((m) => m.surface_form)).toEqual(expect.arrayContaining(["J. Harrington", "James H."]));
  });

  // Regression (quality gate B): two different people with the same full name were merged.
  it("does NOT merge identical full names that have no matching verified address", async () => {
    const repo = new MemoryRepository();
    const a = await mailWith(repo, "a@one.example", "Jane Roe will join us.");
    const b = await mailWith(repo, "b@two.example", "Jane Roe is a different person at another company.");
    const g = buildEntityGraph([
      withEntities(a, [person("p", "Jane Roe")]),
      withEntities(b, [person("p", "Jane Roe")]),
    ]);
    const janes = g.entities.filter((e) => e.display_name === "Jane Roe");
    expect(janes).toHaveLength(2);
    expect(janes.every((e) => e.key_basis === "email_scoped" && e.email_ids.length === 1)).toBe(true);
    expect(janes.map((e) => e.email_ids[0]).sort()).toEqual([a.id, b.id].sort());
  });

  it("does not merge titled or punctuated variants of a name, or near-miss names, without an address", async () => {
    const { byId } = await emails();
    const g = buildEntityGraph([
      withEntities(byId.E001!, [person("a", "Dr. Jane Roe"), person("b", "Jon Smith")]),
      withEntities(byId.E002!, [person("c", "Jane  Roe"), person("d", "John Smith"), person("e", "J. Roe")]),
    ]);
    expect(g.entities.filter((e) => e.key.startsWith("person:name:"))).toEqual([]); // no name-based identity exists
    expect(g.entities.filter((e) => e.display_name.toLowerCase().includes("roe")).every((e) => e.email_ids.length === 1)).toBe(true);
  });

  it("does not trust an address the model asserts but the email does not contain", async () => {
    const repo = new MemoryRepository();
    const a = await mailWith(repo, "a@one.example", "Note one");
    const b = await mailWith(repo, "b@two.example", "Note two");
    const g = buildEntityGraph([
      withEntities(a, [person("p", "Jane Roe", "ceo@arcline.com")]),
      withEntities(b, [person("p", "Someone Else", "ceo@arcline.com")]),
    ]);
    expect(g.entities.some((e) => e.key === "person:email:ceo@arcline.com")).toBe(false);
    expect(g.entities.filter((e) => e.display_name === "Jane Roe" || e.display_name === "Someone Else")).toHaveLength(2);
  });

  it("trusts an address that appears in the email's evidence text, not only its headers", async () => {
    const repo = new MemoryRepository();
    const a = await mailWith(repo, "a@one.example", "Please contact Priya Nair at priya.nair@partner.example for access.");
    const b = await mailWith(repo, "b@two.example", "Cc'ing priya.nair@partner.example as discussed.");
    const withSnippet = (e: StoredEmail, name: string) => {
      const rec = withEntities(e, [person("p", name, "priya.nair@partner.example")]);
      const text = e.body;
      rec.extraction!.evidence_snippets.push({
        id: "s9",
        text,
        location: { where: "body", start: 0, end: text.length },
        origin: "rules",
      });
      return rec;
    };
    const g = buildEntityGraph([withSnippet(a, "Priya Nair"), withSnippet(b, "P. Nair")]);
    const merged = g.entities.find((e) => e.key === "person:email:priya.nair@partner.example")!;
    expect(merged.email_ids.sort()).toEqual([a.id, b.id].sort());
  });

  it("never merges single-word names or initials across emails", async () => {
    const { byId } = await emails();
    const g = buildEntityGraph([
      withEntities(byId.E001!, [person("a", "James"), person("c", "J. Smith")]),
      withEntities(byId.E005!, [person("b", "James"), person("d", "J. Smith")]),
    ]);
    for (const name of ["James", "J. Smith"]) {
      const nodes = g.entities.filter((e) => e.display_name === name);
      expect(nodes).toHaveLength(2);
      expect(nodes.every((e) => e.key_basis === "email_scoped" && e.email_ids.length === 1)).toBe(true);
    }
  });

  it("normalizePersonName only strips case, punctuation, spacing and a leading title", () => {
    expect(normalizePersonName("  Mr.  Robert  AINSLEY ")).toBe("robert ainsley");
    expect(normalizePersonName("Robert Ainsley, CFO")).toBe("robert ainsley cfo"); // no role stripping
  });
});
describe("organizations, accounts, amounts", () => {
  it("merges organizations by normalized name (legal suffix ignored), not by resemblance", async () => {
    const { byId } = await emails();
    const org = (ref: string, name: string): E => ({ ref, type: "organization", name });
    const g = buildEntityGraph([
      withEntities(byId.E004!, [org("o", "Northgate Suppliers Inc.")]),
      withEntities(byId.E009!, [org("o", "NORTHGATE SUPPLIERS")]),
      withEntities(byId.E001!, [org("o", "Northgate Supply Co.")]),
    ]);
    const merged = g.entities.find((e) => e.key === "organization:name:northgate suppliers")!;
    expect(merged.email_ids).toEqual(["E004", "E009"]);
    expect(g.entities.find((e) => e.key === "organization:name:northgate supply")!.email_ids).toEqual(["E001"]);
  });

  it("identifies an account by number AND owner; the same last digits under different owners stay apart", async () => {
    const { byId } = await emails();
    const acct = (ref: string, name: string): E => ({ ref, type: "account", name });
    const org = (ref: string, name: string): E => ({ ref, type: "organization", name });
    const owns = (from: string, to: string): R => ({ from_ref: from, predicate: "owns_account", to_ref: to, snippet_id: "s1", quote: "x" });
    const g = buildEntityGraph([
      withEntities(byId.E009!, [org("o", "Northgate Suppliers Inc."), acct("a", "account ending 6621")], [owns("o", "a")]),
      withEntities(byId.E004!, [org("o", "Northgate Suppliers Inc."), acct("a", "account ending 6621"), acct("b", "account ending 9902")], [owns("o", "a"), owns("o", "b")]),
      withEntities(byId.E005!, [org("o", "Halvorsen Holdings"), acct("a", "account ending 6621")], [owns("o", "a")]),
    ]);
    const northgate6621 = g.entities.find((e) => e.key === "account:6621@organization:name:northgate suppliers")!;
    expect(northgate6621.email_ids).toEqual(["E004", "E009"]);
    expect(northgate6621.key_basis).toBe("account_with_owner");
    // The new account is a distinct node, so the change is visible.
    expect(g.entities.some((e) => e.key === "account:9902@organization:name:northgate suppliers")).toBe(true);
    // Same digits, different owner: not merged.
    expect(g.entities.find((e) => e.key === "account:6621@organization:name:halvorsen holdings")!.email_ids).toEqual(["E005"]);
  });

  it("an account with no known owner stays scoped to its own email", async () => {
    const { byId } = await emails();
    const acct = (ref: string): E => ({ ref, type: "account", name: "account ending 6621" });
    const g = buildEntityGraph([withEntities(byId.E004!, [acct("a")]), withEntities(byId.E009!, [acct("a")])]);
    const accounts = g.entities.filter((e) => e.type === "account");
    expect(accounts).toHaveLength(2);
    expect(accounts.every((e) => e.key_basis === "email_scoped")).toBe(true);
  });

  it("amounts are never merged across emails", async () => {
    const { byId } = await emails();
    const amt = (ref: string): E => ({ ref, type: "amount", name: "$13,900" });
    const g = buildEntityGraph([withEntities(byId.E004!, [amt("m")]), withEntities(byId.E009!, [amt("m")])]);
    expect(g.entities.filter((e) => e.type === "amount")).toHaveLength(2);
  });
});

describe("provenance and origin", () => {
  it("keeps per-mention origin and source email; marks entities seen by the AI as 'ai'", async () => {
    const { byId } = await emails();
    const analysis = withEntities(byId.E001!, [person("p", byId.E001!.from!.address.split("@")[0]!.replace(/[^a-z]/g, " "), byId.E001!.from!.address)]);
    const g = buildEntityGraph([analysis]);
    const sender = g.entities.find((e) => e.key === `person:email:${byId.E001!.from!.address.toLowerCase()}`)!;
    expect(sender.origin).toBe("ai");
    expect(new Set(sender.mentions.map((m) => m.origin))).toEqual(new Set(["ai", "rules"]));
    expect(sender.mentions.every((m) => m.email_id === "E001")).toBe(true);
  });

  it("header-derived people come from rules and keep origin 'rules' when no AI saw them", async () => {
    const { byId } = await emails();
    const g = buildEntityGraph([notComplete(byId.E003!, "degraded")]);
    expect(g.entities.length).toBeGreaterThan(0);
    expect(g.entities.every((e) => e.origin === "rules" && e.type === "person")).toBe(true);
    expect(g.relationships).toEqual([]);
  });

  it("an AI person that exactly equals a header display name in the SAME email resolves to that address", async () => {
    const repo = new MemoryRepository();
    const e = await pasted(
      repo,
      "From: Dana Cole <d.cole@acme-parts.example>\nTo: ap@arcline.com\nDate: Mon, 08 Jun 2026 09:00:00 +0000\nSubject: Hello\n\nPlease review. - Dana Cole",
    );
    const g = buildEntityGraph([withEntities(e, [person("p", "Dana Cole")])]);
    const dana = g.entities.find((x) => x.key === "person:email:d.cole@acme-parts.example")!;
    expect(dana).toBeDefined();
    expect(dana.mentions.map((m) => m.origin).sort()).toEqual(["ai", "rules"]);
  });

  it("an ambiguous display name (two addresses, one name) is not resolved to either", async () => {
    const repo = new MemoryRepository();
    const e = await pasted(
      repo,
      "From: Sam Lee <sam@one.example>\nTo: Sam Lee <sam@two.example>\nDate: Mon, 08 Jun 2026 09:00:00 +0000\nSubject: Hello\n\nHi",
    );
    const g = buildEntityGraph([withEntities(e, [person("p", "Sam Lee")])]);
    const aiMention = g.entities.flatMap((x) => x.mentions).find((m) => m.origin === "ai")!;
    const holder = g.entities.find((x) => x.mentions.includes(aiMention))!;
    expect(holder.key_basis).toBe("email_scoped"); // neither address is claimed; no name identity either
  });
});

describe("relationship aggregation", () => {
  it("aggregates the same (source, predicate, target) across emails with per-email evidence", async () => {
    const { byId } = await emails();
    const org = (ref: string): E => ({ ref, type: "organization", name: "Northgate Suppliers Inc." });
    const acct = (ref: string): E => ({ ref, type: "account", name: "account ending 6621" });
    const owns: R = { from_ref: "o", predicate: "owns_account", to_ref: "a", snippet_id: "s1", quote: "account ending 6621" };
    const g = buildEntityGraph([
      withEntities(byId.E009!, [org("o"), acct("a")], [owns]),
      withEntities(byId.E004!, [org("o"), acct("a")], [{ ...owns, quote: "account ending 6621." }]),
    ]);
    expect(g.relationships).toHaveLength(1);
    const r = g.relationships[0]!;
    expect(r).toMatchObject({ predicate: "owns_account", count: 2, origin: "ai" });
    expect(r.email_ids).toEqual(["E009", "E004"].sort());
    expect(r.evidence.map((x) => x.email_id).sort()).toEqual(["E004", "E009"]);
  });

  it("does not assert relationships from analyses that are not complete, or with unknown endpoints", async () => {
    const { byId } = await emails();
    const org: E = { ref: "o", type: "organization", name: "Northgate Suppliers Inc." };
    const g = buildEntityGraph([
      notComplete(byId.E004!, "partial"),
      withEntities(byId.E009!, [org], [{ from_ref: "o", predicate: "owns_account", to_ref: "ghost", snippet_id: "s1", quote: "x" }]),
    ]);
    expect(g.relationships).toEqual([]);
  });

  it("is deterministic regardless of the order of analyses", async () => {
    const { byId } = await emails();
    const a = withEntities(byId.E001!, [person("p", "Jane Roe"), { ref: "o", type: "organization", name: "Acme" }], [
      { from_ref: "p", predicate: "employed_by", to_ref: "o", snippet_id: "s1", quote: "x" },
    ]);
    const b = withEntities(byId.E002!, [person("p", "Jane Roe")]);
    expect(buildEntityGraph([a, b])).toEqual(buildEntityGraph([b, a]));
  });
});
