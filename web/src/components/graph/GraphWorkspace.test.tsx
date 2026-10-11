import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CrossEmailFinding, EmailDetailResponse, EmailListResponse, GraphResponse } from "@mri/shared";
import { App } from "../../App";
import { HEALTH_AI, detail, listItem, listResponse, processing } from "../../test/fixtures";
import { gEdge, gGraph, gNode } from "../../test/graphFixtures";

const FINDING: CrossEmailFinding = {
  id: "f1",
  rule_id: "payment_account_changed",
  email_id: "E004",
  related_email_ids: ["E009"],
  identity: "consistent",
  vendor: { name: "Northgate Suppliers Inc.", domain: "northgate-suppliers.com" },
  summary: "Payment account ending 9902 differs from ending 6621 on earlier invoice(s) from the same vendor.",
  values: { prior_accounts: ["6621"], new_account: "9902", routing_unchanged: true, claims_bank_change: true },
  evidence: [],
};

let graph: GraphResponse;
let list: EmailListResponse;
let details: Record<string, EmailDetailResponse>;
let calls: { method: string; url: string }[];

function install() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ method: init?.method ?? "GET", url });
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
      if (url.startsWith("/api/health")) return json(HEALTH_AI);
      if (url.startsWith("/api/graph")) return json(graph);
      if (url.startsWith("/api/emails?") || url === "/api/emails") return json(list);
      const m = /^\/api\/emails\/([^/?]+)/.exec(url);
      if (m) {
        const d = details[decodeURIComponent(m[1]!)];
        return d ? json(d) : json({ error: { code: "not_found", message: "no" } }, 404);
      }
      return json({ error: { code: "not_found", message: "?" } }, 404);
    }),
  );
}
const viewport = (wide: boolean) =>
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: /min-width/.test(q) ? wide : false, media: q, addEventListener() {}, removeEventListener() {} }));
const go = (u: string) => window.history.replaceState(null, "", u);
const ids = () => [...document.querySelectorAll("[data-node-id]")].map((n) => n.getAttribute("data-node-id")).sort();
const insp = () => screen.getByRole("complementary", { name: "Entity details" });

