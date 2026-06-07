import { describe, it, expect } from "vitest";
import { inlineTokens, parseBlocks, layoutRuns } from "./markdown";
import type { Anchor } from "../types";

describe("inlineTokens", () => {
  it("splits bold, italic, code and links from surrounding text", () => {
    const t = inlineTokens("a **b** c *i* `d` [link](https://x)");
    expect(t).toEqual([
      { text: "a " },
      { text: "b", wrap: "b" },
      { text: " c " },
      { text: "i", wrap: "i" },
      { text: " " },
      { text: "d", wrap: "code" },
      { text: " " },
      { text: "link", wrap: "link", href: "https://x" },
    ]);
  });

  it("returns plain text untouched", () => {
    expect(inlineTokens("just words")).toEqual([{ text: "just words" }]);
  });
});

describe("parseBlocks", () => {
  it("recognizes headings, paragraphs, lists, quotes and code fences", () => {
    const md = ["# Title", "", "Para one", "line two", "", "- a", "- b", "", "> quoted", "", "```", "code", "```"].join("\n");
    const kinds = parseBlocks(md).map((b) => b.kind);
    expect(kinds).toEqual(["h1", "p", "ul", "quote", "pre"]);
  });

  it("joins wrapped paragraph lines and list items", () => {
    const blocks = parseBlocks("one\ntwo\n\n1. first\n2. second");
    expect(blocks[0]).toMatchObject({ kind: "p", pieces: [{ text: "one two" }] });
    expect(blocks[1].kind).toBe("ol");
    expect((blocks[1] as { items: unknown[] }).items).toHaveLength(2);
  });
});

describe("layoutRuns marking", () => {
  const anchor = (text: string, occurrence = 0): Anchor => ({ text, offset: 0, occurrence });

  it("wraps the anchored span as its own run carrying the anchor key", () => {
    const blocks = layoutRuns("the quick brown fox", [anchor("quick brown")]);
    const runs = blocks[0].runs!;
    const marked = runs.find((r) => r.keys.length);
    expect(marked?.text).toBe("quick brown");
    expect(runs.map((r) => r.text).join("")).toBe("the quick brown fox");
  });

  it("marks an anchor even when it spans rendered (syntax-stripped) bold text", () => {
    // rendered plain text is "bold here"; the anchor was taken over that rendered text
    const blocks = layoutRuns("**bold** here", [anchor("bold here")]);
    const runs = blocks[0].runs!;
    expect(runs.every((r) => r.keys.length)).toBe(true);
    expect(runs.map((r) => r.text).join("")).toBe("bold here");
  });

  it("targets the occurrence-th match across the whole body", () => {
    const blocks = layoutRuns("apple then apple again", [anchor("apple", 1)]);
    const runs = blocks[0].runs!;
    const markedTexts = runs.filter((r) => r.keys.length).map((r) => r.text);
    expect(markedTexts).toEqual(["apple"]);
    // it's the SECOND apple that carries the key
    const idx = runs.findIndex((r) => r.keys.length);
    expect(runs.slice(0, idx).map((r) => r.text).join("")).toBe("apple then ");
  });

  it("leaves text unmarked when there are no anchors", () => {
    const blocks = layoutRuns("plain paragraph", []);
    expect(blocks[0].runs!.every((r) => r.keys.length === 0)).toBe(true);
  });
});
