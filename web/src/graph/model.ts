import type { NodeMeta, Position, Anchor } from "../types";
import { anchorKey } from "./anchor";

export interface PendingNode { id: string; parentId: string; question: string; error?: string; anchor?: Anchor; activity?: string }
export interface DraftNode { id: string; parentId: string; anchor: Anchor }

/** A child branching off a node, with the span it anchors to — drives the panel's marks + jump popover. */
export interface ChildLink { anchor: Anchor; childId: string; childTitle: string; pending?: boolean }

export interface CanvasNode {
  id: string;
  kind: "topic" | "finding";
  title: string;
  pending: boolean;
  draft?: boolean;
  anchor?: Anchor;          // draft/pending: the span it branches from
  parentId?: string;        // set on pending/draft nodes so the UI can recover the parent (e.g. for retry)
  activity?: string;        // latest live-activity line on a pending node
  childCount?: number;      // findings that branch directly off this node (card meta)
  childLinks?: ChildLink[]; // this node's children, for panel highlighting + jump-to
  tokens?: number;          // total tokens this node's Claude call consumed
  costUsd?: number;         // USD cost of that call
  teaser?: string;          // a thread's one-line "why"
  researched?: boolean;     // false on an unresearched thread; true once it has a real body
  error?: string;
  position?: Position;
}
export interface CanvasEdge { id: string; source: string; target: string; label?: string }

/**
 * Derive the visible canvas from the index + UI state. The whole graph is a map now: every
 * non-pruned node is visible (pruning hides a node and its subtree). Reading happens in the side
 * panel, not on the cards, so there is no expand/collapse gating. Pending + draft nodes attach to
 * a parent and show while that parent is visible.
 */
export function buildCanvas(input: {
  metas: NodeMeta[];
  pruned?: Set<string>;
  pending: PendingNode[];
  drafts?: DraftNode[];
  positions: Record<string, Position>;
}): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const { metas, pending, positions } = input;
  const pruned = input.pruned ?? new Set<string>();
  const drafts = input.drafts ?? [];

  // direct-child counts (used for a card's "N threads" meta line)
  const childCount = new Map<string, number>();
  for (const m of metas) {
    if (pruned.has(m.id)) continue;
    for (const p of m.parents) childCount.set(p, (childCount.get(p) ?? 0) + 1);
  }

  // Every node reachable from the topic through non-pruned nodes is visible. Pruning a node
  // therefore hides its whole subtree (children lose their only path to the root).
  const visible = new Set<string>();
  if (!pruned.has("topic")) visible.add("topic");
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of metas) {
      if (visible.has(m.id) || pruned.has(m.id)) continue;
      if (m.parents.some((p) => visible.has(p))) { visible.add(m.id); changed = true; }
    }
  }

  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];

  for (const m of metas) {
    if (!visible.has(m.id)) continue;
    const node: CanvasNode = { id: m.id, kind: m.kind, title: m.question, pending: false };
    node.childCount = childCount.get(m.id) ?? 0;
    if (m.tokens !== undefined) node.tokens = m.tokens;
    if (m.costUsd !== undefined) node.costUsd = m.costUsd;
    if (m.teaser !== undefined) node.teaser = m.teaser;
    if (m.researched !== undefined) node.researched = m.researched;
    if (positions[m.id]) node.position = positions[m.id];
    nodes.push(node);
    for (const p of m.parents) {
      if (!visible.has(p)) continue;
      edges.push({ id: `${p}->${m.id}`, source: p, target: m.id });
    }
  }

  for (const pn of pending) {
    if (pruned.has(pn.id) || !visible.has(pn.parentId)) continue;
    const node: CanvasNode = { id: pn.id, kind: "finding", title: pn.question, pending: true, parentId: pn.parentId };
    if (pn.error) node.error = pn.error;
    if (pn.activity) node.activity = pn.activity;
    if (pn.anchor) node.anchor = pn.anchor;
    if (positions[pn.id]) node.position = positions[pn.id];
    nodes.push(node);
    edges.push({ id: `${pn.parentId}->${pn.id}`, source: pn.parentId, target: pn.id, label: pn.question });
  }

  for (const dr of drafts) {
    if (pruned.has(dr.id) || !visible.has(dr.parentId)) continue;
    const node: CanvasNode = { id: dr.id, kind: "finding", title: "", pending: false, draft: true, anchor: dr.anchor, parentId: dr.parentId };
    if (positions[dr.id]) node.position = positions[dr.id];
    nodes.push(node);
    edges.push({ id: `${dr.parentId}->${dr.id}`, source: dr.parentId, target: dr.id });
  }

  // child links per visible parent: real children are jump targets; pending/draft show as in-progress marks
  const linksByParent = new Map<string, ChildLink[]>();
  const seen = new Map<string, Set<string>>();
  const add = (parentId: string, link: ChildLink) => {
    const key = anchorKey(link.anchor);
    const s = seen.get(parentId) ?? seen.set(parentId, new Set()).get(parentId)!;
    if (s.has(key)) return;
    s.add(key);
    (linksByParent.get(parentId) ?? linksByParent.set(parentId, []).get(parentId)!).push(link);
  };
  for (const m of metas) if (visible.has(m.id) && m.anchor) for (const p of m.parents) if (visible.has(p)) add(p, { anchor: m.anchor, childId: m.id, childTitle: m.question });
  for (const pn of pending) if (visible.has(pn.parentId) && pn.anchor) add(pn.parentId, { anchor: pn.anchor, childId: pn.id, childTitle: pn.question, pending: true });
  for (const dr of drafts) if (visible.has(dr.parentId)) add(dr.parentId, { anchor: dr.anchor, childId: dr.id, childTitle: "", pending: true });
  for (const node of nodes) { const l = linksByParent.get(node.id); if (l) node.childLinks = l; }

  return { nodes, edges };
}
