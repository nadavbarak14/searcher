import { useMemo } from "react";
import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphIndex } from "../types";

export function GraphView({ index, onSelect }: { index: GraphIndex; onSelect: (nodeId: string) => void }) {
  const { nodes, edges } = useMemo(() => {
    const metas = index.nodes;
    const nodes: Node[] = metas.map((m, i) => ({
      id: m.id,
      position: m.kind === "topic" ? { x: 0, y: 0 } : { x: ((i % 4) - 1.5) * 240, y: 140 + Math.floor(i / 4) * 120 },
      data: { label: m.kind === "topic" ? `★ ${index.topic}` : m.question },
      style: {
        padding: 8, borderRadius: 8, width: 200, fontSize: 12,
        border: m.kind === "topic" ? "2px solid #1558d6" : "1px solid #bbb",
        background: m.kind === "topic" ? "#eaf1ff" : "#fff",
      },
    }));
    const edges: Edge[] = metas.flatMap((m) =>
      m.parents.map((p) => ({ id: `${p}->${m.id}`, source: p, target: m.id })),
    );
    return { nodes, edges };
  }, [index]);

  return (
    <div className="canvas">
      <ReactFlow nodes={nodes} edges={edges} fitView onNodeClick={(_, n) => onSelect(n.id)}>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
