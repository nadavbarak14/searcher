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
  onAsk: (question: string) => void;
  onRetry?: () => void; // present on errored pending nodes
  [key: string]: unknown; // React Flow's NodeProps["data"] is an open record
}

function ResearchNodeCardImpl({ data }: NodeProps) {
  const d = data as CardData;
  const [draft, setDraft] = useState("");
  const isTopic = d.kind === "topic";

  const submit = () => {
    const q = draft.trim();
    if (!q) return;
    d.onAsk(q);
    setDraft("");
  };

  return (
    <div
      style={{
        width: d.expanded ? 320 : 200,
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
        onClick={d.pending ? undefined : d.onToggle}
        style={{
          display: "flex",
          gap: 6,
          alignItems: "center",
          padding: "8px 10px",
          cursor: d.pending ? "default" : "pointer",
          background: isTopic ? "#eaf1ff" : "#f7f7f7",
        }}
      >
        {d.pending ? <span aria-label="researching">⏳</span> : <span>{d.expanded ? "▾" : "▸"}</span>}
        <strong style={{ flex: 1 }}>{isTopic ? `★ ${d.title}` : d.title}</strong>
      </div>

      {d.expanded && (
        <div style={{ padding: "8px 10px" }}>
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.45, maxHeight: 260, overflow: "auto" }}>
            {d.body === undefined ? (
              <em className="muted">loading…</em>
            ) : d.body ? (
              d.body
            ) : (
              <em className="muted">(no text)</em>
            )}
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
            <input
              className="nodrag"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask a question…"
              style={{ flex: 1, padding: 6 }}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            <button className="nodrag" disabled={!draft.trim()} onClick={submit}>
              Ask
            </button>
          </div>
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
