import type {
  CrossEmailFinding,
  EvidenceRef,
  NormalizedEmail,
  VendorIdentity,
} from "@mri/shared";
import { buildSegments, type SourceSegment } from "../agents/source";
import { registrableDomain, domainOfAddress } from "./domains";
import { evidenceAround } from "./evidence";
import { LEXICON } from "./lexicon";

type EmailLike = Pick<NormalizedEmail, "from" | "date" | "subject" | "body" | "to" | "cc" | "attachments"> & {
  id: string;
};

const LEGAL_SUFFIX = new Set([
  "inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "gmbh", "plc", "sa", "ag", "bv", "nv",
]);

/** Lower-case, punctuation-free vendor name without legal suffixes. Exact comparison only. */
export function normalizeVendorName(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/[.,'’"()]/g, " ")
    .replace(/&/g, " and ")
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 1 && LEGAL_SUFFIX.has(tokens[tokens.length - 1]!)) tokens.pop();
  return tokens.join(" ");
}

interface Located<T> {
  value: T;
  evidence: EvidenceRef;
}

/** Payment-relevant facts of one email, read deterministically from its text. */
export interface VendorFacts {
  email_id: string;
  date: string | null;
  sender_domain: string | null;
  vendor_name: Located<string> | null;
  vendor_key: string | null;
  amount_due: Located<{ value: number; currency: string }> | null;
  /** The account the document says payment should go to (null when absent or ambiguous). */
  current_account: Located<string> | null;
  routing: Located<string> | null;
  /** Account numbers explicitly described as the *previous* account. */
  previous_accounts: Located<string>[];
  invoice_number: string | null;
  claims_bank_change: boolean;
}

