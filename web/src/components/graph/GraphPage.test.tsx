import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailListResponse, GraphResponse } from "@mri/shared";
import { App } from "../../App";
import { HEALTH_AI, detail, listItem, listResponse } from "../../test/fixtures";
import { gGraph, gNode, sampleGraph } from "../../test/graphFixtures";

interface World {
  graph: GraphResponse | "error" | "slow";
  list: EmailListResponse;
  calls: { method: string; url: string }[];
  graphCalls: number;
}

let world: World;

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      world.calls.push({ method, url });
      const json = (b: unknown, status = 200) =>
        new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
      if (url.startsWith("/api/health")) return json(HEALTH_AI);
      if (url.startsWith("/api/graph")) {
        world.graphCalls++;
        if (world.graph === "error") return json({ error: { code: "internal_error", message: "Something went wrong." } }, 500);
        return json(world.graph);
      }
      if (url.startsWith("/api/emails?") || url === "/api/emails") return json(world.list);
      const m = /^\/api\/emails\/([^/?]+)/.exec(url);
      if (m) return json(detail({ email: { ...detail().email, id: decodeURIComponent(m[1]!), subject: `Detail ${m[1]}` } }));
      return json({ error: { code: "not_found", message: "?" } }, 404);
    }),
  );
}

function setViewport(wide: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({ matches: /min-width/.test(query) ? wide : false, media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList,
  );
}

const go = (url: string) => window.history.replaceState(null, "", url);
const posts = () => world.calls.filter((c) => c.method !== "GET");

beforeEach(() => {
  world = {
    graph: sampleGraph(),
    list: listResponse([
      listItem("E004", "medium", { subject: "Invoice #NS-4471" }),
      listItem("E001", "high", { subject: "URGENT wire" }),
      listItem("E007", "none", { subject: "Holiday schedule" }),
    ]),
    calls: [],
    graphCalls: 0,
  };
  installFetch();
  setViewport(true);
  Element.prototype.scrollIntoView = vi.fn();
  go("/graph");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const nodeButton = (name: RegExp) => screen.getByRole("button", { name });

describe("navigation", () => {
  it("opens /graph directly and marks it as the current page", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "Knowledge graph" })).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "Knowledge graph" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "Inbox" }).getAttribute("aria-current")).toBeNull();
  });

  it("moves between Inbox and Graph with the primary navigation and Back", async () => {
    const user = userEvent.setup();
    go("/");
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Knowledge graph" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Knowledge graph" })).toBeTruthy();
    expect(window.location.pathname).toBe("/graph");
    await user.click(screen.getByRole("link", { name: "Inbox" }));
    expect(await screen.findByText("Choose a message to investigate")).toBeTruthy();
    expect(window.location.pathname).toBe("/");
    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Knowledge graph" })).toBeTruthy();
  });

  it("keeps the inbox usable and starts no analysis from the graph page", async () => {
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Knowledge graph" });
    expect(posts()).toHaveLength(0);
  });
});

describe("data loading", () => {
  it("renders exactly the API's nodes and edges", async () => {
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Knowledge graph" });
    await waitFor(() => expect(document.querySelectorAll("[data-node-id]").length).toBe(world.graph === "error" ? 0 : (world.graph as GraphResponse).nodes.length));
    const ids = [...document.querySelectorAll("[data-node-id]")].map((n) => n.getAttribute("data-node-id")).sort();
    expect(ids).toEqual((world.graph as GraphResponse).nodes.map((n) => n.id).sort());
    expect(document.querySelectorAll("path[marker-end]").length).toBe((world.graph as GraphResponse).edges.length);
    expect(world.graphCalls).toBeGreaterThan(0);
    expect(screen.getByText(/6 entities · 3 relationships/)).toBeTruthy();
  });

  it("states how many messages the graph is based on, from the real list", async () => {
    render(<App />);
    expect(await screen.findByText(/from 0 of 3 messages with a completed AI analysis/)).toBeTruthy();
  });

  it("shows an honest error with retry when the graph cannot load", async () => {
    world.graph = "error";
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("The graph could not be loaded")).toBeTruthy();
    world.graph = sampleGraph();
    await user.click(screen.getByRole("button", { name: /Try again/ }));
    await waitFor(() => expect(document.querySelectorAll("[data-node-id]").length).toBe(6));
  });

  it("shows an empty state with a link back to the inbox when there is nothing to draw", async () => {
    world.graph = gGraph([], []);
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("No entities in the graph yet")).toBeTruthy();
    expect(document.querySelector("svg[role='group']")).toBeNull();
    await user.click(screen.getByRole("link", { name: /Back to the inbox/ }));
    expect(window.location.pathname).toBe("/");
  });

  it("does not invent a relationship for a dangling edge and says so", async () => {
    const g = sampleGraph();
    g.edges.push({ ...g.edges[0]!, id: "dangling", target: "ghost" });
    world.graph = g;
    render(<App />);
    expect(await screen.findByText("Some relationships were left out")).toBeTruthy();
    expect(document.querySelectorAll("path[marker-end]").length).toBe(3);
  });
});

