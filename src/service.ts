import { GraphStore } from "./graph/store.js";
import { projectDir } from "./graph/paths.js";
import type { ResearchNode, Anchor } from "./graph/types.js";
import { runClaude } from "./claude/runner.js";
import { BRANCH_SYSTEM, ROOT_SYSTEM, rootPrompt, branchPrompt, synthesizePrompt } from "./claude/prompts.js";

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

/** Default production runner: delegates to runClaude with the real process env. */
export const defaultRun: RunFn = ({ cwd, prompt, systemPrompt }) =>
  runClaude({ cwd, prompt, systemPrompt, env: process.env as Record<string, string | undefined> });

export class ResearchService {
  constructor(
    private readonly baseDir: string,
    private readonly run: RunFn = defaultRun,
  ) {}

  async createTopic(topic: string): Promise<{ projectId: string }> {
    const projectId = projectIdFromTopic(topic);
    const store = new GraphStore(this.baseDir, projectId);
    await store.createProject(topic);
    const cwd = projectDir(this.baseDir, projectId);
    const res = await this.run({ cwd, prompt: rootPrompt(topic), systemPrompt: ROOT_SYSTEM });
    for (const f of parseFindings(res.meta)) {
      await store.addFinding({ parents: ["topic"], question: f.question, body: f.body, sources: f.sources });
    }
    return { projectId };
  }

  async branch(projectId: string, input: { parentId: string; anchor: Anchor; question: string }): Promise<ResearchNode> {
    const store = new GraphStore(this.baseDir, projectId);
    const index = await store.load();
    const parent = await store.getNode(input.parentId);
    const cwd = projectDir(this.baseDir, projectId);
    const prompt = branchPrompt({ topic: index.topic, selection: input.anchor.text, question: input.question, ancestorTitles: [parent.question] });
    const res = await this.run({ cwd, prompt, systemPrompt: BRANCH_SYSTEM });
    return store.addFinding({ parents: [input.parentId], anchor: input.anchor, question: input.question, body: res.answer, sources: res.sources });
  }

  async synthesize(projectId: string): Promise<string> {
    const store = new GraphStore(this.baseDir, projectId);
    const index = await store.load();
    const cwd = projectDir(this.baseDir, projectId);
    const res = await this.run({ cwd, prompt: synthesizePrompt(index.topic), systemPrompt: BRANCH_SYSTEM });
    return res.answer;
  }
}
