import type { Anchor } from "./types";

/** Compute an Anchor from the body, the selected text, and the char index the selection starts at.
 *  occurrence = how many times `text` appears in body up to and including this one. */
export function computeAnchor(body: string, text: string, fromIndex: number): Anchor {
  const offset = body.indexOf(text, Math.max(0, fromIndex));
  if (offset === -1) return { text, offset: 0, occurrence: 1 };
  let occurrence = 0;
  let i = body.indexOf(text);
  while (i !== -1 && i <= offset) {
    occurrence++;
    i = body.indexOf(text, i + 1);
  }
  return { text, offset, occurrence: Math.max(1, occurrence) };
}
