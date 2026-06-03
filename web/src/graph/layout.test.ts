import { describe, it, expect } from "vitest";
import { layoutNodes } from "./layout";
import type { NodeMeta } from "../types";

const meta = (id: string, parents: string[]): NodeMeta => ({
  id,
  kind: id === "topic" ? "topic" : "finding",
  parents,
  question: id,
  created: "",
});

describe("layoutNodes", () => {
  it("puts the topic at row 0 and children on deeper rows", () => {
    const pos = layoutNodes([meta("topic", []), meta("n_1", ["topic"]), meta("n_2", ["topic"])]);
    expect(pos.topic.y).toBe(0);
    expect(pos.n_1.y).toBeGreaterThan(0);
    expect(pos.n_2.y).toBe(pos.n_1.y); // siblings share a row
    expect(pos.n_1.x).not.toBe(pos.n_2.x); // and are spread horizontally
  });

  it("assigns a position to every node, deeper for grandchildren", () => {
    const pos = layoutNodes([meta("topic", []), meta("n_1", ["topic"]), meta("n_2", ["n_1"])]);
    expect(Object.keys(pos).sort()).toEqual(["n_1", "n_2", "topic"]);
    expect(pos.n_2.y).toBeGreaterThan(pos.n_1.y);
  });

  it("does not loop forever on a cycle", () => {
    const pos = layoutNodes([meta("a", ["b"]), meta("b", ["a"])]);
    expect(Object.keys(pos).sort()).toEqual(["a", "b"]);
  });
});
