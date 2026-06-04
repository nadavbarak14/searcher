import fs from "node:fs/promises";
import { GraphStore } from "./graph/store.js";
import { projectDir } from "./graph/paths.js";
import type { ResearchNode, Anchor, GraphIndex } from "./graph/types.js";
import { runClaude } from "./claude/runner.js";
import { BRANCH_SYSTEM, ROOT_SYSTEM, rootPrompt, branchPrompt, synthesizePrompt } from "./claude/prompts.js";
import { buildBrief } from "./research/brief.js";

/** The runner shape the service depends on (matches ClaudeResult). Tests inject a fake. */
export interface RunResult {
  answer: string;
  claims: string[];
  sources: string[];
  costUsd: number;
  sessionId: string;
  meta: Record<string, unknown> | null;
}
export type RunFn = (input: { cwd: string; prompt: string; systemPrompt: string }) => Promise<RunResult>;

interface Finding {
  question: string;
  body: string;
  sources: string[];
}

function projectIdFromTopic(topic: string): string {
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return slug || "research";
}

function parseFindings(meta: Record<string, unknown> | null): Finding[] {
  if (!meta || !Array.isArray(meta.findings)) return [];
  return (meta.findings as unknown[])
    .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
    .map((f) => ({
      question: String(f.question ?? ""),
      body: String(f.body ?? ""),
      sources: Array.isArray(f.sources) ? (f.sources as unknown[]).filter((s): s is string => typeof s === "string") : [],
    }))
    .filter((f) => f.question || f.body);
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
export const defaultRun: RunFn = ({ cwd, prompt, systemPrompt }) =>
  runClaude({ cwd, prompt, systemPrompt, env: process.env as Record<string, string | undefined> });

export class ResearchService {
  constructor(
    private readonly baseDir: string,
    private readonly run: RunFn = defaultRun,
  ) {}

  async createTopic(topic: string): Promise<{ projectId: string; findingCount: number }> {
    const projectId = await uniqueProjectId(this.baseDir, projectIdFromTopic(topic));
    const store = new GraphStore(this.baseDir, projectId);
    await store.createProject(topic);
    const cwd = projectDir(this.baseDir, projectId);
    const res = await this.run({ cwd, prompt: rootPrompt(topic), systemPrompt: ROOT_SYSTEM });
    const findings = parseFindings(res.meta);
    for (const f of findings) {
      await store.addFinding({ parents: ["topic"], question: f.question, body: f.body, sources: f.sources });
    }
    return { projectId, findingCount: findings.length };
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
  async branch(projectId: string, input: { parentId: string; question: string; anchor?: Anchor }): Promise<ResearchNode> {
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
    const res = await this.run({ cwd, prompt, systemPrompt: BRANCH_SYSTEM });
    const finding: Parameters<typeof store.addFinding>[0] = {
      parents: [input.parentId],
      question: input.question,
      body: res.answer,
      sources: res.sources,
    };
    if (input.anchor) finding.anchor = input.anchor;
    return store.addFinding(finding);
  }

  /** Persist user-dragged canvas coordinates for one or more nodes. */
  async setPositions(projectId: string, updates: { id: string; x: number; y: number }[]): Promise<void> {
    return new GraphStore(this.baseDir, projectId).setPositions(updates);
  }

  async synthesize(projectId: string): Promise<string> {
    const store = new GraphStore(this.baseDir, projectId);
    const index = await store.load();
    const cwd = projectDir(this.baseDir, projectId);
    const res = await this.run({ cwd, prompt: synthesizePrompt(index.topic), systemPrompt: BRANCH_SYSTEM });
    return res.answer;
  }
}
