/* ============================================================
   Shared UI — minimal line icons, the Searcher wordmark, and a
   small deterministic graph glyph. Ported from the design handoff.
   ============================================================ */
import type { CSSProperties, ReactNode } from "react";

export type IconName =
  | "search" | "plus" | "minus" | "chevron" | "arrowLeft" | "arrowUpRight"
  | "sparkle" | "link" | "copy" | "x" | "retry" | "fit" | "dot" | "home"
  | "branch" | "trash" | "target" | "check" | "expandAll" | "collapseAll";

const PATHS: Record<IconName, ReactNode> = {
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  minus: <><path d="M5 12h14" /></>,
  chevron: <><path d="M6 9l6 6 6-6" /></>,
  arrowLeft: <><path d="M19 12H5M11 6l-6 6 6 6" /></>,
  arrowUpRight: <><path d="M7 17L17 7M9 7h8v8" /></>,
  sparkle: <><path d="M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6z" /></>,
  link: <><path d="M9 15l6-6" /><path d="M11 6l1-1a4 4 0 0 1 6 6l-1 1" /><path d="M13 18l-1 1a4 4 0 0 1-6-6l1-1" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>,
  x: <><path d="M6 6l12 12M18 6L6 18" /></>,
  retry: <><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></>,
  fit: <><path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 0-1 1h-4" /></>,
  dot: <><circle cx="12" cy="12" r="3.5" /></>,
  home: <><path d="M4 11l8-7 8 7" /><path d="M6 10v9h12v-9" /></>,
  branch: <><circle cx="6" cy="6" r="2.4" /><circle cx="18" cy="18" r="2.4" /><path d="M6 8.4V14a4 4 0 0 0 4 4h5.6" /></>,
  trash: <><path d="M4 7h16" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.4" /></>,
  check: <><path d="M5 13l4 4L19 7" /></>,
  expandAll: <><path d="M7 8l5-5 5 5" /><path d="M7 16l5 5 5-5" /></>,
  collapseAll: <><path d="M7 5l5 5 5-5" /><path d="M7 19l5-5 5 5" /></>,
};

export function Icon({
  name,
  size = 18,
  stroke = 1.6,
  style,
}: {
  name: IconName;
  size?: number;
  stroke?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}

/** The Searcher wordmark — a small graph glyph + serif name. */
export function Wordmark({ size = 22, color = "var(--ink)" }: { size?: number; color?: string }) {
  const r = size * 0.5;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: size * 0.5 }}>
      <svg width={r * 2.2} height={r * 2.2} viewBox="0 0 28 28" aria-hidden style={{ overflow: "visible" }}>
        <line x1="14" y1="9" x2="7" y2="20" stroke="var(--line-strong)" strokeWidth="1.4" />
        <line x1="14" y1="9" x2="21" y2="20" stroke="var(--line-strong)" strokeWidth="1.4" />
        <circle cx="14" cy="9" r="4.2" fill="var(--clay-soft)" stroke="var(--clay)" strokeWidth="1.6" />
        <circle cx="7" cy="20" r="3" fill="var(--card)" stroke="var(--accent)" strokeWidth="1.6" />
        <circle cx="21" cy="20" r="3" fill="var(--card)" stroke="var(--accent)" strokeWidth="1.6" />
      </svg>
      <span className="serif" style={{ fontSize: size, fontWeight: 500, letterSpacing: "-0.01em", color }}>
        Searcher
      </span>
    </span>
  );
}

/** Small deterministic graph glyph for a library project. */
export function MiniGraph({
  nodes = 5,
  color = "var(--accent)",
  root = "var(--clay)",
  size = 40,
}: {
  nodes?: number;
  color?: string;
  root?: string;
  size?: number;
}) {
  const kids = Math.max(2, Math.min(4, nodes - 1));
  const w = size, h = size * 0.78, cx = w / 2, ry = h - 7;
  const xs = Array.from({ length: kids }, (_, i) => 8 + (i * (w - 16)) / (kids - 1));
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden style={{ display: "block" }}>
      {xs.map((x, i) => <line key={`l${i}`} x1={cx} y1="9" x2={x} y2={ry} stroke="var(--line-strong)" strokeWidth="1.2" />)}
      {xs.map((x, i) => <circle key={`c${i}`} cx={x} cy={ry} r="3.4" fill="var(--card)" stroke={color} strokeWidth="1.5" />)}
      <circle cx={cx} cy="9" r="5" fill="var(--clay-soft)" stroke={root} strokeWidth="1.7" />
    </svg>
  );
}
