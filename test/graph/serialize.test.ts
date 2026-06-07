import { describe, it, expect } from "vitest";
import { nodeToMarkdown, markdownToNode } from "../../src/graph/serialize.js";
import type { ResearchNode } from "../../src/graph/types.js";

const node: ResearchNode = {
  id: "n_1",
  kind: "finding",
  parents: ["topic"],
  anchor: { text: "transfer across models", offset: 412, occurrence: 1 },
  question: "Why do adversarial examples transfer?",
  sources: ["https://example.com/a"],
  created: "2026-06-02T18:30:00.000Z",
  body: "Because models converge on similar decision boundaries.",
};

describe("serialize", () => {
  it("round-trips a finding node through markdown", () => {
    const md = nodeToMarkdown(node);
    const parsed = markdownToNode("n_1", md);
    expect(parsed).toEqual(node);
  });

  it("emits frontmatter then body", () => {
    const md = nodeToMarkdown(node);
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("Because models converge");
  });

  it("round-trips a topic node with no anchor and empty body", () => {
    const topic: ResearchNode = {
      id: "topic",
      kind: "topic",
      parents: [],
      question: "AI security",
      sources: [],
      created: "2026-06-02T18:30:00.000Z",
      body: "",
    };
    const parsed = markdownToNode("topic", nodeToMarkdown(topic));
    expect(parsed).toEqual(topic);
    expect(parsed.anchor).toBeUndefined();
  });

  it("uses the id argument, not any id in the frontmatter", () => {
    const md = nodeToMarkdown(node);
    const parsed = markdownToNode("n_99", md);
    expect(parsed.id).toBe("n_99");
  });

  it("round-trips a multi-line body", () => {
    const n = { ...node, body: "First paragraph.\n\nSecond paragraph.\nThird line." };
    const parsed = markdownToNode("n_1", nodeToMarkdown(n));
    expect(parsed.body).toBe("First paragraph.\n\nSecond paragraph.\nThird line.");
  });

  it("round-trips a node position through frontmatter", () => {
    const n = { ...node, position: { x: 120, y: -40 } };
    const parsed = markdownToNode("n_1", nodeToMarkdown(n));
    expect(parsed.position).toEqual({ x: 120, y: -40 });
  });

  it("omits position when absent", () => {
    const parsed = markdownToNode("n_1", nodeToMarkdown(node));
    expect(parsed.position).toBeUndefined();
  });

  it("round-trips tokens and costUsd through frontmatter", () => {
    const n = { ...node, tokens: 12345, costUsd: 0.0421 };
    const parsed = markdownToNode("n_1", nodeToMarkdown(n));
    expect(parsed.tokens).toBe(12345);
    expect(parsed.costUsd).toBe(0.0421);
  });

  it("omits tokens/costUsd when absent", () => {
    const parsed = markdownToNode("n_1", nodeToMarkdown(node));
    expect(parsed.tokens).toBeUndefined();
    expect(parsed.costUsd).toBeUndefined();
  });

  it("round-trips teaser and researched through frontmatter", () => {
    const n = { ...node, teaser: "why it's interesting", researched: false };
    const parsed = markdownToNode("n_1", nodeToMarkdown(n));
    expect(parsed.teaser).toBe("why it's interesting");
    expect(parsed.researched).toBe(false);
  });

  it("omits teaser/researched when absent", () => {
    const parsed = markdownToNode("n_1", nodeToMarkdown(node));
    expect(parsed.teaser).toBeUndefined();
    expect(parsed.researched).toBeUndefined();
  });

  it("round-trips multiple sources", () => {
    const n = { ...node, sources: ["https://a.test", "https://b.test", "https://c.test"] };
    const parsed = markdownToNode("n_1", nodeToMarkdown(n));
    expect(parsed.sources).toEqual(["https://a.test", "https://b.test", "https://c.test"]);
  });

  it("throws on frontmatter with an invalid kind", () => {
    const bad = "---\nkind: bogus\nparents: []\nquestion: Q\nsources: []\ncreated: 2026-06-02T18:30:00.000Z\n---\nbody";
    expect(() => markdownToNode("n_bad", bad)).toThrow(/kind/);
  });

  it("throws on frontmatter missing created", () => {
    const bad = "---\nkind: finding\nparents: []\nquestion: Q\nsources: []\n---\nbody";
    expect(() => markdownToNode("n_bad", bad)).toThrow(/created/);
  });
});
