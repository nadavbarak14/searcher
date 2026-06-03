import type { NodeMeta } from "../types";

const ROW_H = 380;
const COL_W = 420;

/**
 * Layered tree layout. The topic sits at row 0; a node's row is 1 + the shallowest
 * resolvable parent. Siblings on a row are spread horizontally, centered on x=0.
 * Used only to place nodes that have no saved position yet.
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

  const rows = new Map<number, string[]>();
  for (const m of metas) {
    const d = depthOf(m.id);
    const row = rows.get(d) ?? rows.set(d, []).get(d)!;
    row.push(m.id);
  }

  const out: Record<string, { x: number; y: number }> = {};
  for (const [d, ids] of rows) {
    ids.forEach((id, i) => {
      out[id] = { x: (i - (ids.length - 1) / 2) * COL_W, y: d * ROW_H };
    });
  }
  return out;
}
