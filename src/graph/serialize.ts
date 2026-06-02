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
  const fm = data as FrontMatter;
  const node: ResearchNode = {
    id,
    kind: fm.kind,
    parents: fm.parents ?? [],
    question: fm.question,
    sources: fm.sources ?? [],
    created: fm.created,
    body: content.replace(/\n$/, ""), // strip the single trailing newline gray-matter adds
  };
  if (fm.anchor) node.anchor = fm.anchor;
  return node;
}
