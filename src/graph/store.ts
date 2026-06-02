import fs from "node:fs/promises";
import type { ResearchNode, GraphIndex, NodeMeta } from "./types.js";
import { nodeToMarkdown, markdownToNode } from "./serialize.js";
import { projectDir, nodePath, indexPath } from "./paths.js";

function metaOf(node: ResearchNode): NodeMeta {
  return { id: node.id, kind: node.kind, parents: node.parents, question: node.question, created: node.created };
}

export class GraphStore {
  constructor(
    private readonly baseDir: string,
    private readonly projectId: string,
  ) {}

  /** Create the project folder, the synthetic topic node, and the initial index. */
  async createProject(topic: string): Promise<void> {
    await fs.mkdir(projectDir(this.baseDir, this.projectId), { recursive: true });
    const topicNode: ResearchNode = {
      id: "topic",
      kind: "topic",
      parents: [],
      question: topic,
      sources: [],
      created: new Date().toISOString(),
      body: "",
    };
    await fs.writeFile(nodePath(this.baseDir, this.projectId, "topic"), nodeToMarkdown(topicNode), "utf8");
    const index: GraphIndex = { topic, nextSeq: 1, nodes: [metaOf(topicNode)] };
    await fs.writeFile(indexPath(this.baseDir, this.projectId), JSON.stringify(index, null, 2), "utf8");
  }

  /** Read a single node by id from its markdown file. */
  async getNode(id: string): Promise<ResearchNode> {
    const md = await fs.readFile(nodePath(this.baseDir, this.projectId, id), "utf8");
    return markdownToNode(id, md);
  }
}
