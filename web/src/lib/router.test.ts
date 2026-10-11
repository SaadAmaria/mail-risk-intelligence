import { describe, expect, it } from "vitest";
import { buildUrl, DEFAULT_ROUTE, parseLocation } from "./router";

describe("parseLocation / buildUrl", () => {
  it("parses the mailbox root with defaults", () => {
    expect(parseLocation("/", "")).toEqual(DEFAULT_ROUTE);
  });

  it("parses a deep link with filters", () => {
    expect(parseLocation("/emails/E004", "?q=invoice&risk=medium,unassessed&status=degraded&order=asc&add=1")).toEqual({
      ...DEFAULT_ROUTE,
      emailId: "E004",
      q: "invoice",
      risk: ["medium", "unassessed"],
      status: ["degraded"],
      order: "asc",
      add: true,
    });
  });

  it("round-trips through buildUrl", () => {
    const state = { ...DEFAULT_ROUTE, emailId: "em_1 2", q: "north gate", risk: ["high"], status: [], order: "asc" as const, add: false };
    expect(parseLocation(...(buildUrl(state).split("?") as [string, string?]).map((x, i) => (i === 1 ? "?" + x : x)) as [string, string])).toEqual(state);
  });

  it("omits default values from the URL", () => {
    expect(buildUrl(DEFAULT_ROUTE)).toBe("/");
    expect(buildUrl({ ...DEFAULT_ROUTE, emailId: "E1" })).toBe("/emails/E1");
    expect(buildUrl({ ...DEFAULT_ROUTE, add: true })).toBe("/?add=1");
  });

  it("tolerates malformed escapes and unknown values", () => {
    expect(parseLocation("/emails/%E0%A4%A", "").emailId).toBeNull();
    expect(parseLocation("/emails/E1", "?order=sideways").order).toBe("desc");
  });

  it("parses and builds the graph page with its own parameters", () => {
    const r = parseLocation("/graph", "?node=organization%3Aname%3Anorthgate&view=list");
    expect(r).toMatchObject({ page: "graph", node: "organization:name:northgate", gview: "list", emailId: null });
    expect(buildUrl(r)).toBe("/graph?node=organization%3Aname%3Anorthgate&view=list");
    expect(buildUrl({ ...DEFAULT_ROUTE, page: "graph" })).toBe("/graph");
  });

  it("ignores graph parameters off the graph page and inbox parameters on it", () => {
    expect(parseLocation("/", "?node=x&view=list")).toMatchObject({ page: "inbox", node: null, gview: "graph" });
    expect(buildUrl({ ...DEFAULT_ROUTE, page: "graph", q: "invoice", risk: ["high"] })).toBe("/graph");
  });

  it("a message path wins over the page, so graph state never leaks into message URLs", () => {
    expect(buildUrl({ ...DEFAULT_ROUTE, page: "graph", node: "n1", emailId: "E004" })).toBe("/emails/E004");
  });

  it("does not treat other paths as an email route", () => {
    expect(parseLocation("/emails/", "").emailId).toBeNull();
    expect(parseLocation("/other/E1", "").emailId).toBeNull();
  });
});