const VENDOR_NAME = /^\s*([A-Z][\w&.,'’ \-]{1,60}?)\s+(?:Invoice|Statement|Remittance|Receipt)\b/;
const AMOUNT_DUE =
  /amount\s+(?:due|payable|owed)\s*(?:is|:)?\s*(?:USD\s*)?([$€£])\s?(\d[\d,]*(?:\.\d{1,2})?)/i;
const BODY_AMOUNT = /invoice[^.\n]{0,50}?\bfor\s+([$€£])\s?(\d[\d,]*(?:\.\d{1,2})?)/i;
const ACCOUNT = /\baccount(?:\s+(?:number|no\.?|#))?\s*(?:ending(?:\s+in|\s+with)?|ends\s+in)\s*#?\s*(\d{3,})/gi;
const ACCOUNT_NUM = /\baccount\s*(?:number|no\.?|#)\s*:?\s*(\d{4,})/gi;
const ROUTING = /\brouting(?:\s+(?:number|no\.?|#))?\s*:?\s*(\d{9})\b/i;
const INVOICE_NO = /\binvoice\s*(?:#|no\.?|number)?\s*:?\s*([A-Z]{0,4}-?\d[\w-]{2,})/i;
const CURRENCY: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP" };

const CHANGE_PATTERNS = LEXICON.find((r) => r.rule_id === "payment_detail_change")!.patterns;

function sentenceBefore(text: string, index: number): string {
  const head = text.slice(0, index);
  const boundary = Math.max(head.lastIndexOf(". "), head.lastIndexOf("\n"), head.lastIndexOf("! "));
  return head.slice(boundary + 1).toLowerCase();
}

function parseMoney(symbol: string, digits: string): { value: number; currency: string } | null {
  const n = Number(digits.replace(/,/g, ""));
  return Number.isFinite(n) ? { value: n, currency: CURRENCY[symbol] ?? "USD" } : null;
}

/** Read the payment-relevant facts of an email. Pure; looks at attachments first, then the body. */
export function extractVendorFacts(email: EmailLike): VendorFacts {
  const segments = buildSegments(email);
  const docs = [
    ...segments.filter((s) => s.where === "attachment"),
    ...segments.filter((s) => s.where === "body"),
  ];
  const ev = (seg: SourceSegment, start: number, end: number) => evidenceAround(email.id, seg, start, end);

  let vendorName: VendorFacts["vendor_name"] = null;
  let amountDue: VendorFacts["amount_due"] = null;
  let routing: VendorFacts["routing"] = null;
  let invoiceNumber: string | null = null;
  const accounts: { value: string; label: "previous" | "new" | "payment"; evidence: EvidenceRef }[] = [];

  for (const seg of docs) {
    if (!vendorName) {
      // A document header such as "Northgate Suppliers Inc. Invoice #NS-4471". Attachments are
      // read first; a pasted invoice carries the same header at the start of the body.
      const m = VENDOR_NAME.exec(seg.text.slice(0, 200));
      if (m) vendorName = { value: m[1]!.trim(), evidence: ev(seg, m.index, m.index + m[0].length) };
    }
    if (!amountDue) {
      const m = AMOUNT_DUE.exec(seg.text) ?? (seg.where === "body" ? BODY_AMOUNT.exec(seg.text) : null);
      if (m) {
        const money = parseMoney(m[1]!, m[2]!);
        if (money) amountDue = { value: money, evidence: ev(seg, m.index, m.index + m[0].length) };
      }
    }
    if (!routing) {
      const m = ROUTING.exec(seg.text);
      if (m) routing = { value: m[1]!, evidence: ev(seg, m.index, m.index + m[0].length) };
    }
    if (!invoiceNumber) {
      const m = INVOICE_NO.exec(seg.text);
      if (m) invoiceNumber = m[1]!;
    }
    for (const re of [ACCOUNT, ACCOUNT_NUM]) {
      const r = new RegExp(re.source, re.flags);
      for (let m = r.exec(seg.text); m; m = r.exec(seg.text)) {
        const context = sentenceBefore(seg.text, m.index);
        const label = /\b(?:previous|prior|earlier|former|old)\b/.test(context)
          ? "previous"
          : /\b(?:new|updated|changed|replacement)\b/.test(context)
            ? "new"
            : "payment";
        accounts.push({ value: m[1]!, label, evidence: ev(seg, m.index, m.index + m[0].length) });
      }
    }
  }

  // The destination the document asks to pay: "new" wins; otherwise unlabelled payment mentions.
  // If the document names more than one candidate, it is ambiguous and nothing is claimed.
  const candidates = (label: "new" | "payment") => {
    const distinct = new Map(accounts.filter((a) => a.label === label).map((a) => [a.value, a]));
    return [...distinct.values()];
  };
  const pick = (c: ReturnType<typeof candidates>) => (c.length === 1 ? { value: c[0]!.value, evidence: c[0]!.evidence } : null);
  const newOnes = candidates("new");
  const current = newOnes.length > 0 ? pick(newOnes) : pick(candidates("payment"));

  const allText = segments.filter((s) => s.where !== "header");
  const claimsChange = allText.some((s) => CHANGE_PATTERNS.some((p) => p.test(s.text)));

  return {
    email_id: email.id,
    date: email.date,
    sender_domain: (() => {
      const d = domainOfAddress(email.from?.address);
      return d ? registrableDomain(d) : null;
    })(),
    vendor_name: vendorName,
    vendor_key: vendorName ? normalizeVendorName(vendorName.value) : null,
    amount_due: amountDue,
    current_account: current,
    routing,
    previous_accounts: accounts
      .filter((a) => a.label === "previous")
      .map((a) => ({ value: a.value, evidence: a.evidence })),
    invoice_number: invoiceNumber,
    claims_bank_change: claimsChange,
  };
}

/**
 * Vendor identity ladder (compares two emails' claimed vendor):
 *   consistent - same sender domain AND the same normalized vendor name in the documents;
 *   tentative  - same sender domain but a name is missing/different, OR the same vendor name
 *                from a different sender domain;
 *   null       - neither; no relationship is claimed.
 * "Consistent" means the CLAIMED identity matches across documents. It is not proof of
 * authenticity: a compromised or spoofed sender would also look consistent.
 */
export function vendorIdentity(a: VendorFacts, b: VendorFacts): VendorIdentity | null {
  const sameDomain = a.sender_domain !== null && a.sender_domain === b.sender_domain;
  const bothNamed = a.vendor_key !== null && b.vendor_key !== null;
  const sameName = bothNamed && a.vendor_key === b.vendor_key;

  if (sameDomain && sameName) return "consistent";
  if (sameDomain) return "tentative";
  if (sameName) return "tentative";
  return null;
}

/** Chronological order with a stable id tie-break. Emails without a date are not ordered. */
function isEarlier(a: VendorFacts, b: VendorFacts): boolean {
  if (a.date === null || b.date === null) return false;
  if (a.date !== b.date) return a.date < b.date;
  return a.email_id < b.email_id;
}

const AMOUNT_RATIO_THRESHOLD = 2;

/**
 * Cross-email findings about `target`, computed from the whole mailbox at read time.
 * Order-independent: it depends only on dates and content, never on ingestion order, and nothing
 * is stored, so results change as soon as another email is present. No model is involved.
 */
export function crossEmailFindings(target: EmailLike, all: EmailLike[]): CrossEmailFinding[] {
  const t = extractVendorFacts(target);
  const hasFinancials = t.current_account !== null || t.amount_due !== null;
  if (!hasFinancials) return [];

  const peers = all
    .filter((e) => e.id !== target.id)
    .map((e) => ({ email: e, facts: extractVendorFacts(e) }))
    .filter((p) => (p.facts.current_account !== null || p.facts.amount_due !== null) && isEarlier(p.facts, t))
    .map((p) => ({ ...p, identity: vendorIdentity(t, p.facts) }))
    .filter((p): p is typeof p & { identity: VendorIdentity } => p.identity !== null)
    .sort((a, b) => (a.facts.date! < b.facts.date! ? -1 : a.facts.date! > b.facts.date! ? 1 : a.facts.email_id < b.facts.email_id ? -1 : 1));

  if (peers.length === 0) return [];

  // Use the strongest identity available; never mix tentative peers into a consistent finding.
  const identity: VendorIdentity = peers.some((p) => p.identity === "consistent") ? "consistent" : "tentative";
  const baseline = peers.filter((p) => p.identity === identity);
  const vendor = { name: t.vendor_name?.value ?? baseline.find((p) => p.facts.vendor_name)?.facts.vendor_name?.value ?? null, domain: t.sender_domain };
  const findings: CrossEmailFinding[] = [];

  // 1. Payment account differs from the account(s) earlier invoices used.
  const priorAccounts = new Map<string, { facts: VendorFacts; email_id: string }>();
  for (const p of baseline) {
    const acct = p.facts.current_account;
    if (acct && !priorAccounts.has(acct.value)) priorAccounts.set(acct.value, { facts: p.facts, email_id: p.facts.email_id });
  }
  if (t.current_account && priorAccounts.size > 0 && !priorAccounts.has(t.current_account.value)) {
    const priorEvidence = [...priorAccounts.values()].map((p) => p.facts.current_account!.evidence);
    const priorRouting = [...new Set(baseline.map((p) => p.facts.routing?.value).filter((r): r is string => !!r))];
    const routingUnchanged = !!t.routing && priorRouting.length > 0 && priorRouting.includes(t.routing.value);
    const related = [...new Set([...priorAccounts.values()].map((p) => p.email_id))];
    findings.push({
      id: `${target.id}:payment_account_changed`,
      rule_id: "payment_account_changed",
      email_id: target.id,
      related_email_ids: related,
      identity,
      vendor,
      summary:
        `Payment account ending ${t.current_account.value} differs from ` +
        `${[...priorAccounts.keys()].map((a) => `ending ${a}`).join(", ")} on earlier invoice(s) ` +
        `from ${identity === "consistent" ? "the same vendor" : "a possibly related sender"}` +
        (t.claims_bank_change ? "; the message asks for the new details to be used." : ".") +
        (routingUnchanged ? " The routing number is unchanged." : ""),
      values: {
        prior_accounts: [...priorAccounts.keys()],
        new_account: t.current_account.value,
        routing_unchanged: routingUnchanged,
        claims_bank_change: t.claims_bank_change,
        sender_domain: t.sender_domain,
      },
      evidence: [t.current_account.evidence, ...priorEvidence, ...(t.vendor_name ? [t.vendor_name.evidence] : [])],
    });
  }

  // 2. Invoice amount far above earlier invoices from the same (claimed) vendor.
  const priorAmounts = baseline
    .filter((p) => p.facts.amount_due !== null && p.facts.amount_due.value.currency === t.amount_due?.value.currency)
    .map((p) => ({ amount: p.facts.amount_due!.value.value, facts: p.facts }));
  if (t.amount_due && priorAmounts.length > 0) {
    const max = Math.max(...priorAmounts.map((p) => p.amount));
    const ratio = max > 0 ? t.amount_due.value.value / max : 0;
    if (ratio >= AMOUNT_RATIO_THRESHOLD) {
      findings.push({
        id: `${target.id}:invoice_amount_anomaly`,
        rule_id: "invoice_amount_anomaly",
        email_id: target.id,
        related_email_ids: [...new Set(priorAmounts.map((p) => p.facts.email_id))],
        identity,
        vendor,
        summary:
          `Amount due ${t.amount_due.value.currency} ${t.amount_due.value.value.toLocaleString("en-US")} is ` +
          `${ratio.toFixed(1)}x the largest earlier invoice (${max.toLocaleString("en-US")}) from ` +
          `${identity === "consistent" ? "the same vendor" : "a possibly related sender"}.`,
        values: {
          new_amount: t.amount_due.value.value,
          prior_amounts: priorAmounts.map((p) => p.amount),
          ratio: Math.round(ratio * 10) / 10,
          threshold: AMOUNT_RATIO_THRESHOLD,
          heuristic: true,
        },
        evidence: [t.amount_due.evidence, ...priorAmounts.map((p) => p.facts.amount_due!.evidence)],
      });
    }
  }

  return findings;
}
