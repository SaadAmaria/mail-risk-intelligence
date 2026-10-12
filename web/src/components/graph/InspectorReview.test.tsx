import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphEdge, GraphResponse, RelationshipSupport } from "@mri/shared";
import { App } from "../../App";
import { HEALTH_AI, listItem, listResponse } from "../../test/fixtures";
import { gEdge, gGraph, gNode } from "../../test/graphFixtures";

/*
 * The graph inspectors and the featured relationship must apply the server's review state the same
 * way: the citation's own advisory where present, the relationship-level flag as a fallback (shown
 * once, not per citation), and nothing when neither level flags it.
 */
const FLAG: RelationshipSupport = { participants: "none", order: "unknown", wording: "none_found", review: true, notes: ["The quote does not name either entity."] };
const CLEAN: RelationshipSupport = { participants: "both", order: "source_first", wording: "present", review: false, notes: [] };
type Ev = GraphEdge["evidence"][number];
const ev = (snippet: string, quote: string, support?: RelationshipSupport): Ev => ({ email_id: "E004", snippet_id: snippet, quote, ...(support ? { support } : {}) });

let graph: GraphResponse;
function install() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
      if (url.startsWith("/api/health")) return json(HEALTH_AI);
      if (url.startsWith("/api/graph")) return json(graph);
      if (url.startsWith("/api/emails?") || url === "/api/emails") return json(listResponse([listItem("E004", "medium")]));
      return json({ error: { code: "not_found", message: "no" } }, 404);
    }),
  );
}
const setGraph = (evidence: Ev[], review: boolean | undefined) => {
  graph = gGraph(
    [gNode("o:n", { label: "Northgate" }), gNode("o:a", { label: "Arcline" })],
    [gEdge("o:n", "o:a", { id: "t1", predicate: "threatens", evidence, ...(review === undefined ? {} : { review }) })],
  );
};
const go = (u: string) => window.history.replaceState(null, "", u);
const panel = () => screen.getByRole("complementary", { name: "Entity details" });
const notes = (root: Element) => [...root.querySelectorAll('[data-review="true"]')].filter((n) => n.tagName === "P");

beforeEach(() => {
  install();
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: /min-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} }));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** [name, evidence, edge-level flag, expected notes: the quote each note sits under ("" = relationship level) and its text] */
const COMBOS: [string, Ev[], boolean | undefined, { under: string; text: RegExp }[]][] = [
  ["evidence-level advisory", [ev("s1", "Subject: Invoice #NS-4471", FLAG)], true, [{ under: "Subject: Invoice #NS-4471", text: /does not name either entity/ }]],
  ["edge-only legacy flag (no per-quote metadata)", [ev("s1", "Subject: Invoice #NS-4471")], true, [{ under: "", text: /It may not support the relationship type/ }]],
  [
    "edge-only legacy flag with two citations: one note for the relationship, not one per quote",
    [ev("s1", "first quote"), ev("s2", "second quote")],
    true,
    [{ under: "", text: /It may not support the relationship type/ }],
  ],
  [
    "mixed: only the flagged citation carries the note",
    [ev("s1", "clean quote", CLEAN), ev("s2", "flagged quote", FLAG)],
    true,
    [{ under: "flagged quote", text: /does not name either entity/ }],
  ],
  ["clean with per-quote metadata", [ev("s1", "Northgate threatens Arcline", CLEAN)], false, []],
  ["clean legacy (no metadata, no flag)", [ev("s1", "Northgate threatens Arcline")], undefined, []],
];

/** Where each note sits: under a citation (its quote) or at relationship level (""). */
const placement = (root: Element) =>
  notes(root).map((n) => ({ under: n.closest("li")?.querySelector(":scope > blockquote")?.textContent ?? "", text: n.textContent ?? "" }));

describe.each(COMBOS)("effective review state: %s", (_name, evidence, review, expected) => {
  beforeEach(() => setGraph(evidence, review));

  it("edge inspector", async () => {
    go("/graph?edge=t1");
    render(<App />);
    await screen.findByText(/2 entities · 1 relationship/);
    const section = within(panel()).getByRole("heading", { name: /^Evidence/ }).closest("section")!;
    const got = placement(section);
    expect(got.map((g) => g.under)).toEqual(expected.map((e) => e.under));
    got.forEach((g, i) => expect(g.text).toMatch(expected[i]!.text));
    // provenance and source links are untouched
    expect(within(section).getAllByRole("link", { name: "Show passage in message" })).toHaveLength(evidence.length);
    expect(within(section).getAllByText(/Quote found in message E004/)).toHaveLength(evidence.length);
  });

  it("node connection inspector", async () => {
    go("/graph?node=o:n");
    render(<App />);
    await screen.findByText(/2 entities · 1 relationship/);
    const section = within(panel()).getByRole("heading", { name: /^Relationships \(1\)/ }).closest("section")!;
    const got = placement(section);
    expect(got.map((g) => g.under)).toEqual(expected.map((e) => e.under));
    got.forEach((g, i) => expect(g.text).toMatch(expected[i]!.text));
    expect(within(section).getAllByRole("link", { name: "Show passage in message" })).toHaveLength(evidence.length);
  });

  it("featured relationship (start panel)", async () => {
    go("/graph");
    render(<App />);
    await screen.findByText(/2 entities · 1 relationship/);
    const featured = within(panel()).getByRole("button", { name: "Open this relationship" }).parentElement!.parentElement!;
    const got = notes(featured);
    expect(got).toHaveLength(expected.length ? 1 : 0); // one note at most: no duplicate warning
    if (expected.length) {
      expect(got[0]!.textContent).toMatch(expected[0]!.text);
      // the quote shown is the citation the note is about, when one is flagged
      if (expected[0]!.under) expect(featured.querySelector("blockquote")!.textContent).toBe(expected[0]!.under);
      // the evidence link still points at the quote that is shown
      const href = within(featured).getByRole("link", { name: "Show passage in message" }).getAttribute("href")!;
      expect(new URLSearchParams(href.split("?")[1]).get("evq")).toBe(featured.querySelector("blockquote")!.textContent);
    } else {
      expect(featured.textContent).not.toMatch(/Check this quote/);
    }
  });
});

describe("the advisory is real, readable text for assistive technology", () => {
  it("is not hidden from the accessibility tree and sits inside the labelled evidence section", async () => {
    setGraph([ev("s1", "Subject: Invoice #NS-4471")], true);
    go("/graph?edge=t1");
    render(<App />);
    await screen.findByText(/2 entities · 1 relationship/);
    const note = within(panel()).getByText(/^Check this quote\./).closest("p")!;
    expect(note.closest('[aria-hidden="true"]')).toBeNull();
    expect(note.closest("section")!.getAttribute("aria-labelledby")).toBe("edge-ev");
    expect(note.textContent).toMatch(/Check this quote\. It may not support the relationship type\. This is an automatic heuristic, not a finding\./);
  });
});
