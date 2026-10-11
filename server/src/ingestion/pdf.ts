import { getDocumentProxy } from "unpdf";
import type { IngestLimits } from "./limits";

export type PdfStatus = "ok" | "ocr_unsupported" | "invalid_pdf" | "timeout";

export interface PdfResult {
  status: PdfStatus;
  text: string;
  truncated: boolean;
  totalPages: number;
  message: string | null;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/** Spec allows the header within the first 1024 bytes. */
export function hasPdfSignature(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length - PDF_MAGIC.length, 1024);
  for (let i = 0; i <= end; i++) {
    if (PDF_MAGIC.every((b, j) => bytes[i + j] === b)) return true;
  }
  return false;
}

class PdfTimeout extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PdfTimeout("pdf timeout")), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Extract the text layer of a PDF. Bounded by page count, character count, and a wall-clock
 * budget. Never fetches external resources. Distinguishes:
 *   invalid_pdf     — bad signature, corrupt, or password-protected;
 *   ocr_unsupported — a valid PDF with no extractable text (e.g. scanned images).
 *
 * Limitation: pdf.js runs in-process, so the timeout bounds async stalls, not a
 * synchronous CPU-bound loop inside the parser.
 */
export async function extractPdfText(bytes: Uint8Array, limits: IngestLimits): Promise<PdfResult> {
  const invalid = (message: string): PdfResult => ({
    status: "invalid_pdf",
    text: "",
    truncated: false,
    totalPages: 0,
    message,
  });

  if (!hasPdfSignature(bytes)) return invalid("Missing %PDF- signature; not a PDF file.");

  try {
    return await withTimeout(readPdf(bytes, limits), limits.pdfTimeoutMs);
  } catch (err) {
    if (err instanceof PdfTimeout) {
      return { status: "timeout", text: "", truncated: false, totalPages: 0, message: "PDF parsing timed out." };
    }
    const name = err instanceof Error ? err.name : "";
    if (name === "PasswordException") return invalid("The PDF is password-protected.");
    return invalid("The PDF is corrupted or could not be parsed.");
  }
}

async function readPdf(bytes: Uint8Array, limits: IngestLimits): Promise<PdfResult> {
  const doc = await getDocumentProxy(Uint8Array.from(bytes), {
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  try {
    const totalPages = doc.numPages;
    const pagesToRead = Math.min(totalPages, limits.maxPdfPages);
    const parts: string[] = [];
    let chars = 0;
    let truncated = totalPages > pagesToRead;

    for (let i = 1; i <= pagesToRead; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let pageText = "";
      for (const item of content.items) {
        if ("str" in item) pageText += item.str + (item.hasEOL ? "\n" : " ");
      }
      parts.push(pageText.trim());
      chars += pageText.length;
      if (chars > limits.maxTextChars) {
        truncated = true;
        break;
      }
    }

    let text = parts.join("\n\n").trim();
    if (text.length > limits.maxTextChars) {
      text = text.slice(0, limits.maxTextChars);
      truncated = true;
    }
    if (text.length === 0) {
      return {
        status: "ocr_unsupported",
        text: "",
        truncated: false,
        totalPages,
        message: "The PDF has no extractable text layer (OCR is not supported).",
      };
    }
    return {
      status: "ok",
      text,
      truncated,
      totalPages,
      message: truncated ? `Only part of the PDF was read (${pagesToRead} of ${totalPages} pages, text capped).` : null,
    };
  } finally {
    await doc.loadingTask.destroy().catch(() => undefined);
  }
}
