import type { Anchor } from "../types";
import { anchorKey, locateAnchor } from "./anchor";

export interface Segment { text: string; keys: string[] }

/** Split `body` into ordered segments; each segment lists the anchor keys covering it. Unfound anchors are dropped. */
export function highlightSegments(body: string, anchors: Anchor[]): Segment[] {
  const ranges = anchors
    .map((a) => { const r = locateAnchor(body, a); return r ? { key: anchorKey(a), ...r } : null; })
    .filter((r): r is { key: string; start: number; end: number } => r !== null);

  if (!ranges.length) return body ? [{ text: body, keys: [] }] : [];

  const bounds = new Set<number>([0, body.length]);
  for (const r of ranges) { bounds.add(r.start); bounds.add(r.end); }
  const points = [...bounds].sort((a, b) => a - b);

  const segs: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const s = points[i];
    const e = points[i + 1];
    if (s === e) continue;
    const keys = ranges.filter((r) => r.start <= s && e <= r.end).map((r) => r.key);
    segs.push({ text: body.slice(s, e), keys });
  }
  return segs;
}
