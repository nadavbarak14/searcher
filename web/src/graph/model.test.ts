import { describe, it, expect } from "vitest";
import { buildCanvas, type PendingNode } from "./model";
import type { NodeMeta } from "../types";

const meta = (id: string, parents: string[]): NodeMeta => ({
  id,
  kind: id === "topic" ? "topic" : "finding",
  parents,
  question: id,
  created: "",
});
const metas = [meta("topic", []), meta("n_1", ["topic"]), meta("n_2", ["n_1"])];

describe("buildCanvas", () => {
  it("shows every non-pruned node (the whole graph is a map)", () => {
    const out = buildCanvas({ metas, pending: [], positions: {} });
    expect(out.nodes.map((n) => n.id).sort()).toEqual(["n_1", "n_2", "topic"]);
    expect(out.edges).toContainEqual(expect.objectContaining({ source: "topic", target: "n_1" }));
    expect(out.edges).toContainEqual(expect.objectContaining({ source: "n_1", target: "n_2" }));
  });

  it("includes pending nodes under their parent with a labelled edge", () => {
    const pending: PendingNode[] = [{ id: "pending_1", parentId: "topic", question: "why?" }];
    const out = buildCanvas({ metas, pending, positions: {} });
    const pn = out.nodes.find((n) => n.id === "pending_1");
    expect(pn?.pending).toBe(true);
    expect(pn?.parentId).toBe("topic");
    expect(out.edges).toContainEqual(expect.objectContaining({ source: "topic", target: "pending_1", label: "why?" }));
  });

  it("carries saved position and counts direct children", () => {
    const out = buildCanvas({ metas, pending: [], positions: { n_1: { x: 9, y: 9 } } });
    expect(out.nodes.find((n) => n.id === "n_1")?.position).toEqual({ x: 9, y: 9 });
    expect(out.nodes.find((n) => n.id === "topic")?.childCount).toBe(1);
    expect(out.nodes.find((n) => n.id === "n_1")?.childCount).toBe(1); // n_2 branches off n_1
  });

  it("omits a pruned node, its subtree, and its contribution to the child count", () => {
    const out = buildCanvas({ metas, pruned: new Set(["n_1"]), pending: [], positions: {} });
    const ids = out.nodes.map((n) => n.id);
    expect(ids).not.toContain("n_1");
    expect(ids).not.toContain("n_2"); // edge to a pruned parent drops; n_2 has no visible parent
    expect(out.nodes.find((n) => n.id === "topic")?.childCount).toBe(0);
  });

  it("attaches a parent's child links (anchor + jump target) for the panel", () => {
    const withAnchor: NodeMeta[] = [
      meta("topic", []),
      { ...meta("n_1", ["topic"]), anchor: { text: "span", offset: 0, occurrence: 0 } },
    ];
    const { nodes } = buildCanvas({ metas: withAnchor, pending: [], positions: {} });
    const topic = nodes.find((n) => n.id === "topic")!;
    expect(topic.childLinks).toEqual([{ anchor: { text: "span", offset: 0, occurrence: 0 }, childId: "n_1", childTitle: "n_1" }]);
  });

  it("dedupes child links by anchor key", () => {
    const dup = { text: "span", offset: 0, occurrence: 0 };
    const withDup: NodeMeta[] = [
      meta("topic", []),
      { ...meta("n_1", ["topic"]), anchor: dup },
      { ...meta("n_2", ["topic"]), anchor: dup },
    ];
    const { nodes } = buildCanvas({ metas: withDup, pending: [], positions: {} });
    expect(nodes.find((n) => n.id === "topic")!.childLinks?.length).toBe(1);
  });

  it("uses plain node→node edges (no per-span source handles)", () => {
    const withAnchor: NodeMeta[] = [
      meta("topic", []),
      { ...meta("n_1", ["topic"]), anchor: { text: "span", offset: 0, occurrence: 0 } },
    ];
    const { edges } = buildCanvas({ metas: withAnchor, pending: [], positions: {} });
    const e = edges.find((x) => x.target === "n_1")!;
    expect(e).not.toHaveProperty("sourceHandle");
  });
});
