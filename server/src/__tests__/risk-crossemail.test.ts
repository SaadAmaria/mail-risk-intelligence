import { describe, expect, it } from "vitest";
import type { StoredEmail } from "@mri/shared";
import { buildAllRiskViews, buildRiskView } from "../risk/riskView";
import { crossEmailFindings, extractVendorFacts, normalizeVendorName, vendorIdentity } from "../risk/vendor";
import { MemoryRepository } from "../storage/memoryRepository";
import { aiComplete, loadSeed, OPTS, pasted } from "./riskFixtures";

const invoice = (opts: {
  from: string;
  date: string;
  vendor: string;
  invoice: string;
  amount: string;
  account: string;
  routing?: string;
  note?: string;
  subject?: string;
}) =>
  [
    `From: ${opts.from}`,
    "To: accounts-payable@arcline.com",
    `Date: ${opts.date}`,
    `Subject: ${opts.subject ?? `Invoice ${opts.invoice}`}`,
    "",
    `${opts.vendor} Invoice #${opts.invoice}. Amount due: ${opts.amount}. ` +
      `Payment account: routing ${opts.routing ?? "044000037"}, account ending ${opts.account}. ${opts.note ?? ""}`,
  ].join("\n");

describe("E004 / E009: payment account change supported by a prior invoice", () => {
  it("E004 gets consistent, evidence-linked findings pointing at E009", async () => {
    const { repo, emails } = await loadSeed();
    const findings = crossEmailFindings(repo.getEmail("E004")!, emails);
    const byRule = Object.fromEntries(findings.map((f) => [f.rule_id, f]));

    const acct = byRule.payment_account_changed!;
    expect(acct).toBeDefined();
    expect(acct.email_id).toBe("E004");
    expect(acct.related_email_ids).toEqual(["E009"]);
    expect(acct.identity).toBe("consistent");
    expect(acct.vendor).toEqual({ name: "Northgate Suppliers Inc.", domain: "northgate-suppliers.com" });
    expect(acct.values).toMatchObject({
      prior_accounts: ["6621"],
      new_account: "9902",
      routing_unchanged: true, // "changed banking providers", yet the routing number is the same
      claims_bank_change: true,
    });
    // Evidence links to BOTH emails and quotes the actual text.
    const ids = new Set(acct.evidence.map((e) => e.email_id));
    expect(ids).toEqual(new Set(["E004", "E009"]));
    expect(acct.evidence.find((e) => e.email_id === "E004")!.text).toContain("account ending 9902");
    expect(acct.evidence.find((e) => e.email_id === "E009")!.text).toContain("account ending 6621");

    const amount = byRule.invoice_amount_anomaly!;
    expect(amount.related_email_ids).toEqual(["E009"]);
    expect(amount.values).toMatchObject({ new_amount: 47300, prior_amounts: [13900], ratio: 3.4 });
  });

  it("E009 (the earlier invoice) is not flagged: findings are about the later email only", async () => {
    const { repo, emails } = await loadSeed();
    expect(crossEmailFindings(repo.getEmail("E009")!, emails)).toEqual([]);
  });

  it("E004's risk view reaches medium by rules alone and is labelled rules-only (never high)", async () => {
    const { repo, emails } = await loadSeed();
    const v = buildRiskView(repo.getEmail("E004")!, null, emails, OPTS);
    expect(v.findings.map((f) => f.rule_id).sort()).toEqual(["invoice_amount_anomaly", "payment_account_changed"]);
    expect(v.indicators.map((i) => i.rule_id)).toEqual(
      expect.arrayContaining(["payment_account_changed", "invoice_amount_anomaly", "payment_detail_change"]),
    );
    expect(v.rules_level).toBe("medium");
    expect(v.final_level).toBe("medium");
    expect(v.basis).toBe("rules_only");
    expect(v.assessed).toBe(false);
  });

  it("with a validated AI 'low', the cross-email evidence raises E004 to medium with a rationale", async () => {
    const { repo, emails } = await loadSeed();
    const e = repo.getEmail("E004")!;
    const v = buildRiskView(e, aiComplete(e, "low"), emails, OPTS);
    expect(v).toMatchObject({ ai_level: "low", rules_level: "medium", final_level: "medium", escalated: true });
    expect(v.escalations[0]!.indicator_ids).toEqual(
      expect.arrayContaining(["E004:payment_account_changed", "E004:invoice_amount_anomaly"]),
    );
  });

  it("the AI analysis record is not changed or re-run to compute these findings", async () => {
    const { repo, emails } = await loadSeed();
    const e = repo.getEmail("E004")!;
    const analysis = aiComplete(e, "medium");
    const before = JSON.stringify(analysis);
    buildRiskView(e, analysis, emails, OPTS);
    expect(JSON.stringify(analysis)).toBe(before);
  });
});

