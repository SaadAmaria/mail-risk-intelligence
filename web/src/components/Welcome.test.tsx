import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Welcome, pickForReview } from "./Welcome";
import { listItem, listResponse } from "../test/fixtures";

afterEach(cleanup);

describe("pickForReview", () => {
  it("puts flagged messages first, then not-assessed, then no-risk, newest first", () => {
    const items = [
      listItem("none", "none", { date: "2026-06-09T00:00:00Z" }),
      listItem("un", "unassessed", { date: "2026-06-08T00:00:00Z" }),
      listItem("med-old", "medium", { date: "2026-06-01T00:00:00Z" }),
      listItem("high", "high", { date: "2026-06-02T00:00:00Z" }),
      listItem("med-new", "medium", { date: "2026-06-05T00:00:00Z" }),
    ];
    expect(pickForReview(items).map((e) => e.id)).toEqual(["high", "med-new", "med-old", "un", "none"]);
  });

  it("never shows more than five", () => {
    const items = Array.from({ length: 9 }, (_, i) => listItem(`e${i}`, "medium"));
    expect(pickForReview(items)).toHaveLength(5);
  });
});

describe("Welcome", () => {
  it("links to real messages, never claims an unassessed one is safe, and opens nothing by itself", () => {
    window.history.replaceState(null, "", "/");
    render(
      <Welcome
        overview={listResponse([listItem("E1", "unassessed"), listItem("E2", "medium")])}
        loading={false}
        aiConfigured
        onAdd={() => {}}
      />,
    );
    const link = screen.getByText("Subject E2").closest("a");
    expect(link?.getAttribute("href")).toBe("/emails/E2");
    expect(document.querySelector('[data-level="none"]')).toBeNull();
    expect(screen.getByText(/1 flagged by automatic checks · 1 not assessed/)).toBeTruthy();
    expect(window.location.pathname).toBe("/");
  });

  it("says when the list is capped and when the mailbox is empty", () => {
    const { unmount } = render(
      <Welcome overview={{ emails: [listItem("E1", "high")], total: 800, count: 1 }} loading={false} aiConfigured onAdd={() => {}} />,
    );
    expect(screen.getByText(/From the newest 1 messages/)).toBeTruthy();
    unmount();
    render(<Welcome overview={listResponse([])} loading={false} aiConfigured onAdd={() => {}} />);
    expect(screen.getByText("The mailbox has no messages yet.")).toBeTruthy();
  });
});