describe("selection and inspector", () => {
  it("selecting a node shows its identity, origin, risk caveat, sources and relationships", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    await user.click(nodeButton(/^Organization Northgate Suppliers Inc\./));
    const insp = screen.getByRole("complementary", { name: "Entity details" });
    expect(within(insp).getByRole("heading", { level: 2, name: "Northgate Suppliers Inc." })).toBeTruthy();
    expect(within(insp).getByText("AI-identified")).toBeTruthy();
    expect(within(insp).getByText(/not a finding about this entity/)).toBeTruthy();
    expect(within(insp).getByText("Relationships (2)")).toBeTruthy();
    expect(within(insp).getByText(/New payment account: routing 044000037/)).toBeTruthy();
    expect(window.location.search).toContain("node=");
  });

  it("labels an automatic (rules) entity as such and never as AI-identified", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    await user.click(nodeButton(/^Person or address hr@arcline\.com/));
    const insp = screen.getByRole("complementary", { name: "Entity details" });
    expect(within(insp).getByText("Automatic")).toBeTruthy();
    expect(within(insp).queryByText("AI-identified")).toBeNull();
    expect(within(insp).getByText(/No relationships/)).toBeTruthy();
  });

  it("distinguishes 'No risk found' from 'Not assessed' in the inspector", async () => {
    const g = sampleGraph();
    g.nodes.push(gNode("person:email:x@y.com", { type: "person", label: "x@y.com", origin: "rules", key_basis: "email_address", max_risk: "unassessed", email_ids: ["E010"] }));
    world.graph = g;
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/7 entities · 3 relationships/);
    await user.click(nodeButton(/^Person or address x@y\.com/));
    const insp = screen.getByRole("complementary", { name: "Entity details" });
    expect(insp.querySelector("[data-level]")!.getAttribute("data-level")).toBe("unassessed");
    expect(within(insp).getByText(/This is not the same as safe/)).toBeTruthy();
    await user.click(nodeButton(/^Person or address hr@arcline\.com/));
    const badge = screen.getByRole("complementary", { name: "Entity details" }).querySelector("[data-level]")!;
    expect(badge.getAttribute("data-level")).toBe("none");
    expect(badge.textContent).toMatch(/No risk found/);
  });

  it("source messages link to the existing detail page; unknown ids are shown by id", async () => {
    const g = sampleGraph();
    g.nodes[0] = { ...g.nodes[0]!, email_ids: ["E004", "E999"] };
    world.graph = g;
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    await user.click(nodeButton(/^Organization Northgate Suppliers Inc\./));
    const insp = screen.getByRole("complementary", { name: "Entity details" });
    expect(within(insp).getByText("Message E999")).toBeTruthy();
    expect(within(insp).getByText("Not in the loaded message list")).toBeTruthy();
    await user.click(within(insp).getByRole("link", { name: /Invoice #NS-4471/ }));
    expect(window.location.pathname).toBe("/emails/E004");
    expect(await screen.findByRole("heading", { level: 1, name: "Detail E004" })).toBeTruthy();
  });

  it("a relationship's other endpoint is selectable from the inspector", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    await user.click(nodeButton(/^Organization Northgate Suppliers Inc\./));
    await user.click(within(screen.getByRole("complementary", { name: "Entity details" })).getByRole("button", { name: "account ending 9902" }));
    expect(within(screen.getByRole("complementary", { name: "Entity details" })).getByRole("heading", { level: 2, name: "account ending 9902" })).toBeTruthy();
  });

  it("an unknown ?node= is reported without breaking the page", async () => {
    go("/graph?node=nope");
    render(<App />);
    expect(await screen.findByText("That entity is not in the graph")).toBeTruthy();
    expect(document.querySelectorAll("[data-node-id]").length).toBe(6);
  });

  it("selection never moves any node", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    const positions = () => [...document.querySelectorAll("[data-node-id]")].map((n) => n.getAttribute("data-pos"));
    const before = positions();
    expect(before.filter(Boolean).length).toBe(4); // the connected structure is placed; the rest is in the collection
    await user.click(nodeButton(/^Organization Arcline/));
    expect(positions()).toEqual(before);
  });
});

