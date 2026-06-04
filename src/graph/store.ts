import fs from "node:fs/promises";
import type { ResearchNode, GraphIndex, NodeMeta, ProjectSummary } from "./types.js";
import { nodeToMarkdown, markdownToNode } from "./serialize.js";
import { projectDir, nodePath, indexPath } from "./paths.js";

function metaOf(node: ResearchNode): NodeMeta {
  const meta: NodeMeta = { id: node.id, kind: node.kind, parents: node.parents, question: node.question, created: node.created };
  if (node.anchor) meta.anchor = node.anchor;
  if (node.position) meta.position = node.position;
  return meta;
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

  /**
   * Persist x/y for the given node ids. Writes each node's .md (so positions survive
   * rebuildIndex — frontmatter is the source of truth) and patches the index in one
   * write. Unknown ids are skipped. Race-safe via the write queue.
   */
  async setPositions(updates: { id: string; x: number; y: number }[]): Promise<void> {
    return this.enqueue(async () => {
      const index = await this.loadIndex();
      for (const u of updates) {
        const meta = index.nodes.find((m) => m.id === u.id);
        if (!meta) continue; // unknown id — skip
        const pos = { x: u.x, y: u.y };
        const node = await this.getNode(u.id);
        node.position = pos;
        await fs.writeFile(nodePath(this.baseDir, this.projectId, u.id), nodeToMarkdown(node), "utf8");
        meta.position = pos;
      }
      await this.writeIndex(index);
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

  /**
   * Build a one-line summary for the library screen: topic, node count, deepest level,
   * distinct source count (read from each node's .md), and the index's last-modified time.
   */
  async summary(): Promise<ProjectSummary> {
    const index = await this.load();

    // depth: a node's level is 1 + its shallowest resolvable parent; topic = 0.
    const byId = new Map(index.nodes.map((m) => [m.id, m]));
    const cache = new Map<string, number>();
    const depthOf = (id: string, seen: Set<string> = new Set()): number => {
      if (id === "topic") return 0;
      const cached = cache.get(id);
      if (cached !== undefined) return cached;
      if (seen.has(id)) return 1; // cycle guard
      seen.add(id);
      const parents = byId.get(id)?.parents.filter((p) => byId.has(p)) ?? [];
      const d = parents.length ? 1 + Math.min(...parents.map((p) => depthOf(p, seen))) : 1;
      cache.set(id, d);
      return d;
    };
    const depth = index.nodes.reduce((max, m) => Math.max(max, depthOf(m.id)), 0);

    // distinct sources across every node (sources live in the .md, not the index).
    const sources = new Set<string>();
    for (const m of index.nodes) {
      try {
        const node = await this.getNode(m.id);
        for (const s of node.sources) sources.add(s);
      } catch {
        // a missing/corrupt node file shouldn't sink the whole summary
      }
    }

    const updated = await fs
      .stat(indexPath(this.baseDir, this.projectId))
      .then((s) => s.mtime.toISOString())
      .catch(() => new Date(0).toISOString());

    return { id: this.projectId, topic: index.topic, nodes: index.nodes.length, sources: sources.size, depth, updated };
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