describe("order independence (reversed ingestion order)", () => {
  it("gives identical findings whichever of E004/E009 was ingested first", async () => {
    const a = await loadSeed(["E009", "E004"]);
    const b = await loadSeed(["E004", "E009"]);
    const fa = crossEmailFindings(a.repo.getEmail("E004")!, a.emails);
    const fb = crossEmailFindings(b.repo.getEmail("E004")!, b.emails);
    expect(fa.length).toBeGreaterThan(0);
    expect(fb).toEqual(fa);
  });

  it("gives identical risk views for the whole seed regardless of ingestion order", async () => {
    const forward = await loadSeed();
    const reversed = await loadSeed([...forward.emails].reverse().map((e) => e.id));
    const vf = buildAllRiskViews(forward.emails, [], OPTS);
    const vr = buildAllRiskViews(reversed.emails, [], OPTS);
    expect(vr).toEqual(vf);
  });

  it("is chronological, not positional: E009 is dated before E004 although listed after it", async () => {
    const { repo, emails } = await loadSeed(["E004", "E009"]);
    expect(crossEmailFindings(repo.getEmail("E009")!, emails)).toEqual([]);
    expect(crossEmailFindings(repo.getEmail("E004")!, emails).length).toBeGreaterThan(0);
  });
});

describe("results update as additional emails arrive (read-time, nothing stored)", () => {
  it("E004 has no finding until its baseline arrives, then gains one, then more evidence", async () => {
    const { repo } = await loadSeed(["E004"]);
    const all = () => repo.listEmails();
    expect(crossEmailFindings(repo.getEmail("E004")!, all())).toEqual([]);

    // The baseline invoice arrives later (E009 from the seed).
    const { emails: seed } = await loadSeed(["E009"]);
    const e009 = seed[0]!;
    const { ingestSeedRecord } = await import("../ingestion/ingest");
    const { SeedEmail } = await import("../ingestion/parseSeed");
    const { seedRaw } = await import("./riskFixtures");
    await ingestSeedRecord({ repo }, SeedEmail.parse(seedRaw.find((r) => r.id === e009.id)!));

    const withBaseline = crossEmailFindings(repo.getEmail("E004")!, all());
    expect(withBaseline.map((f) => f.rule_id).sort()).toEqual(["invoice_amount_anomaly", "payment_account_changed"]);
    expect(withBaseline[0]!.related_email_ids).toEqual(["E009"]);

    // An even earlier invoice with the same account arrives: still the same account change,
    // and the baseline now includes it.
    await pasted(
      repo,
      invoice({
        from: "billing@northgate-suppliers.com",
        date: "Tue, 07 Apr 2026 10:00:00 +0000",
        vendor: "Northgate Suppliers Inc.",
        invoice: "NS-4102",
        amount: "$12,400.00",
        account: "6621",
      }),
    );
    const more = crossEmailFindings(repo.getEmail("E004")!, all());
    const acct = more.find((f) => f.rule_id === "payment_account_changed")!;
    expect(acct.related_email_ids.length).toBeGreaterThanOrEqual(1);
    expect(new Set(acct.evidence.map((e) => e.email_id)).size).toBeGreaterThanOrEqual(2);
  });
});

