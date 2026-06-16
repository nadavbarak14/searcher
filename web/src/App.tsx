import { useCallback, useEffect, useState } from "react";
import { Library } from "./components/Library";
import { Canvas } from "./components/Canvas";
import { LoadingCanvas } from "./components/LoadingCanvas";
import { ReportModal, type ReportState } from "./components/ReportModal";
import { api } from "./api";
import type { GraphIndex, ReportStatus } from "./types";

type View =
  | { name: "home" }
  | { name: "loading"; topic: string; error?: string }
  | { name: "canvas"; projectId: string };

export function App() {
  const [view, setView] = useState<View>({ name: "home" });
  const [index, setIndex] = useState<GraphIndex | null>(null);
  const [report, setReport] = useState<ReportState | null>(null);
  const [reportMeta, setReportMeta] = useState<ReportStatus | null>(null); // persisted report: exists? stale?
  const [synthesizing, setSynthesizing] = useState(false);
  const [activity, setActivity] = useState<string[]>([]);

  const projectId = view.name === "canvas" ? view.projectId : null;
  const reload = useCallback(async (id: string) => {
    const { index, report } = await api.getProject(id);
    setIndex(index);
    setReportMeta(report);
  }, []);
  useEffect(() => {
    if (projectId) void reload(projectId);
  }, [projectId, reload]);

  const start = useCallback(async (topic: string) => {
    setIndex(null);
    setActivity([]);
    setView({ name: "loading", topic });
    try {
      const { projectId } = await api.createTopic(topic, (e) => setActivity((a) => [...a, e.label]));
      setView({ name: "canvas", projectId });
    } catch (e) {
      setView({ name: "loading", topic, error: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const open = useCallback((id: string) => {
    setIndex(null); // avoid a flash of the previous project's graph before reload
    setView({ name: "canvas", projectId: id });
  }, []);

  const home = useCallback(() => {
    setReport(null);
    setReportMeta(null);
    setView({ name: "home" });
    setIndex(null);
  }, []);

  const synthesize = useCallback(async () => {
    if (!projectId) return;
    setSynthesizing(true);
    setReport({ status: "loading" });
    try {
      const r = await api.synthesize(projectId);
      setReport({ status: "ready", markdown: r.markdown, generatedAt: r.generatedAt, stale: r.stale });
      setReportMeta({ generatedAt: r.generatedAt, stale: r.stale });
    } catch (e) {
      setReport({ status: "error", error: e instanceof Error ? e.message : String(e) });
    } finally {
      setSynthesizing(false);
    }
  }, [projectId]);

  // Show the already-saved report (no Claude call) — used on reload when a synthesis exists.
  const viewReport = useCallback(async () => {
    if (!projectId) return;
    setReport({ status: "loading" });
    try {
      const r = await api.getReport(projectId);
      if (!r) { setReport(null); return; }
      setReport({ status: "ready", markdown: r.markdown, generatedAt: r.generatedAt, stale: r.stale });
    } catch (e) {
      setReport({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }, [projectId]);

  if (view.name === "home") return <Library onStart={start} onOpen={open} />;

  if (view.name === "loading") {
    return (
      <div className="app">
        <LoadingCanvas topic={view.topic} error={view.error} activity={activity} onRetry={() => void start(view.topic)} onHome={home} />
      </div>
    );
  }

  return (
    <div className="app">
      {index && projectId && (
        <Canvas
          key={projectId}
          projectId={projectId}
          index={index}
          onReloadIndex={() => reload(projectId)}
          onHome={home}
          onSynthesize={() => void synthesize()}
          onViewReport={() => void viewReport()}
          report={reportMeta}
          busy={synthesizing}
        />
      )}
      <ReportModal state={report} topic={index?.topic ?? ""} onClose={() => setReport(null)}
        onResynthesize={() => void synthesize()} resynthesizing={synthesizing} />
    </div>
  );
}
