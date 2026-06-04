export interface Position { x: number; y: number }
export interface Anchor { text: string; offset: number; occurrence: number }
export interface NodeMeta {
  id: string;
  kind: "topic" | "finding";
  parents: string[];
  anchor?: Anchor;
  question: string;
  created: string;
  position?: Position;
}
export interface GraphIndex { topic: string; nextSeq: number; nodes: NodeMeta[] }
export interface ResearchNode extends NodeMeta { sources: string[]; body: string }
export interface ProjectSummary {
  id: string;
  topic: string;
  nodes: number;
  sources: number;
  depth: number;
  updated: string; // ISO 8601
}