// Quality gate C: the 2x rule is a size heuristic, not evidence of fraud by itself.
describe("invoice amount anomaly is a heuristic with accurate evidence", () => {
  const pair = async (prior: string, next: string, sameAccount = true) => {
    const repo = new MemoryRepository();
    const a = await pasted(repo, invoice({ from: "ar@acme-parts.example", date: "Mon, 04 May 2026 10:00:00 +0000", vendor: "Acme Parts LLC", invoice: "A-1", amount: prior, account: "1111" }));
    const b = await pasted(repo, invoice({ from: "ar@acme-parts.example", date: "Thu, 04 Jun 2026 10:00:00 +0000", vendor: "Acme Parts LLC", invoice: "A-2", amount: next, account: sameAccount ? "1111" : "2222" }));
    return { a, b, emails: [a, b] };
  };

  it("alone it yields only 'low', states that it is a heuristic, and quotes both amounts", async () => {
    const { a, b, emails } = await pair("$1,000.00", "$2,500.00");
    const v = buildRiskView(b, null, emails, OPTS);
    expect(v.findings.map((f) => f.rule_id)).toEqual(["invoice_amount_anomaly"]);
    expect(v.rules_level).toBe("low");
    expect(v.final_level).toBe("low");
    const ind = v.indicators.find((i) => i.rule_id === "invoice_amount_anomaly")!;
    expect(ind.detail).toMatch(/size heuristic .* not evidence of fraud/);
    expect(v.findings[0]!.values).toMatchObject({ heuristic: true, threshold: 2, ratio: 2.5 });

    const quotes = Object.fromEntries(v.findings[0]!.evidence.map((e) => [e.email_id, e.text]));
    expect(quotes[b.id]).toContain("$2,500.00");
    expect(quotes[a.id]).toContain("$1,000.00");
  });

  it("just under the threshold produces nothing; exactly 2x produces the finding", async () => {
    expect(crossEmailFindings((await pair("$1,000.00", "$1,999.00")).b, (await pair("$1,000.00", "$1,999.00")).emails)).toEqual([]);
    const two = await pair("$1,000.00", "$2,000.00");
    expect(crossEmailFindings(two.b, two.emails).map((f) => f.rule_id)).toEqual(["invoice_amount_anomaly"]);
  });

  it("an amount anomaly together with an unchanged account never exceeds medium and never says fraud", async () => {
    const { b, emails } = await pair("$1,000.00", "$9,000.00");
    const v = buildRiskView(b, null, emails, OPTS);
    expect(v.final_level).not.toBe("high");
    expect(v.rules_level).toBe("low");
  });

  it("amounts in different currencies are not compared", async () => {
    const repo = new MemoryRepository();
    const a = await pasted(repo, invoice({ from: "ar@acme-parts.example", date: "Mon, 04 May 2026 10:00:00 +0000", vendor: "Acme Parts LLC", invoice: "A-1", amount: "£100.00", account: "1111" }));
    const b = await pasted(repo, invoice({ from: "ar@acme-parts.example", date: "Thu, 04 Jun 2026 10:00:00 +0000", vendor: "Acme Parts LLC", invoice: "A-2", amount: "$900.00", account: "1111" }));
    expect(crossEmailFindings(b, [a, b])).toEqual([]);
  });
});

