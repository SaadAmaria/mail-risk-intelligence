import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailDetailResponse, GraphResponse, RelationshipSupport } from "@mri/shared";
import { App } from "../App";
import { HEALTH_AI, detail, listItem, listResponse, processing } from "../test/fixtures";
import { gEdge, gGraph, gNode } from "../test/graphFixtures";

/*
 * Every primary place a relationship is shown must tell the same story about the server's advisory
 * review: the email-detail row, the graph list, the canvas label, the graph inspector and the
 * evidence callout reached from the graph. The support objects below are exactly what the server's
 * heuristic returned for these quotes (captured from `assessRelationshipSupport`).
 */
const CASES: { name: string; quote: string; support: RelationshipSupport }[] = [
  {
    name: "negated threat",
    quote: "Northgate Suppliers is not a threat to Arcline",
    support: { participants: "both", order: "source_first", wording: "negated", review: true, notes: ["The wording that suggests this claim appears next to a negation."] },
  },
  {
    name: "reversed accusation",
    quote: "Arcline will regret this, says Northgate Suppliers",
    support: { participants: "both", order: "target_first", wording: "present", review: true, notes: ["The quote mentions the second entity first, so the direction may be reversed."] },
  },
  {
    name: "unrelated quote",
    quote: "Subject: Invoice #NS-4471 - please note updated payment details",
    support: { participants: "header", order: "unknown", wording: "none_found", review: true, notes: ["No wording in the quote clearly indicates this kind of claim."] },
  },
  {
    name: "valid uncommon threat",
    quote: "Arcline had better think carefully about what happens next, Northgate Suppliers",
    support: {
      participants: "both",
      order: "target_first",
      wording: "none_found",
      review: true,
      notes: ["No wording in the quote clearly indicates this kind of claim.", "The quote mentions the second entity first, so the direction may be reversed."],
    },
  },
  {
    name: "ordinary, not flagged",
    quote: "Northgate Suppliers: you will regret this, Arcline",
    support: { participants: "both", order: "source_first", wording: "present", review: false, notes: [] },
  },
];

let graph: GraphResponse;
let details: Record<string, EmailDetailResponse>;

function install() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
      if (url.startsWith("/api/health")) return json(HEALTH_AI);
      if (url.startsWith("/api/graph")) return json(graph);
      if (url.startsWith("/api/emails?") || url === "/api/emails") return json(listResponse([listItem("E004", "medium")]));
      const m = /^\/api\/emails\/([^/?]+)/.exec(url);
      const d = m ? details[decodeURIComponent(m[1]!)] : undefined;
      return d ? json(d) : json({ error: { code: "not_found", message: "no" } }, 404);
    }),
  );
}

/** One message holding one AI relationship, as the API returns it (support optional: legacy shape). */
function setup(quote: string, support: RelationshipSupport | undefined, review: boolean) {
  const body = `Hello,\n${quote}\nRegards`;
  const start = body.indexOf(quote);
  const d = detail({ email: { ...detail().email, id: "E004", body } });
  d.processing = { ...processing({ status: "complete", provenance: "recorded", can_reprocess: false, run_count: 1 }), warnings: [], runs: [] };
  d.extraction = {
    schema_version: 1,
    sender: null,
    recipients: [],
    date: null,
    subject: null,
    missing_headers: [],
    summary: "s",
    facts: { amounts: [], dates: [], references: [], attachments: [] },
    evidence_snippets: [{ id: "s1", text: quote, location: { where: "body", start, end: start + quote.length }, origin: "llm" }],
    notes: [],
  };
  const entity = (key: string, name: string) => ({ key, type: "organization" as const, display_name: name, origin: "ai" as const, key_basis: "organization_name", mentions: [], also_in: [] });
  d.entities = [entity("o:n", "Northgate Suppliers"), entity("o:a", "Arcline")];
  d.relationships = [
    { key: "o:n|threatens|o:a", predicate: "threatens", source: "o:n", target: "o:a", evidence: [{ snippet_id: "s1", quote, ...(support ? { support } : {}) }], review, also_in: [] },
  ];
  details = { E004: d };
  graph = gGraph(
    [gNode("o:n", { label: "Northgate Suppliers" }), gNode("o:a", { label: "Arcline" })],
    [gEdge("o:n", "o:a", { id: "t1", predicate: "threatens", review, evidence: [{ email_id: "E004", snippet_id: "s1", quote, ...(support ? { support } : {}) }] })],
  );
}

