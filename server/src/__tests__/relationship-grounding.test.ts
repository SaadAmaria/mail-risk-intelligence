import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { Extraction } from "@mri/shared";
import { runExtractionAgent } from "../agents/extractionAgent";
import { runRiskAgent } from "../agents/riskAgent";
import { checkRelationship } from "../risk/relationshipRules";
import { resultDigest } from "../replay/fixture";
import { setupReplay } from "../replay/setup";
import { AnalysisService } from "../analysis/service";
import { A_OK, B_OK, wireEmail } from "./agentFixtures";
import { FakeLlm, ok } from "./fakes/fakeLlm";
import { loadSeed } from "./riskFixtures";

const opts = { maxCompletionTokens: 1000 };
const REC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/recorded");
let extraction: Extraction;
beforeAll(async () => {
  extraction = (await runExtractionAgent(new FakeLlm([ok(A_OK)]), wireEmail(), opts)).extraction;
});

/** Agent B output with the entities below and exactly the given relationships. */
const answer = (relationships: unknown[]) => ({
  ...B_OK,
  entities: [
    { ref: "p", type: "person", name: "Dana Cole" },
    { ref: "a", type: "amount", name: "$48,200" },
    { ref: "c", type: "account", name: "account ending 7731" },
    { ref: "o", type: "organization", name: "Arcline" },
  ],
  relationships,
});
const run = async (relationships: unknown[]) => runRiskAgent(new FakeLlm([ok(answer(relationships))]), extraction, opts);
const rel = (from: string, predicate: string, to: string, quote: string) => ({ from_ref: from, predicate, to_ref: to, snippet_id: "s1", quote });
const REAL_QUOTE = "wire $48,200 to the new account ending 7731";

describe("a quote that exists is not evidence that the predicate is true", () => {
  it("the validator does not use an English word list to remove a relationship (that was a false-negative risk)", async () => {
    // The audited 'threatens' with a real, unrelated quote passes STRUCTURAL validation; it is
    // flagged for review at read time instead (see relationship-support.test.ts).
    const out = await run([rel("p", "threatens", "o", REAL_QUOTE)]);
    expect(out.analysis.relationships.map((r) => r.predicate)).toEqual(["threatens"]);
    expect(out.dropped).toBe(0);
  });

  it("structure is still checked for accusatory predicates", async () => {
    const out = await run([rel("a", "threatens", "o", REAL_QUOTE)]); // an amount cannot threaten
    expect(out.analysis.relationships).toEqual([]);
  });

  it("legitimate relationships and their quotes are preserved exactly", async () => {
    const out = await run([rel("p", "sent_email_to", "o", REAL_QUOTE), rel("p", "requests_transfer_to", "c", REAL_QUOTE)]);
    expect(out.analysis.relationships.map((r) => [r.from_ref, r.predicate, r.to_ref, r.quote])).toEqual([
      ["p", "sent_email_to", "o", REAL_QUOTE],
      ["p", "requests_transfer_to", "c", REAL_QUOTE],
    ]);
    expect(out.dropped).toBe(0);
  });

  it("no alternate relationship is manufactured: an unknown predicate is removed, not reinterpreted", async () => {
    const out = await run([rel("p", "blackmails", "o", REAL_QUOTE)]);
    expect(out.analysis.relationships).toEqual([]);
    expect(out.warnings.join(" ")).toMatch(/not one of the supported relationship types/);
  });
});

describe("structurally impossible relationships are rejected", () => {
  it.each([
    ["an amount threatens an organization", "a", "threatens", "o"],
    ["an account sends email", "c", "sent_email_to", "o"],
    ["an organization is employed by a person", "o", "employed_by", "p"],
    ["a person owns an amount", "p", "owns_account", "a"],
    ["an amount is the source of a transfer", "a", "requests_transfer_to", "c"],
  ])("%s", async (_n, from, predicate, to) => {
    const out = await run([rel(from, predicate, to, REAL_QUOTE)]);
    expect(out.analysis.relationships).toEqual([]);
    expect(out.warnings.join(" ")).toMatch(/cannot connect those kinds of entity/);
  });

  it("an entity cannot be related to itself", async () => {
    const out = await run([rel("p", "related_to", "p", REAL_QUOTE)]);
    expect(out.analysis.relationships).toEqual([]);
  });

  it("the transfer-to-amount case: an amount is the thing transferred, never the recipient or an account", async () => {
    // person -> amount is kept (James requests transfer OF $184,500); amount -> anything is not.
    expect(checkRelationship("requests_transfer_to", "person", "amount", "wire $184,500", false)).toEqual({ ok: true });
    expect(checkRelationship("requests_transfer_to", "amount", "account", "wire $184,500", false)).toEqual({ ok: false, reason: "endpoint_types" });
    expect(checkRelationship("owns_account", "organization", "amount", "x", false)).toEqual({ ok: false, reason: "endpoint_types" });
  });
});

describe("the committed recordings still replay to exactly what was captured", () => {
  it("E001, E004 and E007 produce the same stored result (digest) after the stricter validation", async () => {
    const { repo } = await loadSeed();
    const replay = setupReplay(REC_DIR, repo);
    expect(replay.client).not.toBeNull();
    const service = new AnalysisService(repo, replay.client, { concurrency: 1, maxRuns: 3, queueCapacity: 10, maxCompletionTokens: 3000 });
    for (const id of ["E001", "E004", "E007"]) {
      expect(service.enqueue(id)).toBe("queued");
      await service.idle();
      const a = repo.getAnalysis(id)!;
      const fixture = JSON.parse(readFileSync(path.join(REC_DIR, `${id}.json`), "utf8"));
      expect(a.status, id).toBe("complete");
      expect(a.provenance).toBe("recorded");
      expect(resultDigest(a), id).toBe(fixture.result.digest);
    }
    await service.stop(10);
  });
});
