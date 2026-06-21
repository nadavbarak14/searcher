import fs from "node:fs/promises";
import { GraphStore } from "./graph/store.js";
import { projectDir } from "./graph/paths.js";
import type { ResearchNode, Anchor, GraphIndex, Report, ReportStatus } from "./graph/types.js";
import { runClaude, runClaudeStream, type ActivityEvent } from "./claude/runner.js";
import { BRANCH_SYSTEM, ROOT_SYSTEM, rootPrompt, branchPrompt, synthesizePrompt } from "./claude/prompts.js";
import { buildBrief } from "./research/brief.js";

/** The runner shape the service depends on (matches ClaudeResult). Tests inject a fake. */
export interface RunResult {
  answer: string;
  claims: string[];
  sources: string[];
  costUsd: number;
  tokens?: number;
  sessionId: string;
  meta: Record<string, unknown> | null;
}
export type { ActivityEvent };
export type RunFn = (
  input: { cwd: string; prompt: string; systemPrompt: string },
  onActivity?: (e: ActivityEvent) => void,
) => Promise<RunResult>;

interface RootNode {
  quote: string;
  title: string;
  body: string;
  sources: string[];
}

function projectIdFromTopic(topic: string): string {
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return slug || "research";
}

/** Parse the root research run's metadata into a short summary + the content-filled child nodes. */
function parseRoot(meta: Record<string, unknown> | null): { summary: string; nodes: RootNode[] } {
  const summary = typeof meta?.summary === "string" ? meta.summary : "";
  const nodes = Array.isArray(meta?.nodes)
    ? (meta!.nodes as unknown[])
        .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
        .map((t) => ({
          quote: String(t.quote ?? ""),
          title: String(t.title ?? ""),
          body: String(t.body ?? ""),
          sources: Array.isArray(t.sources) ? (t.sources as unknown[]).map(String) : [],
        }))
        .filter((t) => t.title)
    : [];
  return { summary, nodes };
}

/** Anchor a node back into the summary at the first match of its quote (0-based occurrence). */
function anchorForQuote(summary: string, quote: string): Anchor | undefined {
  if (!quote) return undefined;
  const offset = summary.indexOf(quote);
  if (offset < 0) return undefined;
  return { text: quote, offset, occurrence: 0 };
}

async function uniqueProjectId(baseDir: string, slug: string): Promise<string> {
  let id = slug;
  let n = 2;
  // projectDir(baseDir, id) must not already exist
  // eslint-disable-next-line no-await-in-loop
  while (await fs.stat(projectDir(baseDir, id)).then(() => true, () => false)) {
    id = `${slug}-${n++}`;
  }
  return id;
}

/** Default production runner: delegates to runClaude with the real process env. */
export const defaultRun: RunFn = ({ cwd, prompt, systemPrompt }, onActivity) => {
  const env = process.env as Record<string, string | undefined>;
  // Stream live activity only when a consumer is listening; otherwise keep the cheaper
  // single-shot path so non-streaming callers and tests behave exactly as before.
  return onActivity
    ? runClaudeStream({ cwd, prompt, systemPrompt, env }, onActivity)
    : runClaude({ cwd, prompt, systemPrompt, env });
};

export class ResearchService {
  constructor(
    private readonly baseDir: string,
    private readonly run: RunFn = defaultRun,
  ) {}

  async createTopic(topic: string, onActivity?: (e: ActivityEvent) => void): Promise<{ projectId: string; findingCount: number; tokens: number }> {
    const projectId = await uniqueProjectId(this.baseDir, projectIdFromTopic(topic));
    const store = new GraphStore(this.baseDir, projectId);
    await store.createProject(topic);
    const cwd = projectDir(this.baseDir, projectId);
    const res = await this.run({ cwd, prompt: rootPrompt(topic), systemPrompt: ROOT_SYSTEM }, onActivity);
    const { summary, nodes } = parseRoot(res.meta);
    // The short summary becomes the topic node's body; the run's totals attach to the topic.
    await store.updateNode("topic", { body: summary, sources: res.sources, tokens: res.tokens ?? 0, costUsd: res.costUsd ?? 0 });
    // Each discovered node is already researched: it carries its own written-out findings + sources.
    for (const n of nodes) {
      const anchor = anchorForQuote(summary, n.quote);
      await store.addFinding({
        parents: ["topic"],
        ...(anchor ? { anchor } : {}),
        question: n.title,
        body: n.body,
        sources: n.sources,
        researched: true,
      });
    }
    return { projectId, findingCount: nodes.length, tokens: res.tokens ?? 0 };
  }

