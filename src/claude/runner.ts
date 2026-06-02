import { spawn } from "node:child_process";
import { scrubbedEnv } from "./env.js";
import { splitMeta } from "./meta.js";

export interface SpawnResult {
  stdout: string;
  code: number | null;
}
export type SpawnFn = (
  args: string[],
  opts: { cwd: string; env: Record<string, string | undefined> },
) => Promise<SpawnResult>;

export interface RunInput {
  cwd: string;
  prompt: string;
  systemPrompt: string;
  env: Record<string, string | undefined>;
  model?: string;
}
export interface ClaudeResult {
  answer: string;
  claims: string[];
  sources: string[];
  costUsd: number;
  sessionId: string;
  meta: Record<string, unknown> | null;
}

const defaultSpawn: SpawnFn = (args, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd: opts.cwd, env: opts.env, shell: true });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, code }));
  });

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export async function runClaude(input: RunInput, spawnFn: SpawnFn = defaultSpawn): Promise<ClaudeResult> {
  const args = [
    "-p", input.prompt,
    "--output-format", "json",
    "--permission-mode", "dontAsk",
    "--allowedTools", "Read", "Glob", "Grep", "WebSearch",
    "--append-system-prompt", input.systemPrompt,
  ];
  if (input.model) args.push("--model", input.model);

  const { stdout, code } = await spawnFn(args, { cwd: input.cwd, env: scrubbedEnv(input.env) });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    throw new Error(`claude -p exited (code ${code}) with unparseable output: ${stdout.slice(0, 300)}`);
  }
  if (parsed.is_error) {
    throw new Error(`claude -p reported an error: ${String(parsed.result ?? parsed.subtype ?? "unknown")}`);
  }

  const { answer, meta } = splitMeta(String(parsed.result ?? ""));
  return {
    answer,
    claims: meta ? asStringArray(meta.claims) : [],
    sources: meta ? asStringArray(meta.sources) : [],
    costUsd: typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : 0,
    sessionId: typeof parsed.session_id === "string" ? parsed.session_id : "",
    meta,
  };
}
