import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailDetailResponse, EmailListResponse, GraphResponse } from "@mri/shared";
import { App } from "../../App";
import { BODY, HEALTH_AI, assessedDetail, listItem, listResponse } from "../../test/fixtures";
import { gEdge, gGraph, gNode, sampleGraph } from "../../test/graphFixtures";

const QUOTE = "wire $13,900 to account 9902";

interface World {
  graph: GraphResponse;
  withAmounts: GraphResponse;
  amountsFail: boolean;
  list: EmailListResponse;
  details: Record<string, EmailDetailResponse>;
  calls: { method: string; url: string }[];
}
let world: World;

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      world.calls.push({ method, url });
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
      if (url.startsWith("/api/health")) return json(HEALTH_AI);
      if (url.startsWith("/api/graph")) {
        if (url.includes("include_amounts=true")) {
          if (world.amountsFail) return json({ error: { code: "internal_error", message: "Something went wrong." } }, 500);
          return json(world.withAmounts);
        }
        return json(world.graph);
      }
      if (url.startsWith("/api/emails?") || url === "/api/emails") return json(world.list);
      const m = /^\/api\/emails\/([^/?]+)/.exec(url);
      if (m) {
        const d = world.details[decodeURIComponent(m[1]!)];
        return d ? json(d) : json({ error: { code: "not_found", message: "Email not found." } }, 404);
      }
      return json({ error: { code: "not_found", message: "?" } }, 404);
    }),
  );
}

