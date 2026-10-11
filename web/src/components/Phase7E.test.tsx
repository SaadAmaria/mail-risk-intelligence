import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailDetailResponse, HealthResponse } from "@mri/shared";
import { App } from "../App";
import { aiConnection, REPLAY_EXPLANATION } from "../lib/copy";
import { LLM_SETUP_GUIDE_URL } from "../lib/docs";
import { HEALTH_AI, HEALTH_RECORDED, detail, listItem, listResponse, processing } from "../test/fixtures";
import { gEdge, gGraph, gNode } from "../test/graphFixtures";
import { ConnectionStatus } from "./ConnectionStatus";

let details: Record<string, EmailDetailResponse>;
let health: HealthResponse;
let calls: { method: string; url: string }[];
let automatic: { status: number; code: string } | null;
let graph = gGraph([], []);

function install() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ method, url });
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
      if (url.startsWith("/api/health")) return json(health);
      if (url.startsWith("/api/graph")) return json(graph);
      if (url.startsWith("/api/emails?") || url === "/api/emails") return json(listResponse([listItem("E1", "unassessed"), listItem("E2", "unassessed")]));
      const m = /^\/api\/emails\/([^/?]+)(\/automatic-checks)?/.exec(url);
      if (m) {
        const id = decodeURIComponent(m[1]!);
        if (m[2]) {
          return automatic
            ? json({ error: { code: automatic.code, message: "server says no" } }, automatic.status)
            : json({ id, result: "performed", processing: details[id]!.processing });
        }
        const d = details[id];
        return d ? json(d) : json({ error: { code: "not_found", message: "no" } }, 404);
      }
      return json({ error: { code: "not_found", message: "?" } }, 404);
    }),
  );
}

const withProcessing = (id: string, p: Partial<ReturnType<typeof processing>>): EmailDetailResponse => {
  const d = detail({ email: { ...detail().email, id } });
  d.processing = { ...processing(p), warnings: [], runs: [] };
  return d;
};

beforeEach(() => {
  calls = [];
  automatic = null;
  health = HEALTH_RECORDED;
  details = { E2: withProcessing("E2", { automatic_checks_available: true }) };
  graph = gGraph([], []);
  install();
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: /min-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} }));
  Element.prototype.scrollIntoView = vi.fn();
  window.history.replaceState(null, "", "/emails/E2");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("header status wording", () => {
  it("says Recorded AI Replay in replay mode, with the explanation available to assistive technology", async () => {
    render(<App />);
    const pill = await screen.findByRole("button", { name: /Recorded AI Replay/ });
    expect(pill.getAttribute("aria-expanded")).toBe("false");
    expect(pill.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(pill.getAttribute("aria-describedby")!)!.textContent).toBe(REPLAY_EXPLANATION);
    expect(REPLAY_EXPLANATION).toBe(
      "Previously recorded LLM analyses are available for replay. No new AI provider requests are made in this mode.",
    );
    expect(screen.queryByText(/Recorded demo analyses available/)).toBeNull();
  });

  it("opens the explanation, offers the live-LLM prompt, and closes with Escape", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Recorded AI Replay/ }));
    const panel = screen.getByRole("region", { name: "About Recorded AI Replay" });
    expect(within(panel).getByText(REPLAY_EXPLANATION)).toBeTruthy();
    expect(within(panel).getByText("Want to connect a live LLM?")).toBeTruthy();
    expect(within(panel).getByText("Follow the project setup guide to configure live AI analysis.")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "About Recorded AI Replay" })).toBeNull();
  });

  it("does not publish a link to a guide that does not exist yet", async () => {
    expect(LLM_SETUP_GUIDE_URL).toBeNull();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Recorded AI Replay/ }));
    const panel = screen.getByRole("region", { name: "About Recorded AI Replay" });
    expect(within(panel).queryByRole("link")).toBeNull();
    const label = within(panel).getByTestId("llm-guide-unavailable");
    expect(label.textContent).toBe("View LLM Setup Guide");
    expect(label.getAttribute("aria-disabled")).toBe("true");
    expect(within(panel).getByText(/Not linked yet/)).toBeTruthy();
  });

  it("renders a real link as soon as a guide target is configured", async () => {
    const user = userEvent.setup();
    render(
      <ConnectionStatus
        pillClass="p"
        dotClass="d"
        fullClass="f"
        shortClass="s"
        text="Recorded AI Replay"
        short="Replay"
        replay
        guideUrl="https://example.invalid/README.md#llm-setup"
      />,
    );
    await user.click(screen.getByRole("button", { name: /Recorded AI Replay/ }));
    const link = screen.getByRole("link", { name: "View LLM Setup Guide" });
    expect(link.getAttribute("href")).toBe("https://example.invalid/README.md#llm-setup");
    expect(screen.queryByTestId("llm-guide-unavailable")).toBeNull();
  });

  it("is never shown while a live model is configured, nor when nothing is available", async () => {
    health = HEALTH_AI;
    const { unmount } = render(<App />);
    await screen.findAllByText(/AI configured|AI ready|AI reachable/);
    expect(screen.queryByText("Recorded AI Replay")).toBeNull();
    expect(screen.queryByRole("button", { name: /Recorded AI Replay/ })).toBeNull();
    unmount();
    cleanup();

    health = { status: "ok", service: "x", llm: { configured: false, provider: null, model: null, reachability: "unchecked" } };
    render(<App />);
    expect((await screen.findAllByText(/AI not configured/)).length).toBeGreaterThan(0);
    expect(screen.queryByText("Recorded AI Replay")).toBeNull();
    expect(aiConnection({ configured: false, provider: null, model: null }).text).not.toMatch(/Replay/);
  });
});

