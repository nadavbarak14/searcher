import { describe, it, expect } from "vitest";
import { segmentSentences, wordRangeAt } from "./speech";

describe("segmentSentences", () => {
  it("splits on terminal punctuation followed by a capitalized next sentence", () => {
    const text = "The cat sat. The dog ran.";
    expect(segmentSentences(text)).toEqual([
      { start: 0, end: 12 },
      { start: 13, end: 25 },
    ]);
  });

  it("keeps trailing text with no terminal punctuation as a final sentence", () => {
    expect(segmentSentences("Hello world")).toEqual([{ start: 0, end: 11 }]);
  });

  it("does not split lowercase abbreviations like e.g.", () => {
    const text = "See e.g. the case works. Next.";
    expect(segmentSentences(text)).toEqual([
      { start: 0, end: 24 },
      { start: 25, end: 30 },
    ]);
  });

  it("handles multiple punctuation marks", () => {
    expect(segmentSentences("Wait!! Really?")).toEqual([
      { start: 0, end: 6 },
      { start: 7, end: 14 },
    ]);
  });

  it("returns [] for empty string", () => {
    expect(segmentSentences("")).toEqual([]);
  });

  it("splits around curly quotes (opening and closing)", () => {
    expect(segmentSentences("A cat sat. “Then it ran.”")).toEqual([
      { start: 0, end: 10 },
      { start: 11, end: 25 },
    ]);
  });

  it("returns [] for whitespace-only text", () => {
    expect(segmentSentences("   ")).toEqual([]);
  });
});

describe("wordRangeAt", () => {
  it("returns the whitespace-delimited word containing the index", () => {
    expect(wordRangeAt("the quick brown", 6)).toEqual({ start: 4, end: 9 });
  });
  it("works at the start of the string", () => {
    expect(wordRangeAt("the quick brown", 0)).toEqual({ start: 0, end: 3 });
  });
  it("returns an empty range when the index is on whitespace", () => {
    expect(wordRangeAt("the quick", 3)).toEqual({ start: 3, end: 3 });
  });
  it("returns an empty range when the index is out of bounds", () => {
    expect(wordRangeAt("hi", 100)).toEqual({ start: 100, end: 100 });
  });
});
