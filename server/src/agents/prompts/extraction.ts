import type { ChatMessage } from "../../llm/types";
import type { SourceSegment } from "../source";
import { delimit, SECURITY_RULES } from "./common";

export const EXTRACTION_PROMPT_VERSION = "extract-v1";

const SYSTEM = `You are the Extraction Agent in an email risk-review pipeline. You read ONE email and return structured facts and verbatim evidence as a single JSON object.

${SECURITY_RULES}

Required JSON shape (all keys present; use [] when nothing applies):
{
  "summary": "neutral summary, max 400 characters: what the email says and what it asks for",
  "facts": {
    "amounts": [{"value": 184500, "currency": "USD", "context": "short label"}],
    "dates": [{"value": "date text exactly as written", "context": "short label"}],
    "references": [{"kind": "invoice|account|routing|url|phone|other", "value": "exactly as written", "context": "short label"}],
    "attachments": [{"filename": "name as listed", "summary": "one sentence"}]
  },
  "evidence_snippets": [{"text": "VERBATIM quote, max 300 characters", "where": "header|body|attachment", "filename": "only when where is attachment"}],
  "notes": ["short caveats, optional"]
}

Rules:
- Only report amounts, dates and references that literally appear in the email or attachments. Copy values exactly.
- evidence_snippets must be exact quotes (same words, same order) copied from the text. Never paraphrase or merge separate sentences. At most 12 snippets.
- Prefer snippets that show: requests for money, payments or changed bank details; requests for credentials or links; secrecy or urgency; threats; confidential or inside information; who is asking whom for what.
- Do not judge risk here. Do not add facts that are not in the text.`;

export interface PromptSegmentLimits {
  body: number;
  attachment: number;
  maxAttachments: number;
}

export const DEFAULT_SEGMENT_LIMITS: PromptSegmentLimits = { body: 6000, attachment: 3000, maxAttachments: 4 };

export interface ExtractionPrompt {
  messages: ChatMessage[];
  /** True when any segment was shortened for the model (verification still uses the full text). */
  truncated: boolean;
}

export function buildExtractionPrompt(
  segments: SourceSegment[],
  attachmentStatuses: { filename: string; status: string }[],
  limits: PromptSegmentLimits = DEFAULT_SEGMENT_LIMITS,
): ExtractionPrompt {
  let truncated = false;
  const parts: string[] = [];
  let attachmentsShown = 0;

  for (const seg of segments) {
    if (seg.where === "header") {
      parts.push(`[HEADER]\n${seg.text}`);
    } else if (seg.where === "body") {
      const clipped = seg.text.length > limits.body;
      truncated ||= clipped;
      parts.push(`[BODY]\n${clipped ? seg.text.slice(0, limits.body) : seg.text}${clipped ? "\n[...truncated]" : ""}`);
    } else {
      if (attachmentsShown >= limits.maxAttachments) {
        truncated = true;
        continue;
      }
      attachmentsShown++;
      const clipped = seg.text.length > limits.attachment;
      truncated ||= clipped;
      parts.push(
        `[ATTACHMENT filename="${seg.filename ?? "unnamed"}"]\n${clipped ? seg.text.slice(0, limits.attachment) : seg.text}${clipped ? "\n[...truncated]" : ""}`,
      );
    }
  }

  const unreadable = attachmentStatuses.filter((a) => a.status !== "ok");
  if (unreadable.length > 0) {
    parts.push(
      "[UNREADABLE ATTACHMENTS - content not available]\n" +
        unreadable.map((a) => `- ${a.filename}: ${a.status}`).join("\n"),
    );
  }

  const d = delimit("EMAIL", parts.join("\n\n"));
  return {
    truncated,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Extract the facts from this email.\n${d.open}\n${d.text}\n${d.close}\nReturn the JSON object now.`,
      },
    ],
  };
}