describe("automatic-checks eligibility in the detail view", () => {
  beforeEach(() => {
    health = { status: "ok", service: "x", llm: { configured: false, provider: null, model: null, reachability: "unchecked" } };
  });

  it("is offered when the server says it is available", async () => {
    render(<App />);
    expect(await screen.findByRole("button", { name: /Run automatic checks/ })).toBeTruthy();
  });

  it("is not offered for a failed record that holds an AI extraction", async () => {
    details.E2 = withProcessing("E2", { status: "failed", analysis_mode: "failed", provenance: "live", automatic_checks_available: false });
    render(<App />);
    await screen.findAllByText(/Analysis failed/);
    expect(screen.queryByRole("button", { name: /Run automatic checks/ })).toBeNull();
  });

  it("is not offered for a partial result or an existing rules-only result", async () => {
    for (const p of [
      { status: "partial" as const, analysis_mode: "partial" as const, provenance: "live" as const },
      { status: "degraded" as const, analysis_mode: "degraded" as const, provenance: "rules" as const, automatic_checks_only: true },
    ]) {
      details.E2 = withProcessing("E2", { ...p, automatic_checks_available: false });
      const { unmount } = render(<App />);
      await screen.findAllByText(/Analysis|Partly|Automatic checks only|AI analysis was not available/);
      expect(screen.queryByRole("button", { name: /Run automatic checks/ })).toBeNull();
      unmount();
      cleanup();
    }
  });

  it("a failed record WITHOUT an extraction is still offered it", async () => {
    details.E2 = withProcessing("E2", { status: "failed", analysis_mode: "failed", provenance: null, automatic_checks_available: true });
    render(<App />);
    expect(await screen.findByRole("button", { name: /Run automatic checks/ })).toBeTruthy();
  });

  it("falls back to the narrow rule when an older server does not report availability", async () => {
    details.E2 = withProcessing("E2", { status: "partial", analysis_mode: "partial", provenance: "live" });
    delete (details.E2!.processing as { automatic_checks_available?: boolean }).automatic_checks_available;
    render(<App />);
    await screen.findAllByText(/Partly analyzed/);
    expect(screen.queryByRole("button", { name: /Run automatic checks/ })).toBeNull();
  });

  it("a 409 race refreshes the record and says nothing was changed, instead of leaving a dead button", async () => {
    const user = userEvent.setup();
    render(<App />);
    const button = await screen.findByRole("button", { name: /Run automatic checks/ });
    // Between loading the page and clicking, an AI result arrived.
    details.E2 = withProcessing("E2", { status: "partial", analysis_mode: "partial", provenance: "live", automatic_checks_available: false });
    automatic = { status: 409, code: "ai_extraction_present" };
    await user.click(button);
    expect(await screen.findByText(/already has an AI extraction.*Nothing was changed; showing its current state\./)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: /Run automatic checks/ })).toBeNull());
    expect(calls.filter((c) => c.method === "POST").map((c) => c.url)).toEqual(["/api/emails/E2/automatic-checks"]);
  });
});

describe("small wording corrections", () => {
  it("uses the singular for one hidden entity or relationship", async () => {
    graph = gGraph(
      [gNode("a", { label: "A" }), gNode("b", { label: "B" }), gNode("c", { label: "C", type: "person", origin: "rules", key_basis: "email_address" })],
      [gEdge("a", "b")],
    );
    window.history.replaceState(null, "", "/graph?types=person");
    render(<App />);
    const results = await screen.findByText(/hidden by filters/);
    expect(results.textContent).toMatch(/2 entities and 1 relationship hidden by filters/);
    expect(results.textContent).not.toMatch(/1 relationships/);
  });
});
