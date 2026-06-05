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
import type { GraphIndex, NodeMeta, Position, Anchor } from "../types";
import { api } from "../api";
import { buildCanvas, type PendingNode, type DraftNode } from "../graph/model";
import { layoutNodes, COL_W, ROW_H } from "../graph/layout";
import { ResearchNodeCard, type CardData } from "./ResearchNodeCard";
import { Icon, Wordmark } from "./ui";

const nodeTypes = { research: ResearchNodeCard };

function Divider() {
  return <div style={{ width: 1, height: 24, background: "var(--line)", flexShrink: 0 }} />;
}

function TopBar({
  topic,
  count,
  allOpen,
  busy,
  onHome,
  onToggleAll,
  onSynthesize,
}: {
  topic: string;
  count: number;
  allOpen: boolean;
  busy: boolean;
  onHome: () => void;
  onToggleAll: () => void;
  onSynthesize: () => void;
}) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "0 16px",
        height: 60,
        background: "var(--card)",
        borderBottom: "1px solid var(--line)",
        flexShrink: 0,
        zIndex: 5,
      }}
    >
      <button className="btn btn-ghost btn-sm" onClick={onHome}>
        <Icon name="arrowLeft" size={16} /> Library
      </button>
      <Divider />
      <Wordmark size={17} />
      <Divider />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="serif" style={{ fontSize: 16, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {topic}
        </div>
        <div className="mono" style={{ fontSize: 10.5, color: "var(--faint)", letterSpacing: "0.04em" }}>{count} NODES</div>
      </div>
      <button className="seg" onClick={onToggleAll} title={allOpen ? "Collapse every finding" : "Expand every finding"}>
        <Icon name={allOpen ? "collapseAll" : "expandAll"} size={15} />
        {allOpen ? "Collapse all" : "Expand all"}
      </button>
      <Divider />
      <button className="btn btn-primary btn-sm" onClick={onSynthesize} disabled={busy}>
        <Icon name="sparkle" size={15} /> {busy ? "Synthesizing…" : "Synthesize"}
      </button>
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

function Flow({
  projectId,
  index,
  onReloadIndex,
  onHome,
  onSynthesize,
  busy,
}: {
  projectId: string;
  index: GraphIndex;
  onReloadIndex: () => Promise<void>;
  onHome: () => void;
  onSynthesize: () => void;
  busy: boolean;
}) {
  // Start with every finding collapsed (titles only); only the topic is "expanded" so its
  // direct findings are visible on the canvas. The user expands a card to read its full answer.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["topic"]));
  const [details, setDetails] = useState<Record<string, { body: string; sources: string[] }>>({});
  const [pending, setPending] = useState<PendingNode[]>([]);
  const [pruned, setPruned] = useState<Set<string>>(() => new Set());
  const [drag, setDrag] = useState<Record<string, Position>>({});
  const pendSeq = useRef(0);
  const fetching = useRef<Set<string>>(new Set());

  const { fitView } = useReactFlow();

  const savedPositions = useMemo<Record<string, Position>>(() => {
    const out: Record<string, Position> = {};
    for (const m of index.nodes) if (m.position) out[m.id] = m.position;
    return out;
  }, [index]);

  // Lazily fetch the body + sources of any expanded, non-topic node we don't have yet.
  useEffect(() => {
    for (const id of expanded) {
      const meta = index.nodes.find((m) => m.id === id);
      if (!meta || meta.kind === "topic") continue; // topic has no body
      if (details[id] !== undefined || fetching.current.has(id)) continue;
      fetching.current.add(id);
      void api
        .getNode(projectId, id)
        .then((n) => setDetails((b) => ({ ...b, [id]: { body: n.body, sources: n.sources } })))
        .finally(() => fetching.current.delete(id));
    }
  }, [expanded, index, projectId, details]);

  const bodies = useMemo(() => Object.fromEntries(Object.entries(details).map(([id, d]) => [id, d.body])), [details]);
  const sources = useMemo(() => Object.fromEntries(Object.entries(details).map(([id, d]) => [id, d.sources])), [details]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const removeNode = useCallback((id: string) => {
    setPruned((prev) => new Set(prev).add(id));
    setExpanded((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setPending((p) => p.filter((x) => x.id !== id));
  }, []);

  const ask = useCallback(
    async (parentId: string, question: string, anchor?: Anchor) => {
      const pid = `pending_${pendSeq.current++}`;
      setPending((p) => [...p, anchor ? { id: pid, parentId, question, anchor } : { id: pid, parentId, question }]);
      setExpanded((prev) => new Set(prev).add(parentId)); // keep parent open so the spinner shows
      try {
        const created = await api.branch(projectId, parentId, question, anchor);
        setDetails((b) => ({ ...b, [created.id]: { body: created.body, sources: created.sources } })); // prime from response
        setPending((p) => p.filter((x) => x.id !== pid));
        await onReloadIndex();
        setExpanded((prev) => new Set(prev).add(created.id)); // auto-expand the new answer
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setPending((p) => p.map((x) => (x.id === pid ? { ...x, error: msg } : x)));
      }
    },
    [projectId, onReloadIndex],
  );

  const [drafts, setDrafts] = useState<DraftNode[]>([]);
  const draftSeq = useRef(0);

  useEffect(() => { setDrafts([]); draftSeq.current = 0; }, [projectId]);

  const startFollowUp = useCallback((parentId: string, anchor: Anchor) => {
    const id = `draft_${draftSeq.current++}`;
    setDrafts((d) => [...d, { id, parentId, anchor }]);
    setExpanded((prev) => new Set(prev).add(parentId));
  }, []);

  const cancelDraft = useCallback((id: string) => setDrafts((d) => d.filter((x) => x.id !== id)), []);

  const submitDraft = useCallback((draft: DraftNode, question: string) => {
    setDrafts((d) => d.filter((x) => x.id !== draft.id));
    void ask(draft.parentId, question, draft.anchor);
  }, [ask]);

  const positions = useMemo(() => ({ ...savedPositions, ...drag }), [savedPositions, drag]);
  const layout = useMemo(() => layoutNodes(index.nodes), [index]);

  // Height-aware tree layout: leaves stack top-to-bottom by their estimated height (full-answer
  // nodes are tall) so siblings never overlap and a column reads in order; each PARENT is then
  // centered vertically against the span of its children (so a node with 4 children to its right
  // sits in the middle of them). Normalized so the topic's center is y=0. Recomputes on
  // expand/collapse; only used for nodes without a saved/dragged position.
  const stackLayout = useMemo<Record<string, Position>>(() => {
    const NODE_GAP = 56;
    const estH = (m: NodeMeta) => (m.kind === "topic" ? 220 : expanded.has(m.id) ? 500 : 150);
    const byId = new Map(index.nodes.map((m) => [m.id, m]));
    const kidsOf = new Map<string, string[]>();
    for (const m of index.nodes) {
      if (pruned.has(m.id)) continue;
      for (const p of m.parents) {
        if (byId.has(p) && !pruned.has(p)) (kidsOf.get(p) ?? kidsOf.set(p, []).get(p)!).push(m.id);
      }
    }
    const out: Record<string, Position> = {};
    const placed = new Set<string>();
    let cursor = 0;
    // place a node + its subtree; returns the node's vertical CENTER
    const place = (id: string, depth: number): number => {
      const m = byId.get(id)!;
      const x = depth * COL_W;
      placed.add(id); // mark before recursing (cycle/DAG guard)
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
      if (pruned.has(m.id) || placed.has(m.id)) continue; // orphans: stack after
      out[m.id] = { x: layout[m.id]?.x ?? COL_W, y: cursor };
      placed.add(m.id);
      cursor += estH(m) + NODE_GAP;
    }
    // normalize so the topic's vertical center sits at y=0
    const t = out["topic"];
    if (t) {
      const shift = t.y + 220 / 2;
      for (const id in out) out[id] = { x: out[id].x, y: out[id].y - shift };
    }
    return out;
  }, [index, layout, expanded, pruned]);

  // place each transient node (compose draft + "Thinking…" pending answer) one column to the
  // RIGHT of its parent, stacked so siblings don't overlap — the same slot its real answer lands in.
  const childPositions = useMemo<Record<string, Position>>(() => {
    const out: Record<string, Position> = {};
    const perParent: Record<string, number> = {};
    const place = (id: string, parentId: string) => {
      const base = positions[parentId] ?? stackLayout[parentId] ?? layout[parentId] ?? { x: 0, y: 0 };
      const i = perParent[parentId] ?? 0;
      perParent[parentId] = i + 1;
      out[id] = { x: base.x + COL_W, y: base.y + i * ROW_H };
    };
    for (const dr of drafts) place(dr.id, dr.parentId);
    for (const pn of pending) place(pn.id, pn.parentId);
    return out;
  }, [drafts, pending, positions, stackLayout, layout]);

  const model = useMemo(
    () => buildCanvas({ metas: index.nodes, expanded, bodies, sources, pruned, pending, drafts, positions: { ...positions, ...childPositions } }),
    [index, expanded, bodies, sources, pruned, pending, drafts, positions, childPositions],
  );

  // expand-all / collapse-all over the not-pruned findings
  const findings = useMemo(() => index.nodes.filter((m) => m.kind !== "topic" && !pruned.has(m.id)), [index, pruned]);
  const allOpen = findings.length > 0 && findings.every((m) => expanded.has(m.id));
  const toggleAll = useCallback(() => {
    if (allOpen) setExpanded(new Set(["topic"]));
    else setExpanded(new Set(index.nodes.map((m) => m.id)));
  }, [allOpen, index]);

  const titleById = useMemo(() => Object.fromEntries(model.nodes.map((n) => [n.id, n.title])), [model]);

  // Derived node list (structure + data + layout position). Crucially this does NOT depend on
  // a per-frame drag position — drag is handled inside React Flow's own state (useNodesState),
  // so a drag moves only the dragged node and never rebuilds this whole list.
  const desiredNodes = useMemo<Node[]>(
    () =>
      model.nodes.map((n) => {
        const data: CardData = {
          kind: n.kind,
          title: n.title,
          expanded: n.expanded,
          pending: n.pending,
          onToggle: () => toggle(n.id),
          onAsk: (q: string) => void ask(n.id, q),
        };
        if (n.body !== undefined) data.body = n.body;
        if (n.anchors) data.anchors = n.anchors;
        if (n.sources !== undefined) data.sources = n.sources;
        if (n.childCount !== undefined) data.childCount = n.childCount;
        if (n.error !== undefined) data.error = n.error;
        if (n.kind !== "topic") data.onRemove = () => removeNode(n.id);
        data.id = n.id;
        if (n.kind !== "topic") data.onFollowUp = (anchor) => startFollowUp(n.id, anchor);
        if (n.draft) {
          data.draft = true;
          data.anchorText = n.anchor?.text ?? "";
          const dr = drafts.find((x) => x.id === n.id)!;
          data.onDraftSubmit = (q: string) => submitDraft(dr, q);
          data.onDraftCancel = () => cancelDraft(n.id);
        }
        if (n.pending && n.parentId) {
          const parentId = n.parentId;
          const question = n.title;
          data.onRetry = () => {
            setPending((p) => p.filter((x) => x.id !== n.id));
            void ask(parentId, question);
          };
        }
        return {
          id: n.id,
          type: "research",
          position: n.position ?? stackLayout[n.id] ?? layout[n.id] ?? { x: 0, y: 0 },
          // expanded/draft/pending nodes sit above neighbors so growth never hides behind a sibling
          zIndex: n.draft || n.pending ? 20 : n.expanded ? 10 : 1,
          data: data as unknown as Record<string, unknown>,
        };
      }),
    [model, stackLayout, layout, drafts, toggle, ask, removeNode, startFollowUp, submitDraft, cancelDraft],
  );

  // React Flow owns the live node state so dragging is handled internally (smooth, single-node
  // update) instead of round-tripping every frame through the derive pipeline above.
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(desiredNodes);

  // Reconcile derived structure/data into RF state whenever the derive actually changes
  // (expand, body fetch, pending, drafts, drag-stop) — NOT on every drag frame. Preserve the
  // live position of any node mid-drag so reconciliation never yanks it back to its layout slot.
  useEffect(() => {
    setRfNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return desiredNodes.map((n) => {
        const p = prevById.get(n.id);
        return p?.dragging ? { ...n, position: p.position, dragging: true } : n;
      });
    });
  }, [desiredNodes, setRfNodes]);

  const rfEdges = useMemo<Edge[]>(
    () =>
      model.edges.map((e) => {
        const edge: Edge = { id: e.id, source: e.source, target: e.target };
        if (e.sourceHandle) edge.sourceHandle = e.sourceHandle; // bind anchored edges to the per-span source handle on the parent card
        const isPending = e.target.startsWith("pending_");
        if (isPending) edge.className = "pending";
        // label child edges (not the topic's first-level fan-out) with the child's question
        const label = e.label ?? (e.source !== "topic" ? titleById[e.target] : undefined);
        if (label) edge.label = label.length > 26 ? label.slice(0, 25) + "…" : label;
        return edge;
      }),
    [model, titleById],
  );

  // Record a node's final position once, on drag-stop (session memory + persist) — never per frame.
  const onNodeDragStop = useCallback(
    (_e: MouseEvent | TouchEvent, node: Node) => {
      const { id, position } = node;
      setDrag((dPrev) => ({ ...dPrev, [id]: position }));
      if (!id.startsWith("pending_") && !id.startsWith("draft_")) {
        void api.setPositions(projectId, [{ id, x: position.x, y: position.y }]);
      }
    },
    [projectId],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <TopBar
        topic={index.topic}
        count={rfNodes.length}
        allOpen={allOpen}
        busy={busy}
        onHome={onHome}
        onToggleAll={toggleAll}
        onSynthesize={onSynthesize}
      />
      <div className="canvas" style={{ flex: 1, minHeight: 0 }}>
        <ReactFlow nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onNodeDragStop={onNodeDragStop} minZoom={0.2} maxZoom={2} defaultViewport={{ x: 120, y: 300, zoom: 0.9 }} proOptions={{ hideAttribution: true }}>
          <Background variant={BackgroundVariant.Dots} gap={26} size={1.1} color="var(--line-strong)" />
          <Panel position="bottom-left">
            <ZoomCluster onFit={() => void fitView({ padding: 0.2, duration: 200 })} />
          </Panel>
          <Panel position="bottom-right">
            <span className="mono" style={{ fontSize: 10.5, color: "var(--faint)", letterSpacing: "0.04em", pointerEvents: "none" }}>
              DRAG TO PAN · SCROLL TO ZOOM · CLICK A CARD TO EXPAND
            </span>
          </Panel>
        </ReactFlow>
      </div>
    </div>
  );
}

export function Canvas(props: {
  projectId: string;
  index: GraphIndex;
  onReloadIndex: () => Promise<void>;
  onHome: () => void;
  onSynthesize: () => void;
  busy: boolean;
}) {
  return (
    // key by project so each opens fresh at the document top (defaultViewport re-applies)
    <ReactFlowProvider key={props.projectId}>
      <Flow {...props} />
    </ReactFlowProvider>
  );
}
