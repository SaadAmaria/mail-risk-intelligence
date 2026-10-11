import type { EvidenceRef } from "@mri/shared";
import type { SourceSegment } from "../agents/source";

const MAX_EVIDENCE_CHARS = 300;

/**
 * A located quote: the whole line around [start,end) in the given segment, clipped to 300
 * characters, with offsets relative to the segment's text (same convention as Agent A snippets).
 */
export function evidenceAround(emailId: string, seg: SourceSegment, start: number, end: number): EvidenceRef {
  let lineStart = seg.text.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = seg.text.indexOf("\n", end);
  if (lineEnd === -1) lineEnd = seg.text.length;
  if (lineEnd - lineStart > MAX_EVIDENCE_CHARS) {
    lineStart = Math.max(lineStart, start - 120);
    lineEnd = Math.min(lineEnd, Math.max(end + 120, lineStart + 1));
    if (lineEnd - lineStart > MAX_EVIDENCE_CHARS) lineEnd = lineStart + MAX_EVIDENCE_CHARS;
  }
  while (lineStart < lineEnd && /\s/.test(seg.text[lineStart]!)) lineStart++;
  while (lineEnd > lineStart && /\s/.test(seg.text[lineEnd - 1]!)) lineEnd--;
  return {
    email_id: emailId,
    where: seg.where,
    ...(seg.filename ? { filename: seg.filename } : {}),
    start: lineStart,
    end: lineEnd,
    text: seg.text.slice(lineStart, lineEnd),
  };
}

/** First match of each regex across the segments, as located evidence. */
export interface PatternMatch {
  pattern: RegExp;
  evidence: EvidenceRef;
  matched: string;
  /** The segment the match is in and the match's offset within that segment's text. */
  segment: SourceSegment;
  index: number;
}

export function firstMatches(emailId: string, segments: SourceSegment[], patterns: RegExp[]): PatternMatch[] {
  const out: PatternMatch[] = [];
  for (const pattern of patterns) {
    for (const seg of segments) {
      const m = new RegExp(pattern.source, pattern.flags.replace("g", "")).exec(seg.text);
      if (m) {
        out.push({
          pattern,
          evidence: evidenceAround(emailId, seg, m.index, m.index + m[0].length),
          matched: m[0],
          segment: seg,
          index: m.index,
        });
        break;
      }
    }
  }
  return out;
}

// Cues that the text is REPORTING or QUOTING someone else's words rather than saying them.
const REPORTING_CUES = [
  /\b(?:it|they|he|she|the (?:sender|email|e-?mail|message|caller|note|letter|voicemail)) (?:said|says|wrote|writes|stated|states|read|reads)\b/i,
  /\b(?:quote[sd]?|quoting|verbatim|excerpt|forwarded|forwarding|reportedly)\b/i,
  /\b(?:threatening|abusive|harassing|hostile) (?:e-?mail|message|voicemail|call|letter|note|language)\b/i,
  /\bincident report\b/i,
];

/**
 * Is the text at `index` inside quotation marks, a quoted-reply line (`>`), or introduced by a
 * reporting cue ("It said ...", "quoting ...")? Used to tell someone reporting a threat from
 * someone making one. A conservative, local check: it looks at the same line and the 140
 * characters before the match only.
 */
export function isQuotedOrReported(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const before = text.slice(lineStart, index);
  if (/^\s*>/.test(text.slice(lineStart, lineStart + 8))) return true;

  // Inside double quotes: an odd number of opening quote characters earlier on the line.
  const quotes = (before.match(/["“”«»]/g) ?? []).length;
  if (quotes % 2 === 1) return true;

  const window = text.slice(Math.max(0, index - 140), index);
  return REPORTING_CUES.some((c) => c.test(window));
}
