import type {
  FinalRiskLevel,
  HealthResponse,
  IndicatorCategory,
  ProcessingStatus,
  RiskView,
} from "@mri/shared";

/**
 * All user-facing wording for risk and processing lives here, in plain language. It is the one
 * place that must not blur "assessed by AI" with "automatic checks" or "not assessed".
 */

export const RISK_LABEL: Record<FinalRiskLevel, string> = {
  high: "High risk",
  medium: "Medium risk",
  low: "Low risk",
  none: "No risk found",
  unassessed: "Not assessed",
};

export const RISK_SHORT: Record<FinalRiskLevel, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "No risk found",
  unassessed: "Not assessed",
};

export const RISK_ORDER: FinalRiskLevel[] = ["high", "medium", "low", "none", "unassessed"];

/** What the level is based on. */
export function basisLine(view: Pick<RiskView, "basis" | "ai_level" | "rules_level" | "assessed">): string {
  switch (view.basis) {
    case "ai_and_rules":
      return `Assessed by AI (${view.ai_level}) and checked by automatic rules (${view.rules_level === "none" ? "no signals" : view.rules_level}).`;
    case "rules_only":
      return "Automatic checks only. This message has not been assessed by AI.";
    default:
      return "Not assessed. There is no AI assessment and the automatic checks found no signals.";
  }
}

/** Short qualifier shown next to a level so a rules-only level is never mistaken for an AI one. */
export function basisChip(basis: RiskView["basis"]): { text: string; kind: "ai" | "rules" | "none" } {
  if (basis === "ai_and_rules") return { text: "AI-assessed", kind: "ai" };
  if (basis === "rules_only") return { text: "Automatic checks only", kind: "rules" };
  return { text: "Not assessed", kind: "none" };
}

export interface StatusCopy {
  title: string;
  detail: string;
  tone: "neutral" | "progress" | "good" | "warn" | "bad";
  /** 0 = not started, 1..3 = queued/extracting/analyzing, 4 = done. */
  step: number;
}

export function statusCopy(status: ProcessingStatus, aiConfigured: boolean): StatusCopy {
  switch (status) {
    case "not_started":
      return {
        title: "Not analyzed yet",
        detail: aiConfigured
          ? "Nothing has been sent to the AI. Automatic checks are shown below. Choose Analyze to run the AI assessment."
          : "AI is not configured, so analysis will run automatic checks only.",
        tone: "neutral",
        step: 0,
      };
    case "queued":
      return { title: "Waiting to be analyzed", detail: "This message is in the queue.", tone: "progress", step: 1 };
    case "extracting":
      return { title: "Reading the message", detail: "Pulling out the key facts and the exact passages that matter.", tone: "progress", step: 2 };
    case "analyzing":
      return { title: "Assessing risk", detail: "Judging the risk and checking every cited quote against the email.", tone: "progress", step: 3 };
    case "complete":
      return {
        title: "Analyzed by AI",
        detail: "Every quote the AI cited was checked against the email before this result was accepted.",
        tone: "good",
        step: 4,
      };
    case "partial":
      return {
        title: "Partly analyzed",
        detail: "The facts were extracted, but a risk assessment could not be verified, so this message is not assessed.",
        tone: "warn",
        step: 2,
      };
    case "degraded":
      return {
        title: "AI analysis was not available",
        detail: "Only automatic checks are shown. They are not an AI assessment.",
        tone: "warn",
        step: 0,
      };
    case "failed":
      return { title: "Analysis failed", detail: "Something went wrong while analyzing this message. It is not assessed.", tone: "bad", step: 0 };
  }
}

export const IN_PROGRESS_STATUSES: ProcessingStatus[] = ["queued", "extracting", "analyzing"];

export const CATEGORY_LABEL: Record<IndicatorCategory, string> = {
  observation: "Observation",
  payment_redirect: "Payment change",
  action: "Requested action",
  pressure: "Pressure",
  impersonation: "Impersonation",
  information: "Sensitive information",
  threat: "Threat",
  tampering: "Review manipulation",
};

export function tagLabel(tag: string): string {
  const s = tag.replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function predicateLabel(p: string): string {
  return p.replace(/_/g, " ");
}

/** Observed AI connection state, from health. Never claims more than was observed. */
export function aiConnection(h: HealthResponse["llm"] | undefined): { text: string; short: string; tone: "ok" | "warn" | "off" } {
  if (!h) return { text: "AI status unknown", short: "AI ?", tone: "off" };
  if (!h.configured) return { text: "AI not configured · automatic checks only", short: "No AI", tone: "off" };
  switch (h.reachability) {
    case "reachable":
      return { text: "AI reachable", short: "AI ready", tone: "ok" };
    case "unreachable":
      return { text: "AI unreachable", short: "AI down", tone: "warn" };
    case "credentials_rejected":
      return { text: "AI credentials rejected", short: "AI key", tone: "warn" };
    default:
      return { text: "AI configured · not used yet", short: "AI ready", tone: "ok" };
  }
}

const ERROR_COPY: Record<string, string> = {
  ocr_unsupported: "This PDF has no text layer (it looks like a scanned image). OCR is not supported.",
  invalid_pdf: "This file could not be read as a PDF. It may be corrupted or password-protected.",
  pdf_timeout: "Reading this PDF took too long and was stopped.",
  unsupported_type: "Only .txt, .eml and .pdf files can be added.",
  type_mismatch: "The file type does not match its extension.",
  binary_content: "This file looks like binary data, not text.",
  input_too_large: "This is larger than the size limit.",
  empty_input: "There is nothing to add: the text or file is empty.",
  malformed_eml: "This does not look like an email message (no email headers were found).",
  invalid_json: "The request could not be understood.",
  invalid_request: "The request could not be understood.",
  no_input: "Choose a file to add.",
  network_error: "Could not reach the server. Check that the API is running.",
  server_unavailable: "The server is not responding. Check that the API is running.",
  already_processing: "This message is already queued or being analyzed.",
  already_complete: "This message has already been analyzed.",
  max_runs_reached: "This message has reached the automatic retry limit.",
  queue_full: "The analysis queue is full. Try again in a moment.",
  not_found: "That message no longer exists.",
};

/** A friendly message for an API error code, falling back to the server's own message. */
export function errorMessage(code: string, serverMessage: string): string {
  return ERROR_COPY[code] ?? serverMessage;
}
