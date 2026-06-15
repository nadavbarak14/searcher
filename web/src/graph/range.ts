/**
 * Given the char lengths of a container's successive text nodes and a target
 * char offset, return which text node holds it and the local offset within
 * that node. Offsets past the end clamp to the end of the last node. Pure.
 */
export function findNodeAtOffset(lengths: number[], offset: number): { index: number; local: number } {
  if (!lengths.length) return { index: 0, local: 0 };
  let acc = 0;
  for (let i = 0; i < lengths.length; i++) {
    if (offset <= acc + lengths[i]) return { index: i, local: Math.max(0, offset - acc) };
    acc += lengths[i];
  }
  const last = lengths.length - 1;
  return { index: last, local: lengths[last] };
}

/** Char offset of (node, nodeOffset) within container.textContent. DOM glue. */
export function offsetWithin(container: HTMLElement, node: Node, nodeOffset: number): number {
  let total = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (n === node) return total + nodeOffset;
    total += (n.textContent ?? "").length;
  }
  return total;
}

/** Build a DOM Range over [start, end) char offsets of container.textContent. DOM glue. */
export function rangeWithin(container: HTMLElement, start: number, end: number): Range {
  const nodes: Text[] = [];
  const lengths: number[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    nodes.push(n as Text);
    lengths.push((n.textContent ?? "").length);
  }
  const range = document.createRange();
  if (!nodes.length) {
    range.selectNodeContents(container);
    return range;
  }
  const a = findNodeAtOffset(lengths, start);
  const b = findNodeAtOffset(lengths, end);
  range.setStart(nodes[a.index], Math.min(a.local, lengths[a.index]));
  range.setEnd(nodes[b.index], Math.min(b.local, lengths[b.index]));
  return range;
}
