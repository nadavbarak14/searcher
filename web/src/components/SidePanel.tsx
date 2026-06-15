import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Anchor } from "../types";
import type { CanvasNode, ChildLink } from "../graph/model";
import { anchorKey, anchorFromSelection } from "../graph/anchor";
import { renderMarkdown } from "../graph/markdown";
import { offsetWithin, rangeWithin } from "../graph/range";
import { useReadAloud, type ReadAloud } from "../useReadAloud";
import { Icon } from "./ui";

/** Compact token count: 1234 → "1.2k". */
function formatTokens(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k";
  return String(n);
}

function SourceList({ sources }: { sources?: string[] }) {
  if (!sources || !sources.length) return null;
  return (
    <div style={{ marginTop: 22, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
      <div className="eyebrow" style={{ fontSize: 10, marginBottom: 9 }}>Sources · {sources.length}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {sources.map((s) => {
          const href = /^https?:\/\//.test(s) ? s : `https://${s}`;
          return (
            <a key={s} href={href} target="_blank" rel="noreferrer" className="mono"
              style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--accent)", textDecoration: "none", lineHeight: 1.3 }}>
              <Icon name="link" size={13} style={{ flexShrink: 0, opacity: 0.7 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

function AskBox({ anchorText, onAsk, onCancel }: { anchorText?: string; onAsk: (q: string) => void; onCancel?: () => void }) {
  const [open, setOpen] = useState(!!anchorText);
  const [draft, setDraft] = useState("");
  const submit = () => { const q = draft.trim(); if (!q) return; onAsk(q); setDraft(""); setOpen(false); };
  const close = () => { setDraft(""); setOpen(false); onCancel?.(); };
  if (!open) {
    return (
      <button className="nodrag" onClick={() => setOpen(true)}
        style={{ marginTop: 20, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 9, padding: "11px 13px", borderRadius: "var(--r-md)", cursor: "pointer", border: "1px dashed var(--accent-line)", background: "var(--accent-soft)", color: "var(--accent-deep)", fontFamily: "var(--sans)", fontSize: 13.5, fontWeight: 500 }}>
        <Icon name="branch" size={15} /> Branch a question from here
      </button>
    );
  }
  return (
    <div className="nodrag" style={{ marginTop: 20 }}>
      {anchorText && (
        <blockquote className="serif" style={{ margin: "0 0 10px", paddingLeft: 10, borderLeft: "2px solid var(--accent-line)", fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.4 }}>
          “{anchorText.length > 160 ? anchorText.slice(0, 160) + "…" : anchorText}”
        </blockquote>
      )}
      <textarea autoFocus value={draft} rows={2} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } if (e.key === "Escape") close(); }}
        placeholder="Ask a follow-up — Claude answers as a new child node…" className="field"
        style={{ fontSize: 13.5, resize: "none", lineHeight: 1.45, width: "100%", boxSizing: "border-box" }} />
      <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost btn-sm" onClick={close}>Cancel</button>
        <button className="btn btn-primary btn-sm" disabled={!draft.trim()} onClick={submit}><Icon name="sparkle" size={14} /> Ask</button>
      </div>
    </div>
  );
}

const SPEEDS = [1, 1.25, 1.5, 2, 0.75];

/** Transport for read-aloud: Listen → (pause/resume, stop, speed). */
function ReadAloudBar({ tts }: { tts: ReadAloud }) {
  const playing = tts.status === "playing";
  const cycleSpeed = () => {
    const i = SPEEDS.indexOf(tts.rate);
    tts.setRate(SPEEDS[(i < 0 ? 0 : i + 1) % SPEEDS.length]);
  };
  if (tts.status === "idle") {
    return (
      <button className="iconbtn bare accent nodrag" title="Read aloud" onClick={tts.play}
        style={{ width: "auto", padding: "0 9px", gap: 6, display: "inline-flex", alignItems: "center", fontFamily: "var(--sans)", fontSize: 12.5 }}>
        <Icon name="headphones" size={15} /> Listen
      </button>
    );
  }
  return (
    <div className="nodrag" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <button className="iconbtn bare" title={playing ? "Pause" : "Resume"} onClick={playing ? tts.pause : tts.resume}>
        <Icon name={playing ? "pause" : "play"} size={15} />
      </button>
      <button className="iconbtn bare" title="Stop" onClick={tts.stop}><Icon name="stop" size={15} /></button>
      <button className="chip" title="Playback speed" onClick={cycleSpeed}
        style={{ fontSize: 11.5, padding: "3px 8px" }}>
        {tts.rate}×
      </button>
    </div>
  );
}

export interface PendingChild { id: string; question: string; anchorText?: string; activity?: string; error?: string }

export interface SidePanelProps {
  node: CanvasNode;
  body?: string;
  sources?: string[];
  childLinks: ChildLink[];
  pendingChildren?: PendingChild[];
  researching?: boolean;
  activity?: string;
  error?: string;
  onClose: () => void;
  onSelectChild: (childId: string) => void;
  onRetryChild?: (id: string) => void;
  onDismissChild?: (id: string) => void;
  onAsk: (question: string, anchor?: Anchor) => void;
}

/** Live "Generating…" list for follow-ups in flight off the open node — the visible proof the ask landed. */
function PendingStrip({ items, onRetry, onDismiss }: { items: PendingChild[]; onRetry?: (id: string) => void; onDismiss?: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((p) => (
        <div key={p.id} style={{ border: `1px ${p.error ? "solid" : "dashed"} ${p.error ? "var(--danger)" : "var(--clay-line)"}`, borderRadius: "var(--r-md)", background: p.error ? "var(--danger-soft)" : "var(--clay-soft)", padding: "12px 14px" }}>
          <div className="eyebrow" style={{ color: p.error ? "var(--danger)" : "var(--clay)", marginBottom: 7, display: "flex", gap: 8, alignItems: "center" }}>
            {p.error ? "Follow-up failed" : "Generating answer…"}
            {!p.error && <span style={{ display: "inline-flex", gap: 4 }}>{[0, 1, 2].map((i) => <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--clay)", animation: `breathe 1.4s ease-in-out ${i * 0.18}s infinite` }} />)}</span>}
          </div>
          <div className="serif" style={{ fontSize: 14, lineHeight: 1.35, color: "var(--ink)" }}>{p.question}</div>
          {p.anchorText && <div className="mono" style={{ marginTop: 6, fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>↳ “{p.anchorText}”</div>}
          {!p.error && p.activity && <div className="mono" style={{ marginTop: 7, fontSize: 11, lineHeight: 1.4, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.activity}</div>}
          {p.error && (
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1, fontSize: 12, color: "var(--danger)" }}>{p.error}</span>
              {onDismiss && <button className="btn btn-ghost btn-sm" onClick={() => onDismiss(p.id)}>Dismiss</button>}
              {onRetry && <button className="btn btn-primary btn-sm" onClick={() => onRetry(p.id)}><Icon name="retry" size={13} /> Retry</button>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function SidePanel({ node, body, sources, childLinks, pendingChildren, researching, activity, error, onClose, onSelectChild, onRetryChild, onDismissChild, onAsk }: SidePanelProps) {
  const isTopic = node.kind === "topic";
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const pendCount = pendingChildren?.length ?? 0;
  const [popover, setPopover] = useState<{ link: ChildLink; x: number; y: number } | null>(null);
  const [sel, setSel] = useState<{ anchor: Anchor; x: number; y: number } | null>(null);
  const [askAnchor, setAskAnchor] = useState<Anchor | null>(null);
  const tts = useReadAloud(() => bodyRef.current);
  const lastSentRef = useRef<string>("");
  const lastBlockRef = useRef<HTMLElement | null>(null);

  // Paint the active sentence/word via the CSS Custom Highlight API (no DOM mutation),
  // falling back to a class band. Scroll only when the sentence (not the word) changes.
  useEffect(() => {
    const w = window as unknown as {
      CSS?: { highlights?: Map<string, unknown> };
      Highlight?: new (...ranges: Range[]) => unknown;
    };
    const hasHL = !!(w.CSS && w.CSS.highlights && typeof w.Highlight === "function");
    const a = tts.active;

    if (!hasHL) {
      document.querySelectorAll(".tts-block-active").forEach((el) => el.classList.remove("tts-block-active"));
      if (a) a.block.classList.add("tts-block-active");
      return;
    }
    const highlights = w.CSS!.highlights!;
    const Highlight = w.Highlight!;
    if (!a) {
      highlights.delete("tts-sentence");
      highlights.delete("tts-word");
      return;
    }
    highlights.set("tts-sentence", new Highlight(rangeWithin(a.block, a.sentence.start, a.sentence.end)));
    if (a.word) highlights.set("tts-word", new Highlight(rangeWithin(a.block, a.word.start, a.word.end)));
    else highlights.delete("tts-word");

    const sentKey = `${a.sentence.start}-${a.sentence.end}`;
    if (a.block !== lastBlockRef.current || sentKey !== lastSentRef.current) {
      lastBlockRef.current = a.block;
      lastSentRef.current = sentKey;
      a.block.scrollIntoView({ block: "nearest", behavior: "instant" });
    }
  }, [tts.active]);

  // Stop speech (and clear highlights via the effect above) when the body content changes.
  const { stop: stopReading } = tts;
  useEffect(() => { if (body !== undefined) stopReading(); }, [body, stopReading]);

  // Clear highlights on unmount.
  useEffect(() => () => {
    const w = window as unknown as { CSS?: { highlights?: Map<string, unknown> } };
    w.CSS?.highlights?.delete("tts-sentence");
    w.CSS?.highlights?.delete("tts-word");
    document.querySelectorAll(".tts-block-active").forEach((el) => el.classList.remove("tts-block-active"));
  }, []);

  const linkByKey = useMemo(() => {
    const m = new Map<string, ChildLink>();
    for (const l of childLinks) m.set(anchorKey(l.anchor), l);
    return m;
  }, [childLinks]);

  const anchors = useMemo(() => childLinks.map((l) => l.anchor), [childLinks]);

  // reset transient UI when the displayed node changes
  useEffect(() => { setPopover(null); setSel(null); setAskAnchor(null); }, [node.id]);

  // when a follow-up starts generating — or the ask box opens — scroll that area into view
  useEffect(() => { if (pendCount > 0) stripRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [pendCount]);
  useEffect(() => { if (askAnchor) stripRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [askAnchor]);

  const onMark = (key: string, el: HTMLElement) => {
    const link = linkByKey.get(key);
    if (!link) return;
    const r = el.getBoundingClientRect();
    setSel(null);
    setPopover({ link, x: r.left, y: r.bottom + 6 });
  };

  const onBodyMouseUp = () => {
    const s = window.getSelection();
    const bodyEl = bodyRef.current;
    if (!s || s.isCollapsed || !bodyEl) { setSel(null); return; }
    const range = s.getRangeAt(0);
    if (!bodyEl.contains(range.startContainer) || !bodyEl.contains(range.endContainer)) { setSel(null); return; }
    const text = s.toString();
    if (!text.trim()) { setSel(null); return; }
    const start = offsetWithin(bodyEl, range.startContainer, range.startOffset);
    const anchor = anchorFromSelection(bodyEl.textContent ?? "", text, start);
    const r = range.getBoundingClientRect();
    setPopover(null);
    setSel({ anchor, x: r.left, y: r.bottom + 6 });
  };

  return (
    <>
    {/* Floating reading card — no backdrop, so the map stays visible + pannable around it. */}
    <aside className="side-panel" style={{
      position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
      width: 600, maxWidth: "92vw", maxHeight: "82%",
      background: "var(--card)", border: "1px solid var(--line-strong)", borderRadius: "var(--r-lg)",
      boxShadow: "var(--shadow-lg, 0 8px 40px rgba(0,0,0,0.14))",
      display: "flex", flexDirection: "column", zIndex: 30, overflow: "hidden", animation: "fadeUp .18s ease",
    }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "18px 20px 14px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="eyebrow" style={{ color: isTopic ? "var(--clay)" : "var(--accent)", marginBottom: 7 }}>
            {isTopic ? "◆ Topic" : "↳ Finding"}
          </div>
          <h2 className="serif" style={{ fontSize: 19, fontWeight: 500, lineHeight: 1.25, letterSpacing: "-0.01em", margin: 0, color: "var(--ink)", textWrap: "balance" }}>
            {node.title}
          </h2>
          <div className="mono" style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 9, fontSize: 10.5, color: "var(--muted)" }}>
            {node.childCount ? <span>{node.childCount} {node.childCount === 1 ? "BRANCH" : "BRANCHES"}</span> : null}
            {sources?.length ? <span>{sources.length} SRC</span> : null}
            {node.tokens && node.tokens > 0 ? <span title={node.costUsd !== undefined ? `${node.tokens.toLocaleString()} tokens · $${node.costUsd.toFixed(3)}` : `${node.tokens.toLocaleString()} tokens`}>≈ {formatTokens(node.tokens)} tokens</span> : null}
          </div>
        </div>
        {tts.supported && body && !researching && <ReadAloudBar tts={tts} />}
        <button className="iconbtn bare" title="Close" onClick={onClose} style={{ flexShrink: 0 }}><Icon name="x" size={16} /></button>
      </div>

      {/* body */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "22px 40px 36px" }}>
        {researching && !body ? (
          <div>
            <div className="eyebrow" style={{ color: "var(--clay)", marginBottom: 10, display: "flex", gap: 8, alignItems: "center" }}>
              Researching…
              <span style={{ display: "inline-flex", gap: 4 }}>
                {[0, 1, 2].map((i) => <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--clay)", animation: `breathe 1.4s ease-in-out ${i * 0.18}s infinite` }} />)}
              </span>
            </div>
            {activity && <div className="mono" style={{ fontSize: 11, lineHeight: 1.4, color: "var(--muted)" }}>{activity}</div>}
          </div>
        ) : (
          <>
            <div ref={bodyRef} onMouseUp={onBodyMouseUp} className="md-body serif"
              style={{ fontSize: 15, lineHeight: 1.62, color: "var(--ink-soft)", userSelect: "text", WebkitUserSelect: "text", cursor: "text" }}>
              {body === undefined
                ? <span className="mono" style={{ color: "var(--faint)" }}>{error ?? "Loading…"}</span>
                : body ? renderMarkdown(body, anchors, onMark) : <span className="mono" style={{ color: "var(--faint)" }}>(no content)</span>}
            </div>
            <SourceList sources={sources} />
            <div ref={stripRef}>
              <PendingStrip items={pendingChildren ?? []} onRetry={onRetryChild} onDismiss={onDismissChild} />
            </div>
            {askAnchor ? (
              <AskBox key={anchorKey(askAnchor)} anchorText={askAnchor.text} onAsk={(q) => { onAsk(q, askAnchor); setAskAnchor(null); }} onCancel={() => setAskAnchor(null)} />
            ) : (
              <AskBox key="free" onAsk={(q) => onAsk(q)} />
            )}
          </>
        )}
      </div>
    </aside>

    {/* Floating overlays go through a portal: the aside is transformed + overflow-hidden, which would
        otherwise clip position:fixed children (that's what cut the follow-up UI off). */}
    {popover && createPortal(
      <>
        <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setPopover(null)} />
        <div style={{ position: "fixed", left: Math.min(popover.x, window.innerWidth - 280), top: popover.y, zIndex: 41, width: 264, background: "var(--card)", border: "1px solid var(--line-strong)", borderRadius: "var(--r-md)", boxShadow: "var(--shadow-md)", padding: "12px 14px" }}>
          <div className="eyebrow" style={{ fontSize: 9.5, color: "var(--accent)", marginBottom: 6 }}>Follow-up</div>
          <div className="serif" style={{ fontSize: 14, lineHeight: 1.35, color: "var(--ink)" }}>
            {popover.link.pending ? <span style={{ color: "var(--muted)" }}>Thinking…</span> : popover.link.childTitle}
          </div>
          {!popover.link.pending && (
            <button className="btn btn-primary btn-sm" style={{ marginTop: 10, width: "100%", justifyContent: "center" }}
              onClick={() => { const id = popover.link.childId; setPopover(null); onSelectChild(id); }}>
              Open <Icon name="arrowUpRight" size={13} />
            </button>
          )}
        </div>
      </>,
      document.body,
    )}

    {sel && createPortal(
      <button className="btn btn-primary btn-sm" style={{ position: "fixed", left: Math.min(sel.x, window.innerWidth - 130), top: Math.min(sel.y, window.innerHeight - 48), zIndex: 41, boxShadow: "var(--shadow-md)" }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => { setAskAnchor(sel.anchor); setSel(null); window.getSelection()?.removeAllRanges(); }}>
        <Icon name="branch" size={13} /> Follow up
      </button>,
      document.body,
    )}
    </>
  );
}