function setViewport(wide: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({ matches: /min-width/.test(query) ? wide : false, media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList,
  );
}

const go = (url: string) => window.history.replaceState(null, "", url);
const nodeIds = () => [...document.querySelectorAll("[data-node-id]")].map((n) => n.getAttribute("data-node-id")!).sort();
const transform = () => document.querySelector("[data-transform]")!.getAttribute("data-transform")!.split(",").map(Number) as [number, number, number];
const node = (re: RegExp) => screen.getByRole("button", { name: re });
async function openFilters(user: ReturnType<typeof userEvent.setup>) {
  const toggle = screen.getByRole("button", { name: /^Filters/ });
  if (toggle.getAttribute("aria-expanded") === "false") await user.click(toggle);
}
const inspector = () => screen.getByRole("complementary", { name: "Entity details" });

function detailWithEvidence(over: Partial<EmailDetailResponse> = {}): EmailDetailResponse {
  const d = assessedDetail();
  d.relationships = [
    { key: "r1", predicate: "requests_transfer_to", source: "person:email:E1:dana", target: "account:email:E1:acct", evidence: [{ snippet_id: "s1", quote: QUOTE }], also_in: [] },
  ];
  d.entities = [
    { key: "person:email:E1:dana", type: "person", display_name: "Dana", origin: "ai", key_basis: "email_scoped", mentions: [], also_in: [] },
    { key: "amount:email:E1:$13,900", type: "amount", display_name: "$13,900", origin: "ai", key_basis: "email_scoped", mentions: [], also_in: [] },
  ];
  return { ...d, ...over };
}

beforeEach(() => {
  const g = sampleGraph();
  g.edges[0] = { ...g.edges[0]!, email_ids: ["E1"], evidence: [{ email_id: "E1", snippet_id: "s1", quote: QUOTE }] };
  world = {
    graph: g,
    withAmounts: gGraph(
      [...g.nodes, gNode("amount:email:E004:$47,300", { type: "amount", label: "$47,300", key_basis: "email_scoped", max_risk: "medium" })],
      g.edges,
    ),
    amountsFail: false,
    list: listResponse([listItem("E1", "high", { subject: "Wire request" }), listItem("E004", "medium", { subject: "Invoice #NS-4471" }), listItem("E001", "high", { subject: "URGENT wire" })]),
    details: { E1: detailWithEvidence() },
    calls: [],
  };
  installFetch();
  setViewport(true);
  Element.prototype.scrollIntoView = vi.fn();
  go("/graph");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("dir");
});

describe("filters, search and URL persistence", () => {
  it("filters by type and persists it in the URL; reset restores everything", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    await openFilters(user);
    await user.click(screen.getByRole("checkbox", { name: /Organization/ }));
    await waitFor(() => expect(nodeIds().length).toBe(2));
    expect(window.location.search).toContain("types=organization");
    expect(screen.getByText(/hidden by filters/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(nodeIds().length).toBe(6));
    expect(window.location.search).not.toContain("types=");
  });

  it("filters by source, risk, search text and connected-only", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    await openFilters(user);
    await user.click(screen.getByRole("checkbox", { name: /Automatic \(not AI\)/ }));
    await waitFor(() => expect(nodeIds().length).toBe(2));
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await openFilters(user);
    await user.click(screen.getByRole("checkbox", { name: "High risk" }));
    await waitFor(() => expect(nodeIds().length).toBe(2)); // Arcline, James
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await user.type(screen.getByRole("searchbox", { name: /Search entities/ }), "northgate");
    await waitFor(() => expect(nodeIds().length).toBe(2));
    expect(window.location.search).toContain("gq=northgate");
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await openFilters(user);
    await user.click(screen.getByRole("checkbox", { name: /Only entities with a visible relationship/ }));
    await waitFor(() => expect(nodeIds().length).toBe(4));
  });

  it("restores filters from a shared URL and shows an honest filtered-empty state", async () => {
    go("/graph?types=location&gq=zzz");
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("No entities match these filters")).toBeTruthy();
    expect(screen.getByText(/6 entities exist in the graph/)).toBeTruthy();
    expect(document.querySelector("svg[role='group']")).toBeNull();
    await user.click(within(screen.getByText("No entities match these filters").closest("div")!.parentElement!).getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(nodeIds().length).toBe(6));
  });

  it("Graph and List use exactly the same filtered entities and relationships", async () => {
    go("/graph?origin=ai&connected=1");
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    await waitFor(() => expect(nodeIds().length).toBe(4));
    const canvas = nodeIds();
    const edges = document.querySelectorAll("path[marker-end]").length;
    await user.click(screen.getByRole("button", { name: "List" }));
    const table = screen.getByRole("table", { name: /Entities \(4\)/ });
    const rows = within(table).getAllByRole("rowheader").map((r) => r.textContent);
    expect(rows.length).toBe(canvas.length);
    expect(screen.getByRole("table", { name: new RegExp(`Relationships \\(${edges}\\)`) })).toBeTruthy();
    // and the labels are the same set the canvas drew
    const labels = canvas.map((id) => world.graph.nodes.find((n) => n.id === id)!.label).sort();
    expect([...rows].sort()).toEqual(labels);
  });

  it("keeps a selection that stays visible and explains one that is hidden, with a recovery action", async () => {
    go("/graph?node=person%3Aemail%3Ahr%40arcline.com");
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    expect(within(inspector()).getByRole("heading", { level: 2, name: "hr@arcline.com" })).toBeTruthy();
    await openFilters(user);
    await user.click(screen.getByRole("checkbox", { name: /AI-identified/ })); // hides the automatic hr@arcline.com
    expect(await screen.findByText(/"hr@arcline.com" is hidden by the filters/)).toBeTruthy();
    expect(window.location.search).toContain("node=");
    await user.click(screen.getByRole("button", { name: /Clear filters to show it/ }));
    await waitFor(() => expect(within(inspector()).getByRole("heading", { level: 2, name: "hr@arcline.com" })).toBeTruthy());
  });

  it("marks relationships to hidden entities in the inspector instead of dropping them silently", async () => {
    go("/graph?node=organization%3Aname%3Aarcline&types=organization");
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    expect(within(inspector()).getAllByText(/hidden by filters/).length).toBe(1); // James is hidden, Northgate is visible
  });
});

