import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Panel,
  useNodesState,
  useReactFlow,
  useViewport,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphIndex, NodeMeta, Position, Anchor, ReportStatus } from "../types";
import { api } from "../api";
import { buildCanvas, type PendingNode } from "../graph/model";
import { layoutNodes, COL_W, ROW_H } from "../graph/layout";
import { ResearchNodeCard, type CardData } from "./ResearchNodeCard";
import { SidePanel } from "./SidePanel";
import { Icon, Wordmark } from "./ui";

const nodeTypes = { research: ResearchNodeCard };

function Divider() {
  return <div style={{ width: 1, height: 24, background: "var(--line)", flexShrink: 0 }} />;
}

function TopBar({ topic, count, busy, report, onHome, onSynthesize, onViewReport }: { topic: string; count: number; busy: boolean; report: ReportStatus | null; onHome: () => void; onSynthesize: () => void; onViewReport: () => void }) {
  return (
    <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "0 16px", height: 60, background: "var(--card)", borderBottom: "1px solid var(--line)", flexShrink: 0, zIndex: 5 }}>
      <button className="btn btn-ghost btn-sm" onClick={onHome}><Icon name="arrowLeft" size={16} /> Library</button>
      <Divider />
      <Wordmark size={17} />
      <Divider />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="serif" style={{ fontSize: 16, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{topic}</div>
        <div className="mono" style={{ fontSize: 10.5, color: "var(--faint)", letterSpacing: "0.04em" }}>{count} NODES</div>
      </div>
      {report ? (
        // A synthesis exists: view the saved one; re-synthesize is primary when it's out of date.
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {report.stale && (
            <span className="mono" title="The graph changed since this report was generated"
              style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, letterSpacing: "0.03em", color: "var(--clay)", background: "var(--clay-soft)", border: "1px solid var(--clay-line)", borderRadius: 999, padding: "3px 9px" }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--clay)" }} /> OUT OF DATE
            </span>
          )}
          <button className="btn btn-sm" onClick={onViewReport}><Icon name="sparkle" size={15} /> View report</button>
          <button className={report.stale ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"} onClick={onSynthesize} disabled={busy}>
            <Icon name="retry" size={14} /> {busy ? "Synthesizing…" : "Re-synthesize"}
          </button>
        </div>
      ) : (
        <button className="btn btn-primary btn-sm" onClick={onSynthesize} disabled={busy}><Icon name="sparkle" size={15} /> {busy ? "Synthesizing…" : "Synthesize"}</button>
      )}
    </header>
  );
}

function ZoomCluster({ onFit }: { onFit: () => void }) {
  const { zoomIn, zoomOut, zoomTo } = useReactFlow();
  const { zoom } = useViewport();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", background: "var(--card)", border: "1px solid var(--line-strong)", borderRadius: "var(--r-md)", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
        <button className="ctl" onClick={() => zoomIn({ duration: 150 })} title="Zoom in"><Icon name="plus" size={16} /></button>
        <div style={{ height: 1, background: "var(--line)" }} />
        <button className="zoom-pct" onClick={() => zoomTo(1, { duration: 150 })} title="Reset to 100%">{Math.round(zoom * 100)}%</button>
        <div style={{ height: 1, background: "var(--line)" }} />
        <button className="ctl" onClick={() => zoomOut({ duration: 150 })} title="Zoom out"><Icon name="minus" size={16} /></button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", background: "var(--card)", border: "1px solid var(--line-strong)", borderRadius: "var(--r-md)", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
        <button className="ctl" onClick={onFit} title="Fit graph to view"><Icon name="fit" size={16} /></button>
      </div>
    </div>
  );
}

