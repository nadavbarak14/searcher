import type { NodeMeta } from "../types";

export const COL_W = 480; // x gap between depth columns (answer nodes are wide)
export const ROW_H = 200; // y gap between siblings within a column

/**
 * Layered tree layout, growing LEFT→RIGHT. The topic sits at column 0 (x=0); a node's
 * column is 1 + the shallowest resolvable parent. Siblings in a column are spread
 * vertically, centered on y=0. Used only to place nodes that have no saved position yet.
 */
export function layoutNodes(metas: NodeMeta[]): Record<string, { x: number; y: number }> {
  const byId = new Map(metas.map((m) => [m.id, m]));
  const depthCache = new Map<string, number>();

  const depthOf = (id: string, seen: Set<string> = new Set()): number => {
    if (id === "topic") return 0;
    const cached = depthCache.get(id);
    if (cached !== undefined) return cached;
    if (seen.has(id)) return 1; // cycle guard
    seen.add(id);
    const m = byId.get(id);
    const parents = m?.parents.filter((p) => byId.has(p)) ?? [];
    const d = parents.length ? 1 + Math.min(...parents.map((p) => depthOf(p, seen))) : 1;
    depthCache.set(id, d);
    return d;
  };

  const cols = new Map<number, string[]>();
  for (const m of metas) {
    const d = depthOf(m.id);
    const col = cols.get(d) ?? cols.set(d, []).get(d)!;
    col.push(m.id);
  }

  const out: Record<string, { x: number; y: number }> = {};
  for (const [d, ids] of cols) {
    ids.forEach((id, i) => {
      out[id] = { x: d * COL_W, y: (i - (ids.length - 1) / 2) * ROW_H };
    });
  }
  return out;
}
