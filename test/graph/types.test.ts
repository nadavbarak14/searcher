import { describe, it, expectTypeOf } from "vitest";
import type { ResearchNode, GraphIndex, Anchor, NodeKind } from "../../src/graph/types.js";

describe("graph types", () => {
  it("ResearchNode has the expected shape", () => {
    const node: ResearchNode = {
      id: "n_1",
      kind: "finding",
      parents: ["topic"],
      anchor: { text: "transfer", offset: 10, occurrence: 1 },
      question: "Why do adversarial examples transfer?",
      sources: ["https://example.com"],
      created: "2026-06-02T18:30:00.000Z",
      body: "Because models learn similar features.",
    };
    expectTypeOf(node.kind).toEqualTypeOf<NodeKind>();
    expectTypeOf(node.anchor).toEqualTypeOf<Anchor | undefined>();
  });

  it("topic node may omit anchor", () => {
    const topic: ResearchNode = {
      id: "topic",
      kind: "topic",
      parents: [],
      question: "AI security",
      sources: [],
      created: "2026-06-02T18:30:00.000Z",
      body: "",
    };
    expectTypeOf(topic).toEqualTypeOf<ResearchNode>();
  });

  it("GraphIndex tracks nextSeq and node metas", () => {
    const index: GraphIndex = {
      topic: "AI security",
      nextSeq: 1,
      nodes: [{ id: "topic", kind: "topic", parents: [], question: "AI security", created: "2026-06-02T18:30:00.000Z" }],
    };
    expectTypeOf(index.nextSeq).toEqualTypeOf<number>();
  });
});
