import { describe, it, expect } from "vitest";
import { anchorKey, anchorFromSelection, locateAnchor } from "./anchor";

describe("anchorFromSelection", () => {
  it("records text, offset, and 0-based occurrence", () => {
    const body = "alpha beta alpha gamma";
    // second "alpha" starts at index 11
    const a = anchorFromSelection(body, "alpha", 11);
    expect(a).toEqual({ text: "alpha", offset: 11, occurrence: 1 });
  });
  it("treats the first match as occurrence 0", () => {
    expect(anchorFromSelection("one two", "one", 0)).toEqual({ text: "one", offset: 0, occurrence: 0 });
  });
});

describe("locateAnchor", () => {
  it("finds the occurrence-th match", () => {
    const body = "alpha beta alpha gamma";
    expect(locateAnchor(body, { text: "alpha", offset: 11, occurrence: 1 })).toEqual({ start: 11, end: 16 });
  });
  it("falls back to offset when occurrence is gone but offset still matches", () => {
    const body = "xx alpha yy";
    expect(locateAnchor(body, { text: "alpha", offset: 3, occurrence: 5 })).toEqual({ start: 3, end: 8 });
  });
  it("returns null when the text is absent", () => {
    expect(locateAnchor("nothing here", { text: "zzz", offset: 0, occurrence: 0 })).toBeNull();
  });
});

describe("anchorKey", () => {
  it("is stable per (occurrence, offset)", () => {
    expect(anchorKey({ text: "x", offset: 11, occurrence: 1 })).toBe("a1_11");
  });
});
