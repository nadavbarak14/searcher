import { useCallback, useMemo, useRef, useState } from "react";
import { ReactFlow, Background, Controls, type Node, type Edge, type NodeChange } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphIndex, Position } from "../types";
import { api } from "../api";
import { buildCanvas, type PendingNode } from "../graph/model";
import { layoutNodes } from "../graph/layout";
import { ResearchNodeCard, type CardData } from "./ResearchNodeCard";

const nodeTypes = { research: ResearchNodeCard };

export function Canvas({
  projectId,
  index,
  onReloadIndex,
}: {
  projectId: string;
  index: GraphIndex;
  onReloadIndex: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["topic"]));
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<PendingNode[]>([]);
  const [drag, setDrag] = useState<Record<string, Position>>({}); // live drag overrides
  const pendSeq = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const savedPositions = useMemo<Record<string, Position>>(() => {
    const out: Record<string, Position> = {};
    for (const m of index.nodes) if (m.position) out[m.id] = m.position;
    return out;
  }, [index]);

  const toggle = useCallback(
    async (id: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      if (bodies[id] === undefined) {
        const node = await api.getNode(projectId, id);
        setBodies((b) => ({ ...b, [id]: node.body }));
      }
    },
    [bodies, projectId],
  );

  const ask = useCallback(
    async (parentId: string, question: string) => {
      const pid = `pending_${pendSeq.current++}`;
      setPending((p) => [...p, { id: pid, parentId, question }]);
      setExpanded((prev) => new Set(prev).add(parentId)); // keep parent open so the spinner shows
      try {
        await api.branch(projectId, parentId, question);
        setPending((p) => p.filter((x) => x.id !== pid));
        await onReloadIndex();
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
      onToggle: () => void toggle(n.id),
      onAsk: (q: string) => void ask(n.id, q),
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
    <div className="canvas" style={{ width: "100%", height: "100%" }}>
      <ReactFlow nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} fitView>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
