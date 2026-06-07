import { Fragment, type ReactNode } from "react";
import type { Anchor } from "../types";
import { highlightSegments } from "./highlight";

/* ============================================================
   Compact markdown → React renderer with integrated anchor marks.

   Covers the common set Claude emits: headings (#..###), bold,
   italic, inline code, links, bullet/numbered lists, blockquotes,
   code fences, and paragraphs. Exotic markdown (tables, images,
   nested lists) degrades to readable plain text.

   Anchoring runs over the RENDERED plain text — the same string the
   DOM exposes as the panel body's textContent — so a span selected
   in the panel and a span highlighted from a stored anchor live in
   one coordinate space. Marks are placed by occurrence, not raw
   offset, which survives the markdown syntax being stripped away.
   ============================================================ */

type InlineWrap = "b" | "i" | "code" | "link";
interface Piece { text: string; wrap?: InlineWrap; href?: string }
export interface Run { text: string; keys: string[]; wrap?: InlineWrap; href?: string }

type Block =
  | { kind: "p" | "h1" | "h2" | "h3" | "quote" | "pre"; pieces: Piece[] }
  | { kind: "ul" | "ol"; items: Piece[][] };

export interface RunBlock {
  kind: Block["kind"];
  runs?: Run[];       // non-list blocks
  items?: Run[][];    // list blocks
}

export type MarkHandler = (key: string, el: HTMLElement) => void;

