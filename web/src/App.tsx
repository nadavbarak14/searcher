import { useEffect, useState, useCallback } from "react";
import { Library } from "./components/Library";
import { GraphView } from "./components/GraphView";
import { NodeDetail } from "./components/NodeDetail";
import { api } from "./api";
import type { GraphIndex, ResearchNode } from "./types";

export function App() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [index, setIndex] = useState<GraphIndex | null>(null);
  const [node, setNode] = useState<ResearchNode | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);

  const refresh = useCallback(async (id: string) => setIndex(await api.getProject(id)), []);
  useEffect(() => { if (projectId) refresh(projectId); }, [projectId, refresh]);

  async function openNode(nodeId: string) {
    if (!projectId) return;
    setNode(await api.getNode(projectId, nodeId));
  }

  async function synthesize() {
    if (!projectId) return;
    setBusy(true);
    try { setReport(await api.synthesize(projectId)); } finally { setBusy(false); }
  }

  if (!projectId) return <Library onOpen={setProjectId} />;

  return (
    <div className="app">
      <div className="topbar">
        <button onClick={() => { setProjectId(null); setIndex(null); setNode(null); }}>← Library</button>
        <strong>{index?.topic ?? projectId}</strong>
        <span style={{ flex: 1 }} />
        <button onClick={synthesize} disabled={busy}>Synthesize</button>
      </div>
      <div className="main">
        {index && <GraphView index={index} onSelect={openNode} />}
        {node
          ? <NodeDetail
              node={node}
              projectId={projectId}
              exploredChildren={(index?.nodes ?? [])
                .filter((n) => n.parents.includes(node.id) && n.anchor)
                .map((n) => ({ id: n.id, anchor: n.anchor!, question: n.question }))}
              onChanged={() => refresh(projectId)}
              onSelectChild={openNode}
            />
          : <div className="detail"><p className="muted">Click a node to read it and branch questions.</p></div>}
      </div>
      {report !== null && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", padding: 40 }} onClick={() => setReport(null)}>
          <div style={{ background: "#fff", padding: 24, maxWidth: 800, margin: "0 auto", maxHeight: "80vh", overflow: "auto" }}
               onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setReport(null)}>Close</button>
            <pre style={{ whiteSpace: "pre-wrap" }}>{report}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