beforeEach(() => {
  graph = gGraph(
    [
      gNode("p:a", { type: "person", label: "Ada", email_ids: ["E001"], max_risk: "high", key_basis: "email_scoped" }),
      gNode("o:b", { label: "Bravo Corp", email_ids: ["E001", "E004"], max_risk: "high" }),
      gNode("o:c", { label: "Cedar Ltd", email_ids: ["E004"], max_risk: "medium" }),
      gNode("a:d", { type: "account", label: "account ending 9902", email_ids: ["E004"], key_basis: "email_scoped" }),
      gNode("p:x", { type: "person", label: "x@iso.example", origin: "rules", key_basis: "email_address", email_ids: ["E007"], max_risk: "none" }),
      gNode("p:y", { type: "person", label: "y@iso.example", origin: "rules", key_basis: "email_address", email_ids: ["E009"], max_risk: "unassessed" }),
    ],
    [
      gEdge("p:a", "o:b", {
        id: "r2",
        predicate: "sent_email_to",
        email_ids: ["E001"],
        evidence: [{ email_id: "E001", snippet_id: "s1", quote: "I need you to wire the funds today" }],
      }),
      gEdge("o:c", "a:d", {
        id: "r1",
        predicate: "requests_transfer_to",
        email_ids: ["E004"],
        evidence: [{ email_id: "E004", snippet_id: "s3", quote: "New payment account ending 9902" }],
      }),
    ],
  );
  list = listResponse([
    listItem("E001", "high", { subject: "URGENT wire" }),
    listItem("E004", "medium", { subject: "Invoice #NS-4471", risk: { ...listItem("E004").risk, final_level: "medium", finding_count: 1 } }),
    listItem("E007", "none"),
    listItem("E009", "unassessed", {
      processing: processing({ status: "degraded", analysis_mode: "degraded", provenance: "rules", automatic_checks_only: true }),
    }),
  ]);
  const withFinding = detail();
  withFinding.email.id = "E004";
  withFinding.risk = { ...withFinding.risk, findings: [FINDING] };
  details = { E004: withFinding };
  calls = [];
  install();
  viewport(true);
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  go("/graph");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("investigation workspace", () => {
  it("opens on a real starting point: the highest-risk relationship with its cited passage", async () => {
    render(<App />);
    await screen.findByText(/6 entities · 2 relationships/);
    const panel = insp();
    expect(within(panel).getByRole("heading", { level: 2, name: "Start with a relationship" })).toBeTruthy();
    expect(within(panel).getByText(/I need you to wire the funds today/)).toBeTruthy(); // E001 (high) before E004 (medium)
    expect(within(panel).getByText(/1 more relationship is listed in the navigator/)).toBeTruthy();
  });

  it("places only related entities on the canvas and keeps the rest in a labelled collection", async () => {
    render(<App />);
    await screen.findByText(/6 entities · 2 relationships/);
    expect(ids()).toEqual(["a:d", "o:b", "o:c", "p:a", "p:x", "p:y"]);
    const placed = [...document.querySelectorAll("[data-node-id][data-pos]")].map((n) => n.getAttribute("data-node-id")).sort();
    expect(placed).toEqual(["a:d", "o:b", "o:c", "p:a"]);
    const rail = document.getElementById("rail-h")!.closest("section") as HTMLElement;
    expect(within(rail).getByRole("heading", { name: "Not connected (2)" })).toBeTruthy();
    expect(within(rail).getByText(/No relationship was extracted/)).toBeTruthy();
    expect(within(rail).getAllByRole("button").some((b) => /x@iso\.example/.test(b.getAttribute("aria-label") ?? ""))).toBe(true);
  });

  it("selecting a relationship shows its sentence, exact quote, source message and the open-email action", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 2 relationships/);
    await user.click(screen.getByRole("button", { name: /^Relationship: Cedar Ltd requests transfer to account ending 9902/ }));
    expect(window.location.search).toContain("edge=r1");
    const panel = insp();
    expect(within(panel).getByRole("heading", { level: 2 }).textContent).toBe("Cedar Ltd requests transfer to account ending 9902");
    expect(within(panel).getByText("New payment account ending 9902")).toBeTruthy();
    const evidence = within(panel).getByRole("link", { name: "Show passage in message" });
    expect(evidence.getAttribute("href")).toMatch(/^\/emails\/E004\?ev=s3&evq=/);
    expect(within(panel).getByRole("link", { name: /Open original email/ }).getAttribute("href")).toBe("/emails/E004");
    // the selected relationship is marked, and nothing moved
    expect(document.querySelector('[data-edge-id="r1"]')!.getAttribute("aria-pressed")).toBe("true");
  });

  it("a relationship link restores its selection, and the navigator row selects the same relationship", async () => {
    go("/graph?edge=r2");
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 2 relationships/);
    expect(within(insp()).getByRole("heading", { level: 2 }).textContent).toBe("Ada sent email to Bravo Corp");
    const nav = screen.getByRole("navigation", { name: "Investigation navigator" });
    await user.click(within(nav).getByRole("button", { name: /Cedar Ltd requests transfer to account ending 9902/ }));
    expect(window.location.search).toContain("edge=r1");
    expect(within(insp()).getByRole("heading", { level: 2 }).textContent).toMatch(/Cedar Ltd requests transfer/);
  });

  it("selecting an entity from the navigator selects it on the canvas and lists its messages", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 2 relationships/);
    const nav = screen.getByRole("navigation", { name: "Investigation navigator" });
    await user.click(within(nav).getByRole("button", { name: "Bravo Corp, Organization, AI-identified" }));
    expect(document.querySelector('[data-node-id="o:b"]')!.getAttribute("aria-pressed")).toBe("true");
    const panel = insp();
    expect(within(panel).getByText("Source messages (2)")).toBeTruthy();
    expect(within(panel).getByRole("link", { name: /URGENT wire/ }).getAttribute("href")).toBe("/emails/E001");
  });

  it("shows the real cross-email comparison as a finding, never as a relationship", async () => {
    render(<App />);
    await screen.findByText(/6 entities · 2 relationships/);
    const region = await screen.findByRole("region", { name: /Cross-email comparison/ });
    expect(within(region).getByText("6621")).toBeTruthy();
    expect(within(region).getByText("9902")).toBeTruthy();
    expect(within(region).getByText(/Not a graph relationship/)).toBeTruthy();
    expect(within(region).getByText(/not proof of fraud/i)).toBeTruthy();
    // no edge was added for it
    expect(document.querySelectorAll("path[marker-end]").length).toBe(2);
    expect(calls.filter((c) => c.method !== "GET")).toHaveLength(0);
  });

  it("links an entity to the findings of its own messages", async () => {
    go("/graph?node=" + encodeURIComponent("a:d"));
    render(<App />);
    await screen.findByText(/6 entities · 2 relationships/);
    const panel = insp();
    expect(await within(panel).findByText(/Cross-email findings in its messages \(1\)/)).toBeTruthy();
    expect(within(panel).getByRole("link", { name: /Open E004 to see the comparison/ }).getAttribute("href")).toBe("/emails/E004");
  });

  it("says what was analyzed, from the real list", async () => {
    render(<App />);
    await screen.findByText(/6 entities · 2 relationships/);
    const summary = screen.getByRole("group", { name: "What was analyzed" });
    expect(within(summary).getByText(/4 messages:/)).toBeTruthy();
    expect(within(summary).getByText(/1 automatic checks only/)).toBeTruthy();
  });
});

describe("narrow screens", () => {
  beforeEach(() => viewport(false));

  it("opens on the overview, and the tabs switch between overview, map and entities", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 2 relationships/);
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector("[data-node-id]")).toBeNull();
    expect(within(insp()).getByText(/Relationships to review \(2\)/)).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "Map" }));
    expect(window.location.search).toContain("tab=map");
    await waitFor(() => expect(ids().length).toBe(6));

    await user.click(screen.getByRole("tab", { name: "Entities" }));
    expect(screen.getByRole("table", { name: /Entities \(6\)/ })).toBeTruthy();
  });

  it("selecting an entity brings its details to the front, and Back returns to the map", async () => {
    go("/graph?tab=map");
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 2 relationships/);
    await user.click(screen.getByRole("button", { name: /^Organization Bravo Corp/ }));
    expect(Element.prototype.scrollTo).toHaveBeenCalled();
    expect(within(insp()).getByRole("heading", { level: 2, name: "Bravo Corp" })).toBeTruthy();
    expect(document.querySelector("[data-node-id]")).toBeNull();
    await user.click(within(screen.getByRole("navigation", { name: "Back to the knowledge graph" })).getByRole("link"));
    await waitFor(() => expect(ids().length).toBe(6));
  });

  it("opens a relationship from the overview as full-screen details", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 2 relationships/);
    await user.click(screen.getByRole("button", { name: /Ada sent email to Bravo Corp/ }));
    expect(window.location.search).toContain("edge=r2");
    expect(within(insp()).getByRole("heading", { level: 2 }).textContent).toBe("Ada sent email to Bravo Corp");
    expect(screen.getByRole("navigation", { name: "Back to the knowledge graph" })).toBeTruthy();
  });
});
