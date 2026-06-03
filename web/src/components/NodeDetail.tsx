import { useState } from "react";
import type { ResearchNode, Anchor, PendingQuestion } from "../types";
import { computeAnchor } from "../anchor";
import { segmentBody, type Mark } from "../highlights";
import { usePendingQuestions } from "../usePendingQuestions";
import { api } from "../api";

export function NodeDetail({
  node, projectId, exploredChildren, onChanged, onSelectChild,
}: {
  node: ResearchNode;
  projectId: string;
  exploredChildren: { id: string; anchor: Anchor; question: string }[];
  onChanged: () => void | Promise<void>;
  onSelectChild: (nodeId: string) => void;
}) {
  const [pending, setPending] = usePendingQuestions(projectId, node.id);
  const [selection, setSelection] = useState("");
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);

  function captureSelection() {
    const sel = window.getSelection()?.toString().trim() ?? "";
    if (sel) setSelection(sel);
  }

  function addQuestion() {
    const q = draft.trim();
    if (!q || !selection) return; // a question must be anchored to a real selection
    const anchor = computeAnchor(node.body, selection, node.body.indexOf(selection));
    setPending([...pending, { id: crypto.randomUUID(), anchor, question: q }]);
    setDraft("");
    setSelection("");
  }

  function removeQuestion(id: string) {
    setPending(pending.filter((p) => p.id !== id));
  }

  async function runAll() {
    if (pending.length === 0) return;
    setRunning(true);
    try {
      const items = pending.map((p) => ({ parentId: node.id, anchor: p.anchor, question: p.question }));
      const { failures } = await api.branchBatch(projectId, items);
      const failed = new Map(failures.map((f) => [f.index, f.error]));
      const remaining = pending
        .map((p, i) => (failed.has(i) ? { ...p, error: failed.get(i) as string } : null))
        .filter((p): p is NonNullable<typeof p> => p !== null) as PendingQuestion[];
      setPending(remaining);
      await onChanged();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // `pending` here is the same snapshot used to build `items`; inputs are disabled
      // while `running`, so no concurrent mutation can race this update.
      setPending(pending.map((p) => ({ ...p, error: msg })));
    } finally {
      setRunning(false);
    }
  }

  // Build marks: explored children first (so they win on overlap), then pending with number badges.
  const marks: { anchor: Anchor; mark: Mark }[] = [
    ...exploredChildren.map((c) => ({ anchor: c.anchor, mark: { kind: "explored", label: "", ref: c.id } as Mark })),
    ...pending.map((p, i) => ({ anchor: p.anchor, mark: { kind: "pending", label: String(i + 1), ref: p.id } as Mark })),
  ];
  const segments = node.body ? segmentBody(node.body, marks) : [];

  return (
    <div className="detail">
      <h3>{node.question}</h3>

      <div className="body" onMouseUp={captureSelection} style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
        {node.body
          ? segments.map((s, i) =>
              s.mark ? (
                <mark
                  key={i}
                  onClick={s.mark.kind === "explored" ? () => onSelectChild(s.mark!.ref) : undefined}
                  style={{
                    cursor: s.mark.kind === "explored" ? "pointer" : "text",
                    background: s.mark.kind === "explored" ? "#cfe3ff" : "transparent",
                    borderBottom: s.mark.kind === "pending" ? "2px dashed #d08700" : "none",
                    padding: "0 1px",
                  }}
                  title={s.mark.kind === "explored" ? "Open child node" : `Pending question ${s.mark.label}`}
                >
                  {s.text}
                  {s.mark.kind === "pending" ? <sup style={{ color: "#d08700" }}>{s.mark.label}</sup> : null}
                </mark>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )
          : <em>(This node has no body text to annotate. Open one of its findings to ask anchored questions.)</em>}
      </div>

      {node.sources?.length > 0 && (
        <div className="sources">
          <strong>Sources</strong>
          {node.sources.map((s) => <a key={s} href={s} target="_blank" rel="noreferrer">{s}</a>)}
        </div>
      )}

      <hr />

      <p className="muted">Selected: {selection ? `"${selection}"` : "(select text above to anchor a question)"}</p>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Type a question, then Add it to the batch…"
        rows={3}
        style={{ width: "100%" }}
        disabled={running}
      />
      <button onClick={addQuestion} disabled={running || !draft.trim() || !selection}>Add question</button>

      {pending.length > 0 && (
        <div className="pending" style={{ marginTop: 12 }}>
          <strong>Pending questions ({pending.length})</strong>
          <ol>
            {pending.map((p) => (
              <li key={p.id} style={{ marginBottom: 6 }}>
                <span className="muted">"{p.anchor.text.slice(0, 40)}"</span> — {p.question}
                <button onClick={() => removeQuestion(p.id)} style={{ marginLeft: 8 }} disabled={running}>delete</button>
                {p.error ? <div style={{ color: "#b00020" }}>⚠ {p.error}</div> : null}
              </li>
            ))}
          </ol>
          <button onClick={runAll} disabled={running}>
            {running ? "Researching…" : `Run all ${pending.length} →`}
          </button>
        </div>
      )}
    </div>
  );
}
