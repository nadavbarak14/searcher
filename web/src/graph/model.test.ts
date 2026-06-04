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
  it("topic is always visible; children only when their parent is expanded", () => {
    const collapsed = buildCanvas({ metas, expanded: new Set(), bodies: {}, pending: [], positions: {} });
    expect(collapsed.nodes.map((n) => n.id)).toEqual(["topic"]);

    const open = buildCanvas({ metas, expanded: new Set(["topic"]), bodies: {}, pending: [], positions: {} });
    expect(open.nodes.map((n) => n.id).sort()).toEqual(["n_1", "topic"]);
    expect(open.edges).toContainEqual(expect.objectContaining({ source: "topic", target: "n_1" }));
  });

  it("hides grandchildren until the intermediate node is also expanded", () => {
    const open = buildCanvas({ metas, expanded: new Set(["topic"]), bodies: {}, pending: [], positions: {} });
    expect(open.nodes.map((n) => n.id)).not.toContain("n_2");
    const both = buildCanvas({ metas, expanded: new Set(["topic", "n_1"]), bodies: {}, pending: [], positions: {} });
    expect(both.nodes.map((n) => n.id)).toContain("n_2");
  });

  it("includes pending nodes under an expanded parent with a labelled edge", () => {
    const pending: PendingNode[] = [{ id: "pending_1", parentId: "topic", question: "why?" }];
    const out = buildCanvas({ metas, expanded: new Set(["topic"]), bodies: {}, pending, positions: {} });
    const pn = out.nodes.find((n) => n.id === "pending_1");
    expect(pn?.pending).toBe(true);
    expect(pn?.parentId).toBe("topic");
    expect(out.edges).toContainEqual(expect.objectContaining({ source: "topic", target: "pending_1", label: "why?" }));
  });

  it("hides a pending node whose parent is collapsed", () => {
    const pending: PendingNode[] = [{ id: "pending_1", parentId: "topic", question: "why?" }];
    const out = buildCanvas({ metas, expanded: new Set(), bodies: {}, pending, positions: {} });
    expect(out.nodes.find((n) => n.id === "pending_1")).toBeUndefined();
  });

  it("carries body + saved position when present", () => {
    const out = buildCanvas({ metas, expanded: new Set(["topic"]), bodies: { n_1: "BODY" }, pending: [], positions: { n_1: { x: 9, y: 9 } } });
    const n1 = out.nodes.find((n) => n.id === "n_1")!;
    expect(n1.body).toBe("BODY");
    expect(n1.position).toEqual({ x: 9, y: 9 });
  });

  it("carries sources when present and counts direct children on the topic", () => {
    const out = buildCanvas({
      metas,
      expanded: new Set(["topic"]),
      bodies: {},
      sources: { n_1: ["https://a", "https://b"] },
      pending: [],
      positions: {},
    });
    expect(out.nodes.find((n) => n.id === "n_1")?.sources).toEqual(["https://a", "https://b"]);
    expect(out.nodes.find((n) => n.id === "topic")?.childCount).toBe(1); // n_1 branches off topic
  });

  it("omits a pruned node, its subtree, and its contribution to the child count", () => {
    const out = buildCanvas({
      metas,
      expanded: new Set(["topic", "n_1"]),
      bodies: {},
      pruned: new Set(["n_1"]),
      pending: [],
      positions: {},
    });
    const ids = out.nodes.map((n) => n.id);
    expect(ids).not.toContain("n_1");
    expect(ids).not.toContain("n_2"); // child of the pruned node is hidden too
    expect(out.nodes.find((n) => n.id === "topic")?.childCount).toBe(0);
  });
});
