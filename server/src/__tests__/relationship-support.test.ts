import { afterEach, describe, expect, it } from "vitest";
import type { AnalysisRecord, RiskAnalysis, StoredEmail } from "@mri/shared";
import { assessRelationshipSupport } from "../risk/relationshipSupport";
import { buildEntityGraph } from "../risk/entities";
import { MemoryRepository } from "../storage/memoryRepository";
import { startApi, type Started } from "./apiHarness";
import { aiComplete, loadSeed, pasted } from "./riskFixtures";

let app: Started | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

const northgate = { name: "Northgate Suppliers", type: "organization" as const };
const arcline = { name: "Arcline", type: "organization" as const };
const james = { name: "James Harlow", type: "person" as const };

type Arg = Parameters<typeof assessRelationshipSupport>[0];
const assess = (predicate: Arg["predicate"], source: Arg["source"] = northgate, target: Arg["target"] = arcline, quote = "", fromHeader = false) =>
  assessRelationshipSupport({ predicate, source, target, quote, fromHeader });

describe("advisory support check: exact audit examples", () => {
  it("a negated threat is not presented as supported wording", () => {
    for (const quote of ["Northgate Suppliers is not a threat to Arcline", "We would never hurt Arcline", "This isn't a threat, Arcline."]) {
      const s = assess("threatens", northgate, arcline, quote);
      expect(s.wording, quote).toBe("negated");
      expect(s.review, quote).toBe(true);
    }
  });

  it("a reversed threat is flagged (the quote names the target first)", () => {
    const s = assess("threatens", northgate, arcline, "Arcline will regret this, says Northgate Suppliers");
    expect(s.participants).toBe("both");
    expect(s.order).toBe("target_first");
    expect(s.review).toBe(true);
    expect(s.notes.join(" ")).toMatch(/direction may be reversed/);
  });

  it("an unrelated real quote (the audited invoice subject) needs review for an accusation", () => {
    const s = assess("threatens", northgate, arcline, "Subject: Invoice #NS-4471 - please note updated payment details", true);
    expect(s.wording).toBe("none_found");
    expect(s.review).toBe(true);
  });

  it("an uncommon but genuine threat is NOT removed or marked unsupported just for its phrasing", () => {
    // Not in the word list: it is kept (the validator never drops it) and merely asks for a look.
    const s = assess("threatens", james, arcline, "Arcline had better think carefully about what happens next, James Harlow");
    expect(s.review).toBe(true);
    expect(["none_found", "present"]).toContain(s.wording);
    // and an accusation with ordinary wording, naming source before target, is not flagged
    const ok = assess("threatens", james, arcline, "James Harlow: you will regret this, Arcline");
    expect(ok).toMatchObject({ wording: "present", order: "source_first", review: false });
  });

  it("states honestly that it is advisory: notes are descriptive, never 'verified'", () => {
    const s = assess("alleges_against", james, arcline, "unrelated text");
    expect(s.notes.join(" ")).not.toMatch(/verified|proven|true/i);
  });
});

describe("non-accusatory predicates", () => {
  it("an unrelated quote is flagged for review; a header snippet or a named participant is not", () => {
    expect(assess("employed_by", james, arcline, "The weather is nice.").review).toBe(true);
    expect(assess("employed_by", james, arcline, "unrelated", true)).toMatchObject({ participants: "header", review: false });
    expect(assess("employed_by", james, arcline, "James Harlow joined Arcline in May").review).toBe(false);
    expect(assess("sent_email_to", northgate, arcline, "Invoice for Arcline").review).toBe(false); // names one party
  });

  it("surnames, addresses and distinctive name tokens count as naming a party", () => {
    expect(assess("employed_by", { name: "James Harlow", type: "person", address: "j.harlow@x.example" }, arcline, "mail j.harlow@x.example about Arcline").participants).toBe("both");
    expect(assess("employed_by", james, arcline, "Harlow works at Arcline").participants).toBe("both");
  });
});

describe("legacy stored analyses are re-checked on read, never rewritten", () => {
  type E = RiskAnalysis["entities"][number];
  type R = RiskAnalysis["relationships"][number];
  const legacy = (e: StoredEmail, entities: E[], relationships: R[]): AnalysisRecord =>
    aiComplete(e, "none", { entities, relationships, evidence: false });

  it("a stored structurally impossible relationship is excluded and counted; the stored record is unchanged", async () => {
    const { repo, emails } = await loadSeed(["E004"]);
    const rec = legacy(
      emails[0]!,
      [
        { ref: "m", type: "amount", name: "$47,300" },
        { ref: "o", type: "organization", name: "Arcline" },
        { ref: "v", type: "organization", name: "Northgate Suppliers Inc." },
      ],
      [
        { from_ref: "m", predicate: "threatens", to_ref: "o", snippet_id: "s1", quote: "Invoice #NS-4471" }, // impossible
        { from_ref: "v", predicate: "sent_email_to", to_ref: "o", snippet_id: "s1", quote: "Invoice #NS-4471" }, // fine
      ],
    );
    repo.saveAnalysis(rec);
    const before = JSON.stringify(repo.getAnalysis("E004"));
    app = await startApi({ repo });
    const g = (await app.get("/api/graph?include_amounts=true")).body;
    expect(g.edges.map((e: any) => e.predicate)).toEqual(["sent_email_to"]);
    expect(g.meta.excluded_relationships).toBe(1);
    expect(JSON.stringify(repo.getAnalysis("E004"))).toBe(before); // never rewritten
    const d = (await app.get("/api/emails/E004")).body;
    expect(d.relationships.map((r: any) => r.predicate)).toEqual(["sent_email_to"]);
  });

  it("a stored accusation with weak support stays visible but is flagged for review, in the graph and in the message", async () => {
    const { repo, emails } = await loadSeed(["E004"]);
    repo.saveAnalysis(
      legacy(
        emails[0]!,
        [
          { ref: "v", type: "organization", name: "Northgate Suppliers Inc." },
          { ref: "o", type: "organization", name: "Arcline" },
        ],
        [{ from_ref: "v", predicate: "threatens", to_ref: "o", snippet_id: "s1", quote: "Subject: Invoice #NS-4471" }],
      ),
    );
    app = await startApi({ repo });
    const g = (await app.get("/api/graph")).body;
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].review).toBe(true);
    expect(g.edges[0].evidence[0].support.review).toBe(true);
    const d = (await app.get("/api/emails/E004")).body;
    expect(d.relationships[0].review).toBe(true);
  });

  it("the recorded relationships keep their quotes and are reported with advisory support", async () => {
    const repo = new MemoryRepository();
    const e = await pasted(repo, "From: James <j@arcline-parts.example>\nTo: fin@arcline.com\nDate: Mon, 08 Jun 2026 09:00:00 +0000\nSubject: Wire\n\nPlease wire $184,500 today.");
    const g = buildEntityGraph([
      legacy(
        e,
        [
          { ref: "j", type: "person", name: "James" },
          { ref: "m", type: "amount", name: "$184,500" },
        ],
        [{ from_ref: "j", predicate: "requests_transfer_to", to_ref: "m", snippet_id: "s1", quote: "Please wire $184,500 today." }],
      ),
    ]);
    expect(g.relationships).toHaveLength(1);
    expect(g.relationships[0]!.evidence[0]!.quote).toBe("Please wire $184,500 today.");
    expect(g.relationships[0]!.evidence[0]!.support.participants).toBe("target_only");
    expect(g.excluded_relationships).toBe(0);
  });
});
