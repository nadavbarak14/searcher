import { describe, it, expect } from "vitest";
import { highlightSegments } from "./highlight";

describe("highlightSegments", () => {
  it("returns one plain segment when there are no anchors", () => {
    expect(highlightSegments("hello world", [])).toEqual([{ text: "hello world", keys: [] }]);
  });
  it("splits a single mid-body anchor into plain/marked/plain", () => {
    const segs = highlightSegments("aa BB cc", [{ text: "BB", offset: 3, occurrence: 0 }]);
    expect(segs).toEqual([
      { text: "aa ", keys: [] },
      { text: "BB", keys: ["a0_3"] },
      { text: " cc", keys: [] },
    ]);
  });
  it("tags an overlapping region with both keys", () => {
    // "abcd": anchor1 = "abc"@0, anchor2 = "bcd"@1 → middle "bc" carries both
    const segs = highlightSegments("abcd", [
      { text: "abc", offset: 0, occurrence: 0 },
      { text: "bcd", offset: 1, occurrence: 0 },
    ]);
    expect(segs).toEqual([
      { text: "a", keys: ["a0_0"] },
      { text: "bc", keys: ["a0_0", "a0_1"] },
      { text: "d", keys: ["a0_1"] },
    ]);
  });
  it("drops anchors whose text is gone", () => {
    expect(highlightSegments("only this", [{ text: "missing", offset: 0, occurrence: 0 }]))
      .toEqual([{ text: "only this", keys: [] }]);
  });
});
