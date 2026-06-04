import type { NodeMeta, Position } from "../types";

export interface PendingNode { id: string; parentId: string; question: string; error?: string }

export interface CanvasNode {
  id: string;
  kind: "topic" | "finding";
  title: string;
  expanded: boolean;
  pending: boolean;
  parentId?: string; // set on pending nodes so the UI can recover the parent (e.g. for retry)
  body?: string;
  sources?: string[];
  childCount?: number; // findings that branch directly off this node (used for the topic card meta)
  error?: string;
  position?: Position;
}
export interface CanvasEdge { id: string; source: string; target: string; label?: string }

/**
 * Derive the visible canvas from the index + UI state. Visibility: the topic is always
 * visible; any other node is visible iff at least one parent is itself visible AND expanded.
 * (Expand/collapse therefore cascades — a collapsed node hides its whole subtree.) Pending
 * nodes attach to a parent and show only while that parent is visible-and-expanded.
 */
export function buildCanvas(input: {
  metas: NodeMeta[];
  expanded: Set<string>;
  bodies: Record<string, string>;
  sources?: Record<string, string[]>;
  pruned?: Set<string>;
  pending: PendingNode[];
  positions: Record<string, Position>;
}): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const { metas, expanded, bodies, pending, positions } = input;
  const sources = input.sources ?? {};
  const pruned = input.pruned ?? new Set<string>();

  // direct-child counts, used for the topic card's "N FINDINGS" meta line
  const childCount = new Map<string, number>();
  for (const m of metas) {
    if (pruned.has(m.id)) continue;
    for (const p of m.parents) childCount.set(p, (childCount.get(p) ?? 0) + 1);
  }

  const visible = new Set<string>(["topic"]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of metas) {
      if (visible.has(m.id) || pruned.has(m.id)) continue;
      if (m.parents.some((p) => visible.has(p) && expanded.has(p))) {
        visible.add(m.id);
        changed = true;
      }
    }
  }

  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];

  for (const m of metas) {
    if (!visible.has(m.id)) continue;
    const node: CanvasNode = { id: m.id, kind: m.kind, title: m.question, expanded: expanded.has(m.id), pending: false };
    if (bodies[m.id] !== undefined) node.body = bodies[m.id];
    if (sources[m.id] !== undefined) node.sources = sources[m.id];
    if (m.kind === "topic") node.childCount = childCount.get(m.id) ?? 0;
    if (positions[m.id]) node.position = positions[m.id];
    nodes.push(node);
    for (const p of m.parents) {
      if (visible.has(p)) edges.push({ id: `${p}->${m.id}`, source: p, target: m.id });
    }
  }

  for (const pn of pending) {
    if (pruned.has(pn.id)) continue;
    if (!(visible.has(pn.parentId) && expanded.has(pn.parentId))) continue;
    const node: CanvasNode = { id: pn.id, kind: "finding", title: pn.question, expanded: false, pending: true, parentId: pn.parentId };
    if (pn.error) node.error = pn.error;
    nodes.push(node);
    edges.push({ id: `${pn.parentId}->${pn.id}`, source: pn.parentId, target: pn.id, label: pn.question });
  }

  return { nodes, edges };
}
