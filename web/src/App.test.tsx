import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailDetailResponse, EmailListItem, EmailListResponse } from "@mri/shared";
import { App } from "./App";
import { HEALTH_AI, assessedDetail, detail, listItem, listResponse, processing } from "./test/fixtures";

interface Call {
  method: string;
  url: string;
}

interface World {
  list: EmailListResponse;
  details: Record<string, EmailDetailResponse>;
  calls: Call[];
  health: unknown;
}

function installFetch(world: World) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      world.calls.push({ method, url });
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      if (url.startsWith("/api/health")) return json(world.health);
      if (url.startsWith("/api/emails?") || url === "/api/emails") {
        if (method === "POST") return json({ error: { code: "invalid_request", message: "no" } }, 400);
        return json(world.list);
      }
      const m = /^\/api\/emails\/([^/?]+)(\/reprocess)?/.exec(url);
      if (m) {
        const d = world.details[decodeURIComponent(m[1]!)];
        if (!d) return json({ error: { code: "not_found", message: "Email not found." } }, 404);
        if (m[2]) {
          const next = { ...d, processing: { ...d.processing, status: "queued" as const, in_progress: true } };
          world.details[d.email.id] = next;
          return json({ id: d.email.id, result: "queued", processing: next.processing }, 202);
        }
        return json(d);
      }
      return json({ error: { code: "not_found", message: "?" } }, 404);
    }),
  );
}

function setViewport(wide: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: /min-width/.test(query) ? wide : false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

function go(url: string) {
  window.history.replaceState(null, "", url);
}

let world: World;

beforeEach(() => {
  world = { list: listResponse([listItem("E1", "unassessed"), listItem("E2", "medium")]), details: {}, calls: [], health: HEALTH_AI };
  world.details.E1 = detail();
  installFetch(world);
  setViewport(true);
  Element.prototype.scrollIntoView = vi.fn();
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  go("/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const posts = () => world.calls.filter((c) => c.method !== "GET");

describe("inbox", () => {
  it("lists messages with explicit risk wording and starts no analysis by itself", async () => {
    render(<App />);
    expect((await screen.findAllByText("Subject E1")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not assessed").length).toBeGreaterThan(0);
    expect(document.querySelector("[data-level=\"none\"]")).toBeNull();
    expect(posts()).toHaveLength(0);
  });

  it("does not present capped counts as mailbox totals", async () => {
    world.list = { emails: [listItem("E1", "high")], total: 900, count: 1 };
    render(<App />);
    expect(await screen.findByText(/lower bounds/)).toBeTruthy();
    expect(screen.getByText(/newest 1 of 900/)).toBeTruthy();
  });

  it("shows a clear error with retry when the list cannot load", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    render(<App />);
    expect(await screen.findByText("The mailbox could not be loaded")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeTruthy();
  });
});

describe("routing", () => {
  it("opens a deep link straight into the investigation and keeps the list on wide screens", async () => {
    go("/emails/E1");
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "Invoice" })).toBeTruthy();
    expect(screen.getByText("Subject E2")).toBeTruthy();
    const selected = screen.getByText("Subject E1").closest("a");
    expect(selected?.getAttribute("aria-current")).toBe("true");
  });

  it("drills down on a narrow screen: list first, then only the investigation, Back returns", async () => {
    setViewport(false);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText("Subject E1"));
    expect(await screen.findByRole("heading", { level: 1, name: "Invoice" })).toBeTruthy();
    expect(screen.queryByText("Subject E2")).toBeNull();
    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(await screen.findByText("Subject E2")).toBeTruthy();
  });

  it("reports a missing message without crashing", async () => {
    go("/emails/NOPE");
    render(<App />);
    expect(await screen.findByText("Message not found")).toBeTruthy();
  });
});

describe("investigation", () => {
  it("never labels an unassessed message as safe and does not call the AI on open", async () => {
    go("/emails/E1");
    render(<App />);
    expect(await screen.findByText("Not assessed does not mean safe")).toBeTruthy();
    expect(document.querySelector("[data-level=\"none\"]")).toBeNull();
    expect(posts()).toHaveLength(0);
    expect(screen.getByRole("button", { name: /Analyze with AI/ })).toBeTruthy();
  });

  it("starts analysis only after an explicit click", async () => {
    go("/emails/E1");
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Analyze with AI/ }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.url).toMatch(/\/api\/emails\/E1\/reprocess$/);
  });

  it("highlights a cited quote only where its position is verified", async () => {
    world.details.E1 = assessedDetail();
    go("/emails/E1");
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Passages the AI cited", { exact: false });
    const message = screen.getByRole("heading", { name: "Original message" }).closest("section")!;
    const marks = message.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe("wire $13,900 to account 9902");
    await user.click(screen.getByRole("button", { name: /Show in message/ }));
    expect(marks[0]!.className).toMatch(/active/);
  });

  it("shows the quote without any highlight when the recorded position is wrong", async () => {
    world.details.E1 = assessedDetail({ badOffsets: true });
    go("/emails/E1");
    render(<App />);
    await screen.findByText("Passages the AI cited", { exact: false });
    const message = screen.getByRole("heading", { name: "Original message" }).closest("section")!;
    expect(message.querySelectorAll("mark")).toHaveLength(0);
    // The quote itself is still shown, with an honest reason.
    expect(screen.getAllByText("wire $13,900 to account 9902").length).toBeGreaterThan(0);
    expect(screen.getByText(/position could not be verified/)).toBeTruthy();
  });

  it("shows header evidence as a quote and never highlights it", async () => {
    const d = detail();
    d.risk.indicators = [
      {
        id: "i1",
        rule_id: "lookalike_domain",
        category: "observation",
        label: "Look-alike sender domain",
        detail: "The domain resembles a known one.",
        evidence: [{ email_id: "E1", where: "header", start: 0, end: 5, text: "From: vendor@examp1e.com" }],
        related_email_ids: [],
        counts_toward_medium: true,
        sufficient_for_medium: false,
      },
    ];
    d.risk.final_level = "low";
    d.risk.basis = "rules_only";
    world.details.E1 = d;
    go("/emails/E1");
    render(<App />);
    const quote = await screen.findByText("From: vendor@examp1e.com");
    expect(quote.tagName).toBe("BLOCKQUOTE");
    expect(screen.getByText(/headers are shown as quoted/)).toBeTruthy();
    const message = screen.getByRole("heading", { name: "Original message" }).closest("section")!;
    expect(within(message).queryAllByText(/examp1e/)).toHaveLength(0);
  });

  it("polls only while analysis is in progress", async () => {
    const d = detail();
    d.processing = { ...processing({ status: "extracting", in_progress: true, can_reprocess: false }), warnings: [], runs: [] };
    world.details.E1 = d;
    go("/emails/E1");
    render(<App />);
    expect((await screen.findAllByText("Reading the message")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Analyze with AI|Retry/ })).toBeNull();
  });
});

