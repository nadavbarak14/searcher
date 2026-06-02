# Searcher — Plan 02: Claude Runner + Backend API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the backend: a cost-safe Claude runner that drives the local `claude -p` CLI on the user's subscription, a research service that ties it to the Plan 01 graph store, and a one-command Fastify server that serves the API and (later) the frontend.

**Architecture:** `claude -p --output-format json` is the engine (validated working on the user's subscription). The runner spawns it with a scrubbed environment (no API keys → forces subscription OAuth), `cwd` = the project data folder (scopes Read), and `--permission-mode dontAsk`. A structured `<<<SEARCHER_META … SEARCHER_META>>>` block at the end of Claude's reply carries machine-parseable `claims`/`sources` (and `findings` for the root pass). The service layer composes runner + GraphStore. Fastify exposes REST endpoints and static-serves the built frontend. Everything is unit-tested with a **mocked spawn** — `npm test` never spends subscription credit.

**Tech Stack:** TypeScript ESM, Vitest, Fastify, `@fastify/static`, `open` (auto-launch browser), Node `child_process`. Builds on Plan 01 (`src/graph/*`).

**Validated facts (see project memory):** `claude -p "..." --output-format json` returns `{ result, total_cost_usd, session_id, is_error, ... }`. `--permission-mode` accepts `dontAsk`. stderr may carry unrelated hook noise → read **stdout only**. On Windows `claude` is a `.cmd` shim → spawn with `shell: true`.

**v1 scope decisions:** non-streaming JSON output (live streaming deferred); the real-`claude` integration test is `it.skip` by default. Crash-hardening items carried from Plan 01's review (atomic index writes, queue-serialized rebuild) are still deferred unless they block.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/config.ts` | Resolve data dir + port from env, with defaults. |
| `src/claude/env.ts` | `scrubbedEnv()` — strip API-key vars so spawned CLI uses subscription OAuth. |
| `src/claude/preflight.ts` | `preflight()` — verify `claude` present + no API key set; clear errors. |
| `src/claude/meta.ts` | Parse the `<<<SEARCHER_META … SEARCHER_META>>>` block out of a reply. |
| `src/claude/runner.ts` | `runClaude()` — spawn `claude -p`, parse the result JSON. Injectable spawn. |
| `src/claude/prompts.ts` | System prompts + root/branch/synthesize prompt builders. |
| `src/service.ts` | `createTopic` / `branch` / `synthesize` — compose runner + GraphStore. |
| `src/server/app.ts` | `buildApp()` — Fastify routes + static serving. |
| `src/main.ts` | Entry point: preflight → listen → open browser. |
| `public/index.html` | Placeholder page (replaced by Plan 03's built frontend). |
| `test/**` | Unit tests with mocked spawn / mocked service. |

---

### Task 1: Config module

**Files:**
- Create: `src/config.ts`
- Test: `test/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/config.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { resolveConfig } from "../src/config.js";
import os from "node:os";
import path from "node:path";

describe("resolveConfig", () => {
  it("uses defaults when env is empty", () => {
    const cfg = resolveConfig({});
    expect(cfg.port).toBe(4317);
    expect(cfg.dataDir).toBe(path.join(os.homedir(), "Searcher"));
  });

  it("honors SEARCHER_PORT and SEARCHER_DATA_DIR", () => {
    const cfg = resolveConfig({ SEARCHER_PORT: "5000", SEARCHER_DATA_DIR: "/tmp/x" });
    expect(cfg.port).toBe(5000);
    expect(cfg.dataDir).toBe("/tmp/x");
  });

  it("ignores a non-numeric port and falls back to default", () => {
    const cfg = resolveConfig({ SEARCHER_PORT: "abc" });
    expect(cfg.port).toBe(4317);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — cannot find module `../src/config.js`.

- [ ] **Step 3: Implement**

Create `src/config.ts`:

```typescript
import os from "node:os";
import path from "node:path";

export interface Config {
  port: number;
  dataDir: string;
}

const DEFAULT_PORT = 4317;

/** Resolve runtime config from an environment-like map (defaults if unset/invalid). */
export function resolveConfig(env: Record<string, string | undefined>): Config {
  const parsedPort = Number(env.SEARCHER_PORT);
  const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_PORT;
  const dataDir = env.SEARCHER_DATA_DIR ?? path.join(os.homedir(), "Searcher");
  return { port, dataDir };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/config.test.ts` → PASS (3 tests). Then `npm test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat(config): resolve data dir + port from env"
```

---

### Task 2: Environment scrub + preflight

**Files:**
- Create: `src/claude/env.ts`
- Create: `src/claude/preflight.ts`
- Test: `test/claude/env.test.ts`
- Test: `test/claude/preflight.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/claude/env.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { scrubbedEnv, API_KEY_VARS } from "../../src/claude/env.js";

describe("scrubbedEnv", () => {
  it("removes every API-key/auth var so the CLI must use subscription OAuth", () => {
    const input = {
      PATH: "/usr/bin",
      ANTHROPIC_API_KEY: "sk-ant-xxx",
      ANTHROPIC_AUTH_TOKEN: "tok",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_USE_VERTEX: "1",
      KEEP_ME: "yes",
    };
    const out = scrubbedEnv(input);
    for (const v of API_KEY_VARS) expect(out[v]).toBeUndefined();
    expect(out.PATH).toBe("/usr/bin");
    expect(out.KEEP_ME).toBe("yes");
  });

  it("does not mutate the input object", () => {
    const input = { ANTHROPIC_API_KEY: "x" };
    scrubbedEnv(input);
    expect(input.ANTHROPIC_API_KEY).toBe("x");
  });
});
```

Create `test/claude/preflight.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { preflight } from "../../src/claude/preflight.js";

describe("preflight", () => {
  it("passes when claude is present and no API key is set", async () => {
    const res = await preflight({ env: { PATH: "/x" }, checkClaude: async () => true });
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it("fails when an API key var is present (would bill metered)", async () => {
    const res = await preflight({ env: { ANTHROPIC_API_KEY: "sk" }, checkClaude: async () => true });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("fails when the claude CLI is not found", async () => {
    const res = await preflight({ env: {}, checkClaude: async () => false });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/claude/i);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/claude/env.test.ts test/claude/preflight.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

Create `src/claude/env.ts`:

```typescript
/** Env vars that, if set, would make the Claude CLI bill metered API usage instead of the subscription. */
export const API_KEY_VARS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
] as const;

/** Return a copy of `env` with all API-key/auth vars removed (input is not mutated). */
export function scrubbedEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const out = { ...env };
  for (const v of API_KEY_VARS) delete out[v];
  return out;
}
```

Create `src/claude/preflight.ts`:

```typescript
import { API_KEY_VARS } from "./env.js";

export interface PreflightResult {
  ok: boolean;
  errors: string[];
}

export interface PreflightDeps {
  env: Record<string, string | undefined>;
  /** Returns true if the `claude` CLI is invocable. */
  checkClaude: () => Promise<boolean>;
}

/** Verify the environment is safe to run on the subscription (no API key) and the CLI is present. */
export async function preflight(deps: PreflightDeps): Promise<PreflightResult> {
  const errors: string[] = [];
  for (const v of API_KEY_VARS) {
    if (deps.env[v]) {
      errors.push(
        `${v} is set — this would bill metered API usage. Unset it so Searcher uses your Claude subscription.`,
      );
    }
  }
  if (!(await deps.checkClaude())) {
    errors.push(
      "The `claude` CLI was not found. Install Claude Code and log in with your subscription (`claude` then /login).",
    );
  }
  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run test/claude/env.test.ts test/claude/preflight.test.ts` → PASS (5 tests). Then `npm test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/claude/env.ts src/claude/preflight.ts test/claude/env.test.ts test/claude/preflight.test.ts
git commit -m "feat(claude): env scrub + subscription-safety preflight"
```

---

### Task 3: META block parser

**Files:**
- Create: `src/claude/meta.ts`
- Test: `test/claude/meta.test.ts`

The agent is instructed (Task 5 prompts) to end its reply with:
```
<<<SEARCHER_META
{ ...json... }
SEARCHER_META>>>
```

- [ ] **Step 1: Write the failing test**

Create `test/claude/meta.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { splitMeta } from "../../src/claude/meta.js";

describe("splitMeta", () => {
  it("extracts the answer and parsed meta json", () => {
    const reply = [
      "Adversarial examples transfer because models share features.",
      "",
      "<<<SEARCHER_META",
      '{"claims":["models share features"],"sources":["https://a.test"]}',
      "SEARCHER_META>>>",
    ].join("\n");
    const { answer, meta } = splitMeta(reply);
    expect(answer).toBe("Adversarial examples transfer because models share features.");
    expect(meta).toEqual({ claims: ["models share features"], sources: ["https://a.test"] });
  });

  it("returns the whole text as answer and null meta when no block present", () => {
    const { answer, meta } = splitMeta("just an answer");
    expect(answer).toBe("just an answer");
    expect(meta).toBeNull();
  });

  it("returns null meta when the block contains invalid json (answer still recovered)", () => {
    const reply = "Ans.\n<<<SEARCHER_META\nnot json\nSEARCHER_META>>>";
    const { answer, meta } = splitMeta(reply);
    expect(answer).toBe("Ans.");
    expect(meta).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/claude/meta.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/claude/meta.ts`:

```typescript
const START = "<<<SEARCHER_META";
const END = "SEARCHER_META>>>";

export interface SplitMeta {
  answer: string;
  meta: Record<string, unknown> | null;
}

/**
 * Split a Claude reply into the human answer and the parsed SEARCHER_META JSON block.
 * If no block exists or its JSON is invalid, `meta` is null and `answer` is the text
 * before the marker (or the whole reply).
 */
export function splitMeta(reply: string): SplitMeta {
  const start = reply.lastIndexOf(START);
  if (start === -1) return { answer: reply.trim(), meta: null };

  const answer = reply.slice(0, start).trim();
  const end = reply.indexOf(END, start);
  const jsonText = reply.slice(start + START.length, end === -1 ? undefined : end).trim();
  try {
    return { answer, meta: JSON.parse(jsonText) as Record<string, unknown> };
  } catch {
    return { answer, meta: null };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/claude/meta.test.ts` → PASS (3 tests). Then `npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/claude/meta.ts test/claude/meta.test.ts
git commit -m "feat(claude): parse SEARCHER_META block from replies"
```

---

### Task 4: Claude runner (spawn + result parse)

**Files:**
- Create: `src/claude/runner.ts`
- Test: `test/claude/runner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/claude/runner.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { runClaude, type SpawnResult, type SpawnFn } from "../../src/claude/runner.js";

function fakeSpawn(stdout: string, code = 0): { fn: SpawnFn; calls: any[] } {
  const calls: any[] = [];
  const fn: SpawnFn = async (args, opts) => {
    calls.push({ args, opts });
    return { stdout, code } as SpawnResult;
  };
  return { fn, calls };
}

const sampleJson = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "The answer.\n<<<SEARCHER_META\n{\"claims\":[\"c1\"],\"sources\":[\"https://s.test\"]}\nSEARCHER_META>>>",
  total_cost_usd: 0.01,
  session_id: "sess-1",
});

describe("runClaude", () => {
  it("builds the correct argv and parses answer + meta + cost", async () => {
    const { fn, calls } = fakeSpawn(sampleJson);
    const res = await runClaude(
      { cwd: "/proj", prompt: "Q?", systemPrompt: "SYS", env: { PATH: "/x" } },
      fn,
    );
    expect(res.answer).toBe("The answer.");
    expect(res.claims).toEqual(["c1"]);
    expect(res.sources).toEqual(["https://s.test"]);
    expect(res.costUsd).toBe(0.01);
    expect(res.sessionId).toBe("sess-1");

    const argv: string[] = calls[0].args;
    expect(argv).toContain("-p");
    expect(argv).toContain("Q?");
    expect(argv).toEqual(expect.arrayContaining(["--output-format", "json"]));
    expect(argv).toEqual(expect.arrayContaining(["--permission-mode", "dontAsk"]));
    expect(argv).toEqual(expect.arrayContaining(["--append-system-prompt", "SYS"]));
    expect(argv).toContain("WebSearch");
    expect(calls[0].opts.cwd).toBe("/proj");
    // env must be scrubbed
    expect(calls[0].opts.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("throws when claude reports is_error", async () => {
    const errJson = JSON.stringify({ is_error: true, result: "boom", subtype: "error" });
    const { fn } = fakeSpawn(errJson);
    await expect(
      runClaude({ cwd: "/p", prompt: "q", systemPrompt: "s", env: {} }, fn),
    ).rejects.toThrow(/boom|error/i);
  });

  it("throws on non-zero exit with unparseable stdout", async () => {
    const { fn } = fakeSpawn("not json", 1);
    await expect(
      runClaude({ cwd: "/p", prompt: "q", systemPrompt: "s", env: {} }, fn),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/claude/runner.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/claude/runner.ts`:

```typescript
import { spawn } from "node:child_process";
import { scrubbedEnv } from "./env.js";
import { splitMeta } from "./meta.js";

export interface SpawnResult {
  stdout: string;
  code: number | null;
}

/** Injectable spawn-and-collect function (real impl uses child_process; tests pass a fake). */
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
}

/** Default spawn impl: runs the `claude` CLI, collects stdout (ignores stderr noise). */
const defaultSpawn: SpawnFn = (args, opts) =>
  new Promise((resolve, reject) => {
    // shell:true so Windows resolves the `claude.cmd` shim.
    const child = spawn("claude", args, { cwd: opts.cwd, env: opts.env, shell: true });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, code }));
  });

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Run `claude -p` headlessly and parse the structured result. */
export async function runClaude(input: RunInput, spawnFn: SpawnFn = defaultSpawn): Promise<ClaudeResult> {
  const args = [
    "-p",
    input.prompt,
    "--output-format",
    "json",
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    "Read",
    "Glob",
    "Grep",
    "WebSearch",
    "--append-system-prompt",
    input.systemPrompt,
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
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/claude/runner.test.ts` → PASS (3 tests). Then `npm test` + `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/claude/runner.ts test/claude/runner.test.ts
git commit -m "feat(claude): runClaude spawns claude -p and parses result (mockable spawn)"
```

---

### Task 5: Prompts

**Files:**
- Create: `src/claude/prompts.ts`
- Test: `test/claude/prompts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/claude/prompts.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { BRANCH_SYSTEM, ROOT_SYSTEM, rootPrompt, branchPrompt, synthesizePrompt } from "../../src/claude/prompts.js";

describe("prompts", () => {
  it("system prompts mention the SEARCHER_META protocol", () => {
    expect(BRANCH_SYSTEM).toContain("SEARCHER_META");
    expect(ROOT_SYSTEM).toContain("SEARCHER_META");
    expect(ROOT_SYSTEM).toContain("findings");
  });

  it("rootPrompt includes the topic", () => {
    expect(rootPrompt("AI security")).toContain("AI security");
  });

  it("branchPrompt includes topic, selection, question and ancestor titles", () => {
    const p = branchPrompt({
      topic: "AI security",
      selection: "adversarial examples",
      question: "why transfer?",
      ancestorTitles: ["What are adversarial examples?"],
    });
    expect(p).toContain("AI security");
    expect(p).toContain("adversarial examples");
    expect(p).toContain("why transfer?");
    expect(p).toContain("What are adversarial examples?");
  });

  it("synthesizePrompt includes the topic", () => {
    expect(synthesizePrompt("AI security")).toContain("AI security");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/claude/prompts.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/claude/prompts.ts`:

```typescript
const META_INSTRUCTIONS = [
  "End your reply with a metadata block delimited EXACTLY like this:",
  "<<<SEARCHER_META",
  '{ "claims": ["short factual claim", ...], "sources": ["https://...", ...] }',
  "SEARCHER_META>>>",
  "Put 1-5 key claims and every URL you used in it. Output nothing after the closing marker.",
].join("\n");

export const BRANCH_SYSTEM = [
  "You are a research assistant inside a knowledge-graph app.",
  "Answer the user's question concisely and factually. Use web search when it helps and cite sources.",
  "You may read sibling research notes: they are .md files in your current working directory; read them if they add context.",
  META_INSTRUCTIONS,
].join("\n\n");

export const ROOT_SYSTEM = [
  "You are a research assistant kicking off research on a topic.",
  "Identify 3-5 distinct, important sub-areas of the topic. Use web search where useful.",
  "Return ONLY a metadata block (minimal prose before it) in this exact form:",
  "<<<SEARCHER_META",
  '{ "findings": [ { "question": "the sub-area as a question", "body": "a concise 2-4 sentence finding", "sources": ["https://..."] }, ... ] }',
  "SEARCHER_META>>>",
  "Output nothing after the closing marker.",
].join("\n\n");

export function rootPrompt(topic: string): string {
  return `Research topic: "${topic}". Map out its key sub-areas as findings.`;
}

export function branchPrompt(input: {
  topic: string;
  selection: string;
  question: string;
  ancestorTitles: string[];
}): string {
  const trail = input.ancestorTitles.length
    ? `\nResearch context (ancestor questions):\n- ${input.ancestorTitles.join("\n- ")}`
    : "";
  return [
    `Overall research topic: "${input.topic}".`,
    `I am drilling into this selected text: "${input.selection}".`,
    `My question: ${input.question}`,
    trail,
  ].join("\n");
}

export function synthesizePrompt(topic: string): string {
  return [
    `Synthesize the research project on "${topic}" into a clean markdown report.`,
    "The research notes are .md files in your current working directory — read them all (each has frontmatter with its question).",
    "Produce: a short intro, the main threads with their conclusions, and a consolidated sources list.",
    "Output the report as markdown. You may omit the SEARCHER_META block for this task.",
  ].join("\n");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/claude/prompts.test.ts` → PASS (4 tests). Then `npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/claude/prompts.ts test/claude/prompts.test.ts
git commit -m "feat(claude): system prompts + root/branch/synthesize prompt builders"
```

---

### Task 6: Research service

**Files:**
- Create: `src/service.ts`
- Test: `test/service.test.ts`

`ResearchService` composes a `GraphStore` (Plan 01) and an injected `runClaude`-shaped function so tests never spawn the CLI.

- [ ] **Step 1: Write the failing test**

Create `test/service.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GraphStore } from "../src/graph/store.js";
import { ResearchService, type RunFn } from "../src/service.js";

let baseDir: string;
afterEach(async () => baseDir && (await fs.rm(baseDir, { recursive: true, force: true })));
beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "searcher-svc-"));
});

function svcWith(run: RunFn) {
  return new ResearchService(baseDir, run);
}

describe("ResearchService.createTopic", () => {
  it("creates the project topic node + one finding per returned finding", async () => {
    const run: RunFn = async () => ({
      answer: "",
      claims: [],
      sources: [],
      costUsd: 0,
      sessionId: "s",
      meta: { findings: [
        { question: "Q1", body: "B1", sources: ["https://1"] },
        { question: "Q2", body: "B2", sources: [] },
      ] },
    });
    const svc = svcWith(run);
    const { projectId } = await svc.createTopic("AI security");

    const store = new GraphStore(baseDir, projectId);
    const index = await store.load();
    expect(index.topic).toBe("AI security");
    expect(index.nodes.filter((n) => n.kind === "finding")).toHaveLength(2);
  });
});

describe("ResearchService.branch", () => {
  it("creates a child finding anchored to the selection", async () => {
    const rootRun: RunFn = async () => ({
      answer: "", claims: [], sources: [], costUsd: 0, sessionId: "s",
      meta: { findings: [{ question: "Q1", body: "B1", sources: [] }] },
    });
    const svc1 = svcWith(rootRun);
    const { projectId } = await svc1.createTopic("AI security");

    const branchRun: RunFn = async () => ({
      answer: "Because of shared features.", claims: ["c"], sources: ["https://x"], costUsd: 0.02, sessionId: "s2", meta: null,
    });
    const svc2 = new ResearchService(baseDir, branchRun);
    const node = await svc2.branch(projectId, {
      parentId: "n_1",
      anchor: { text: "features", offset: 3, occurrence: 1 },
      question: "why?",
    });
    expect(node.kind).toBe("finding");
    expect(node.parents).toEqual(["n_1"]);
    expect(node.anchor?.text).toBe("features");
    expect(node.body).toBe("Because of shared features.");
    expect(node.sources).toEqual(["https://x"]);
  });
});

describe("ResearchService.synthesize", () => {
  it("returns the runner's answer as the report", async () => {
    const rootRun: RunFn = async () => ({
      answer: "", claims: [], sources: [], costUsd: 0, sessionId: "s",
      meta: { findings: [{ question: "Q1", body: "B1", sources: [] }] },
    });
    const { projectId } = await svcWith(rootRun).createTopic("AI security");

    const synthRun: RunFn = async () => ({
      answer: "# Report\nAll about AI security.", claims: [], sources: [], costUsd: 0.05, sessionId: "s3", meta: null,
    });
    const report = await new ResearchService(baseDir, synthRun).synthesize(projectId);
    expect(report).toContain("# Report");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/service.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/service.ts`:

```typescript
import path from "node:path";
import { GraphStore } from "./graph/store.js";
import { projectDir } from "./graph/paths.js";
import type { ResearchNode, Anchor } from "./graph/types.js";
import { runClaude } from "./claude/runner.js";
import { BRANCH_SYSTEM, ROOT_SYSTEM, rootPrompt, branchPrompt, synthesizePrompt } from "./claude/prompts.js";
import { scrubbedEnv } from "./claude/env.js";

/** The runner shape the service depends on. Production passes a wrapper over runClaude that also
 *  returns the raw meta (for the root findings list); tests pass a fake. */
export interface RunResult {
  answer: string;
  claims: string[];
  sources: string[];
  costUsd: number;
  sessionId: string;
  meta: Record<string, unknown> | null;
}
export type RunFn = (input: {
  cwd: string;
  prompt: string;
  systemPrompt: string;
}) => Promise<RunResult>;

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

/** The default production runner: wraps runClaude and surfaces the parsed meta block. */
export const defaultRun: RunFn = async ({ cwd, prompt, systemPrompt }) => {
  // runClaude already splits answer/claims/sources; we re-run splitMeta indirectly by also
  // returning meta. To keep one source of truth, call runClaude and recompute meta from sources/claims
  // is lossy for `findings`, so the runner is extended to expose meta — see note below.
  const r = await runClaude({ cwd, prompt, systemPrompt, env: process.env as Record<string, string | undefined> });
  return { ...r, meta: r.meta };
};

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

  async branch(
    projectId: string,
    input: { parentId: string; anchor: Anchor; question: string },
  ): Promise<ResearchNode> {
    const store = new GraphStore(this.baseDir, projectId);
    const index = await store.load();
    const parent = await store.getNode(input.parentId);
    const cwd = projectDir(this.baseDir, projectId);
    const prompt = branchPrompt({
      topic: index.topic,
      selection: input.anchor.text,
      question: input.question,
      ancestorTitles: [parent.question],
    });
    const res = await this.run({ cwd, prompt, systemPrompt: BRANCH_SYSTEM });
    return store.addFinding({
      parents: [input.parentId],
      anchor: input.anchor,
      question: input.question,
      body: res.answer,
      sources: res.sources,
    });
  }

  async synthesize(projectId: string): Promise<string> {
    const store = new GraphStore(this.baseDir, projectId);
    const index = await store.load();
    const cwd = projectDir(this.baseDir, projectId);
    const res = await this.run({ cwd, prompt: synthesizePrompt(index.topic), systemPrompt: BRANCH_SYSTEM });
    return res.answer;
  }
}
```

NOTE for implementer: `runClaude` (Task 4) currently does NOT return `meta`. To make `defaultRun` work, extend `ClaudeResult` and `runClaude` to also return `meta: Record<string, unknown> | null` (the same object `splitMeta` produced). This is a small additive change: add `meta` to the `ClaudeResult` interface and to the returned object (`meta`), and update the Task-4 test to assert `res.meta` is the parsed object. Make that change as part of this task and keep all Task-4 tests green. Tests in this task inject `RunFn` directly so they are unaffected.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/service.test.ts` → PASS. Then `npm test` + `npm run typecheck` (update the runner + its test for `meta` as noted; all green).

- [ ] **Step 5: Commit**

```bash
git add src/service.ts src/claude/runner.ts test/service.test.ts test/claude/runner.test.ts
git commit -m "feat(service): createTopic/branch/synthesize over store + runner"
```

---

### Task 7: Fastify app + routes + static serving

**Files:**
- Create: `src/server/app.ts`
- Create: `public/index.html`
- Test: `test/server/app.test.ts`
- Add deps: `fastify`, `@fastify/static`

- [ ] **Step 1: Add deps**

Run:
```bash
npm install fastify @fastify/static
npm install --save-dev @types/node
```

- [ ] **Step 2: Write the failing test**

Create `test/server/app.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../../src/server/app.js";
import type { ResearchService } from "../../src/service.js";

let baseDir: string;
beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "searcher-app-"));
});
afterEach(async () => baseDir && (await fs.rm(baseDir, { recursive: true, force: true })));

// A stub service with just the methods routes use.
function stubService(over: Partial<ResearchService> = {}): ResearchService {
  return {
    createTopic: async () => ({ projectId: "ai-security" }),
    branch: async () => ({ id: "n_1", kind: "finding", parents: ["topic"], question: "q", sources: [], created: "t", body: "b" }),
    synthesize: async () => "# Report",
    ...over,
  } as unknown as ResearchService;
}

describe("buildApp routes", () => {
  it("POST /api/projects creates a topic", async () => {
    const app = buildApp({ dataDir: baseDir, service: stubService() });
    const res = await app.inject({ method: "POST", url: "/api/projects", payload: { topic: "AI security" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().projectId).toBe("ai-security");
    await app.close();
  });

  it("POST /api/projects 400s when topic missing", async () => {
    const app = buildApp({ dataDir: baseDir, service: stubService() });
    const res = await app.inject({ method: "POST", url: "/api/projects", payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("POST /api/projects/:id/branch returns the new node", async () => {
    const app = buildApp({ dataDir: baseDir, service: stubService() });
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/ai-security/branch",
      payload: { parentId: "topic", anchor: { text: "x", offset: 0, occurrence: 1 }, question: "why?" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe("n_1");
    await app.close();
  });

  it("GET /api/projects lists project folders in the data dir", async () => {
    await fs.mkdir(path.join(baseDir, "proj-a"));
    await fs.mkdir(path.join(baseDir, "proj-b"));
    const app = buildApp({ dataDir: baseDir, service: stubService() });
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    expect(res.statusCode).toBe(200);
    expect(res.json().projects.sort()).toEqual(["proj-a", "proj-b"]);
    await app.close();
  });

  it("serves the placeholder index.html at /", async () => {
    const app = buildApp({ dataDir: baseDir, service: stubService() });
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Searcher");
    await app.close();
  });
});
```

- [ ] **Step 3: Create the placeholder page**

Create `public/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Searcher</title>
  </head>
  <body>
    <h1>Searcher</h1>
    <p>Backend is running. The research canvas (frontend) is built in the next milestone.</p>
  </body>
</html>
```

- [ ] **Step 4: Implement the app**

Create `src/server/app.ts`:

```typescript
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ResearchService } from "../service.js";
import { GraphStore } from "../graph/store.js";

export interface AppDeps {
  dataDir: string;
  service: ResearchService;
  /** Absolute path to the static dir to serve (defaults to <repo>/public). */
  publicDir?: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultPublicDir = path.resolve(here, "../../../public");

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/api/projects", async () => {
    const entries = await fs.readdir(deps.dataDir, { withFileTypes: true }).catch(() => []);
    const projects = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    return { projects };
  });

  app.post<{ Body: { topic?: string } }>("/api/projects", async (req, reply) => {
    const topic = req.body?.topic?.trim();
    if (!topic) return reply.code(400).send({ error: "topic is required" });
    return deps.service.createTopic(topic);
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id", async (req, reply) => {
    const store = new GraphStore(deps.dataDir, req.params.id);
    try {
      const index = await store.load();
      return { index };
    } catch {
      return reply.code(404).send({ error: "project not found" });
    }
  });

  app.post<{
    Params: { id: string };
    Body: { parentId?: string; anchor?: { text: string; offset: number; occurrence: number }; question?: string };
  }>("/api/projects/:id/branch", async (req, reply) => {
    const { parentId, anchor, question } = req.body ?? {};
    if (!parentId || !anchor || !question) {
      return reply.code(400).send({ error: "parentId, anchor and question are required" });
    }
    return deps.service.branch(req.params.id, { parentId, anchor, question });
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/synthesize", async (req) => {
    const markdown = await deps.service.synthesize(req.params.id);
    return { markdown };
  });

  app.register(fastifyStatic, { root: deps.publicDir ?? defaultPublicDir });

  return app;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/server/app.test.ts` → PASS (5 tests). Then `npm test` + `npm run typecheck`.

NOTE: `defaultPublicDir` resolves relative to the COMPILED location (`dist/src/server/`). With `outDir: dist` and `rootDir: "."`, compiled file is `dist/src/server/app.js`, so `../../../public` reaches the repo `public/`. The tests pass `publicDir` explicitly only if needed; here the default is used and the repo `public/` exists. If the path resolution fails in the test (because tests run from `src` via vitest, not `dist`), pass `publicDir: path.resolve(process.cwd(), "public")` in the test's `buildApp` calls. Implementer: make the "/" test pass — if the default path doesn't resolve under vitest, add `publicDir` to the test deps pointing at the repo `public/`.

- [ ] **Step 6: Commit**

```bash
git add src/server/app.ts public/index.html test/server/app.test.ts package.json package-lock.json
git commit -m "feat(server): Fastify routes + static serving"
```

---

### Task 8: Entry point, one-command run, auto-open

**Files:**
- Create: `src/main.ts`
- Modify: `package.json` (scripts + `open` dep)
- Test: `test/main.smoke.test.ts`

- [ ] **Step 1: Add the `open` dep**

Run: `npm install open`

- [ ] **Step 2: Write the failing smoke test**

Create `test/main.smoke.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { startServer } from "../src/main.js";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";

describe("startServer", () => {
  it("starts, serves /, and stops (no browser open in test)", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "searcher-main-"));
    const { app, url } = await startServer({ port: 0, dataDir, openBrowser: false });
    expect(url).toMatch(/^http:\/\/localhost:\d+$/);
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 3: Implement**

Create `src/main.ts`:

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import { resolveConfig } from "./config.js";
import { buildApp } from "./server/app.js";
import { ResearchService } from "./service.js";
import { preflight } from "./claude/preflight.js";

const execFileP = promisify(execFile);

async function claudePresent(): Promise<boolean> {
  try {
    await execFileP("claude", ["--version"], { shell: true });
    return true;
  } catch {
    return false;
  }
}

export interface StartOptions {
  port: number;
  dataDir: string;
  openBrowser?: boolean;
}

/** Build + start the server. Returns the app and its URL. Does not run preflight (see main()). */
export async function startServer(opts: StartOptions): Promise<{ app: FastifyInstance; url: string }> {
  const service = new ResearchService(opts.dataDir);
  const app = buildApp({ dataDir: opts.dataDir, service });
  const address = await app.listen({ port: opts.port, host: "127.0.0.1" });
  // address like http://127.0.0.1:PORT — normalize host to localhost for the browser
  const url = address.replace("127.0.0.1", "localhost");
  if (opts.openBrowser) {
    const open = (await import("open")).default;
    await open(url).catch(() => {});
  }
  return { app, url };
}

/** CLI entry: preflight, then start, then open the browser. */
export async function main(): Promise<void> {
  const cfg = resolveConfig(process.env);
  const pf = await preflight({ env: process.env, checkClaude: claudePresent });
  if (!pf.ok) {
    console.error("Searcher cannot start:\n" + pf.errors.map((e) => "  - " + e).join("\n"));
    process.exit(1);
  }
  const { url } = await startServer({ port: cfg.port, dataDir: cfg.dataDir, openBrowser: true });
  console.log(`Searcher running at ${url}  (data: ${cfg.dataDir})`);
}

// Run main() only when executed directly (not when imported by tests).
const isDirect = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

NOTE for implementer: the `isDirect` guard above is fragile across platforms (Windows path → file URL). A more robust check: compare the realpath. If the smoke test or `npm start` misbehaves because `main()` runs (or doesn't), use this instead:
```typescript
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
const isDirect = (() => {
  try { return process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
```
Use whichever makes the smoke test pass WITHOUT spawning the server on import. The smoke test imports `startServer` (not `main`), so importing the module must not call `main()`.

- [ ] **Step 4: Add scripts**

In `package.json`, set scripts to:

```json
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "build": "tsc",
    "start": "tsc && node dist/src/main.js"
  }
```

- [ ] **Step 5: Run to verify**

Run: `npx vitest run test/main.smoke.test.ts` → PASS (1 test). Then `npm test` + `npm run typecheck`.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts package.json package-lock.json test/main.smoke.test.ts
git commit -m "feat(server): entry point with preflight, one-command start, auto-open"
```

---

### Task 9: Opt-in real-CLI integration test (skipped by default)

**Files:**
- Create: `test/claude/runner.integration.test.ts`

- [ ] **Step 1: Write the (skipped) integration test**

Create `test/claude/runner.integration.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { runClaude } from "../../src/claude/runner.js";

// Opt-in only: set SEARCHER_LIVE=1 to actually call `claude -p` (spends subscription credit).
const live = process.env.SEARCHER_LIVE === "1";

describe.skipIf(!live)("runClaude (LIVE, spends credit)", () => {
  it("gets a real answer from claude -p", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "searcher-live-"));
    const res = await runClaude({
      cwd,
      prompt: "In one sentence, what is an adversarial example in ML?",
      systemPrompt: "Answer in one sentence. End with the SEARCHER_META block containing sources (may be empty).",
      env: process.env as Record<string, string | undefined>,
      model: "haiku",
    });
    expect(res.answer.length).toBeGreaterThan(0);
    await fs.rm(cwd, { recursive: true, force: true });
  }, 60_000);
});
```

- [ ] **Step 2: Verify it's skipped by default**

Run: `npm test` → all pass; the integration test is reported skipped (not run). To run it manually later: `SEARCHER_LIVE=1 npx vitest run test/claude/runner.integration.test.ts` (PowerShell: `$env:SEARCHER_LIVE=1; npx vitest run ...`).

- [ ] **Step 3: Commit**

```bash
git add test/claude/runner.integration.test.ts
git commit -m "test(claude): opt-in live integration test (skipped by default)"
```

---

## Self-Review

**Spec coverage (Plan 02 slice):**
- Subscription-only, env-scrub, preflight → Tasks 2, 8. ✓
- `claude -p` runner, `cwd` scoping, `dontAsk`, allowed tools, JSON parse → Task 4. ✓
- META block (claims/sources/findings) parse → Tasks 3, 6. ✓
- Root pass → N findings; branch with anchor; synthesize → Task 6. ✓
- REST endpoints + static serve → Task 7. ✓
- One-command run + auto-open + preflight gate → Task 8. ✓
- Cost-safe tests (mock spawn) + opt-in live test → Tasks 4, 9. ✓
- Windows `.cmd` shim (`shell: true`) → Tasks 4, 8. ✓
- *Deferred (documented):* live token streaming; atomic index writes / queue-serialized rebuild (Plan 01 carryover); per-node cost surfacing in UI (Plan 03).

**Placeholder scan:** none — every step has complete code + exact commands. Two implementer NOTES (runner `meta` extension in Task 6; `isDirect` guard in Task 8) give concrete code, not vague guidance.

**Type consistency:** `RunResult`/`RunFn` (service) vs `ClaudeResult` (runner) — Task 6 explicitly extends `runClaude` to return `meta`, reconciling them. `Anchor`, `ResearchNode`, `GraphStore`, `projectDir` reused from Plan 01 with matching signatures. Route payload shapes match the service method inputs.

---

## Next milestone
- **Plan 03 — Frontend:** React + Vite + React Flow canvas, library view, topic creation, the select-text→branch interaction, node detail panel, synthesize/export, cost display. Built into `public/` so `npm start` serves it.
