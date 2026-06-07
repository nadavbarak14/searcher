import { memo, useState } from "react";
import { Handle, Position as RFPosition, type NodeProps } from "@xyflow/react";
import { Icon } from "./ui";

/** Compact token count: 1234 → "1.2k", 12345 → "12k", 999 → "999". */
function formatTokens(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k";
  return String(n);
}

/** A small, muted "≈ Nk tokens" caption shown in a card's meta area. */
function TokenBadge({ tokens, costUsd }: { tokens?: number; costUsd?: number }) {
  if (tokens === undefined || tokens <= 0) return null;
  const title = costUsd !== undefined ? `${tokens.toLocaleString()} tokens · $${costUsd.toFixed(3)}` : `${tokens.toLocaleString()} tokens`;
  return <span className="mono" title={title} style={{ fontSize: 11, color: "var(--muted)" }}>≈ {formatTokens(tokens)} tokens</span>;
}

export interface CardData {
  kind: "topic" | "finding";
  title: string;
  pending: boolean;
  selected?: boolean;     // this node's content is open in the side panel
  childCount?: number;    // direct branches off this node
  tokens?: number;
  costUsd?: number;
  teaser?: string;        // a thread's one-line "why" (signpost)
  researched?: boolean;   // false on an unresearched thread
  researching?: boolean;  // true while being researched
  error?: string;
  activity?: string;      // latest live-activity line on a pending node
  onSelect: () => void;   // open this node in the side panel
  onRemove?: () => void;  // prune (absent on the topic)
  onRetry?: () => void;   // present on errored pending nodes
  id?: string;
  draft?: boolean;
  anchorText?: string;    // draft: the quoted span it branches from
  onDraftSubmit?: (question: string) => void;
  onDraftCancel?: () => void;
  [key: string]: unknown;
}

/* ---- hover toolbar (copy title + prune) ---- */
function CardToolbar({ show, copyText, onRemove }: { show: boolean; copyText?: string; onRemove?: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (copyText && navigator.clipboard) navigator.clipboard.writeText(copyText).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className="nodrag" style={{ position: "absolute", top: 9, right: 9, display: "flex", gap: 2, zIndex: 2, padding: 3, background: "var(--card)", border: "1px solid var(--line)", borderRadius: 9, boxShadow: "var(--shadow-sm)", opacity: show ? 1 : 0, transform: show ? "none" : "translateY(-3px)", transition: "opacity .12s ease, transform .12s ease", pointerEvents: show ? "auto" : "none" }}>
      <button className="iconbtn bare accent" title={copied ? "Copied" : "Copy title"} onClick={copy}><Icon name={copied ? "check" : "copy"} size={14} /></button>
      {onRemove && <button className="iconbtn bare danger" title="Prune this node" onClick={(e) => { e.stopPropagation(); onRemove(); }}><Icon name="trash" size={14} /></button>}
    </div>
  );
}