describe("include amounts uses the API parameter", () => {
  it("is off by default (no include_amounts), then refetches with it and shows the amount", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    expect(world.calls.some((c) => c.url.includes("include_amounts"))).toBe(false);
    expect(screen.getByText(/Amounts are not included/)).toBeTruthy();
    await openFilters(user);
    await user.click(screen.getByRole("checkbox", { name: "Include amounts" }));
    await waitFor(() => expect(nodeIds()).toContain("amount:email:E004:$47,300"));
    expect(world.calls.some((c) => c.url === "/api/graph?include_amounts=true")).toBe(true);
    expect(window.location.search).toContain("amounts=1");
    expect(screen.queryByText(/Amounts are not included/)).toBeNull();
  });

  it("keeps the last graph and says so when the refetch fails, then recovers", async () => {
    world.amountsFail = true;
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    await openFilters(user);
    await user.click(screen.getByRole("checkbox", { name: "Include amounts" }));
    expect(await screen.findByText("The graph could not be loaded")).toBeTruthy();
    world.amountsFail = false;
    await user.click(screen.getByRole("button", { name: /Try again/ }));
    await waitFor(() => expect(nodeIds()).toContain("amount:email:E004:$47,300"));
  });

  it("offers to include amounts when a shared link points at an amount that is not loaded", async () => {
    go("/graph?node=amount%3Aemail%3AE004%3A%2447%2C300");
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("That entity is not in the graph")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Include amounts" }));
    await waitFor(() => expect(within(inspector()).getByRole("heading", { level: 2, name: "$47,300" })).toBeTruthy());
  });
});

describe("pan, zoom and fit", () => {
  it("zooms with the buttons, is bounded, and fit restores the identity", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    expect(transform()).toEqual([0, 0, 1]);
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(transform()[2]).toBeGreaterThan(1);
    await user.click(screen.getByRole("button", { name: "Fit the whole graph in view" }));
    expect(transform()).toEqual([0, 0, 1]);
    expect((screen.getByRole("button", { name: "Fit the whole graph in view" }) as HTMLButtonElement).disabled).toBe(true);
    for (let i = 0; i < 25; i++) await user.click(screen.getByRole("button", { name: "Zoom in" }).hasAttribute("disabled") ? screen.getByRole("button", { name: "Zoom out" }) : screen.getByRole("button", { name: "Zoom in" }));
    expect(transform()[2]).toBeLessThanOrEqual(6);
    expect(transform()[2]).toBeGreaterThanOrEqual(0.5);
  });

  it("is operable from the keyboard (plus, minus, zero, arrows)", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    const stage = screen.getByRole("group", { name: /^Graph canvas\./ });
    stage.focus();
    await user.keyboard("+");
    expect(transform()[2]).toBeGreaterThan(1);
    const beforePan = transform()[0];
    await user.keyboard("{ArrowLeft}");
    expect(transform()[0]).toBeGreaterThan(beforePan);
    await user.keyboard("0");
    expect(transform()).toEqual([0, 0, 1]);
    await user.keyboard("-");
    expect(transform()[2]).toBeLessThan(1);
  });

  it("zooms with the mouse wheel around the pointer", async () => {
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    const svg = document.querySelector("svg[role='group']")!;
    fireEvent.wheel(svg, { deltaY: -200, clientX: 10, clientY: 10 });
    expect(transform()[2]).toBeGreaterThan(1);
    fireEvent.wheel(svg, { deltaY: 400, clientX: 10, clientY: 10 });
    expect(transform()[2]).toBeLessThan(1.5);
  });

  it("drag pans the view and does not select the node under the pointer", async () => {
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    const svg = document.querySelector("svg[role='group']")!;
    const target = document.querySelector('[data-node-id="organization:name:arcline"]')!;
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 100, clientY: 100, button: 0, pointerType: "mouse" });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 160, clientY: 130, button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 160, clientY: 130, button: 0, pointerType: "mouse" });
    const [x, y] = transform();
    expect(Math.hypot(x, y)).toBeGreaterThan(0);
    fireEvent.click(target); // the click that follows a drag
    expect(target.getAttribute("aria-pressed")).toBe("false");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    fireEvent.click(target); // a deliberate click afterwards selects
    expect(document.querySelector('[data-node-id="organization:name:arcline"]')!.getAttribute("aria-pressed")).toBe("true");
  });

  it("two-pointer pinch zooms", async () => {
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    const svg = document.querySelector("svg[role='group']")!;
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 100, clientY: 100, pointerType: "touch" });
    fireEvent.pointerDown(svg, { pointerId: 2, clientX: 200, clientY: 100, pointerType: "touch" });
    fireEvent.pointerMove(svg, { pointerId: 2, clientX: 300, clientY: 100, pointerType: "touch" });
    expect(transform()[2]).toBeGreaterThan(1);
    fireEvent.pointerUp(svg, { pointerId: 2, pointerType: "touch" });
    fireEvent.pointerUp(svg, { pointerId: 1, pointerType: "touch" });
  });

  it("starts fitted again when the visible graph changes", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(transform()[2]).toBeGreaterThan(1);
    await openFilters(user);
    await user.click(screen.getByRole("checkbox", { name: /Organization/ }));
    await waitFor(() => expect(transform()).toEqual([0, 0, 1]));
  });

  it("works on a narrow viewport without side-by-side layout", async () => {
    setViewport(false);
    go("/graph?tab=map");
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(transform()[2]).toBeGreaterThan(1);
  });
});