  /**
   * Lazily research one (unresearched) thread node in place: run the branch flow against its
   * anchored span/question and persist the answer onto the node, flipping `researched` true.
   */
  async researchNode(projectId: string, nodeId: string, onActivity?: (e: ActivityEvent) => void): Promise<ResearchNode> {
    const store = new GraphStore(this.baseDir, projectId);
    const index = await store.load();
    const node = await store.getNode(nodeId);
    const cwd = projectDir(this.baseDir, projectId);
    const prompt = branchPrompt({
      topic: index.topic,
      selection: node.anchor?.text ?? node.question,
      question: node.question,
      ancestorTitles: ["topic"],
    });
    const res = await this.run({ cwd, prompt, systemPrompt: BRANCH_SYSTEM }, onActivity);
    return store.updateNode(nodeId, {
      body: res.answer,
      sources: res.sources,
      tokens: res.tokens ?? 0,
      costUsd: res.costUsd ?? 0,
      researched: true,
    });
  }

  /** Load every finding node's question + body, in index (creation) order, for the brief. */
  private async findingsFor(store: GraphStore, index: GraphIndex): Promise<{ question: string; body: string }[]> {
    const metas = index.nodes.filter((n) => n.kind === "finding");
    return Promise.all(
      metas.map(async (m) => {
        const node = await store.getNode(m.id);
        return { question: node.question, body: node.body };
      }),
    );
  }

  /**
   * Ask one question about a node and persist the answer as a child finding. Questions are
   * whole-node by default; `anchor` is optional and only set for legacy text-anchored links.
   */
  async branch(projectId: string, input: { parentId: string; question: string; anchor?: Anchor }, onActivity?: (e: ActivityEvent) => void): Promise<ResearchNode> {
    const store = new GraphStore(this.baseDir, projectId);
    const index = await store.load();
    const parent = await store.getNode(input.parentId);
    const cwd = projectDir(this.baseDir, projectId);
    const brief = buildBrief({ goal: index.topic, findings: await this.findingsFor(store, index) });
    const prompt = branchPrompt({
      topic: index.topic,
      selection: input.anchor?.text ?? parent.question,
      question: input.question,
      ancestorTitles: [parent.question],
      brief,
    });
    const res = await this.run({ cwd, prompt, systemPrompt: BRANCH_SYSTEM }, onActivity);
    const finding: Parameters<typeof store.addFinding>[0] = {
      parents: [input.parentId],
      question: input.question,
      body: res.answer,
      sources: res.sources,
      tokens: res.tokens ?? 0,
      costUsd: res.costUsd ?? 0,
      researched: true,
    };
    if (input.anchor) finding.anchor = input.anchor;
    return store.addFinding(finding);
  }

  /** Persist user-dragged canvas coordinates for one or more nodes. */
  async setPositions(projectId: string, updates: { id: string; x: number; y: number }[]): Promise<void> {
    return new GraphStore(this.baseDir, projectId).setPositions(updates);
  }

  /** Synthesize the whole project into a report, persist it (fingerprinted), and return it fresh. */
  async synthesize(projectId: string): Promise<Report> {
    const store = new GraphStore(this.baseDir, projectId);
    const index = await store.load();
    const cwd = projectDir(this.baseDir, projectId);
    const res = await this.run({ cwd, prompt: synthesizePrompt(index.topic), systemPrompt: BRANCH_SYSTEM });
    const stored = await store.saveReport(res.answer);
    return { markdown: stored.markdown, generatedAt: stored.generatedAt, stale: false };
  }

  /** The saved report (with staleness), or null if the project has never been synthesized. */
  async getReport(projectId: string): Promise<Report | null> {
    return new GraphStore(this.baseDir, projectId).report();
  }

  /** Lightweight report status (exists? stale?) for the project load, without the markdown. */
  async reportStatus(projectId: string): Promise<ReportStatus | null> {
    return new GraphStore(this.baseDir, projectId).reportStatus();
  }
}
