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
  it("puts the topic at x=0 and children in deeper columns to the right", () => {
    const pos = layoutNodes([meta("topic", []), meta("n_1", ["topic"]), meta("n_2", ["topic"])]);
    expect(pos.topic.x).toBe(0);
    expect(pos.n_1.x).toBeGreaterThan(0);
    expect(pos.n_2.x).toBe(pos.n_1.x); // siblings share a column (x)
    expect(pos.n_1.y).not.toBe(pos.n_2.y); // and are spread vertically
  });

  it("places a grandchild in a column further right than its parent", () => {
    const pos = layoutNodes([meta("topic", []), meta("n_1", ["topic"]), meta("n_2", ["n_1"])]);
    expect(pos.n_2.x).toBeGreaterThan(pos.n_1.x);
  });

  it("does not loop forever on a cycle", () => {
    const pos = layoutNodes([meta("a", ["b"]), meta("b", ["a"])]);
    expect(Object.keys(pos).sort()).toEqual(["a", "b"]);
  });
});
