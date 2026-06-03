import { useCallback, useEffect, useState } from "react";
import { Library } from "./components/Library";
import { Canvas } from "./components/Canvas";
import { LoadingCanvas } from "./components/LoadingCanvas";
import { api } from "./api";
import type { GraphIndex } from "./types";

type View =
  | { name: "home" }
  | { name: "loading"; topic: string; error?: string }
  | { name: "canvas"; projectId: string };

export function App() {
  const [view, setView] = useState<View>({ name: "home" });
  const [index, setIndex] = useState<GraphIndex | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const projectId = view.name === "canvas" ? view.projectId : null;
  const reload = useCallback(async (id: string) => setIndex(await api.getProject(id)), []);
  useEffect(() => {
    if (projectId) void reload(projectId);
  }, [projectId, reload]);

  const start = useCallback(async (topic: string) => {
    setView({ name: "loading", topic });
    try {
      const { projectId } = await api.createTopic(topic);
      setView({ name: "canvas", projectId });
    } catch (e) {
      setView({ name: "loading", topic, error: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const open = useCallback((id: string) => setView({ name: "canvas", projectId: id }), []);
  const home = useCallback(() => {
    setView({ name: "home" });
    setIndex(null);
  }, []);

  const synthesize = useCallback(async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      setReport(await api.synthesize(projectId));
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  if (view.name === "home") return <Library onStart={start} onOpen={open} />;

  if (view.name === "loading") {
    return (
      <div className="app">
        <div className="main" style={{ height: "100vh" }}>
          <LoadingCanvas topic={view.topic} error={view.error} onRetry={() => void start(view.topic)} onHome={home} />
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="topbar">
        <button onClick={home}>← Home</button>
        <strong>{index?.topic ?? projectId}</strong>
        <span style={{ flex: 1 }} />
        <button onClick={() => void synthesize()} disabled={busy}>
          Synthesize
        </button>
      </div>
      <div className="main" style={{ height: "calc(100vh - 48px)" }}>
        {index && projectId && <Canvas projectId={projectId} index={index} onReloadIndex={() => reload(projectId)} />}
      </div>
      {report !== null && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", padding: 40 }}
          onClick={() => setReport(null)}
        >
          <div
            style={{ background: "#fff", padding: 24, maxWidth: 800, margin: "0 auto", maxHeight: "80vh", overflow: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={() => setReport(null)}>Close</button>
            <pre style={{ whiteSpace: "pre-wrap" }}>{report}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
