import matter from "gray-matter";
import type { ResearchNode, NodeKind, Anchor } from "./types.js";

interface FrontMatter {
  kind: NodeKind;
  parents: string[];
  anchor?: Anchor;
  question: string;
  sources: string[];
  created: string;
}

function assertFrontMatter(id: string, fm: Partial<FrontMatter>): asserts fm is FrontMatter {
  if (fm.kind !== "topic" && fm.kind !== "finding") {
    throw new Error(`Invalid node "${id}": frontmatter "kind" must be "topic" or "finding", got ${JSON.stringify(fm.kind)}`);
  }
  if (!fm.created) {
    throw new Error(`Invalid node "${id}": frontmatter "created" is required`);
  }
  if (fm.question === undefined) {
    throw new Error(`Invalid node "${id}": frontmatter "question" is required`);
  }
}

/** Serialize a node to a markdown string: YAML frontmatter + body. `id` is NOT stored (it's the filename). */
export function nodeToMarkdown(node: ResearchNode): string {
  const data: FrontMatter = {
    kind: node.kind,
    parents: node.parents,
    question: node.question,
    sources: node.sources,
    created: node.created,
  };
  if (node.anchor) data.anchor = node.anchor;
  // gray-matter appends a trailing newline to the body; keep body verbatim.
  return matter.stringify(node.body, data);
}

/** Parse a markdown string back into a node. The id comes from the caller (the filename), not the content. */
export function markdownToNode(id: string, md: string): ResearchNode {
  const { data, content } = matter(md);
  const fm = data as Partial<FrontMatter>;
  assertFrontMatter(id, fm);
  const node: ResearchNode = {
    id,
    kind: fm.kind,
    parents: fm.parents ?? [],
    question: fm.question,
    sources: fm.sources ?? [],
    created: fm.created,
    // Normalize: gray-matter appends exactly one trailing newline on stringify, which we
    // strip here so round-trips are exact. NOTE: a single trailing newline in the original
    // body is therefore not preserved. Bodies are AI-generated prose where this is irrelevant.
    body: content.replace(/\n$/, ""),
  };
  if (fm.anchor) node.anchor = fm.anchor;
  return node;
}
