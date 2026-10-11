import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailDetailResponse } from "@mri/shared";
import { AUTOMATIC_CHECKS_STAGE_KIND } from "@mri/shared";
import { App } from "../App";
import { HEALTH_AI, HEALTH_RECORDED, assessedDetail, detail, listItem, listResponse, processing } from "../test/fixtures";

interface Call {
  method: string;
  url: string;
}

let calls: Call[];
let details: Record<string, EmailDetailResponse>;
let health: unknown;
let automaticStatus = 200;

const AUTO_RUN = {
  started_at: "2026-10-11T10:00:00Z",
  finished_at: "2026-10-11T10:00:00Z",
  outcome: "degraded" as const,
  stages: [
    { stage: "extraction" as const, outcome: "ok" as const, calls: 0, error_kind: null, error_message: null, usage: null, latency_ms: null, dropped_items: 0 },
    { stage: "risk" as const, outcome: "skipped" as const, calls: 0, error_kind: AUTOMATIC_CHECKS_STAGE_KIND, error_message: null, usage: null, latency_ms: null, dropped_items: 0 },
  ],
};

function install() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ method, url });
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      if (url.startsWith("/api/health")) return json(health);
      if (url.startsWith("/api/emails?") || url === "/api/emails") {
        return json(listResponse([listItem("E1", "unassessed"), listItem("E2", "unassessed")]));
      }
      const m = /^\/api\/emails\/([^/?]+)(\/reprocess|\/automatic-checks)?/.exec(url);
      if (m) {
        const id = decodeURIComponent(m[1]!);
        const d = details[id];
        if (!d) return json({ error: { code: "not_found", message: "no" } }, 404);
        if (m[2] === "/automatic-checks") {
          if (automaticStatus !== 200) {
            return json({ error: { code: "already_complete", message: "server says no" } }, automaticStatus);
          }
          const next: EmailDetailResponse = {
            ...d,
            processing: {
              ...processing({
                status: "degraded",
                analysis_mode: "degraded",
                provenance: "rules",
                run_count: 1,
                automatic_checks_only: true,
              }),
              warnings: [],
              runs: [AUTO_RUN],
            },
          };
          details[id] = next;
          return json({ id, result: "performed", processing: next.processing });
        }
        if (m[2] === "/reprocess") return json({ id, result: "queued", processing: d.processing }, 202);
        return json(d);
      }
      return json({ error: { code: "not_found", message: "?" } }, 404);
    }),
  );
}

beforeEach(() => {
  calls = [];
  automaticStatus = 200;
  details = {
    E1: detail(),
    E2: detail({ email: { ...detail().email, id: "E2", subject: "Added by hand" } }),
  };
  health = HEALTH_RECORDED; // recordings exist for E1 only
  install();
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: /min-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} }));
  Element.prototype.scrollIntoView = vi.fn();
  window.history.replaceState(null, "", "/emails/E2");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const posts = () => calls.filter((c) => c.method === "POST");

