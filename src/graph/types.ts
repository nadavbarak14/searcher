export type NodeKind = "topic" | "finding";

/** Canvas coordinates for a node. Persisted so the user's layout survives reloads. */
export interface Position {
  x: number;
  y: number;
}

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
  position?: Position; // last-saved canvas coordinates (absent until the user drags it)
  tokens?: number; // total tokens this node's Claude call consumed (topic = the initial research run)
  costUsd?: number; // USD cost of that same call
  teaser?: string; // a thread's one-line "why", shown on the collapsed signpost (unresearched threads)
  researched?: boolean; // false on an unresearched thread; true once it has a real body
}

/** Lightweight per-node metadata stored in the index (everything reconstructable from .md files). */
export interface NodeMeta {
  id: string;
  kind: NodeKind;
  parents: string[];
  anchor?: Anchor; // present on findings that branch from a selection; mirrors the node's anchor
  question: string;
  created: string;
  position?: Position; // mirrors the node's saved canvas coordinates
  tokens?: number; // mirrors the node's token total
  costUsd?: number; // mirrors the node's USD cost
  teaser?: string; // mirrors the node's thread teaser ("why")
  researched?: boolean; // mirrors the node's researched flag
}

/** Derived, rebuildable index for fast project loading. Source of truth is the .md frontmatter. */
export interface GraphIndex {
  topic: string;
  nextSeq: number; // next finding id will be `n_<nextSeq>`
  nodes: NodeMeta[];
}

/** The persisted synthesis: the report markdown plus the graph fingerprint it was generated from. */
export interface StoredReport {
  markdown: string;
  generatedAt: string; // ISO 8601
  fingerprint: string; // hash of the node content this report was synthesized from
}

/** Whether a saved report exists and whether the graph has changed since (so it needs re-synthesizing). */
export interface ReportStatus {
  generatedAt: string;
  stale: boolean;
}

/** A saved report with its staleness, for display. */
export interface Report extends ReportStatus {
  markdown: string;
}

/** A one-line summary of a project, used to render the library/home screen. */
export interface ProjectSummary {
  id: string; // the project folder name
  topic: string;
  nodes: number; // total node count (incl. the topic)
  sources: number; // count of distinct source URLs across all nodes
  depth: number; // deepest level below the topic (topic = 0)
  updated: string; // ISO 8601 — when the index was last written
}
