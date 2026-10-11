import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, api } from "./api";

afterEach(() => vi.unstubAllGlobals());

const respond = (status: number, body?: unknown) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body === undefined ? "" : JSON.stringify(body), { status })));

describe("api client", () => {
  it("keeps the server's stable error code and message", async () => {
    respond(409, { error: { code: "already_processing", message: "busy" } });
    await expect(api.reprocess("E1")).rejects.toMatchObject({ status: 409, code: "already_processing", message: "busy" });
  });

  it("reports an unresponsive API when a gateway error has no API body", async () => {
    respond(500);
    const err = await api.listEmails().catch((e) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.code).toBe("server_unavailable");
  });

  it("maps a network failure to network_error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("failed"))));
    await expect(api.getEmail("E1")).rejects.toMatchObject({ code: "network_error" });
  });

  it("only reads on list and detail; analysis is a separate explicit POST", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ emails: [], total: 0, count: 0 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await api.listEmails({ q: "invoice", risk: ["high"], order: "asc", limit: 5 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("GET");
    expect(url).toBe("/api/emails?q=invoice&risk=high&order=asc&limit=5");
  });

  it("never asks for analysis unless told to", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "x" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await api.addPaste("hello", false);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ raw_text: "hello", analyze: false });
  });
});
