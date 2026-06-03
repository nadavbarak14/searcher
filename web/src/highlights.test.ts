import { describe, it, expect } from "vitest";
import { resolveRange, segmentBody, type Mark } from "./highlights";

const pending: Mark = { kind: "pending", label: "1", ref: "p1" };
const explored: Mark = { kind: "explored", label: "", ref: "n_2" };

describe("resolveRange", () => {
  it("finds the Nth occurrence", () => {
    expect(resolveRange("ab ab ab", { text: "ab", offset: 0, occurrence: 2 })).toEqual([3, 5]);
  });
  it("returns null when not found", () => {
    expect(resolveRange("abc", { text: "zzz", offset: 0, occurrence: 1 })).toBeNull();
  });
});

describe("segmentBody", () => {
  it("splits body and marks the anchored spans", () => {
    const segs = segmentBody("DNS spoofing is bad", [
      { anchor: { text: "spoofing", offset: 4, occurrence: 1 }, mark: pending },
    ]);
    expect(segs).toEqual([
      { text: "DNS " },
      { text: "spoofing", mark: pending },
      { text: " is bad" },
    ]);
  });
  it("orders multiple marks and skips unresolved anchors", () => {
    const segs = segmentBody("alpha beta gamma", [
      { anchor: { text: "gamma", offset: 11, occurrence: 1 }, mark: explored },
      { anchor: { text: "alpha", offset: 0, occurrence: 1 }, mark: pending },
      { anchor: { text: "missing", offset: 0, occurrence: 1 }, mark: pending },
    ]);
    expect(segs.map((s) => s.mark?.ref ?? null)).toEqual(["p1", null, "n_2"]);
    expect(segs.map((s) => s.text).join("")).toBe("alpha beta gamma");
  });
  it("drops overlapping later marks (earlier start wins)", () => {
    const segs = segmentBody("abcdef", [
      { anchor: { text: "abcd", offset: 0, occurrence: 1 }, mark: pending },
      { anchor: { text: "cdef", offset: 2, occurrence: 1 }, mark: explored },
    ]);
    expect(segs).toEqual([{ text: "abcd", mark: pending }, { text: "ef" }]);
  });
});
