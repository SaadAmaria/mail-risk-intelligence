import { describe, expect, it } from "vitest";
import { buildRuns, findQuoteIn, isValidRange, locateCitedQuote } from "./highlight";

const TEXT = "Please wire $48,200 to the new account ending 7731 today. Keep this confidential.";

describe("isValidRange", () => {
  it("accepts a range whose text is exactly the expected text", () => {
    expect(isValidRange(TEXT, 7, 11, "wire")).toBe(true);
  });

  it.each([
    ["wrong text at the offsets", 0, 4, "wire"],
    ["end beyond the text", 70, 500, "x"],
    ["negative start", -1, 3, "Ple"],
    ["empty range", 5, 5, ""],
    ["reversed range", 9, 3, "wire"],
    ["fractional", 1.5, 4, "lea"],
  ])("rejects %s", (_l, s, e, expected) => {
    expect(isValidRange(TEXT, s as number, e as number, expected as string)).toBe(false);
  });
});

describe("findQuoteIn", () => {
  it("finds a quote ignoring case and whitespace differences", () => {
    const r = findQuoteIn(TEXT, "keep   THIS\nconfidential")!;
    expect(TEXT.slice(r.start, r.end)).toBe("Keep this confidential");
  });
  it("does not match different wording or an empty quote", () => {
    expect(findQuoteIn(TEXT, "keep this secret")).toBeNull();
    expect(findQuoteIn(TEXT, "   ")).toBeNull();
  });
  it("treats regex characters in a quote literally", () => {
    expect(findQuoteIn("cost (approx.) $5+", "(approx.) $5+")).not.toBeNull();
    expect(findQuoteIn("cost approx", ".*")).toBeNull();
  });
});

describe("locateCitedQuote", () => {
  const snippetText = "Please wire $48,200 to the new account ending 7731 today.";
  const loc = { start: 0, end: snippetText.length };

  it("returns the exact range of the quote within the segment", () => {
    const r = locateCitedQuote(TEXT, loc, snippetText, "new account ending 7731")!;
    expect(TEXT.slice(r.start, r.end)).toBe("new account ending 7731");
  });

  it("returns null when the snippet is not actually at its recorded location", () => {
    expect(locateCitedQuote(TEXT, { start: 10, end: 10 + snippetText.length }, snippetText, "new account")).toBeNull();
  });

  it("returns null when the quote is not inside the snippet (never highlights the whole snippet)", () => {
    expect(locateCitedQuote(TEXT, loc, snippetText, "Keep this confidential")).toBeNull();
  });

  it("returns null for out-of-range locations", () => {
    expect(locateCitedQuote(TEXT, { start: 0, end: 9999 }, snippetText, "wire")).toBeNull();
  });

  it("works for a snippet that does not start at offset 0", () => {
    const snip = "Keep this confidential.";
    const start = TEXT.indexOf(snip);
    const r = locateCitedQuote(TEXT, { start, end: start + snip.length }, snip, "this confidential")!;
    expect(TEXT.slice(r.start, r.end)).toBe("this confidential");
  });
});

describe("buildRuns", () => {
  it("returns the text unchanged when there is nothing to highlight", () => {
    expect(buildRuns("hello", [])).toEqual([{ text: "hello", claims: [] }]);
  });

  it("always concatenates back to the original text", () => {
    const runs = buildRuns(TEXT, [
      { start: 7, end: 19, claimId: "a" },
      { start: 10, end: 30, claimId: "b" },
      { start: 60, end: 72, claimId: "c" },
    ]);
    expect(runs.map((r) => r.text).join("")).toBe(TEXT);
  });

  it("merges overlaps and lists every claim on the overlapping part", () => {
    const runs = buildRuns("0123456789", [
      { start: 2, end: 6, claimId: "a" },
      { start: 4, end: 8, claimId: "b" },
    ]);
    expect(runs).toEqual([
      { text: "01", claims: [] },
      { text: "23", claims: ["a"] },
      { text: "45", claims: ["a", "b"] },
      { text: "67", claims: ["b"] },
      { text: "89", claims: [] },
    ]);
  });

  it("ignores invalid ranges instead of marking the wrong words", () => {
    const runs = buildRuns("abcdef", [
      { start: -2, end: 3, claimId: "x" },
      { start: 4, end: 99, claimId: "y" },
      { start: 3, end: 3, claimId: "z" },
    ]);
    expect(runs).toEqual([{ text: "abcdef", claims: [] }]);
  });
});
