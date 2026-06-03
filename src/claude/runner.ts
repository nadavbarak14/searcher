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
    // shell:false is REQUIRED: under shell:true, Node concatenates args without
    // escaping (DEP0190), so cmd.exe shreds the multi-line --append-system-prompt
    // (newlines, <<<, {}, quotes) and Claude never receives the SEARCHER_META
    // instruction → zero findings. `claude` is a native .exe here, so CreateProcess
    // resolves it on PATH directly. stdin is detached so each call skips Claude's
    // 3s "no stdin received" wait.
    const child = spawn("claude", args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, code }));
  });

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function parseResultJson(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first !== -1 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1)) as Record<string, unknown>;
    }
    throw new Error("no JSON object found");
  }
}

export async function runClaude(input: RunInput, spawnFn: SpawnFn = defaultSpawn): Promise<ClaudeResult> {
  const args = [
    "-p", input.prompt,
    "--output-format", "json",
    "--permission-mode", "dontAsk",
    "--allowedTools", "Read", "Glob", "Grep", "WebSearch",
    // Don't load the user's global MCP servers (chrome-devtools, posthog, etc.):
    // the app uses only the built-in tools above, and loading MCP tool definitions
    // roughly doubles the per-call cache-creation cost for zero benefit.
    "--strict-mcp-config",
    "--append-system-prompt", input.systemPrompt,
  ];
  // Default to Sonnet: ~3x leaner per cold call than Opus, ample for this research.
  args.push("--model", input.model ?? "sonnet");

  const { stdout, code } = await spawnFn(args, { cwd: input.cwd, env: scrubbedEnv(input.env) });

  let parsed: Record<string, unknown>;
  try {
    parsed = parseResultJson(stdout);
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
