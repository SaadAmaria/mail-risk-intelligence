import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LLM_SETUP_GUIDE_HEADING, LLM_SETUP_GUIDE_URL } from "./docs";

// The repository root (web/ is the vitest working directory).
const ROOT = path.resolve(process.cwd(), "..");
const README = readFileSync(path.join(ROOT, "README.md"), "utf8");

/** GitHub's heading anchor: lowercase, drop punctuation, spaces to hyphens. */
const slug = (h: string) =>
  h.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-");
const headings = [...README.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((m) => m[1]!);
const anchors = new Set(headings.map(slug));

describe("the LLM setup guide link", () => {
  it("points at an anchor that exists in README.md, on the project repository", () => {
    const url = new URL(LLM_SETUP_GUIDE_URL!);
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("github.com");
    expect(url.pathname).toBe("/SaadAmaria/mail-risk-intelligence/blob/main/README.md");
    expect(anchors.has(url.hash.slice(1))).toBe(true);
    expect(url.hash).toBe("#live-llm-setup");
    expect(slug(LLM_SETUP_GUIDE_HEADING)).toBe("live-llm-setup");
    expect(headings).toContain(LLM_SETUP_GUIDE_HEADING);
  });
  it("is not a localhost or filesystem URL", () => {
    expect(LLM_SETUP_GUIDE_URL).not.toMatch(/localhost|127\.0\.0\.1|file:|[A-Z]:[\\]/);
  });
});

describe("README.md quality", () => {
  it("every in-page anchor link resolves to a heading", () => {
    const links = [...README.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThan(10);
    for (const l of links) expect(anchors.has(l), `#${l}`).toBe(true);
  });
  it("every relative file or image link exists", () => {
    const links = [...README.matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+)/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThan(5);
    for (const l of links) expect(existsSync(path.join(ROOT, l)), l).toBe(true);
  });
  it("makes no claim it cannot support", () => {
    expect(README).not.toMatch(/ollama[^\n]*(supported|works|tested and)/i);
    expect(README).not.toMatch(/all (10|ten) (emails|messages)[^\n]*(live|analy[sz]ed by ai)/i);
    expect(README).not.toMatch(/production[- ]ready|\bsecure by design\b|\b\d{2,3}% accura/i);
    expect(README).not.toMatch(/gsk_[A-Za-z0-9]{10,}|LLM_API_KEY=\S*[A-Za-z0-9]{20,}/);
    expect(README).not.toMatch(/TODO|TBD|FIXME|example\.invalid/);
  });
  it("states the distinctions the reviewer needs", () => {
    for (const phrase of ["Recorded AI Replay", "Automatic checks only", "Not assessed", "own API key", "not production-secure", "No authentication"]) {
      expect(README, phrase).toContain(phrase);
    }
  });
});
