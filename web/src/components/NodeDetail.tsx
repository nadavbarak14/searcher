import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { ResearchNode, Anchor } from "../types";
import { computeAnchor } from "../anchor";

export function NodeDetail({
  node, onBranch, busy,
}: {
  node: ResearchNode;
  onBranch: (anchor: Anchor, question: string) => void;
  busy: boolean;
}) {
  const [selection, setSelection] = useState("");
  const [question, setQuestion] = useState("");

  function captureSelection() {
    const sel = window.getSelection()?.toString().trim() ?? "";
    if (sel) setSelection(sel);
  }

  function submit() {
    const text = selection || node.body.slice(0, 40);
    const anchor = computeAnchor(node.body, text, node.body.indexOf(text));
    onBranch(anchor, question.trim());
    setQuestion("");
  }

  return (
    <div className="detail">
      <h3>{node.question}</h3>
      <div onMouseUp={captureSelection}>
        <ReactMarkdown>{node.body || "_(topic root)_"}</ReactMarkdown>
      </div>
      {node.sources?.length > 0 && (
        <div className="sources">
          <strong>Sources</strong>
          {node.sources.map((s) => <a key={s} href={s} target="_blank" rel="noreferrer">{s}</a>)}
        </div>
      )}
      <hr />
      <p className="muted">Selected: {selection ? `"${selection}"` : "(select text above to anchor a question)"}</p>
      <textarea value={question} onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask a follow-up question…" rows={3} style={{ width: "100%" }} disabled={busy} />
      <button onClick={submit} disabled={busy || !question.trim()}>{busy ? "Researching…" : "Branch question"}</button>
    </div>
  );
}
