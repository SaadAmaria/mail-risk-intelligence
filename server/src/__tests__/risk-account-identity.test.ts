import { describe, expect, it } from "vitest";
import type { AnalysisRecord, RiskAnalysis, StoredEmail } from "@mri/shared";
import { buildEntityGraph } from "../risk/entities";
import { MemoryRepository } from "../storage/memoryRepository";
import { aiComplete, pasted } from "./riskFixtures";

/**
 * Phase 9C: the last digits of a masked account are not an identifier. A masked mention merges
 * across messages only with a mention that describes it identically; a complete number merges.
 */
type E = RiskAnalysis["entities"][number];
type R = RiskAnalysis["relationships"][number];
const rec = (e: StoredEmail, entities: E[], relationships: R[]): AnalysisRecord => aiComplete(e, "none", { entities, relationships, evidence: false });
const org = (name: string): E => ({ ref: "o", type: "organization", name });
const acct = (name: string): E => ({ ref: "a", type: "account", name });
const owns: R = { from_ref: "o", predicate: "owns_account", to_ref: "a", snippet_id: "s1", quote: "x" };

async function two() {
  const repo = new MemoryRepository();
  const a = await pasted(repo, "From: a@one.example\nTo: x@arcline.com\nDate: Mon, 08 Jun 2026 09:00:00 +0000\nSubject: one\n\nAcme account.");
  const b = await pasted(repo, "From: b@two.example\nTo: x@arcline.com\nDate: Tue, 09 Jun 2026 09:00:00 +0000\nSubject: two\n\nAcme account again.");
  return { a, b };
}
const accountsOf = (recs: AnalysisRecord[]) => buildEntityGraph(recs).entities.filter((e) => e.type === "account");

describe("masked-account identity across messages", () => {
  it("checking vs savings account ending 1234 of the same owner: two accounts", async () => {
    const { a, b } = await two();
    const out = accountsOf([rec(a, [org("Acme"), acct("checking account ending 1234")], [owns]), rec(b, [org("Acme"), acct("savings account ending 1234")], [owns])]);
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.email_ids.length === 1)).toBe(true);
  });

  it("an undescribed mention and a described one are uncertain, so they stay separate", async () => {
    const { a, b } = await two();
    const out = accountsOf([rec(a, [org("Acme"), acct("account ending 1234")], [owns]), rec(b, [org("Acme"), acct("checking account ending 1234")], [owns])]);
    expect(out).toHaveLength(2);
  });

  it("identically described mentions of the same owner merge (a bare 'account ending 6621' too)", async () => {
    const { a, b } = await two();
    for (const name of ["account ending 6621", "checking account ending 6621"]) {
      const out = accountsOf([rec(a, [org("Acme"), acct(name)], [owns]), rec(b, [org("Acme"), acct(name)], [owns])]);
      expect(out, name).toHaveLength(1);
      expect(out[0]!.email_ids).toHaveLength(2);
    }
  });

  it("the description is compared after normalisation (case, 'no.', 'acct')", async () => {
    const { a, b } = await two();
    const out = accountsOf([rec(a, [org("Acme"), acct("Checking account ending 1234")], [owns]), rec(b, [org("Acme"), acct("checking acct. ending in 1234")], [owns])]);
    expect(out).toHaveLength(1);
  });

  it("a complete account number merges across descriptions", async () => {
    const { a, b } = await two();
    const out = accountsOf([rec(a, [org("Acme"), acct("account 123456789012")], [owns]), rec(b, [org("Acme"), acct("checking account number 123456789012")], [owns])]);
    expect(out).toHaveLength(1);
    expect(out[0]!.email_ids).toHaveLength(2);
  });

  it("a complete number and a masked mention of it are not assumed to be the same account", async () => {
    const { a, b } = await two();
    const out = accountsOf([rec(a, [org("Acme"), acct("account 123456781234")], [owns]), rec(b, [org("Acme"), acct("account ending 1234")], [owns])]);
    expect(out).toHaveLength(2);
  });

  it("different owners never merge, whatever the description", async () => {
    const { a, b } = await two();
    const out = accountsOf([rec(a, [org("Acme Co"), acct("account ending 1234")], [owns]), rec(b, [org("Westbank"), acct("account ending 1234")], [owns])]);
    expect(out).toHaveLength(2);
  });

  it("is independent of message order", async () => {
    const { a, b } = await two();
    const ra = rec(a, [org("Acme"), acct("checking account ending 1234")], [owns]);
    const rb = rec(b, [org("Acme"), acct("savings account ending 1234")], [owns]);
    const keys = (xs: AnalysisRecord[]) => accountsOf(xs).map((e) => e.key).sort();
    expect(keys([rb, ra])).toEqual(keys([ra, rb]));
  });

  it("the E004/E009 shared account 'account ending 6621' (bare, same owner) still aggregates", async () => {
    const { a, b } = await two();
    const out = accountsOf([rec(a, [org("Northgate Suppliers Inc."), acct("account ending 6621")], [owns]), rec(b, [org("Northgate Suppliers Inc."), acct("account ending 6621")], [owns])]);
    expect(out).toHaveLength(1);
    expect(out[0]!.key).toBe("account:6621@organization:name:northgate suppliers");
    expect(out[0]!.email_ids).toHaveLength(2);
  });
});
