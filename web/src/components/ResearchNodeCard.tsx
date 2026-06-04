import { memo, useRef, useState } from "react";
import { Handle, Position as RFPosition, type NodeProps } from "@xyflow/react";
import { Icon } from "./ui";
import type { Anchor } from "../types";
import { anchorFromSelection } from "../graph/anchor";

// char offset of a node/offset pair within container.textContent
function offsetWithin(container: HTMLElement, node: Node, nodeOffset: number): number {
  let total = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (n === node) return total + nodeOffset;
    total += (n.textContent ?? "").length;
  }
  return total;
}

export interface CardData {
  kind: "topic" | "finding";
  title: string;
  expanded: boolean;
  pending: boolean;
  body?: string;
  sources?: string[];
  childCount?: number; // direct findings, for the topic card meta line
  error?: string;
  onToggle: () => void; // expand/collapse (also triggers lazy body fetch)
  onAsk: (question: string) => void; // branch a follow-up question off this node
  onRetry?: () => void; // present on errored pending nodes
  onRemove?: () => void; // prune this node (absent on the topic/root)
  id?: string;          // node id (used for updateNodeInternals in Phase 4)
  draft?: boolean;
  anchorText?: string;  // for a draft card: the quoted span it branches from
  anchors?: Anchor[];   // child-anchors to highlight (Phase 3)
  onFollowUp?: (anchor: Anchor) => void;
  onDraftSubmit?: (question: string) => void; // draft: fire the branch
  onDraftCancel?: () => void;                  // draft: discard
  [key: string]: unknown; // React Flow's NodeProps["data"] is an open record
}

