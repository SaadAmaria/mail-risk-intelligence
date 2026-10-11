import type { NormalizedEmail, RiskIndicator } from "@mri/shared";
import { findDeterministicHits } from "../agents/deterministic";
import { buildSegments } from "../agents/source";
import {
  domainOfAddress,
  hostOfUrl,
  isInternalHost,
  isIpLiteral,
  isPersonalMailDomain,
  lookalikeOf,
  registrableDomain,
} from "./domains";
import { evidenceAround, firstMatches, isQuotedOrReported } from "./evidence";
import { AUTHORITY_LOCAL_TOKENS, LEXICON, SENSITIVE_MATERIAL } from "./lexicon";

export interface IndicatorOptions {
  /** The organization's own domains (look-alike reference). */
  orgDomains: string[];
}

type EmailLike = Pick<
  NormalizedEmail,
  "from" | "to" | "cc" | "date" | "subject" | "body" | "attachments"
> & { id: string };

/**
 * Deterministic observations and contextual indicators for ONE email, from its own content.
 * Everything here is evidence for a human reviewer, not a verdict, and nothing is emitted
 * without a located quote. The input is the stored email text; model output is never consulted,
 * so nothing a model (or the email) says can switch these off.
 */
export function computeIndicators(email: EmailLike, options: IndicatorOptions): RiskIndicator[] {
  const out: RiskIndicator[] = [];
  const counters = new Map<string, number>();
  const add = (i: Omit<RiskIndicator, "id" | "counts_toward_medium" | "sufficient_for_medium" | "related_email_ids"> &
    Partial<Pick<RiskIndicator, "counts_toward_medium" | "sufficient_for_medium" | "related_email_ids">>): void => {
    const n = (counters.get(i.rule_id) ?? 0) + 1;
    counters.set(i.rule_id, n);
    out.push({
      counts_toward_medium: true,
      sufficient_for_medium: false,
      related_email_ids: [],
      ...i,
      id: `${email.id}:${i.rule_id}:${n}`,
    });
  };

  const segments = buildSegments(email);
  const header = segments.find((s) => s.where === "header");
  const senderAddress = email.from?.address ?? null;
  const senderDomain = domainOfAddress(senderAddress);
  const senderInternal = senderDomain ? isInternalHost(senderDomain, options.orgDomains) : false;

  // ---- Observation: sender domain resembles ours ----------------------------------------
  const senderLookalike = senderDomain ? lookalikeOf(senderDomain, options.orgDomains) : null;
  if (senderLookalike && senderDomain && header && senderAddress) {
    const at = header.text.indexOf(senderAddress);
    add({
      rule_id: "lookalike_sender_domain",
      category: "observation",
      label: "Sender domain resembles the organization's domain",
      detail:
        `"${senderDomain}" is not an organization domain but resembles "${senderLookalike.org_domain}" ` +
        `(${senderLookalike.reason.replace(/_/g, " ")}; matched "${senderLookalike.matched}"). ` +
        "This is an observation about the address; it does not by itself show wrongdoing.",
      evidence: [evidenceAround(email.id, header, Math.max(0, at), Math.max(0, at) + senderAddress.length)],
    });
  }

  // ---- Observation: suspicious links (not every external URL) ---------------------------
  const hits = findDeterministicHits(segments).filter((h) => h.kind === "url");
  const seenHosts = new Set<string>();
  for (const h of hits) {
    const host = hostOfUrl(h.value);
    if (!host || seenHosts.has(host) || isInternalHost(host, options.orgDomains)) continue;
    const reasons: string[] = [];
    const look = lookalikeOf(host, options.orgDomains);
    if (look) reasons.push(`resembles "${look.org_domain}" (${look.reason.replace(/_/g, " ")})`);
    if (host.split(".").some((l) => l.startsWith("xn--"))) reasons.push("uses an internationalized (punycode) label");
    if (isIpLiteral(host)) reasons.push("is a raw IP address");
    if (reasons.length === 0) continue; // an ordinary external link is not an indicator
    seenHosts.add(host);
    add({
      rule_id: "suspicious_link",
      category: "observation",
      label: "Link points to a suspicious domain",
      detail: `The link host "${host}" ${reasons.join(" and ")}. The link was recorded as text and was not opened.`,
      evidence: [evidenceAround(email.id, segments[h.segmentIndex]!, h.start, h.end)],
    });
  }

  // ---- Contextual lexicon indicators ------------------------------------------------------
  for (const rule of LEXICON) {
    const matches = firstMatches(email.id, segments, rule.patterns);
    if (matches.length === 0) continue;
    // Phrases that are ordinary on their own count only next to an explicit match.
    const supporting = rule.corroborating ? firstMatches(email.id, segments, rule.corroborating) : [];
    const all = [...matches, ...supporting];
    const phrases = new Set(all.map((m) => m.matched.toLowerCase()));

    // Threats are judged by context: language that is quoted or reported ("It said '...'", a
    // `>` quoted reply, an incident report) is not a threat made by this sender.
    let direct = all.length;
    if (rule.rule_id === "threat_language") {
      direct = all.filter((m) => !isQuotedOrReported(m.segment.text, m.index)).length;
    }
    const reportedOnly = rule.rule_id === "threat_language" && direct === 0;

    add({
      rule_id: rule.rule_id,
      category: rule.category,
      label: reportedOnly ? "Threatening language that is quoted or reported" : rule.label,
      detail: reportedOnly
        ? "Threatening wording appears inside quotation marks, a quoted reply, or a report of someone else's " +
          "words, so it is not treated as a threat made by this sender. Shown for context only."
        : `Matched ${all.length} phrase pattern(s): ` +
          [...phrases].slice(0, 4).map((p) => `"${p.slice(0, 60)}"`).join(", ") +
          (rule.rule_id === "prompt_injection_language"
            ? ". This is text aimed at an automated reviewer; it is evidence of an attempt to influence review, not proof of fraud."
            : ". A phrase match is a prompt for review, not proof of intent."),
      evidence: all.slice(0, 3).map((m) => m.evidence),
      // Reported/quoted language does not count toward medium; several DIRECT distinct threats do.
      counts_toward_medium: !reportedOnly,
      sufficient_for_medium: rule.rule_id === "threat_language" && direct >= 2,
    });
  }

  // ---- Impersonation: authority claim from a look-alike domain ------------------------------
  if (senderLookalike && senderAddress && header) {
    const local = senderAddress.split("@")[0]!.toLowerCase();
    const tokens = local.split(/[^a-z0-9]+/).filter(Boolean);
    const claimed = tokens.filter((t) => AUTHORITY_LOCAL_TOKENS.has(t));
    if (claimed.length > 0) {
      const at = header.text.indexOf(senderAddress);
      add({
        rule_id: "authority_claim_from_lookalike",
        category: "impersonation",
        label: "Authority claimed from a look-alike domain",
        detail:
          `The address claims a role (${claimed.join(", ")}) while its domain resembles the ` +
          "organization's. Authority words alone are not suspicious; the combination is worth review.",
        evidence: [evidenceAround(email.id, header, Math.max(0, at), Math.max(0, at) + senderAddress.length)],
      });
    }
  }

  // ---- Information: sensitive material from an internal sender to a personal address ----
  if (senderInternal && header) {
    const personal = [...email.to, ...email.cc].find((r) => {
      const d = domainOfAddress(r.address);
      return d !== null && isPersonalMailDomain(d) && !isInternalHost(d, options.orgDomains);
    });
    if (personal) {
      const textSegments = segments.filter((s) => s.where !== "header");
      const sensitive = firstMatches(email.id, textSegments, [SENSITIVE_MATERIAL]);
      if (sensitive.length > 0) {
        const at = header.text.indexOf(personal.address);
        add({
          rule_id: "sensitive_material_to_personal_address",
          category: "information",
          label: "Internal sender sent apparently sensitive material to a personal address",
          detail:
            `Recipient "${personal.address}" is a personal mailbox. The text mentions sensitive material ` +
            `(${sensitive[0]!.matched.toLowerCase()}). Sending to a personal address is not itself wrong.`,
          evidence: [
            evidenceAround(email.id, header, Math.max(0, at), Math.max(0, at) + personal.address.length),
            sensitive[0]!.evidence,
          ],
        });
      }
    }
  }

  // Sanity: nothing may be emitted without located evidence.
  return out.filter((i) => i.evidence.length > 0 && i.evidence.every((e) => e.text.length > 0));
}

/** For the sender, the registrable domain (used by the vendor comparison). */
export function senderRegistrableDomain(email: Pick<NormalizedEmail, "from">): string | null {
  const d = domainOfAddress(email.from?.address);
  return d ? registrableDomain(d) : null;
}
