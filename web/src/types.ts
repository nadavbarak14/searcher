export interface Anchor { text: string; offset: number; occurrence: number }
export interface NodeMeta { id: string; kind: "topic" | "finding"; parents: string[]; question: string; created: string }
export interface GraphIndex { topic: string; nextSeq: number; nodes: NodeMeta[] }
export interface ResearchNode extends NodeMeta { anchor?: Anchor; sources: string[]; body: string }