const go = (u: string) => window.history.replaceState(null, "", u);
const relRow = () => screen.getByText("Relationships the AI cited").nextElementSibling!.nextElementSibling!.querySelector("li")!;

beforeEach(() => {
  install();
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: /min-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} }));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.each(CASES)("relationship review status is consistent everywhere: $name", ({ quote, support }) => {
  const flagged = support.review;
  beforeEach(() => setup(quote, support, flagged));

  it("email detail relationship row", async () => {
    go("/emails/E004");
    render(<App />);
    await screen.findByText("Relationships the AI cited");
    const row = relRow();
    expect(row.textContent).toContain(quote); // kept and shown as the model's interpretation
    expect(row.getAttribute("data-review")).toBe(flagged ? "true" : null);
    const note = row.querySelector('[data-review="true"]');
    if (flagged) {
      expect(note!.textContent).toMatch(/^Check this quote\./);
      for (const n of support.notes) expect(note!.textContent).toContain(n);
      expect(note!.textContent).toMatch(/heuristic, not a finding/);
    } else {
      expect(note).toBeNull();
      expect(row.textContent).not.toMatch(/Check this quote/);
    }
  });

  it("graph list row, with the qualification in the text a screen reader reads", async () => {
    go("/graph?view=list");
    render(<App />);
    const table = await screen.findByRole("table", { name: /Relationships \(1\)/ });
    const cell = within(table).getByRole("button", { name: "threatens" }).closest("td")!;
    if (flagged) {
      expect(within(cell).getByText("Check quote")).toBeTruthy();
      expect(cell.textContent).toMatch(/Check quote: an automatic check suggests the quote may not support this relationship type/);
    } else {
      expect(cell.textContent).toBe("threatens");
    }
  });

  it("canvas relationship label (accessible name) and graph inspector", async () => {
    go("/graph?edge=t1");
    render(<App />);
    await screen.findByText(/2 entities · 1 relationship/);
    const pill = document.querySelector('[data-edge-id="t1"]')!;
    const label = pill.getAttribute("aria-label")!;
    expect(label).toMatch(/^Relationship: Northgate Suppliers threatens Arcline/);
    expect(pill.textContent).toBe("threatens"); // visible label unchanged
    if (flagged) {
      expect(label).toMatch(/Check quote: an automatic check suggests/);
      expect(pill.getAttribute("data-review")).toBe("true");
    } else {
      expect(label).toBe("Relationship: Northgate Suppliers threatens Arcline");
      expect(pill.getAttribute("data-review")).toBeNull();
    }
    const panel = screen.getByRole("complementary", { name: "Entity details" });
    expect(!!panel.querySelector('[data-review="true"]')).toBe(flagged); // existing inspector behaviour
    expect(document.querySelectorAll("path[marker-end]").length).toBe(1); // still drawn either way
  });

  it("graph navigation to the email evidence carries the same status and neutral wording", async () => {
    const user = userEvent.setup();
    go("/graph?edge=t1");
    render(<App />);
    await screen.findByText(/2 entities · 1 relationship/);
    const panel = screen.getByRole("complementary", { name: "Entity details" });
    await user.click(within(panel).getByRole("link", { name: "Show passage in message" }));
    const box = await screen.findByTestId("linked-evidence");
    expect(box.textContent).toMatch(/This passage was cited for this AI-inferred relationship:/);
    expect(box.textContent).toMatch(/Northgate Suppliers threatens Arcline/);
    expect(box.textContent).toMatch(/found word for word in this message; what the relationship means is the AI's reading/);
    expect(box.textContent).toMatch(/highlighted in the original message below/);
    expect(document.body.textContent).not.toMatch(/supports a relationship/);
    const note = box.querySelector('[data-review="true"]');
    if (flagged) for (const n of support.notes) expect(note!.textContent).toContain(n);
    else expect(note).toBeNull();
  });
});

describe("a relationship carrying only the relationship-level flag (legacy or partial payload)", () => {
  beforeEach(() => setup("Subject: Invoice #NS-4471", undefined, true));

  it("is flagged in the detail row with the generic advisory text", async () => {
    go("/emails/E004");
    render(<App />);
    await screen.findByText("Relationships the AI cited");
    expect(relRow().querySelector('[data-review="true"]')!.textContent).toMatch(/Check this quote\. It may not support the relationship type\./);
  });

  it("is flagged in the graph list, on the canvas label and in the evidence callout", async () => {
    go("/graph?view=list");
    render(<App />);
    const table = await screen.findByRole("table", { name: /Relationships \(1\)/ });
    expect(within(table).getByText("Check quote")).toBeTruthy();
    cleanup();

    go("/graph?edge=t1");
    render(<App />);
    await screen.findByText(/2 entities · 1 relationship/);
    expect(document.querySelector('[data-edge-id="t1"]')!.getAttribute("aria-label")).toMatch(/Check quote/);
    cleanup();

    go("/emails/E004?ev=s1&evq=" + encodeURIComponent("Subject: Invoice #NS-4471"));
    render(<App />);
    const box = await screen.findByTestId("linked-evidence");
    expect(box.querySelector('[data-review="true"]')!.textContent).toMatch(/It may not support the relationship type/);
  });
});

describe("stored address lists that could not be read in full", () => {
  const withIssues = (over: Partial<EmailDetailResponse["email"]>) => {
    const d = detail({ email: { ...detail().email, id: "E004", ...over } });
    details = { E004: d };
    graph = gGraph([], []);
  };

  it("a healthy message shows no data-quality warning", async () => {
    withIssues({});
    go("/emails/E004");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Invoice" });
    expect(screen.queryByTestId("read-issues")).toBeNull();
    expect(screen.getByText("ap@example.com")).toBeTruthy();
  });

  it("partially corrupt: healthy recipients stay, the line is marked incomplete, and the loss is explained", async () => {
    withIssues({ read_issues: [{ field: "to", unreadable: false, dropped: 2 }] });
    go("/emails/E004");
    render(<App />);
    const box = await screen.findByTestId("read-issues");
    expect(box.textContent).toMatch(/2 stored recipients could not be read and are not shown\. The To line is incomplete\./);
    expect(box.textContent).toMatch(/Nothing was filled in for them, and the stored record was not changed\./);
    const to = screen.getByText("To").nextElementSibling!;
    expect(to.textContent).toBe("ap@example.com (incomplete: some could not be read)");
  });

  it("wholly corrupt: no recipient is invented and the list is not called empty", async () => {
    withIssues({ to: [], cc: [], read_issues: [{ field: "to", unreadable: true, dropped: 0 }, { field: "cc", unreadable: false, dropped: 1 }] });
    go("/emails/E004");
    render(<App />);
    const box = await screen.findByTestId("read-issues");
    expect(box.textContent).toMatch(/The stored recipient list could not be read, so no recipients are shown\./);
    expect(box.textContent).toMatch(/1 stored Cc address could not be read and is not shown\./);
    expect(screen.getByText("To").nextElementSibling!.textContent).toBe("Could not be read");
    expect(screen.getByText("Cc").nextElementSibling!.textContent).toBe("Could not be read");
    expect(screen.queryByText("No recipients listed")).toBeNull();
  });
});