/* ---- draft compose card (selection-anchored follow-up, when started from canvas) ---- */
function DraftCard({ anchorText, onSubmit, onCancel }: { anchorText: string; onSubmit: (q: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState("");
  const submit = () => { const q = draft.trim(); if (q) onSubmit(q); };
  return (
    <div style={{ position: "relative", width: 320, background: "var(--card)", borderRadius: "var(--r-lg)", border: "1px dashed var(--accent-line)", boxShadow: "var(--shadow-md)", padding: "16px 18px" }}>
      <Handle type="target" position={RFPosition.Left} />
      <div className="eyebrow" style={{ color: "var(--accent-deep)", marginBottom: 8 }}>↳ Follow up</div>
      {anchorText && (
        <blockquote className="serif nodrag" style={{ margin: "0 0 12px", paddingLeft: 10, borderLeft: "2px solid var(--accent-line)", fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.4 }}>
          “{anchorText.length > 140 ? anchorText.slice(0, 140) + "…" : anchorText}”
        </blockquote>
      )}
      <textarea autoFocus value={draft} rows={2} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } if (e.key === "Escape") onCancel(); }}
        placeholder="Ask about this selection — Claude answers here…" className="field nodrag nopan nowheel"
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

  // ---- draft compose node ----
  if (d.draft) {
    return <DraftCard anchorText={d.anchorText ?? ""} onSubmit={d.onDraftSubmit!} onCancel={d.onDraftCancel!} />;
  }

  // ---- pending (optimistic) node ----
  if (d.pending) {
    return (
      <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        style={{ position: "relative", width: 280, background: "var(--card)", borderRadius: "var(--r-lg)", border: "1px dashed var(--clay-line)", boxShadow: "var(--shadow-sm)", padding: "16px 18px" }}>
        <Handle type="target" position={RFPosition.Left} />
        {d.onRemove && <CardToolbar show={hover} copyText={d.title} onRemove={d.onRemove} />}
        <div className="eyebrow" style={{ color: "var(--clay)", marginBottom: 10, display: "flex", gap: 8, alignItems: "center" }}>
          {d.error ? "Failed" : "Thinking…"}
          {!d.error && <span style={{ display: "inline-flex", gap: 4 }}>{[0, 1, 2].map((i) => <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--clay)", animation: `breathe 1.4s ease-in-out ${i * 0.18}s infinite` }} />)}</span>}
        </div>
        <div className="serif" style={{ fontSize: 15.5, lineHeight: 1.32, color: "var(--ink-soft)" }}>{d.title}</div>
        {!d.error && d.activity && <div className="mono" style={{ marginTop: 9, fontSize: 11, lineHeight: 1.4, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.activity}</div>}
        {d.error && (
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1, fontSize: 12, color: "var(--danger)" }}>{d.error}</span>
            {d.onRemove && <button className="btn btn-ghost btn-sm nodrag" onClick={d.onRemove}>Dismiss</button>}
            {d.onRetry && <button className="btn btn-primary btn-sm nodrag" onClick={d.onRetry}><Icon name="retry" size={13} /> Retry</button>}
          </div>
        )}
        <Handle type="source" position={RFPosition.Right} />
      </div>
    );
  }

  // ---- topic (root) card ----
  if (isTopic) {
    return (
      <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onClick={d.onSelect}
        style={{ position: "relative", width: 340, background: "var(--clay-soft)", borderRadius: "var(--r-lg)", border: "1.5px solid var(--clay)", boxShadow: d.selected ? "0 0 0 3px var(--clay-line), var(--shadow-md)" : "var(--shadow-md)", padding: "18px 20px", cursor: "pointer", transition: "box-shadow .15s ease" }}>
        <Handle type="target" position={RFPosition.Left} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span className="eyebrow" style={{ color: "var(--clay)" }}>◆ Topic</span>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--clay)" }}>ROOT</span>
        </div>
        <h2 className="serif" style={{ fontSize: 20, fontWeight: 500, lineHeight: 1.22, letterSpacing: "-0.01em", margin: 0, color: "var(--ink)", textWrap: "balance" }}>{d.title}</h2>
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 13, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span>{d.childCount ?? 0} {d.childCount === 1 ? "NODE" : "NODES"}</span>
          <TokenBadge tokens={d.tokens} costUsd={d.costUsd} />
          <span className="accent" style={{ color: "var(--accent-deep)", display: "inline-flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>Read <Icon name="arrowUpRight" size={12} /></span>
        </div>
        <Handle type="source" position={RFPosition.Right} />
      </div>
    );
  }

  // ---- finding card (compact) ----
  const unresearched = d.researched === false;
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onClick={d.onSelect}
      style={{ position: "relative", width: 272, background: "var(--card)", borderRadius: "var(--r-lg)", border: "1px solid var(--line-strong)", boxShadow: d.selected ? "0 0 0 3px var(--accent-line), var(--shadow-md)" : "var(--shadow-sm)", overflow: "hidden", cursor: "pointer", transition: "box-shadow .15s ease" }}>
      <Handle type="target" position={RFPosition.Left} />
      <CardToolbar show={hover} copyText={d.title} onRemove={d.onRemove} />
      <div style={{ padding: "14px 16px" }}>
        <span className="serif" style={{ display: "block", fontSize: 15.5, lineHeight: 1.3, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.005em", paddingRight: 18 }}>{d.title}</span>
        {d.teaser && <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", marginTop: 6, fontSize: 12.5, lineHeight: 1.4, color: "var(--muted)" }}>{d.teaser}</span>}
        <div className="mono" style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 11, fontSize: 10.5, color: "var(--muted)" }}>
          {unresearched ? <span>CLICK TO RESEARCH</span> : (
            <>
              {d.childCount ? <span>{d.childCount} {d.childCount === 1 ? "BRANCH" : "BRANCHES"}</span> : <span>FINDING</span>}
              <TokenBadge tokens={d.tokens} costUsd={d.costUsd} />
            </>
          )}
          <span className="accent" style={{ color: "var(--accent-deep)", display: "inline-flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>Read <Icon name="arrowUpRight" size={12} /></span>
        </div>
      </div>
      <Handle type="source" position={RFPosition.Right} />
    </div>
  );
}

export const ResearchNodeCard = memo(ResearchNodeCardImpl);
