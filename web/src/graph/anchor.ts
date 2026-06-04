import type { Anchor } from "../types";

/** Stable id for an anchored span, used as a React Flow sourceHandle id and a <mark> key. */
export function anchorKey(a: Anchor): string {
  return `a${a.occurrence}_${a.offset}`;
}

/** Build an Anchor from a selection: 0-based occurrence = count of earlier matches before startIndex. */
export function anchorFromSelection(body: string, selectedText: string, startIndex: number): Anchor {
  let occurrence = 0;
  let from = 0;
  let idx = body.indexOf(selectedText, from);
  while (idx !== -1 && idx < startIndex) {
    occurrence++;
    from = idx + 1;
    idx = body.indexOf(selectedText, from);
  }
  return { text: selectedText, offset: startIndex, occurrence };
}

/** Resolve an anchor back to a [start,end) range: prefer the occurrence-th match, fall back to offset. */
export function locateAnchor(body: string, a: Anchor): { start: number; end: number } | null {
  if (!a.text) return null;
  let from = 0;
  let idx = -1;
  for (let i = 0; i <= a.occurrence; i++) {
    idx = body.indexOf(a.text, from);
    if (idx === -1) break;
    from = idx + 1;
  }
  if (idx !== -1) return { start: idx, end: idx + a.text.length };
  if (body.substr(a.offset, a.text.length) === a.text) return { start: a.offset, end: a.offset + a.text.length };
  return null;
}
