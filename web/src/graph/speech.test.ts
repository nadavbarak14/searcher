import { describe, it, expect } from "vitest";
import { segmentSentences } from "./speech";

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
});
