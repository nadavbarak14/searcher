import { memo, useState } from "react";
import { Handle, Position as RFPosition, type NodeProps } from "@xyflow/react";

export interface CardData {
  kind: "topic" | "finding";
  title: string;
  expanded: boolean;
  pending: boolean;
  body?: string;
  error?: string;
  onToggle: () => void; // expand/collapse (also triggers lazy body fetch)
  onAsk: (question: string, selection?: string) => void; // selection = ask about a specific span
  onRetry?: () => void; // present on errored pending nodes
  [key: string]: unknown; // React Flow's NodeProps["data"] is an open record
}

const toggleBtn: React.CSSProperties = {
  width: 22,
  height: 22,
  lineHeight: "20px",
  textAlign: "center",
  border: "1px solid #999",
  borderRadius: 4,
  background: "#fff",
  cursor: "pointer",
  fontSize: 14,
  padding: 0,
};

function ResearchNodeCardImpl({ data }: NodeProps) {
  const d = data as CardData;
  const [asking, setAsking] = useState(false);
  const [draft, setDraft] = useState("");
  const [selection, setSelection] = useState("");
  const isTopic = d.kind === "topic";

  const submit = () => {
    const q = draft.trim();
    if (!q) return;
    d.onAsk(q, selection || undefined);
    setDraft("");
    setAsking(false);
    setSelection("");
  };

  const captureSelection = () => {
    const sel = window.getSelection()?.toString().trim() ?? "";
    setSelection(sel);
  };

  return (
    <div
      style={{
        width: d.expanded ? 340 : 210,
        background: "#fff",
        borderRadius: 10,
        border: isTopic ? "2px solid #1558d6" : d.pending ? "1px dashed #d08700" : "1px solid #bbb",
        boxShadow: "0 1px 4px rgba(0,0,0,.08)",
        fontSize: 13,
        overflow: "hidden",
      }}
    >
      <Handle type="target" position={RFPosition.Top} />

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          padding: "8px 10px",
          background: isTopic ? "#eaf1ff" : "#f7f7f7",
        }}
      >
        {d.pending ? (
          <span aria-label="researching">⏳</span>
        ) : (
          <button
            className="nodrag"
            style={toggleBtn}
            title={d.expanded ? "Collapse" : "Expand"}
            onClick={(e) => {
              e.stopPropagation();
              d.onToggle();
            }}
          >
            {d.expanded ? "–" : "+"}
          </button>
        )}
        <strong style={{ flex: 1 }}>{isTopic ? `★ ${d.title}` : d.title}</strong>
      </div>

      {d.expanded && (
        <div style={{ padding: "8px 10px" }}>
          {!isTopic && (
            <div
              onMouseUp={captureSelection}
              style={{ whiteSpace: "pre-wrap", lineHeight: 1.45, maxHeight: 280, overflow: "auto", userSelect: "text" }}
            >
              {d.body === undefined ? (
                <em className="muted">loading…</em>
              ) : d.body ? (
                d.body
              ) : (
                <em className="muted">(no text)</em>
              )}
            </div>
          )}

          {!asking ? (
            <div className="nodrag" style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button onClick={() => setAsking(true)}>
                {selection ? `Ask about “${selection.slice(0, 24)}${selection.length > 24 ? "…" : ""}”` : "＋ Ask a question"}
              </button>
              {selection && <button onClick={() => setSelection("")}>clear</button>}
            </div>
          ) : (
            <div className="nodrag" style={{ marginTop: 8 }}>
              {selection && (
                <div className="muted" style={{ marginBottom: 4, fontSize: 12 }}>
                  about: “{selection.slice(0, 48)}{selection.length > 48 ? "…" : ""}”
                </div>
              )}
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Type your question…"
                  style={{ flex: 1, padding: 6 }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submit();
                    if (e.key === "Escape") {
                      setAsking(false);
                      setDraft("");
                    }
                  }}
                />
                <button disabled={!draft.trim()} onClick={submit}>
                  Send
                </button>
                <button
                  onClick={() => {
                    setAsking(false);
                    setDraft("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {d.pending && d.error && (
        <div style={{ padding: "6px 10px", color: "#b00020" }}>
          ⚠ {d.error}{" "}
          {d.onRetry && (
            <button className="nodrag" onClick={d.onRetry}>
              retry
            </button>
          )}
        </div>
      )}

      <Handle type="source" position={RFPosition.Bottom} />
    </div>
  );
}

export const ResearchNodeCard = memo(ResearchNodeCardImpl);