describe("parallel relationships", () => {
  it("draws each of several relationships between the same two entities as its own path", async () => {
    const a = gNode("a", { label: "A" });
    const b = gNode("b", { label: "B" });
    world.graph = gGraph([a, b], [gEdge("a", "b", { id: "e1", predicate: "sent_email_to" }), gEdge("b", "a", { id: "e2", predicate: "related_to" }), gEdge("a", "b", { id: "e3", predicate: "instructs" })]);
    render(<App />);
    await screen.findByText(/2 entities · 3 relationships/);
    const paths = [...document.querySelectorAll("path[marker-end]")].map((p) => p.getAttribute("d"));
    expect(paths.length).toBe(3);
    expect(new Set(paths).size).toBe(3); // no two overlap exactly
  });
});

describe("evidence deep links", () => {
  it("opens the email and highlights exactly the verified passage", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    await user.click(node(/^Organization Northgate Suppliers Inc\./));
    await user.click(within(inspector()).getAllByRole("link", { name: "Show passage in message" })[0]!);
    expect(window.location.pathname).toBe("/emails/E1");
    expect(window.location.search).toContain("ev=s1");
    expect(await screen.findByText("Opened from the knowledge graph")).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll("mark").length).toBeGreaterThan(0));
    const active = [...document.querySelectorAll("mark")].filter((m) => /active/.test(m.className)).map((m) => m.textContent).join("");
    expect(active).toBe(QUOTE);
    expect(BODY.includes(active)).toBe(true);
  });

  it("supports Back to the graph with the same selection", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    await user.click(node(/^Organization Northgate Suppliers Inc\./));
    await user.click(within(inspector()).getAllByRole("link", { name: "Show passage in message" })[0]!);
    await screen.findByText("Opened from the knowledge graph");
    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Knowledge graph" })).toBeTruthy();
    expect(within(inspector()).getByRole("heading", { level: 2, name: "Northgate Suppliers Inc." })).toBeTruthy();
  });

  it("never highlights unrelated text for a stale, forged or unverifiable reference", async () => {
    go("/emails/E1?ev=s9&evq=anything");
    const { unmount } = render(<App />);
    expect(await screen.findByText("That evidence reference is not available")).toBeTruthy();
    // The AI's own verified citations are still marked; the forged reference adds nothing.
    const activeMarks = () => [...document.querySelectorAll("mark")].filter((m) => /active/.test(m.className));
    expect(activeMarks().length).toBe(0);
    unmount();
    cleanup();

    go(`/emails/E1?ev=s1&evq=${encodeURIComponent("Please wire")}`); // a real substring, but not recorded evidence
    render(<App />);
    expect(await screen.findByText("That evidence reference is not available")).toBeTruthy();
    expect([...document.querySelectorAll("mark")].some((m) => /active/.test(m.className))).toBe(false);
    expect([...document.querySelectorAll("mark")].some((m) => m.textContent === "Please wire")).toBe(false);
  });

  it("shows the quote without any highlight when the recorded position does not verify", async () => {
    const bad = assessedDetail({ badOffsets: true });
    bad.relationships = detailWithEvidence().relationships;
    world.details.E1 = bad;
    go(`/emails/E1?ev=s1&evq=${encodeURIComponent(QUOTE)}`);
    render(<App />);
    expect(await screen.findByText(/shown as a quote and nothing is highlighted/)).toBeTruthy();
    expect(document.querySelectorAll("mark").length).toBe(0);
  });

  it("evidence parameters do not leak into other message links", async () => {
    go(`/emails/E1?ev=s1&evq=${encodeURIComponent(QUOTE)}`);
    render(<App />);
    await screen.findByText("Opened from the knowledge graph");
    const hrefs = [...document.querySelectorAll("a[href^='/emails/']")].map((a) => a.getAttribute("href")!);
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.filter((h) => h.includes("ev="))).toEqual([]);
  });
});

