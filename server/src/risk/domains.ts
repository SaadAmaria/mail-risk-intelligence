/**
 * Domain helpers for look-alike detection. All functions are pure. Look-alike detection here
 * produces an OBSERVATION ("this domain resembles ours"), never a verdict.
 */

const MULTI_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "co.nz", "co.jp", "com.br", "co.in", "co.za",
]);

const PERSONAL_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com", "hotmail.com", "live.com",
  "msn.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "pm.me", "fastmail.com",
  "fastmail.fm", "gmx.com", "gmx.net", "zoho.com", "mail.com", "yandex.com", "tutanota.com",
]);

export function domainOfAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const at = address.lastIndexOf("@");
  if (at === -1) return null;
  const d = address.slice(at + 1).trim().toLowerCase().replace(/\.$/, "");
  return d.length > 0 ? d : null;
}

/** Registrable domain: last two labels, or three for a known multi-part public suffix. */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  return MULTI_PART_SUFFIXES.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

export function isInternalHost(host: string, orgDomains: string[]): boolean {
  const reg = registrableDomain(host);
  return orgDomains.some((o) => registrableDomain(o) === reg);
}

export function isPersonalMailDomain(domain: string): boolean {
  return PERSONAL_MAIL_DOMAINS.has(registrableDomain(domain));
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/** Fold characters commonly used to imitate others (rn->m, vv->w, 0->o, 1->l, 5->s). */
export function foldConfusables(s: string): string {
  return s
    .toLowerCase()
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
    .replace(/0/g, "o")
    .replace(/1/g, "l")
    .replace(/5/g, "s");
}

export type LookalikeReason =
  | "brand_token_with_extra_words" // e.g. arcline-portal.com
  | "different_tld" // arcline.co
  | "confusable_characters" // arc1ine.com
  | "edit_distance" // arclne.com, arclline-corp.com
  | "subdomain_trick"; // arcline.com.evil.example

export interface Lookalike {
  org_domain: string;
  reason: LookalikeReason;
  /** The label or token that resembles the organization's name. */
  matched: string;
  distance: number;
}

/**
 * Does `host` resemble one of the organization's own domains without being one of them?
 * Short organization names are matched more strictly. An unrelated domain is never flagged.
 */
export function lookalikeOf(host: string, orgDomains: string[]): Lookalike | null {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (isInternalHost(h, orgDomains)) return null;

  const reg = registrableDomain(h);
  const regLabel = reg.split(".")[0] ?? "";
  const hostLabels = h.split(".");

  for (const org of orgDomains) {
    const orgReg = registrableDomain(org.toLowerCase());
    const orgLabel = orgReg.split(".")[0] ?? "";
    if (orgLabel.length < 4) continue;

    // The organization's name used as a label of someone else's domain.
    if (hostLabels.slice(0, -2).includes(orgLabel)) {
      return { org_domain: orgReg, reason: "subdomain_trick", matched: orgLabel, distance: 0 };
    }
    if (regLabel === orgLabel) {
      return { org_domain: orgReg, reason: "different_tld", matched: regLabel, distance: 0 };
    }

    const tokens = [regLabel, ...regLabel.split(/[-_]/).filter((t) => t.length > 0)];
    const maxDist = orgLabel.length >= 8 ? 2 : 1;
    for (const t of tokens) {
      if (t === orgLabel) {
        return { org_domain: orgReg, reason: "brand_token_with_extra_words", matched: t, distance: 0 };
      }
      if (t.length >= 4 && foldConfusables(t) === foldConfusables(orgLabel)) {
        return { org_domain: orgReg, reason: "confusable_characters", matched: t, distance: 0 };
      }
      if (t.length >= 5) {
        const d = levenshtein(t, orgLabel);
        if (d >= 1 && d <= maxDist) {
          return { org_domain: orgReg, reason: "edit_distance", matched: t, distance: d };
        }
      }
    }
  }
  return null;
}

/** Host of a URL as it appears in text, understanding defanged `hxxp(s)`. Never fetches it. */
export function hostOfUrl(raw: string): string | null {
  const fixed = raw.replace(/^hxxp/i, "http").replace(/\[\.\]/g, ".");
  try {
    const u = new URL(fixed);
    return u.hostname.toLowerCase().replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

export function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[");
}
