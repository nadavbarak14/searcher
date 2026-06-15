import { describe, it, expect } from "vitest";
import { findNodeAtOffset } from "./range";

describe("findNodeAtOffset", () => {
  it("finds an offset inside the first node", () => {
    expect(findNodeAtOffset([5, 5, 5], 3)).toEqual({ index: 0, local: 3 });
  });
  it("finds an offset that falls into a later node", () => {
    expect(findNodeAtOffset([5, 5, 5], 7)).toEqual({ index: 1, local: 2 });
  });
  it("clamps an offset past the end to the last node", () => {
    expect(findNodeAtOffset([5, 5, 5], 100)).toEqual({ index: 2, local: 5 });
  });
  it("maps a boundary offset to the end of the earlier node, not the start of the next", () => {
    expect(findNodeAtOffset([5, 5], 5)).toEqual({ index: 0, local: 5 });
  });
  it("handles an empty list", () => {
    expect(findNodeAtOffset([], 3)).toEqual({ index: 0, local: 0 });
  });
});
