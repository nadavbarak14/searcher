export type NodeKind = "topic" | "finding";

/** How a child node's selection maps back into the parent's rendered answer. */
export interface Anchor {
  text: string;
  offset: number; // char offset into the parent body
  occurrence: number; // Nth match of `text`, to disambiguate duplicates (1-based)
}

/** A single research node. Persisted as one markdown file: frontmatter = metadata, body = answer. */
export interface ResearchNode {
  id: string; // "topic" for the root, else "n_<seq>"
  kind: NodeKind;
  parents: string[]; // empty for the topic node; >=1 otherwise. Array → graph, not just tree.
  anchor?: Anchor; // absent on the topic node and on manual cross-links
  question: string;
  sources: string[];
  created: string; // ISO 8601
  body: string; // markdown answer (the topic node's body is "")
}

/** Lightweight per-node metadata stored in the index (everything reconstructable from .md files). */
export interface NodeMeta {
  id: string;
  kind: NodeKind;
  parents: string[];
  anchor?: Anchor; // present on findings that branch from a selection; mirrors the node's anchor
  question: string;
  created: string;
}

/** Derived, rebuildable index for fast project loading. Source of truth is the .md frontmatter. */
export interface GraphIndex {
  topic: string;
  nextSeq: number; // next finding id will be `n_<nextSeq>`
  nodes: NodeMeta[];
}
