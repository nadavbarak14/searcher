import { describe, it, expect } from "vitest";
import { buildCanvas, type PendingNode, type DraftNode } from "./model";
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

  it("renders a draft child node and edge under its expanded parent", () => {
    const metas = [meta("topic", []), meta("n_1", ["topic"])];
    const { nodes, edges } = buildCanvas({
      metas, expanded: new Set(["topic", "n_1"]), bodies: { n_1: "body" },
      pending: [], positions: {},
      drafts: [{ id: "draft_0", parentId: "n_1", anchor: { text: "body", offset: 0, occurrence: 0 } }],
    });
    const draft = nodes.find((n) => n.id === "draft_0");
    expect(draft?.draft).toBe(true);
    expect(draft?.anchor?.text).toBe("body");
    expect(edges.some((e) => e.source === "n_1" && e.target === "draft_0")).toBe(true);
  });

  it("hides a draft whose parent is collapsed", () => {
    const metas = [meta("topic", []), meta("n_1", ["topic"])];
    const { nodes } = buildCanvas({
      metas, expanded: new Set(["topic"]), bodies: {}, pending: [], positions: {},
      drafts: [{ id: "draft_0", parentId: "n_1", anchor: { text: "x", offset: 0, occurrence: 0 } }],
    });
    expect(nodes.find((n) => n.id === "draft_0")).toBeUndefined();
  });

  it("attaches a parent's child-anchors for highlighting", () => {
    const metas: NodeMeta[] = [
      meta("topic", []),
      { ...meta("n_1", ["topic"]), anchor: { text: "span", offset: 0, occurrence: 0 } },
    ];
    const { nodes } = buildCanvas({
      metas, expanded: new Set(["topic"]), bodies: { topic: "" }, pending: [], positions: {}, drafts: [],
    });
    const topic = nodes.find((n) => n.id === "topic")!;
    expect(topic.anchors?.map((a) => a.text)).toEqual(["span"]);
  });

  it("dedupes child-anchors by key and includes draft anchors", () => {
    const metas = [meta("topic", []), meta("n_1", ["topic"])];
    const dup = { text: "span", offset: 0, occurrence: 0 };
    const { nodes } = buildCanvas({
      metas, expanded: new Set(["topic", "n_1"]), bodies: { n_1: "span here" }, pending: [], positions: {},
      drafts: [{ id: "draft_0", parentId: "n_1", anchor: dup }, { id: "draft_1", parentId: "n_1", anchor: dup }],
    });
    expect(nodes.find((n) => n.id === "n_1")!.anchors?.length).toBe(1);
  });
});