describe("vendor identity: consistent, tentative, unknown", () => {
  const facts = async (text: string) => {
    const repo = new MemoryRepository();
    const e = await pasted(repo, text);
    return { email: e, facts: extractVendorFacts(e) };
  };

  it("same sender domain and same normalized vendor name -> consistent", async () => {
    const a = await facts(invoice({ from: "ar@acme-parts.example", date: "Mon, 04 May 2026 10:00:00 +0000", vendor: "Acme Parts LLC", invoice: "A-100", amount: "$1,000.00", account: "1111" }));
    const b = await facts(invoice({ from: "ar@acme-parts.example", date: "Thu, 04 Jun 2026 10:00:00 +0000", vendor: "ACME PARTS, Inc.", invoice: "A-200", amount: "$1,100.00", account: "2222" }));
    expect(vendorIdentity(b.facts, a.facts)).toBe("consistent"); // legal suffix and case ignored
  });

  it("similar names on different domains are NOT the same vendor (unknown)", async () => {
    const a = await facts(invoice({ from: "billing@northgate-suppliers.com", date: "Mon, 04 May 2026 10:00:00 +0000", vendor: "Northgate Suppliers Inc.", invoice: "NS-1", amount: "$1,000.00", account: "6621" }));
    const b = await facts(invoice({ from: "billing@northgate-supply.example", date: "Thu, 04 Jun 2026 10:00:00 +0000", vendor: "Northgate Supply Co.", invoice: "NS-9", amount: "$9,000.00", account: "9902" }));
    expect(normalizeVendorName("Northgate Suppliers Inc.")).not.toBe(normalizeVendorName("Northgate Supply Co."));
    expect(vendorIdentity(b.facts, a.facts)).toBeNull();
    expect(crossEmailFindings(b.email, [a.email, b.email])).toEqual([]);
  });

  it("same domain but different vendor names is only tentative", async () => {
    const a = await facts(invoice({ from: "billing@shared-mail.example", date: "Mon, 04 May 2026 10:00:00 +0000", vendor: "Alpha Freight Ltd.", invoice: "AF-1", amount: "$1,000.00", account: "1111" }));
    const b = await facts(invoice({ from: "billing@shared-mail.example", date: "Thu, 04 Jun 2026 10:00:00 +0000", vendor: "Beta Haulage Ltd.", invoice: "BH-1", amount: "$5,000.00", account: "2222" }));
    expect(vendorIdentity(b.facts, a.facts)).toBe("tentative");
    const findings = crossEmailFindings(b.email, [a.email, b.email]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.identity === "tentative")).toBe(true);
    expect(findings[0]!.summary).toMatch(/possibly related sender/);
  });

  it("the same vendor name from a different domain is tentative, not confirmed", async () => {
    const a = await facts(invoice({ from: "billing@northgate-suppliers.com", date: "Mon, 04 May 2026 10:00:00 +0000", vendor: "Northgate Suppliers Inc.", invoice: "NS-1", amount: "$1,000.00", account: "6621" }));
    const b = await facts(invoice({ from: "billing@northgate-suppliers-invoices.example", date: "Thu, 04 Jun 2026 10:00:00 +0000", vendor: "Northgate Suppliers Inc.", invoice: "NS-2", amount: "$1,000.00", account: "9902" }));
    expect(vendorIdentity(b.facts, a.facts)).toBe("tentative");
  });

  it("a tentative match is shown but never raises the level above low on its own", async () => {
    const repo = new MemoryRepository();
    const a = await pasted(repo, invoice({ from: "billing@shared-mail.example", date: "Mon, 04 May 2026 10:00:00 +0000", vendor: "Alpha Freight Ltd.", invoice: "AF-1", amount: "$1,000.00", account: "1111" }));
    const b = await pasted(repo, invoice({ from: "billing@shared-mail.example", date: "Thu, 04 Jun 2026 10:00:00 +0000", vendor: "Beta Haulage Ltd.", invoice: "BH-1", amount: "$5,000.00", account: "2222" }));
    const v = buildRiskView(b, null, [a, b], OPTS);
    expect(v.findings.map((f) => f.rule_id).sort()).toEqual(["invoice_amount_anomaly", "payment_account_changed"]);
    expect(v.indicators.every((i) => i.identity === "tentative" && !i.counts_toward_medium)).toBe(true);
    expect(v.rules_level).toBe("low");
    expect(v.final_level).toBe("low");
  });

  it("the same account and a similar amount produce no finding", async () => {
    const a = await facts(invoice({ from: "ar@acme-parts.example", date: "Mon, 04 May 2026 10:00:00 +0000", vendor: "Acme Parts LLC", invoice: "A-1", amount: "$1,000.00", account: "1111" }));
    const b = await facts(invoice({ from: "ar@acme-parts.example", date: "Thu, 04 Jun 2026 10:00:00 +0000", vendor: "Acme Parts LLC", invoice: "A-2", amount: "$1,250.00", account: "1111" }));
    expect(crossEmailFindings(b.email, [a.email, b.email])).toEqual([]);
  });

  it("an undated email is not ordered against others (no finding is guessed)", async () => {
    const repo = new MemoryRepository();
    const a = await pasted(repo, invoice({ from: "ar@acme-parts.example", date: "Mon, 04 May 2026 10:00:00 +0000", vendor: "Acme Parts LLC", invoice: "A-1", amount: "$1,000.00", account: "1111" }));
    const undated = await pasted(
      repo,
      "From: ar@acme-parts.example\nSubject: Invoice A-2\n\nAcme Parts LLC Invoice #A-2. Amount due: $9,999.00. Payment account: account ending 2222.",
    );
    expect(undated.date).toBeNull();
    expect(crossEmailFindings(undated, [a, undated] as StoredEmail[])).toEqual([]);
  });

  it("a document naming two different candidate accounts is ambiguous: no account is claimed", async () => {
    const e = await facts(
      "From: ar@acme-parts.example\nDate: Mon, 04 May 2026 10:00:00 +0000\nSubject: Invoice\n\nAcme Parts LLC Invoice #A-1. Amount due: $1,000.00. Pay account ending 1111 or account ending 2222.",
    );
    expect(e.facts.current_account).toBeNull();
  });
});