describe("add email", () => {
  it("does not send anything for analysis unless the box is ticked", async () => {
    go("/?add=1");
    const user = userEvent.setup();
    const posted: string[] = [];
    const base = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          posted.push(String(init.body));
          return new Response(
            JSON.stringify({
              id: "N1",
              created: true,
              reason: null,
              source_kind: "paste",
              missing_headers: [],
              warnings: [],
              attachments: [],
              processing: processing(),
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          );
        }
        return base(input, init);
      }),
    );
    world.details.N1 = detail({ email: { ...detail().email, id: "N1", subject: "Pasted" } });
    render(<App />);
    const box = await screen.findByLabelText("Email text");
    await user.type(box, "Subject: hi{enter}{enter}body");
    const analyze = screen.getByRole("checkbox", { name: /Analyze with AI after adding/ });
    expect((analyze as HTMLInputElement).checked).toBe(false);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add email" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(JSON.parse(posted[0]!).analyze).toBe(false);
  });
});


describe("run again after the retry limit", () => {
  it("asks for confirmation before sending force=true", async () => {
    const d = detail();
    d.processing = { ...processing({ status: "degraded", can_reprocess: false, run_count: 3 }), warnings: [], runs: [] };
    world.details.E1 = d;
    go("/emails/E1");
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Run again anyway/ }));
    expect(posts()).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(posts()).toHaveLength(0);
    await user.click(await screen.findByRole("button", { name: /Run again anyway/ }));
    await user.click(screen.getByRole("button", { name: "Yes, run again" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.url).toMatch(/reprocess[?]force=true$/);
  });
});

// Keep the imported type referenced for readers of the fixtures.
export type _Item = EmailListItem;