function Flow({ projectId, index, onReloadIndex, onHome, onSynthesize, onViewReport, report, busy }: {
  projectId: string;
  index: GraphIndex;
  onReloadIndex: () => Promise<void>;
  onHome: () => void;
  onSynthesize: () => void;
  onViewReport: () => void;
  report: ReportStatus | null;
  busy: boolean;
}) {
  // Which node's content is open in the side panel (null = panel closed). Reading happens there;
  // cards are just a compact map you click to open.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, { body: string; sources: string[] }>>({});
  const [pending, setPending] = useState<PendingNode[]>([]);
  const [pruned, setPruned] = useState<Set<string>>(() => new Set());
  const [drag, setDrag] = useState<Record<string, Position>>({});
  const pendSeq = useRef(0);
  const fetching = useRef<Set<string>>(new Set());

  const { fitView, setCenter, getZoom } = useReactFlow();

  const savedPositions = useMemo<Record<string, Position>>(() => {
    const out: Record<string, Position> = {};
    for (const m of index.nodes) if (m.position) out[m.id] = m.position;
    return out;
  }, [index]);

  const [researching, setResearching] = useState<Set<string>>(() => new Set());
  const [researchActivity, setResearchActivity] = useState<Record<string, string>>({});
  const [researchError, setResearchError] = useState<Record<string, string>>({});
  const researchingRef = useRef<Set<string>>(new Set());

  // close the panel when switching projects
  useEffect(() => { setSelectedId(null); }, [projectId]);

  // Lazily fetch the selected node's body + sources (researched nodes). Unresearched threads have
  // no body yet — they're researched in place by the effect below.
  useEffect(() => {
    const id = selectedId;
    if (!id) return;
    const meta = index.nodes.find((m) => m.id === id);
    if (!meta || meta.researched === false) return;
    if (details[id] !== undefined || fetching.current.has(id)) return;
    fetching.current.add(id);
    void api.getNode(projectId, id)
      .then((n) => setDetails((b) => ({ ...b, [id]: { body: n.body, sources: n.sources } })))
      .finally(() => fetching.current.delete(id));
  }, [selectedId, index, projectId, details]);

  // Lazily RESEARCH the selected, still-unresearched thread in place (streaming live activity),
  // then fill its body and reload the index so meta.researched flips true + tokens show.
  useEffect(() => {
    const id = selectedId;
    if (!id) return;
    const meta = index.nodes.find((m) => m.id === id);
    if (!meta || meta.researched !== false) return;
    if (details[id] !== undefined || researchingRef.current.has(id)) return;
    researchingRef.current.add(id);
    setResearching((s) => new Set(s).add(id));
    setResearchError((e) => { if (!(id in e)) return e; const next = { ...e }; delete next[id]; return next; });
    void api.researchNode(projectId, id, (e) => setResearchActivity((a) => ({ ...a, [id]: e.label })))
      .then(async (n) => { setDetails((b) => ({ ...b, [id]: { body: n.body, sources: n.sources } })); await onReloadIndex(); })
      .catch((err) => setResearchError((e) => ({ ...e, [id]: err instanceof Error ? err.message : String(err) })))
      .finally(() => {
        researchingRef.current.delete(id);
        setResearching((s) => { const next = new Set(s); next.delete(id); return next; });
        setResearchActivity((a) => { if (!(id in a)) return a; const next = { ...a }; delete next[id]; return next; });
      });
  }, [selectedId, index, projectId, details, onReloadIndex]);

  const positions = useMemo(() => ({ ...savedPositions, ...drag }), [savedPositions, drag]);
  const layout = useMemo(() => layoutNodes(index.nodes), [index]);

  // Height-aware tree layout: leaves stack top-to-bottom, each parent centered against its
  // children's span. Cards are a fixed compact size now (no expand), so heights are constant.
  const stackLayout = useMemo<Record<string, Position>>(() => {
    const NODE_GAP = 48;
    const estH = (m: NodeMeta) => (m.kind === "topic" ? 170 : 150);
    const byId = new Map(index.nodes.map((m) => [m.id, m]));
    const kidsOf = new Map<string, string[]>();
    for (const m of index.nodes) {
      if (pruned.has(m.id)) continue;
      for (const p of m.parents) if (byId.has(p) && !pruned.has(p)) (kidsOf.get(p) ?? kidsOf.set(p, []).get(p)!).push(m.id);
    }
    const out: Record<string, Position> = {};
    const placed = new Set<string>();
    let cursor = 0;
    const place = (id: string, depth: number): number => {
      const m = byId.get(id)!;
      const x = depth * COL_W;
      placed.add(id);
      const kids = (kidsOf.get(id) ?? []).filter((k) => !placed.has(k));
      if (kids.length === 0) {
        const top = cursor;
        out[id] = { x, y: top };
        cursor += estH(m) + NODE_GAP;
        return top + estH(m) / 2;
      }
      const centers = kids.map((k) => place(k, depth + 1));
      const center = (centers[0] + centers[centers.length - 1]) / 2;
      out[id] = { x, y: center - estH(m) / 2 };
      return center;
    };
    if (byId.has("topic")) place("topic", 0);
    for (const m of index.nodes) {
      if (pruned.has(m.id) || placed.has(m.id)) continue;
      out[m.id] = { x: layout[m.id]?.x ?? COL_W, y: cursor };
      placed.add(m.id);
      cursor += estH(m) + NODE_GAP;
    }
    const t = out["topic"];
    if (t) { const shift = t.y + 170 / 2; for (const id in out) out[id] = { x: out[id].x, y: out[id].y - shift }; }
    return out;
  }, [index, layout, pruned]);

  const resolvePos = useCallback((id: string): Position => positions[id] ?? stackLayout[id] ?? layout[id] ?? { x: 0, y: 0 }, [positions, stackLayout, layout]);

  // place each pending ("Thinking…") answer one column to the RIGHT of its parent, stacked.
  const childPositions = useMemo<Record<string, Position>>(() => {
    const out: Record<string, Position> = {};
    const perParent: Record<string, number> = {};
    for (const pn of pending) {
      const base = resolvePos(pn.parentId);
      const i = perParent[pn.parentId] ?? 0;
      perParent[pn.parentId] = i + 1;
      out[pn.id] = { x: base.x + COL_W, y: base.y + i * ROW_H };
    }
    return out;
  }, [pending, resolvePos]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    const p = resolvePos(id);
    const z = getZoom();
    // The reading card floats centered (~600px) with the map visible around it. Shift the focal point
    // right so the highlighted node lands just LEFT of the card, peeking out instead of hiding behind it.
    setCenter(p.x + 160 + 360 / z, p.y + 80, { zoom: z, duration: 400 });
  }, [resolvePos, setCenter, getZoom]);

  const ask = useCallback(async (parentId: string, question: string, anchor?: Anchor) => {
    const pid = `pending_${pendSeq.current++}`;
    setPending((p) => [...p, anchor ? { id: pid, parentId, question, anchor } : { id: pid, parentId, question }]);
    try {
      const created = await api.branch(projectId, parentId, question, anchor, (e) =>
        setPending((p) => p.map((x) => (x.id === pid ? { ...x, activity: e.label } : x))));
      setDetails((b) => ({ ...b, [created.id]: { body: created.body, sources: created.sources } }));
      setPending((p) => p.filter((x) => x.id !== pid));
      await onReloadIndex();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPending((p) => p.map((x) => (x.id === pid ? { ...x, error: msg } : x)));
    }
  }, [projectId, onReloadIndex]);

  const removeNode = useCallback((id: string) => {
    setPruned((prev) => new Set(prev).add(id));
    setPending((p) => p.filter((x) => x.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);

  const model = useMemo(
    () => buildCanvas({ metas: index.nodes, pruned, pending, positions: { ...positions, ...childPositions } }),
    [index, pruned, pending, positions, childPositions],
  );

  const titleById = useMemo(() => Object.fromEntries(model.nodes.map((n) => [n.id, n.title])), [model]);

  const desiredNodes = useMemo<Node[]>(
    () =>
      model.nodes.map((n) => {
        const data: CardData = { kind: n.kind, title: n.title, pending: n.pending, onSelect: () => select(n.id) };
        if (n.id === selectedId) data.selected = true;
        if (n.childCount !== undefined) data.childCount = n.childCount;
        if (n.error !== undefined) data.error = n.error;
        if (n.activity !== undefined) data.activity = n.activity;
        if (n.tokens !== undefined) data.tokens = n.tokens;
        if (n.costUsd !== undefined) data.costUsd = n.costUsd;
        if (n.teaser !== undefined) data.teaser = n.teaser;
        if (n.researched !== undefined) data.researched = n.researched;
        if (researching.has(n.id)) data.researching = true;
        if (researchError[n.id] !== undefined && data.error === undefined) data.error = researchError[n.id];
        if (n.kind !== "topic") data.onRemove = () => removeNode(n.id);
        data.id = n.id;
        if (n.pending && n.parentId) {
          const parentId = n.parentId;
          const question = n.title;
          data.onRetry = () => { setPending((p) => p.filter((x) => x.id !== n.id)); void ask(parentId, question); };
        }
        return {
          id: n.id,
          type: "research",
          position: n.position ?? stackLayout[n.id] ?? layout[n.id] ?? { x: 0, y: 0 },
          zIndex: n.pending ? 20 : n.id === selectedId ? 10 : 1,
          data: data as unknown as Record<string, unknown>,
        };
      }),
    [model, stackLayout, layout, select, ask, removeNode, researching, researchError, selectedId],
  );

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(desiredNodes);

  useEffect(() => {
    setRfNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return desiredNodes.map((n) => { const p = prevById.get(n.id); return p?.dragging ? { ...n, position: p.position, dragging: true } : n; });
    });
  }, [desiredNodes, setRfNodes]);

  const rfEdges = useMemo<Edge[]>(
    () =>
      model.edges.map((e) => {
        const edge: Edge = { id: e.id, source: e.source, target: e.target };
        if (e.target.startsWith("pending_")) edge.className = "pending";
        const label = e.label ?? (e.source !== "topic" ? titleById[e.target] : undefined);
        if (label) edge.label = label.length > 26 ? label.slice(0, 25) + "…" : label;
        return edge;
      }),
    [model, titleById],
  );

  const onNodeDragStop = useCallback((_e: MouseEvent | TouchEvent, node: Node) => {
    const { id, position } = node;
    setDrag((dPrev) => ({ ...dPrev, [id]: position }));
    if (!id.startsWith("pending_")) void api.setPositions(projectId, [{ id, x: position.x, y: position.y }]);
  }, [projectId]);

  const selectedNode = useMemo(() => model.nodes.find((n) => n.id === selectedId) ?? null, [model, selectedId]);

  // in-progress follow-ups branching off the open node — surfaced inside the panel as live "Generating…" items
  const pendingChildren = useMemo(
    () => pending.filter((p) => p.parentId === selectedId).map((p) => ({ id: p.id, question: p.question, anchorText: p.anchor?.text, activity: p.activity, error: p.error })),
    [pending, selectedId],
  );

  const retryChild = useCallback((id: string) => {
    const pn = pending.find((x) => x.id === id);
    if (!pn) return;
    setPending((p) => p.filter((x) => x.id !== id));
    void ask(pn.parentId, pn.question, pn.anchor);
  }, [pending, ask]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <TopBar topic={index.topic} count={rfNodes.length} busy={busy} report={report} onHome={onHome} onSynthesize={onSynthesize} onViewReport={onViewReport} />
      <div className="canvas" style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <ReactFlow nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onNodeDragStop={onNodeDragStop} onPaneClick={() => setSelectedId(null)} minZoom={0.2} maxZoom={2} defaultViewport={{ x: 120, y: 300, zoom: 0.9 }} proOptions={{ hideAttribution: true }}>
          <Background variant={BackgroundVariant.Dots} gap={26} size={1.1} color="var(--line-strong)" />
          <Panel position="bottom-left">
            <ZoomCluster onFit={() => void fitView({ padding: 0.2, duration: 200 })} />
          </Panel>
          <Panel position="bottom-right">
            <span className="mono" style={{ fontSize: 10.5, color: "var(--faint)", letterSpacing: "0.04em", pointerEvents: "none" }}>DRAG TO PAN · SCROLL TO ZOOM · CLICK A CARD TO READ</span>
          </Panel>
        </ReactFlow>
        {selectedNode && (
          <SidePanel
            key={selectedNode.id}
            node={selectedNode}
            body={details[selectedNode.id]?.body}
            sources={details[selectedNode.id]?.sources}
            childLinks={selectedNode.childLinks ?? []}
            pendingChildren={pendingChildren}
            researching={researching.has(selectedNode.id)}
            activity={researchActivity[selectedNode.id]}
            error={researchError[selectedNode.id]}
            onClose={() => setSelectedId(null)}
            onSelectChild={(id) => select(id)}
            onRetryChild={retryChild}
            onDismissChild={removeNode}
            onAsk={(question, anchor) => void ask(selectedNode.id, question, anchor)}
          />
        )}
      </div>
    </div>
  );
}

export function Canvas(props: { projectId: string; index: GraphIndex; onReloadIndex: () => Promise<void>; onHome: () => void; onSynthesize: () => void; onViewReport: () => void; report: ReportStatus | null; busy: boolean }) {
  return (
    <ReactFlowProvider key={props.projectId}>
      <Flow {...props} />
    </ReactFlowProvider>
  );
}
