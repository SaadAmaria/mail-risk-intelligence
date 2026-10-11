import { IngestError } from "./errors";

/** Binary sniff window. Any NUL byte in it means this is not text. */
const SNIFF_BYTES = 8192;

/**
 * Decode bytes as text. Handles UTF-8 (with/without BOM) and UTF-16 BOMs; falls back to
 * windows-1252 when the bytes are not valid UTF-8. Throws `binary_content` for NUL bytes.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  const head = bytes.subarray(0, SNIFF_BYTES);
  if (head.includes(0)) {
    throw new IngestError("binary_content", "The file looks like binary data, not text.");
  }
  const start = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start));
  } catch {
    return new TextDecoder("windows-1252").decode(bytes.subarray(start));
  }
}

export function normalizeNewlines(s: string): string {
  return s.replace(/\r\n?/g, "\n");
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/**
 * Reduce HTML to plain text. Output is only ever treated as text; nothing is rendered,
 * fetched, or executed. Not a general HTML sanitizer.
 */
export function htmlToText(html: string): string {
  return normalizeNewlines(html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head)[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ent: string) => {
      if (ent.startsWith("#x") || ent.startsWith("#X")) {
        const cp = Number.parseInt(ent.slice(2), 16);
        return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
      }
      if (ent.startsWith("#")) {
        const cp = Number.parseInt(ent.slice(1), 10);
        return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
      }
      return NAMED_ENTITIES[ent.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Cut text to `max` characters; reports whether anything was dropped. */
export function clampText(text: string, max: number): { text: string; truncated: boolean } {
  return text.length > max ? { text: text.slice(0, max), truncated: true } : { text, truncated: false };
}

/** Display-only filename: basename, no control characters, bounded length. Never used as a path. */
export function sanitizeFilename(name: string | null | undefined, fallback = "unnamed"): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255);
  return cleaned || fallback;
}