describe("graph / list toggle", () => {
  it("shows the same entities as a table, keeps the selection, and returns to the canvas", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    await user.click(nodeButton(/^Organization Arcline/));
    await user.click(screen.getByRole("button", { name: "List" }));
    expect(window.location.search).toContain("view=list");
    const entities = screen.getByRole("table", { name: /Entities \(6\)/ });
    expect(within(entities).getAllByRole("row").length).toBe(7);
    expect(within(screen.getByRole("complementary", { name: "Entity details" })).getByRole("heading", { level: 2, name: "Arcline" })).toBeTruthy();
    expect(screen.getByRole("table", { name: /Relationships \(3\)/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Graph" }));
    expect(document.querySelectorAll("[data-node-id]").length).toBe(6);
    expect(within(screen.getByRole("complementary", { name: "Entity details" })).getByRole("heading", { level: 2, name: "Arcline" })).toBeTruthy();
  });

  it("selects from the list", async () => {
    go("/graph?view=list");
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("table", { name: /Entities/ });
    await user.click(screen.getByRole("button", { name: "billing@northgate-suppliers.com" }));
    expect(within(screen.getByRole("complementary", { name: "Entity details" })).getByRole("heading", { level: 2 }).textContent).toBe("billing@northgate-suppliers.com");
  });
});

describe("keyboard and accessibility", () => {
  it("nodes are focusable buttons with descriptive labels, selectable with Enter, cleared with Escape", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    const n = nodeButton(/^Organization Arcline/);
    expect(n.getAttribute("tabindex")).toBe("0");
    expect(n.getAttribute("aria-label")).toMatch(/Identified by a validated AI assessment\. High risk among its source messages\. 2 connections, 2 messages\./);
    n.focus();
    await user.keyboard("{Enter}");
    expect(n.getAttribute("aria-pressed")).toBe("true");
    await user.keyboard("{Escape}");
    expect(nodeButton(/^Organization Arcline/).getAttribute("aria-pressed")).toBe("false");
  });

  it("encodes type, source and risk without relying on colour", async () => {
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    // risk: a letter with its own accessible text (never colour alone)
    const marks = [...document.querySelectorAll("[data-risk-glyph]")];
    expect(marks.map((m) => m.textContent)).toEqual(expect.arrayContaining(["H", "M", "✓"]));
    expect(marks.every((m) => (m.getAttribute("title") ?? "").length > 0)).toBe(true);
    // type: an icon and a word; source: a word and the outline
    const org = document.querySelector('[data-node-id="organization:name:arcline"]')!;
    const acct = document.querySelector('[data-node-id="account:email:E004:account ending 9902"]')!;
    expect(org.getAttribute("data-type")).toBe("organization");
    expect(org.textContent).toMatch(/Organization/);
    expect(org.textContent).toMatch(/AI/);
    expect(acct.getAttribute("data-type")).toBe("account");
    const rules = document.querySelector('[data-node-id="person:email:hr@arcline.com"]')!;
    expect(rules.getAttribute("data-origin")).toBe("rules");
    expect(rules.textContent).toMatch(/Automatic/);
    expect(screen.getByText("Legend")).toBeTruthy();
  });

  it("works the same on a narrow viewport (no side-by-side requirement)", async () => {
    setViewport(false);
    go("/graph?tab=map");
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/6 entities · 3 relationships/);
    await user.click(nodeButton(/^Organization Arcline/));
    // the selection is a navigation step: the details fill the screen and Back returns to the map
    expect(window.location.search).toContain("node=");
    expect(screen.getByRole("complementary", { name: "Entity details" })).toBeTruthy();
    expect(document.querySelector("[data-node-id]")).toBeNull();
    await user.click(within(screen.getByRole("navigation", { name: "Back to the knowledge graph" })).getByRole("link"));
    await waitFor(() => expect(document.querySelectorAll("[data-node-id]").length).toBe(6));
  });
});