describe("show in graph", () => {
  it("links eligible entities to the canonical node id with correct encoding", async () => {
    go("/emails/E1");
    render(<App />);
    const link = await screen.findByRole("link", { name: "Show Dana in the knowledge graph" });
    expect(link.getAttribute("href")).toBe("/graph?node=person%3Aemail%3AE1%3Adana");
    const amount = screen.getByRole("link", { name: /Show \$13,900 in the knowledge graph/ });
    expect(amount.getAttribute("href")).toContain("amounts=1");
    expect(amount.getAttribute("href")).toContain(encodeURIComponent("amount:email:E1:$13,900"));
  });

  it("selects the matching node when it exists", async () => {
    world.graph.nodes.push(gNode("person:email:E1:dana", { type: "person", label: "Dana", key_basis: "email_scoped", email_ids: ["E1"] }));
    go("/emails/E1");
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Show Dana in the knowledge graph" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Knowledge graph" })).toBeTruthy();
    await waitFor(() => expect(within(inspector()).getByRole("heading", { level: 2, name: "Dana" })).toBeTruthy());
  });

  it("is informative, not fabricated, when the entity is not in the graph", async () => {
    go("/emails/E1");
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Show Dana in the knowledge graph" }));
    expect(await screen.findByText("That entity is not in the graph")).toBeTruthy();
    expect(nodeIds()).not.toContain("person:email:E1:dana");
  });
});

describe("accessibility and internationalisation smoke", () => {
  it("every control on the graph page has an accessible name, ids are unique, headings are ordered", async () => {
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    const unnamed = [...document.querySelectorAll("button, input, a[href], [role='button']")].filter((el) => {
      const label = el.getAttribute("aria-label") ?? el.getAttribute("aria-labelledby");
      const text = el.textContent?.trim();
      const wrapped = el.closest("label")?.textContent?.trim();
      const id = el.getAttribute("id");
      const forLabel = id ? document.querySelector(`label[for="${id}"]`)?.textContent?.trim() : null;
      return !label && !text && !wrapped && !forLabel;
    });
    expect(unnamed.map((e) => e.outerHTML.slice(0, 80))).toEqual([]);
    const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const levels = [...document.querySelectorAll("h1, h2, h3")].map((h) => Number(h.tagName[1]));
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i++) expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
  });

  it("filter groups are real fieldsets with legends", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    await openFilters(user);
    const legends = [...document.querySelectorAll("fieldset > legend")].map((l) => l.textContent);
    expect(legends).toEqual(["Type", "Source", "Risk signal", "Options"]);
  });

  it("renders and works in a right-to-left document", async () => {
    document.documentElement.setAttribute("dir", "rtl");
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    expect(nodeIds().length).toBe(6);
    await user.click(node(/^Organization Arcline/));
    expect(within(inspector()).getByRole("heading", { level: 2, name: "Arcline" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeTruthy();
  });

  it("starts no analysis and sends no POST from any graph interaction", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await user.click(node(/^Organization Arcline/));
    await user.click(screen.getByRole("button", { name: "List" }));
    await openFilters(user);
    await user.click(screen.getByRole("checkbox", { name: "Include amounts" }));
    expect(world.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });
});

describe("the graph is the first thing on the page", () => {
  it("filters are collapsed by default and open themselves when a filter is active", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    const toggle = screen.getByRole("button", { name: /^Filters/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("graph-filter-panel")!.hidden).toBe(true);
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    cleanup();
    go("/graph?origin=ai");
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    expect(screen.getByRole("button", { name: /^Filters \(1\)/ }).getAttribute("aria-expanded")).toBe("true");
  });
});
