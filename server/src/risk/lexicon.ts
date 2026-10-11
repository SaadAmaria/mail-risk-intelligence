import type { IndicatorCategory } from "@mri/shared";

/**
 * Phrase patterns for contextual indicators. Each pattern is deliberately specific: a single
 * common word ("confidential", "urgent" alone in a newsletter) must not be enough to matter, and
 * every indicator is only EVIDENCE that a human should look at, never a verdict. A rule that
 * matches contributes a located quote; nothing is reported without one.
 */
export interface LexiconRule {
  rule_id: string;
  category: IndicatorCategory;
  label: string;
  patterns: RegExp[];
  /**
   * Patterns that are ordinary in everyday text on their own ("mark as safe", "set the risk
   * level"). They are reported only as supporting evidence when a `patterns` match exists.
   */
  corroborating?: RegExp[];
}

export const LEXICON: LexiconRule[] = [
  {
    rule_id: "urgency",
    category: "pressure",
    label: "Urgency or deadline pressure",
    patterns: [
      /\burgent(?:ly)?\b/i,
      /\bimmediately\b/i,
      /\bbefore (?:noon|12\s?(?:pm|p\.m\.)|(?:the )?end of (?:the )?day|close of business|eod|cob)\b/i,
      /\bwithin (?:the next )?\d{1,2}\s?(?:hours?|hrs?)\b/i,
      /\bin (?:the next )?\d{1,2}\s?(?:hours?|hrs?)\b/i,
      /\b(?:cannot|can't|can not) wait\b/i,
      /\btime[- ]sensitive\b/i,
      /\bfailure to act\b/i,
      /\baccount (?:suspension|will be (?:suspended|closed|locked))\b/i,
    ],
  },
  {
    rule_id: "secrecy",
    category: "pressure",
    label: "Request for secrecy or to bypass normal channels",
    patterns: [
      /\bkeep (?:this|it) (?:confidential|between us|quiet|private|secret)\b/i,
      /\btreat (?:this|it) as confidential\b/i,
      /\b(?:do not|don't|dont) (?:loop|tell|inform|involve|share|forward|mention)\b[^.\n]{0,50}/i,
      /\b(?:do not|don't|dont) reply\b[^.\n]{0,40}\b(?:work|company|corporate) (?:e-?mail|address|account)\b/i,
      /\bdelete (?:this|it|the e-?mail) after\b/i,
      /\bbetween (?:us|you and me)\b/i,
      /\boff the record\b/i,
      /\bwithout (?:telling|informing|alerting) anyone\b/i,
    ],
  },
  {
    rule_id: "payment_request",
    category: "action",
    label: "Request to send money",
    patterns: [
      /\b(?:wire|transfer|remit|send)\b[^.\n]{0,45}?[$€£]\s?\d/i,
      /[$€£]\s?\d[\d,.]*\s?[KkMm]?\b[^.\n]{0,45}?\b(?:wire|transfer|remit)\b/i,
      /\bwire (?:the )?(?:funds|money|payment)\b/i,
      /\bI need (?:finance|accounts payable|ap)\b[^.\n]{0,40}\bto (?:wire|pay|transfer)\b/i,
    ],
  },
  {
    rule_id: "payment_detail_change",
    category: "action",
    label: "Request to use changed payment details",
    patterns: [
      /\b(?:new|updated|changed|different)\s+(?:bank(?:ing)?|payment|wire|remittance)\s+(?:details|account|information|instructions|provider)\b/i,
      /\bchanged (?:our )?bank(?:ing)? provider/i,
      /\b(?:rather than|instead of) the account on file\b/i,
      /\bplease update your (?:records|vendor|payment)\b/i,
    ],
  },
  {
    rule_id: "out_of_band_payment_details",
    category: "action",
    label: "Payment details to follow through another channel",
    patterns: [
      /\b(?:account|bank|wire|payment) (?:details|information)\b[^.\n]{0,50}\b(?:from|via|on|through) (?:my )?(?:personal|private) (?:phone|e-?mail|number|address)\b/i,
      /\bI(?:'ll| will) send (?:the )?(?:account|bank|wire) details\b/i,
    ],
  },
  {
    rule_id: "credential_request",
    category: "action",
    label: "Request to verify identity or reset credentials",
    patterns: [
      /\b(?:verify|confirm|validate) your (?:identity|account|password|credentials|login)\b/i,
      /\breset your password\b/i,
      /\bpassword (?:will )?(?:expires?|expire)\b/i,
      /\bclick (?:the |this |on the )?(?:secure )?(?:link|button)\b/i,
      /\b(?:log ?in|sign ?in) (?:immediately|now|using|with|to (?:avoid|keep|confirm))\b/i,
    ],
  },
  {
    rule_id: "inside_information_language",
    category: "information",
    label: "Language suggesting non-public information or trading ahead of news",
    patterns: [
      /\bbefore the (?:market|announcement|news|public)\b[^.\n]{0,30}/i,
      /\b(?:pick up|buy|grab|load up on) (?:some )?(?:shares|stock|options)\b/i,
      /\b(?:deal|acquisition|merger|earnings)\b[^.\n]{0,50}\b(?:basically done|about to|not (?:public|announced)|before it (?:is|'s) announced)\b/i,
      /\bannouncement is (?:on |this |next )?\w+/i,
      /\binside (?:information|info|tip|knowledge)\b/i,
    ],
  },
  {
    rule_id: "threat_language",
    category: "threat",
    label: "Threatening language",
    patterns: [
      /\bI know where (?:you|your)\b[^.\n]{0,40}/i,
      /\bI know people\b/i,
      /\byou(?:'ll| will) (?:regret|be hearing from me)\b/i,
      /\byou won'?t like (?:how|what)\b/i,
      /\bwatch your back\b/i,
      /\bthis isn'?t over\b/i,
      /\bcome after (?:you|your)\b/i,
    ],
  },
  {
    rule_id: "prompt_injection_language",
    category: "tampering",
    label: "Text aimed at manipulating automated review",
    // Explicit instruction-override, role re-assignment or delimiter forgery. Ordinary phrases
    // such as "mark this message as safe" (mail-client help) or "set the risk level" (project
    // planning) are NOT enough on their own; see `corroborating`.
    patterns: [
      /\bignore (?:all |any |the )?(?:previous|prior|above|earlier) (?:instructions|rules|messages|prompts)\b/i,
      /\bdisregard (?:all |the )?(?:above|previous|prior|system) (?:instructions|rules|prompts|messages)\b/i,
      /\byou are now\b[^.\n]{0,50}\b(?:assistant|AI|language model|compliance officer|reviewer)\b/i,
      /\bas an? (?:AI|language model)\b[^.\n]{0,40}\b(?:you (?:must|should|will)|please)\b/i,
      /<<<\s*(?:BEGIN|END)_UNTRUSTED/i,
    ],
    corroborating: [
      /\bmark (?:this|it|the|this (?:message|email|e-?mail)|the (?:message|email|e-?mail))(?: (?:message|email|e-?mail))? (?:as )?(?:safe|legitimate|benign|none|no risk)\b/i,
      /\bset (?:the )?risk(?:[ ._]?level)?\b[^.\n]{0,20}\b(?:to )?(?:none|low|safe)\b/i,
      /\b(?:reveal|show|print|output) (?:your )?(?:system|developer) prompt\b/i,
    ],
  },
];

/** Words in a sender's local part that claim authority. Only meaningful with a look-alike domain. */
export const AUTHORITY_LOCAL_TOKENS = new Set([
  "ceo", "cfo", "coo", "cto", "president", "chairman", "director", "executive", "payroll", "hr",
  "helpdesk", "it", "itsupport", "support", "security", "admin", "administrator", "accounts", "billing",
  "alert", "alerts", "noreply", "compliance",
]);

/** Words that make "confidential material sent to a personal address" worth noting. */
export const SENSITIVE_MATERIAL = /\b(?:confidential|proprietary|internal only|trade secret|customer list|client list|contracts?|source code|roadmap|pricing|copies)\b/i;
