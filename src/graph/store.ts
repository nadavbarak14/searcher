import fs from "node:fs/promises";
import type { ResearchNode, GraphIndex, NodeMeta } from "./types.js";
import { nodeToMarkdown, markdownToNode } from "./serialize.js";
import { projectDir, nodePath, indexPath } from "./paths.js";

function metaOf(node: ResearchNode): NodeMeta {
  return { id: node.id, kind: node.kind, parents: node.parents, question: node.question, created: node.created };
}

export class GraphStore {
  /** Serializes all mutating operations so concurrent writers can't race on the index. */
  private writeChain: Promise<unknown> = Promise.resolve();

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(fn, fn); // run regardless of a prior failure
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

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

  /** Read the derived index. */
  async loadIndex(): Promise<GraphIndex> {
    const raw = await fs.readFile(indexPath(this.baseDir, this.projectId), "utf8");
    return JSON.parse(raw) as GraphIndex;
  }

  private async writeIndex(index: GraphIndex): Promise<void> {
    await fs.writeFile(indexPath(this.baseDir, this.projectId), JSON.stringify(index, null, 2), "utf8");
  }

  /**
   * Add a finding node. Allocates the next id, writes the .md FIRST, then updates the index.
   * (If the process dies between the two writes, rebuildIndex() reconciles on next load.)
   */
  async addFinding(input: {
    parents: string[];
    anchor?: import("./types.js").Anchor;
    question: string;
    body: string;
    sources: string[];
  }): Promise<ResearchNode> {
    return this.enqueue(async () => {
      const index = await this.loadIndex();
      const id = `n_${index.nextSeq}`;
      const node: ResearchNode = {
        id,
        kind: "finding",
        parents: input.parents,
        question: input.question,
        sources: input.sources,
        created: new Date().toISOString(),
        body: input.body,
      };
      if (input.anchor) node.anchor = input.anchor;

      await fs.writeFile(nodePath(this.baseDir, this.projectId, id), nodeToMarkdown(node), "utf8");
      index.nextSeq += 1;
      index.nodes.push(metaOf(node));
      await this.writeIndex(index);
      return node;
    });
  }

  /** Rebuild the index purely from the .md files on disk, then persist it. Source of truth = frontmatter. */
  async rebuildIndex(): Promise<GraphIndex> {
    const dir = projectDir(this.baseDir, this.projectId);
    const entries = await fs.readdir(dir);
    const ids = entries.filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3));

    const nodes: NodeMeta[] = [];
    let topic = "";
    let maxSeq = 0;
    for (const id of ids) {
      const node = await this.getNode(id);
      nodes.push(metaOf(node));
      if (node.kind === "topic") topic = node.question;
      const m = /^n_(\d+)$/.exec(id);
      if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
    }
    const index: GraphIndex = { topic, nextSeq: maxSeq + 1, nodes };
    await this.writeIndex(index);
    return index;
  }

  /** Load the index, rebuilding from .md files if it is missing or unreadable. */
  async load(): Promise<GraphIndex> {
    try {
      return await this.loadIndex();
    } catch {
      return await this.rebuildIndex();
    }
  }
}