const HEADING = /^(#{1,6})\s+(.*)$/;
const QUOTE = /^>\s?/;
const LIST = /^\s*([-*+]|\d+\.)\s+/;
const ORDERED = /^\s*\d+\.\s+/;
const FENCE = /^```/;

// One pass over inline syntax: bold, italic, inline code, links — first match wins.
const INLINE = /(\*\*|__)([\s\S]+?)\1|(\*|_)([\s\S]+?)\3|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function inlineTokens(text: string): Piece[] {
  const out: Piece[] = [];
  const push = (t: string, wrap?: InlineWrap, href?: string) => {
    if (!t) return;
    out.push(href ? { text: t, wrap, href } : wrap ? { text: t, wrap } : { text: t });
  };
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text))) {
    if (m.index > last) push(text.slice(last, m.index));
    if (m[1] && m[2] !== undefined) push(m[2], "b");
    else if (m[3] && m[4] !== undefined) push(m[4], "i");
    else if (m[5] !== undefined) push(m[5], "code");
    else if (m[6] !== undefined) push(m[6], "link", m[7]);
    last = INLINE.lastIndex;
  }
  push(text.slice(last));
  return out;
}

export function parseBlocks(body: string): Block[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (FENCE.test(line.trim())) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i].trim())) buf.push(lines[i++]);
      i++; // closing fence
      blocks.push({ kind: "pre", pieces: [{ text: buf.join("\n") }] });
      continue;
    }
    if (line.trim() === "") { i++; continue; }
    const h = HEADING.exec(line);
    if (h) {
      const level = Math.min(h[1].length, 3);
      blocks.push({ kind: `h${level}` as "h1" | "h2" | "h3", pieces: inlineTokens(h[2].trim()) });
      i++; continue;
    }
    if (QUOTE.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) buf.push(lines[i++].replace(QUOTE, ""));
      blocks.push({ kind: "quote", pieces: inlineTokens(buf.join(" ").trim()) });
      continue;
    }
    if (LIST.test(line)) {
      const ordered = ORDERED.test(line);
      const items: Piece[][] = [];
      while (i < lines.length && LIST.test(lines[i])) items.push(inlineTokens(lines[i++].replace(LIST, "").trim()));
      blocks.push({ kind: ordered ? "ol" : "ul", items });
      continue;
    }
    const buf = [line];
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === "" || HEADING.test(l) || QUOTE.test(l) || LIST.test(l) || FENCE.test(l.trim())) break;
      buf.push(l); i++;
    }
    blocks.push({ kind: "p", pieces: inlineTokens(buf.join(" ").trim()) });
  }
  return blocks;
}

type ListBlock = Extract<Block, { items: Piece[][] }>;
const isList = (b: Block): b is ListBlock => b.kind === "ul" || b.kind === "ol";
const blockPieces = (b: Block): Piece[] => (isList(b) ? b.items.flat() : b.pieces);

/**
 * Build per-block runs: each piece is sliced at the mark-segment boundaries so anchored spans
 * become their own runs (carrying the covering anchor keys). Pure — no React — so it's testable.
 */
export function layoutRuns(body: string, anchors: Anchor[]): RunBlock[] {
  const blocks = parseBlocks(body || "");
  const full = blocks.flatMap(blockPieces).map((p) => p.text).join("");
  const segs = highlightSegments(full, anchors); // tiles `full` exactly, in order
  let si = 0; // current segment
  let sp = 0; // chars consumed within the current segment
  const runsFor = (pieces: Piece[]): Run[] => {
    const runs: Run[] = [];
    for (const p of pieces) {
      let rem = p.text;
      while (rem.length) {
        if (si >= segs.length) { runs.push({ text: rem, keys: [], wrap: p.wrap, href: p.href }); break; }
        const seg = segs[si];
        const take = Math.min(seg.text.length - sp, rem.length);
        runs.push({ text: rem.slice(0, take), keys: seg.keys, wrap: p.wrap, href: p.href });
        rem = rem.slice(take); sp += take;
        if (sp >= seg.text.length) { si++; sp = 0; }
      }
    }
    return runs;
  };
  return blocks.map((b) =>
    isList(b)
      ? { kind: b.kind, items: b.items.map((it) => runsFor(it)) }
      : { kind: b.kind, runs: runsFor(b.pieces) },
  );
}

function renderRun(r: Run, key: number, onMark?: MarkHandler): ReactNode {
  let node: ReactNode = r.text;
  if (r.wrap === "b") node = <strong>{node}</strong>;
  else if (r.wrap === "i") node = <em>{node}</em>;
  else if (r.wrap === "code") node = <code className="md-code">{node}</code>;
  else if (r.wrap === "link" && r.href)
    node = <a className="nodrag md-link" href={r.href} target="_blank" rel="noreferrer">{node}</a>;
  if (r.keys.length) {
    node = (
      <mark
        className="anchor-mark"
        data-akey={r.keys.join(" ")}
        onClick={onMark ? (e) => { e.stopPropagation(); onMark(r.keys[0], e.currentTarget); } : undefined}
      >
        {node}
      </mark>
    );
  }
  return <Fragment key={key}>{node}</Fragment>;
}

const renderRuns = (runs: Run[], onMark?: MarkHandler) => runs.map((r, i) => renderRun(r, i, onMark));

/** Render markdown to React, highlighting anchored spans as clickable <mark> elements. */
export function renderMarkdown(body: string, anchors: Anchor[], onMark?: MarkHandler): ReactNode {
  return layoutRuns(body, anchors).map((b, i) => {
    if (b.kind === "ul" || b.kind === "ol") {
      const Tag = b.kind;
      return <Tag key={i} className="md-list">{b.items!.map((it, j) => <li key={j}>{renderRuns(it, onMark)}</li>)}</Tag>;
    }
    const runs = b.runs!;
    switch (b.kind) {
      case "pre":
        return <pre key={i} className="md-pre"><code>{runs.map((r) => r.text).join("")}</code></pre>;
      case "quote":
        return <blockquote key={i} className="md-quote">{renderRuns(runs, onMark)}</blockquote>;
      case "h1":
        return <h1 key={i} className="md-h md-h1">{renderRuns(runs, onMark)}</h1>;
      case "h2":
        return <h2 key={i} className="md-h md-h2">{renderRuns(runs, onMark)}</h2>;
      case "h3":
        return <h3 key={i} className="md-h md-h3">{renderRuns(runs, onMark)}</h3>;
      default:
        return <p key={i} className="md-p">{renderRuns(runs, onMark)}</p>;
    }
  });
}
