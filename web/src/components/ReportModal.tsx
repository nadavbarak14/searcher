import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Icon } from "./ui";

export type ReportState =
  | { status: "loading" }
  | { status: "ready"; markdown: string; generatedAt?: string; stale?: boolean }
  | { status: "error"; error: string };

/** "Jun 15, 2026, 2:14 PM" → a short, locale-aware label; empty string if unparseable. */
function formatWhen(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/* ---- minimal inline renderer: **bold**, `code`, [text](url) ---- */
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
function renderInline(text: string, keyBase: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key} style={{ fontWeight: 600, color: "var(--ink)" }}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={key} className="mono" style={{ fontSize: "0.88em", background: "var(--card-2)", padding: "1px 5px", borderRadius: 5 }}>{part.slice(1, -1)}</code>;
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      return <a key={key} href={link[2]} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>{link[1]}</a>;
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

const paraStyle: React.CSSProperties = { fontSize: 17, lineHeight: 1.66, color: "var(--ink-soft)", margin: "0 0 14px", maxWidth: "64ch" };
const headStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, letterSpacing: "0.02em", margin: "30px 0 12px",
  color: "var(--accent-deep)", textTransform: "uppercase", fontFamily: "var(--mono)",
};

/* ---- block renderer: headings, paragraphs, lists ---- */
function renderMarkdown(md: string): ReactNode[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushPara = () => {
    if (!para.length) return;
    out.push(<p key={`p${key++}`} className="serif" style={paraStyle}>{renderInline(para.join(" "), `p${key}`)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    const items = list.items;
    out.push(
      <Tag key={`l${key++}`} className="serif" style={{ margin: "0 0 16px", paddingLeft: 22, color: "var(--ink-soft)" }}>
        {items.map((it, i) => (
          <li key={i} style={{ fontSize: 16.5, lineHeight: 1.6, marginBottom: 6 }}>{renderInline(it, `li${key}-${i}`)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };
  const flush = () => { flushPara(); flushList(); };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const level = h[1].length;
      const text = h[2];
      if (level === 1) {
        out.push(
          <h1 key={`h${key++}`} className="serif" style={{ fontSize: 34, fontWeight: 500, lineHeight: 1.12, letterSpacing: "-0.02em", margin: "0 0 16px", color: "var(--ink)", textWrap: "balance" }}>
            {renderInline(text, `h${key}`)}
          </h1>,
        );
      } else {
        out.push(<h2 key={`h${key++}`} style={headStyle}>{renderInline(text, `h${key}`)}</h2>);
      }
      continue;
    }

    const ul = /^[-*]\s+(.*)$/.exec(line);
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      const item = (ul ? ul[1] : ol![1]);
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] }; }
      list.items.push(item);
      continue;
    }

    flushList();
    para.push(line.trim());
  }
  flush();
  return out;
}

export function ReportModal({ state, onClose, topic, onResynthesize, resynthesizing }: { state: ReportState | null; onClose: () => void; topic: string; onResynthesize?: () => void; resynthesizing?: boolean }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, onClose]);

  if (!state) return null;
  const markdown = state.status === "ready" ? state.markdown : "";
  const generatedAt = state.status === "ready" ? state.generatedAt : undefined;
  const stale = state.status === "ready" && state.stale === true;

  const copy = () => {
    if (markdown && navigator.clipboard) navigator.clipboard.writeText(markdown).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const exportMd = () => {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "report"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", justifyContent: "flex-end", background: "oklch(0.3 0.02 60 / 0.32)", animation: "fadeIn .15s ease" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(680px, 92vw)", height: "100%", background: "var(--paper)", boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column", animation: "slideIn .22s ease" }}
      >
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 28px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
          <span style={{ color: "var(--clay)", display: "flex" }}><Icon name="sparkle" size={20} /></span>
          <div style={{ flex: 1 }}>
            <div className="eyebrow">Synthesis</div>
            {generatedAt && <div className="mono" style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 2 }}>Generated {formatWhen(generatedAt)}</div>}
          </div>
          <button className="btn btn-sm" onClick={copy} disabled={state.status !== "ready"}>
            <Icon name={copied ? "check" : "copy"} size={14} /> {copied ? "Copied" : "Copy"}
          </button>
          <button className="btn btn-sm" onClick={exportMd} disabled={state.status !== "ready"}>
            <Icon name="arrowUpRight" size={14} /> Export .md
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>

        {/* out-of-date strip: the graph changed since this report was generated */}
        {stale && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 28px", background: "var(--clay-soft)", borderBottom: "1px solid var(--clay-line)", flexShrink: 0 }}>
            <span style={{ flex: 1, fontSize: 13, color: "var(--clay)", lineHeight: 1.4 }}>
              This report is out of date — the graph changed since it was generated.
            </span>
            {onResynthesize && (
              <button className="btn btn-primary btn-sm" onClick={onResynthesize} disabled={resynthesizing}>
                <Icon name="retry" size={14} /> {resynthesizing ? "Re-synthesizing…" : "Re-synthesize"}
              </button>
            )}
          </div>
        )}

        {/* body */}
        {state.status === "loading" && (
          <div style={{ flex: 1, display: "grid", placeItems: "center" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 18 }}>
                {[0, 1, 2].map((i) => (
                  <span key={i} style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--clay)", animation: `breathe 1.4s ease-in-out ${i * 0.18}s infinite` }} />
                ))}
              </div>
              <p className="serif" style={{ fontSize: 17, color: "var(--ink-soft)", margin: 0 }}>Reading every node and writing the report…</p>
              <p className="mono" style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 8 }}>RUNS ON YOUR SUBSCRIPTION</p>
            </div>
          </div>
        )}

        {state.status === "error" && (
          <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 40 }}>
            <div style={{ textAlign: "center", maxWidth: 420 }}>
              <div className="eyebrow" style={{ color: "var(--danger)", marginBottom: 10 }}>Synthesis failed</div>
              <p style={{ fontSize: 15, lineHeight: 1.5, color: "var(--ink-soft)" }}>{state.error}</p>
            </div>
          </div>
        )}

        {state.status === "ready" && (
          <article style={{ overflow: "auto", padding: "40px 56px 80px" }}>
            <div className="eyebrow" style={{ color: "var(--clay)", marginBottom: 18 }}>Synthesized from this graph</div>
            {renderMarkdown(markdown)}
          </article>
        )}
      </div>
    </div>
  );
}
