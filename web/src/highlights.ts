import type { Anchor } from "./types";

export interface Mark {
  kind: "pending" | "explored";
  label: string; // number badge for pending; "" for explored
  ref: string; // pending id, or child node id for explored
}
export interface Segment {
  text: string;
  mark?: Mark;
}

/** Resolve an anchor to a [start, end) range in body using its occurrence; null if absent. */
export function resolveRange(body: string, anchor: Anchor): [number, number] | null {
  let from = 0;
  let seen = 0;
  for (;;) {
    const i = body.indexOf(anchor.text, from);
    if (i === -1) return null;
    seen += 1;
    if (seen === anchor.occurrence) return [i, i + anchor.text.length];
    from = i + 1;
  }
}

/** Split body into ordered segments, marking anchored ranges. On overlap, the earlier start wins. */
export function segmentBody(body: string, marks: { anchor: Anchor; mark: Mark }[]): Segment[] {
  const ranges = marks
    .map((m) => {
      const r = resolveRange(body, m.anchor);
      return r ? { start: r[0], end: r[1], mark: m.mark } : null;
    })
    .filter((r): r is { start: number; end: number; mark: Mark } => r !== null)
    .sort((a, b) => a.start - b.start);

  const segments: Segment[] = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.start < pos) continue; // overlaps an already-emitted mark — skip
    if (r.start > pos) segments.push({ text: body.slice(pos, r.start) });
    segments.push({ text: body.slice(r.start, r.end), mark: r.mark });
    pos = r.end;
  }
  if (pos < body.length) segments.push({ text: body.slice(pos) });
  return segments;
}
