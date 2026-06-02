import { describe, it, expect } from "vitest";
import { computeAnchor } from "./anchor";

describe("computeAnchor", () => {
  it("finds offset and occurrence=1 for a unique selection", () => {
    const body = "Adversarial examples fool models.";
    expect(computeAnchor(body, "fool", body.indexOf("fool"))).toEqual({ text: "fool", offset: 21, occurrence: 1 });
  });
  it("computes occurrence for a repeated selection by the fromIndex", () => {
    const body = "models and more models here";
    const second = body.indexOf("models", 7);
    expect(computeAnchor(body, "models", second)).toEqual({ text: "models", offset: second, occurrence: 2 });
  });
  it("falls back to occurrence 1 / offset 0 when not found", () => {
    expect(computeAnchor("abc", "xyz", 0)).toEqual({ text: "xyz", offset: 0, occurrence: 1 });
  });
});
