import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useReactFlow,
  useNodesInitialized,
  type Node,
  type Edge,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphIndex, Position } from "../types";
import { api } from "../api";
import { buildCanvas, type PendingNode } from "../graph/model";
import { layoutNodes } from "../graph/layout";
import { ResearchNodeCard, type CardData } from "./ResearchNodeCard";

const nodeTypes = { research: ResearchNodeCard };

function directChildrenOfTopic(index: GraphIndex): string[] {
  return index.nodes.filter((m) => m.parents.includes("topic")).map((m) => m.id);
}

function Flow({
  projectId,
  index,
  onReloadIndex,
}: {
  projectId: string;
  index: GraphIndex;
  onReloadIndex: () => Promise<void>;
}) {
  // Auto-expand the topic and its initial findings so content is visible on arrival.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["topic", ...directChildrenOfTopic(index)]));
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<PendingNode[]>([]);
  const [drag, setDrag] = useState<Record<string, Position>>({});
  const pendSeq = useRef(0);
  const fetching = useRef<Set<string>>(new Set());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();

  const savedPositions = useMemo<Record<string, Position>>(() => {
    const out: Record<string, Position> = {};
    for (const m of index.nodes) if (m.position) out[m.id] = m.position;
    return out;
  }, [index]);

  // Lazily fetch the body of any expanded, non-topic node we don't have yet.
  useEffect(() => {
    for (const id of expanded) {
      const meta = index.nodes.find((m) => m.id === id);
      if (!meta || meta.kind === "topic") continue; // topic has no body
      if (bodies[id] !== undefined || fetching.current.has(id)) continue;
      fetching.current.add(id);
      void api
        .getNode(projectId, id)
        .then((n) => setBodies((b) => ({ ...b, [id]: n.body })))
        .finally(() => fetching.current.delete(id));
    }
  }, [expanded, index, projectId, bodies]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const ask = useCallback(
    async (parentId: string, question: string, selection?: string) => {
      const pid = `pending_${pendSeq.current++}`;
      setPending((p) => [...p, { id: pid, parentId, question }]);
      setExpanded((prev) => new Set(prev).add(parentId)); // keep parent open so the spinner shows
      try {
        const anchor = selection ? { text: selection, offset: 0, occurrence: 1 } : undefined;
        const created = await api.branch(projectId, parentId, question, anchor);
        setBodies((b) => ({ ...b, [created.id]: created.body })); // prime cache from the response
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

  const positions = useMemo(() => ({ ...savedPositions, ...drag }), [savedPositions, drag]);
  const model = useMemo(
    () => buildCanvas({ metas: index.nodes, expanded, bodies, pending, positions }),
    [index, expanded, bodies, pending, positions],
  );
  const layout = useMemo(() => layoutNodes(index.nodes), [index]);

  const rfNodes: Node[] = model.nodes.map((n) => {
    const data: CardData = {
      kind: n.kind,
      title: n.title,
      expanded: n.expanded,
      pending: n.pending,
      onToggle: () => toggle(n.id),
      onAsk: (q: string, selection?: string) => void ask(n.id, q, selection),
    };
    if (n.body !== undefined) data.body = n.body;
    if (n.error !== undefined) data.error = n.error;
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
      position: n.position ?? layout[n.id] ?? { x: 0, y: 0 },
      data: data as unknown as Record<string, unknown>,
    };
  });

  const rfEdges: Edge[] = model.edges.map((e) => {
    const edge: Edge = { id: e.id, source: e.source, target: e.target };
    if (e.label !== undefined) edge.label = e.label;
    return edge;
  });

  // Re-fit the view once nodes are measured, and whenever the visible set changes size.
  const visibleCount = rfNodes.length;
  useEffect(() => {
    if (nodesInitialized) void fitView({ padding: 0.2, duration: 200 });
  }, [nodesInitialized, visibleCount, fitView]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const c of changes) {
        if (c.type === "position" && c.position) {
          const id = c.id;
          const pos = c.position;
          setDrag((dPrev) => ({ ...dPrev, [id]: pos }));
          if (c.dragging === false && !id.startsWith("pending_")) {
            if (saveTimer.current) clearTimeout(saveTimer.current);
            saveTimer.current = setTimeout(() => {
              void api.setPositions(projectId, [{ id, x: pos.x, y: pos.y }]);
            }, 400);
          }
        }
      }
    },
    [projectId],
  );

  return (
    <ReactFlow nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} minZoom={0.1} fitView>
      <Background />
      <Controls />
    </ReactFlow>
  );
}

export function Canvas(props: { projectId: string; index: GraphIndex; onReloadIndex: () => Promise<void> }) {
  return (
    <div className="canvas" style={{ width: "100%", height: "100%" }}>
      <ReactFlowProvider>
        <Flow {...props} />
      </ReactFlowProvider>
    </div>
  );
}
