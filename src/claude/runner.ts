import { spawn } from "node:child_process";
import path from "node:path";
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

/** A live activity item describing what Claude is doing, surfaced to the UI. */
export type ActivityEvent =
  | { type: "tool"; label: string } // e.g. 'Searching the web for "best EV 2026"', 'Reading solar-costs.md'
  | { type: "status"; label: string }; // phase change, e.g. "Composing the answer…"

/**
 * Streaming spawn: emits stdout incrementally via onStdout (called with raw chunks) and
 * resolves with the exit code once the process closes. Mirrors SpawnFn's injection pattern
 * so a test can feed canned stream-json chunks.
 */
export type StreamSpawnFn = (
  args: string[],
  opts: { cwd: string; env: Record<string, string | undefined> },
  onStdout: (chunk: string) => void,
) => Promise<{ code: number | null }>;

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
  tokens: number;
  sessionId: string;
  meta: Record<string, unknown> | null;
}

/** Sum the four token counters off a Claude `usage` object, defensively (missing/odd shapes → 0). */
function totalTokens(usage: unknown): number {
  if (typeof usage !== "object" || usage === null) return 0;
  const u = usage as Record<string, unknown>;
  return (
    Number(u.input_tokens || 0) +
    Number(u.output_tokens || 0) +
    Number(u.cache_creation_input_tokens || 0) +
    Number(u.cache_read_input_tokens || 0)
  );
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

const defaultStreamSpawn: StreamSpawnFn = (args, opts, onStdout) =>
  new Promise((resolve, reject) => {
    // Same spawn contract as defaultSpawn (shell:false, detached stdin); only difference is
    // we forward stdout chunks live instead of buffering them into a single string.
    const child = spawn("claude", args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (d) => onStdout(d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code }));
  });

/** Map a stream-json tool_use block to a human-readable activity label. */
function toolLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "WebSearch":
      return `Searching the web for "${String(input.query ?? "")}"`;
    case "Read":
      return `Reading ${path.basename(String(input.file_path ?? ""))}`;
    case "Grep":
      return `Scanning notes for "${String(input.pattern ?? "")}"`;
    case "Glob":
      return "Looking through notes";
    default:
      return `Using ${name}`;
  }
}

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
    tokens: totalTokens(parsed.usage),
    sessionId: typeof parsed.session_id === "string" ? parsed.session_id : "",
    meta,
  };
}

/**
 * Like runClaude, but streams Claude's live activity (web searches, file reads, phase changes)
 * via onActivity while the run is in flight. Uses --output-format stream-json so stdout is a
 * stream of newline-delimited JSON events; the terminal "result" event carries the same fields
 * runClaude reads, so we assemble an identical ClaudeResult.
 */
export async function runClaudeStream(
  input: RunInput,
  onActivity: (e: ActivityEvent) => void,
  streamSpawnFn: StreamSpawnFn = defaultStreamSpawn,
): Promise<ClaudeResult> {
  const args = [
    "-p", input.prompt,
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--permission-mode", "dontAsk",
    "--allowedTools", "Read", "Glob", "Grep", "WebSearch",
    "--strict-mcp-config",
    "--append-system-prompt", input.systemPrompt,
  ];
  args.push("--model", input.model ?? "sonnet");

  let buffer = "";
  let composing = false;
  let resultEvent: Record<string, unknown> | null = null;

  const handleEvent = (event: Record<string, unknown>) => {
    if (event.type === "assistant") {
      const message = event.message as Record<string, unknown> | undefined;
      const content = Array.isArray(message?.content) ? (message!.content as unknown[]) : [];
      for (const raw of content) {
        const block = raw as Record<string, unknown>;
        if (block.type === "tool_use") {
          onActivity({ type: "tool", label: toolLabel(String(block.name ?? ""), (block.input as Record<string, unknown>) ?? {}) });
        } else if (block.type === "text" && !composing) {
          composing = true;
          onActivity({ type: "status", label: "Composing the answer…" });
        }
      }
    } else if (event.type === "result") {
      resultEvent = event;
    }
  };

  const consume = (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        handleEvent(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // ignore non-JSON lines (e.g. an update banner)
      }
    }
  };

  const { code } = await streamSpawnFn(args, { cwd: input.cwd, env: scrubbedEnv(input.env) }, consume);

  // flush any trailing line not terminated by a newline
  const tail = buffer.trim();
  if (tail) {
    try {
      handleEvent(JSON.parse(tail) as Record<string, unknown>);
    } catch {
      /* ignore */
    }
  }

  if (!resultEvent) {
    throw new Error(`claude stream-json exited (code ${code}) without a result event`);
  }
  const parsed = resultEvent as Record<string, unknown>;
  if (parsed.is_error) {
    throw new Error(`claude -p reported an error: ${String(parsed.result ?? parsed.subtype ?? "unknown")}`);
  }

  const { answer, meta } = splitMeta(String(parsed.result ?? ""));
  return {
    answer,
    claims: meta ? asStringArray(meta.claims) : [],
    sources: meta ? asStringArray(meta.sources) : [],
    costUsd: typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : 0,
    tokens: totalTokens(parsed.usage),
    sessionId: typeof parsed.session_id === "string" ? parsed.session_id : "",
    meta,
  };
}
