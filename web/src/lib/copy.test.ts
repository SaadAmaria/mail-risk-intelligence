import { describe, expect, it } from "vitest";
import { ANALYSIS_STATUSES, type ProcessingStatus } from "@mri/shared";
import { aiConnection, basisChip, basisLine, errorMessage, RECORDED_NOTICE, RISK_LABEL, statusCopy } from "./copy";

describe("risk wording", () => {
  it("never calls an unassessed message 'none' or 'safe'", () => {
    expect(RISK_LABEL.unassessed).toBe("Not assessed");
    for (const text of Object.values(RISK_LABEL)) expect(text.toLowerCase()).not.toContain("safe");
    expect(RISK_LABEL.unassessed).not.toBe(RISK_LABEL.none);
  });

  it("labels a rules-only level as automatic checks, never as an AI assessment", () => {
    expect(basisChip("rules_only")).toEqual({ text: "Automatic checks only", kind: "rules" });
    expect(basisLine({ basis: "rules_only", ai_level: null, rules_level: "medium", assessed: false })).toMatch(
      /not been assessed by AI/,
    );
    expect(basisChip("unassessed").kind).toBe("none");
  });

  it("describes an AI-assessed level with both sources", () => {
    expect(basisLine({ basis: "ai_and_rules", ai_level: "high", rules_level: "medium", assessed: true })).toBe(
      "Assessed by AI (high) and checked by automatic rules (medium).",
    );
  });
});

describe("processing wording", () => {
  const all: ProcessingStatus[] = ["not_started", ...ANALYSIS_STATUSES];

  it("has plain-language copy for every status", () => {
    for (const s of all) {
      const c = statusCopy(s, true);
      expect(c.title.length).toBeGreaterThan(3);
      expect(c.detail.length).toBeGreaterThan(10);
    }
  });

  it("only 'complete' is presented as analyzed by AI", () => {
    const analyzed = all.filter((s) => /analyzed by ai/i.test(statusCopy(s, true).title));
    expect(analyzed).toEqual(["complete"]);
  });

  it("explains partial, degraded and failed as not assessed / not AI", () => {
    expect(statusCopy("partial", true).detail).toMatch(/not assessed/);
    expect(statusCopy("degraded", true).detail).toMatch(/not an AI assessment/);
    expect(statusCopy("failed", true).detail).toMatch(/not assessed/);
  });

  it("says nothing was sent to the AI before analysis is requested", () => {
    expect(statusCopy("not_started", true).detail).toMatch(/Nothing has been sent to the AI/);
    expect(statusCopy("not_started", false).detail).toMatch(/not configured/);
  });
});

describe("AI connection and errors", () => {
  it("reports only what was observed", () => {
    const base = { configured: true, provider: "api.groq.com", model: "m" } as const;
    expect(aiConnection({ ...base, reachability: "unchecked" }).text).toMatch(/not used yet/);
    expect(aiConnection({ ...base, reachability: "reachable" }).text).toBe("AI reachable");
    expect(aiConnection({ ...base, reachability: "unreachable" }).tone).toBe("warn");
    expect(aiConnection({ configured: false, provider: null, model: null }).text).toMatch(/not configured/);
  });

  it("maps known error codes to friendly text and falls back to the server message", () => {
    expect(errorMessage("ocr_unsupported", "x")).toMatch(/scanned image/);
    expect(errorMessage("something_new", "Server said this")).toBe("Server said this");
  });
});

describe("recorded provenance wording", () => {
  it("never lets a replay read as a live call", () => {
    expect(basisChip("ai_and_rules", "recorded").text).toBe("AI-assessed — Recorded");
    expect(basisChip("ai_and_rules", "live").text).toBe("AI-assessed — Live");
    expect(basisChip("rules_only", "rules").text).toBe("Automatic checks only");
  });

  it("explains that a replay sends nothing, before and after", () => {
    expect(statusCopy("not_started", false, { mode: "recorded" }).detail).toMatch(/recorded AI analysis/);
    expect(RECORDED_NOTICE).toMatch(/No email is sent to an AI provider/);
    const done = statusCopy("complete", false, { provenance: "recorded" });
    expect(done.title).toMatch(/recorded/);
    expect(done.detail).toMatch(/No email was sent to an AI provider/);
  });

  it("describes recorded availability without claiming reachability", () => {
    const off = { configured: false, provider: null, model: null };
    const text = aiConnection(off, { available: true, email_ids: ["E1"], model: "m", captured_at: null, problems: [] }).text;
    expect(text).toBe("Recorded AI Replay");
    expect(text).not.toMatch(/reachable/i);
    expect(aiConnection(off).text).toMatch(/not configured/);
  });
});
