import { describe, expect, it } from "vitest";
import { formatDateTime, formatDay } from "./format";

describe("date display", () => {
  it("labels every displayed date as UTC", () => {
    expect(formatDay("2026-06-09T02:15:00Z")).toBe("9 Jun 2026 UTC");
    expect(formatDateTime("2026-06-09T02:15:00Z")).toBe("9 Jun 2026, 02:15 UTC");
  });
  it("does not label a missing date", () => {
    expect(formatDay(null)).toBe("No date");
    expect(formatDateTime(null)).toBe("Date missing");
  });
});