/* ---- sources list (shown in an expanded finding) ---- */
function SourceList({ sources }: { sources?: string[] }) {
  if (!sources || !sources.length) return null;
  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
      <div className="eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>
        Sources · {sources.length}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {sources.map((s) => {
          const href = /^https?:\/\//.test(s) ? s : `https://${s}`;
          return (
            <a
              key={s}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="nodrag mono"
              style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--accent)", textDecoration: "none", lineHeight: 1.3 }}
            >
              <Icon name="link" size={13} style={{ flexShrink: 0, opacity: 0.7 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

/* ---- branch-a-question box ---- */
function AskBox({ onAsk }: { onAsk: (q: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const submit = () => {
    const q = draft.trim();
    if (!q) return;
    onAsk(q);
    setDraft("");
    setOpen(false);
  };
  if (!open) {
    return (
      <button
        className="nodrag"
        onClick={() => setOpen(true)}
        style={{
          marginTop: 16,
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "11px 13px",
          borderRadius: "var(--r-md)",
          cursor: "pointer",
          border: "1px dashed var(--accent-line)",
          background: "var(--accent-soft)",
          color: "var(--accent-deep)",
          fontFamily: "var(--sans)",
          fontSize: 13.5,
          fontWeight: 500,
          transition: "background .12s ease",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "oklch(0.93 0.03 256)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "var(--accent-soft)")}
      >
        <Icon name="branch" size={15} /> Branch a question from here
      </button>
    );
  }
  return (
    <div className="nodrag" style={{ marginTop: 16 }}>
      <textarea
        autoFocus
        value={draft}
        rows={2}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") {
            setOpen(false);
            setDraft("");
          }
        }}
        placeholder="Ask a follow-up — Claude answers as a new child node…"
        className="field"
        style={{ fontSize: 13.5, resize: "none", lineHeight: 1.45 }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); setDraft(""); }}>Cancel</button>
        <button className="btn btn-primary btn-sm" disabled={!draft.trim()} onClick={submit}>
          <Icon name="sparkle" size={14} /> Ask
        </button>
      </div>
    </div>
  );
}

/* ---- hover toolbar (copy + prune) ---- */
function CardToolbar({ show, copyText, onRemove }: { show: boolean; copyText?: string; onRemove?: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (copyText && navigator.clipboard) navigator.clipboard.writeText(copyText).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div
      className="nodrag"
      style={{
        position: "absolute",
        top: 9,
        right: 9,
        display: "flex",
        gap: 2,
        zIndex: 2,
        padding: 3,
        background: "var(--card)",
        border: "1px solid var(--line)",
        borderRadius: 9,
        boxShadow: "var(--shadow-sm)",
        opacity: show ? 1 : 0,
        transform: show ? "none" : "translateY(-3px)",
        transition: "opacity .12s ease, transform .12s ease",
        pointerEvents: show ? "auto" : "none",
      }}
    >
      <button className="iconbtn bare accent" title={copied ? "Copied" : "Copy text"} onClick={copy}>
        <Icon name={copied ? "check" : "copy"} size={14} />
      </button>
      {onRemove && (
        <button className="iconbtn bare danger" title="Prune this node" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
          <Icon name="trash" size={14} />
        </button>
      )}
    </div>
  );
}

/* ---- draft compose card (selection-anchored follow-up) ---- */
function DraftCard({ anchorText, onSubmit, onCancel }: { anchorText: string; onSubmit: (q: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState("");
  const submit = () => { const q = draft.trim(); if (q) onSubmit(q); };
  return (
    <div style={{ position: "relative", width: 320, background: "var(--card)", borderRadius: "var(--r-lg)", border: "1px dashed var(--accent-line)", boxShadow: "var(--shadow-md)", padding: "16px 18px" }}>
      <Handle type="target" position={RFPosition.Left} />
      <div className="eyebrow" style={{ color: "var(--accent-deep)", marginBottom: 8 }}>↳ Follow up</div>
      {anchorText && (
        <blockquote className="serif nodrag" style={{ margin: "0 0 12px", paddingLeft: 10, borderLeft: "2px solid var(--accent-line)", fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.4 }}>
          “{anchorText.length > 140 ? anchorText.slice(0, 139) + "…" : anchorText}”
        </blockquote>
      )}
      <textarea autoFocus value={draft} rows={2} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } if (e.key === "Escape") onCancel(); }}
        placeholder="Ask about this selection — Claude answers here…" className="field nodrag"
        style={{ fontSize: 13.5, resize: "none", lineHeight: 1.45 }} />
      <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost btn-sm nodrag" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary btn-sm nodrag" disabled={!draft.trim()} onClick={submit}><Icon name="sparkle" size={14} /> Ask</button>
      </div>
      <Handle type="source" position={RFPosition.Right} />
    </div>
  );
}

function ResearchNodeCardImpl({ data }: NodeProps) {
  const d = data as CardData;
  const isTopic = d.kind === "topic";
  const [hover, setHover] = useState(false);

  // ---- selection → follow-up (finding branch) ----
  const cardRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [sel, setSel] = useState<{ anchor: Anchor; top: number; left: number } | null>(null);

  const onBodyMouseUp = () => {
    const s = window.getSelection();
    const body = bodyRef.current;
    if (!s || s.isCollapsed || !body) { setSel(null); return; }
    const range = s.getRangeAt(0);
    if (!body.contains(range.startContainer) || !body.contains(range.endContainer)) { setSel(null); return; }
    const text = s.toString();
    if (!text.trim()) { setSel(null); return; }
    const start = offsetWithin(body, range.startContainer, range.startOffset);
    const anchor = anchorFromSelection(body.textContent ?? "", text, start);
    const r = range.getBoundingClientRect();
    const cardRect = (cardRef.current ?? body).getBoundingClientRect();
    setSel({ anchor, top: r.bottom - cardRect.top + 6, left: r.left - cardRect.left });
  };

  // ---- draft compose node ----
  if (d.draft) {
    return <DraftCard anchorText={d.anchorText ?? ""} onSubmit={d.onDraftSubmit!} onCancel={d.onDraftCancel!} />;
  }

  // ---- pending (optimistic) node ----
  if (d.pending) {
    return (
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: "relative",
          width: 280,
          background: "var(--card)",
          borderRadius: "var(--r-lg)",
          border: "1px dashed var(--clay-line)",
          boxShadow: "var(--shadow-sm)",
          padding: "16px 18px",
        }}
      >
        <Handle type="target" position={RFPosition.Left} />
        {d.onRemove && <CardToolbar show={hover} copyText={d.title} onRemove={d.onRemove} />}
        <div className="eyebrow" style={{ color: "var(--clay)", marginBottom: 10, display: "flex", gap: 8, alignItems: "center" }}>
          {d.error ? "Failed" : "Researching"}
          {!d.error && (
            <span style={{ display: "inline-flex", gap: 4 }}>
              {[0, 1, 2].map((i) => (
                <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--clay)", animation: `breathe 1.4s ease-in-out ${i * 0.18}s infinite` }} />
              ))}
            </span>
          )}
        </div>
        <div className="serif" style={{ fontSize: 15.5, lineHeight: 1.32, color: "var(--ink-soft)" }}>{d.title}</div>
        {d.error && (
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1, fontSize: 12, color: "var(--danger)" }}>{d.error}</span>
            {d.onRemove && <button className="btn btn-ghost btn-sm nodrag" onClick={d.onRemove}>Dismiss</button>}
            {d.onRetry && (
              <button className="btn btn-primary btn-sm nodrag" onClick={d.onRetry}>
                <Icon name="retry" size={13} /> Retry
              </button>
            )}
          </div>
        )}
        <Handle type="source" position={RFPosition.Right} />
      </div>
    );
  }

  // ---- topic (root) node ----
  if (isTopic) {
    return (
      <div
        style={{
          width: 340,
          background: "var(--clay-soft)",
          borderRadius: "var(--r-lg)",
          border: "1.5px solid var(--clay)",
          boxShadow: "var(--shadow-md)",
          padding: "18px 20px",
        }}
      >
        <Handle type="target" position={RFPosition.Left} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span className="eyebrow" style={{ color: "var(--clay)" }}>◆ Topic</span>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--clay)" }}>ROOT</span>
        </div>
        <h2 className="serif" style={{ fontSize: 21, fontWeight: 500, lineHeight: 1.22, letterSpacing: "-0.01em", margin: 0, color: "var(--ink)", textWrap: "balance" }}>
          {d.title}
        </h2>
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 12 }}>
          {d.childCount ?? 0} {d.childCount === 1 ? "FINDING" : "FINDINGS"}&nbsp;·&nbsp;DEEP PASS COMPLETE
        </div>
        <Handle type="source" position={RFPosition.Right} />
      </div>
    );
  }

  // ---- finding node (collapsed / expanded) ----
  const width = d.expanded ? 384 : 268;
  return (
    <div
      ref={cardRef}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        width,
        background: "var(--card)",
        borderRadius: "var(--r-lg)",
        border: "1px solid var(--line-strong)",
        boxShadow: d.expanded ? "var(--shadow-md)" : "var(--shadow-sm)",
        overflow: "hidden",
        transition: "width .18s ease, box-shadow .18s ease",
      }}
    >
      <Handle type="target" position={RFPosition.Left} />
      <CardToolbar show={hover} copyText={d.body || d.title} onRemove={d.onRemove} />

      {/* header — click toggles expand; whole node is the drag handle */}
      <div
        onClick={d.onToggle}
        style={{
          display: "flex",
          gap: 11,
          alignItems: "flex-start",
          padding: "14px 16px",
          background: d.expanded ? "var(--card-2)" : "transparent",
          borderBottom: d.expanded ? "1px solid var(--line)" : "none",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            marginTop: 1,
            color: "var(--muted)",
            display: "flex",
            flexShrink: 0,
            transform: d.expanded ? "rotate(0deg)" : "rotate(-90deg)",
            transition: "transform .18s ease",
          }}
        >
          <Icon name="chevron" size={17} />
        </span>
        <span className="serif" style={{ flex: 1, fontSize: 15.5, lineHeight: 1.3, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.005em" }}>
          {d.title}
        </span>
      </div>

      {/* collapsed meta */}
      {!d.expanded && (
        <div className="mono" style={{ display: "flex", gap: 12, padding: "0 16px 13px 43px", fontSize: 10.5, color: "var(--muted)" }}>
          <span>{(d.sources?.length ?? 0)} SRC</span>
          <span>FINDING</span>
        </div>
      )}

      {/* expanded body */}
      {d.expanded && (
        <div style={{ padding: "16px 18px 18px" }}>
          <div
            ref={bodyRef}
            onMouseUp={onBodyMouseUp}
            className="nodrag serif"
            style={{ fontSize: 15, lineHeight: 1.62, color: "var(--ink-soft)", maxHeight: 260, overflow: "auto", whiteSpace: "pre-wrap" }}
          >
            {d.body === undefined ? <span className="mono" style={{ color: "var(--faint)" }}>Loading…</span> : d.body || <span className="mono" style={{ color: "var(--faint)" }}>(no text)</span>}
          </div>
          <SourceList sources={d.sources} />
          <AskBox onAsk={d.onAsk} />
        </div>
      )}

      {sel && d.onFollowUp && (
        <button className="btn btn-primary btn-sm nodrag" style={{ position: "absolute", top: sel.top, left: sel.left, zIndex: 5, boxShadow: "var(--shadow-md)" }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { d.onFollowUp!(sel.anchor); window.getSelection()?.removeAllRanges(); setSel(null); }}>
          <Icon name="branch" size={13} /> Follow up
        </button>
      )}

      <Handle type="source" position={RFPosition.Right} />
    </div>
  );
}

export const ResearchNodeCard = memo(ResearchNodeCardImpl);