describe("automatic checks (rules-only) in the investigation view", () => {
  it("is offered for a message without a recording and explains that no AI or Groq is involved", async () => {
    render(<App />);
    const button = await screen.findByRole("button", { name: /Run automatic checks/ });
    expect(button).toBeTruthy();
    expect(screen.getByText(/do not use AI, and nothing is sent to Groq/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Replay recorded analysis|Analyze with AI/ })).toBeNull();
    expect(posts()).toHaveLength(0); // nothing starts on its own
  });

  it("calls the dedicated endpoint (never reprocess), refreshes, and labels the result as rules-only", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Run automatic checks/ }));

    await waitFor(() => expect(screen.getAllByText("Automatic checks only").length).toBeGreaterThan(0));
    expect(posts().map((p) => p.url)).toEqual(["/api/emails/E2/automatic-checks"]);
    expect(posts().some((p) => /reprocess/.test(p.url))).toBe(false);
    expect(screen.queryByText("Analyzed by AI")).toBeNull();
    expect(screen.queryByText(/AI-assessed/)).toBeNull();
    expect(screen.getByText(/No AI was used and nothing was sent to an AI provider/)).toBeTruthy();
    // the action is gone once done; a message with no AI assessment is never shown as safe
    expect(screen.queryByRole("button", { name: /Run automatic checks/ })).toBeNull();
    expect(document.querySelector('[data-level="none"]')).toBeNull();
  });

  it("keeps the recorded replay for a recorded message and offers no automatic-checks action there", async () => {
    window.history.replaceState(null, "", "/emails/E1");
    render(<App />);
    expect(await screen.findByRole("button", { name: /Replay recorded analysis/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Run automatic checks/ })).toBeNull();
  });

  it("is not offered over a completed assessment", async () => {
    details.E2 = assessedDetail({ provenance: "recorded" });
    health = HEALTH_AI;
    details.E2 = { ...details.E2, email: { ...details.E2.email, id: "E2" } };
    render(<App />);
    await screen.findAllByText(/Recorded|Analyzed by AI/);
    expect(screen.queryByRole("button", { name: /Run automatic checks/ })).toBeNull();
  });

  it("with live AI configured the primary action is still the AI one and no rules-only button competes", async () => {
    health = HEALTH_AI;
    render(<App />);
    expect(await screen.findByRole("button", { name: /Analyze with AI/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Run automatic checks/ })).toBeNull();
  });

  it("shows the server's refusal and leaves the message as it was", async () => {
    automaticStatus = 409;
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Run automatic checks/ }));
    expect(await screen.findByText(/This message has already been analyzed. Nothing was changed; showing its current state./)).toBeTruthy();
    expect(screen.queryByText(/No AI was used and nothing was sent to an AI provider/)).toBeNull();
  });

  it("an AI-failure 'degraded' result is not mislabelled as an automatic-checks run", async () => {
    details.E2 = detail({
      email: { ...detail().email, id: "E2" },
      processing: {
        ...processing({ status: "degraded", analysis_mode: "degraded", provenance: "rules", run_count: 1 }),
        warnings: [],
        runs: [],
      },
    });
    render(<App />);
    expect((await screen.findAllByText("AI analysis was not available")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/No AI was used and nothing was sent to an AI provider/)).toBeNull();
  });
});

describe("automatic checks in the knowledge graph", () => {
  it("counts rules-only messages separately and never calls their people AI-identified", async () => {
    const person = {
      id: "person:email:billing@northgate-suppliers.com",
      type: "person" as const,
      label: "billing@northgate-suppliers.com",
      origin: "rules" as const,
      key_basis: "email_address",
      email_ids: ["E004", "E009"],
      mention_count: 2,
      max_risk: "unassessed" as const,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ method: init?.method ?? "GET", url });
        const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
        if (url.startsWith("/api/health")) return json(health);
        if (url.startsWith("/api/graph")) {
          return json({ nodes: [person], edges: [], meta: { email_count: 2, node_count: 1, edge_count: 0, basis: "b" } });
        }
        return json(
          listResponse([
            listItem("E004", "unassessed"),
            listItem("E009", "unassessed", {
              processing: processing({ status: "degraded", analysis_mode: "degraded", provenance: "rules", automatic_checks_only: true }),
            }),
          ]),
        );
      }),
    );
    window.history.replaceState(null, "", "/graph?node=" + encodeURIComponent(person.id));
    render(<App />);
    expect(await screen.findByText(/1 with automatic checks only \(people from the headers; no AI relationships\)/)).toBeTruthy();
    const inspector = await screen.findByRole("complementary", { name: "Entity details" });
    expect(inspector.textContent).not.toMatch(/AI-identified/);
    expect(inspector.textContent).toMatch(/Automatic/);
    expect(posts()).toHaveLength(0);
  });
});
