# Searcher — Plan 03: Frontend Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans.

**Goal:** A React + React Flow web app — create a topic, see the research as a navigable graph, click a node to read it, select text in an answer to branch a new question, and export a synthesis. Built into `public/` so `npm start` serves it on one port.

**Architecture:** Vite + React + TypeScript app in `web/`, building to `public/` (which becomes generated output). A typed `api.ts` client calls the Plan 02 backend. `@xyflow/react` renders the node graph from the project index; clicking a node fetches its full body; selecting text in the detail panel computes an `Anchor` and POSTs a branch. The backend gains a per-node GET route and an SPA fallback.

**Tech Stack:** Vite, React 18, TypeScript, `@xyflow/react` (React Flow), `react-markdown`. Tests: Vitest + `@testing-library/react` + jsdom for the testable units.

**Builds on:** Plan 02 backend (routes under `/api`). This plan also completes the deferred Plan 02 item: **SPA fallback** for client routes.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/server/app.ts` (modify) | Add `GET /api/projects/:id/nodes/:nodeId`; add SPA fallback (non-`/api` GET → index.html). |
| `test/server/app.test.ts` (modify) | Decouple static tests from a committed `public/`; cover the node route + SPA fallback. |
| `.gitignore` (modify) | Ignore generated `/public/`. |
| `vite.config.ts` | Vite: root `web/`, build `outDir` → `../public`, dev proxy `/api` → backend. |
| `web/index.html`, `web/src/main.tsx` | App mount. |
| `web/src/api.ts` | Typed fetch client (testable with mocked fetch). |
| `web/src/anchor.ts` | `computeAnchor(body, selectedText, fromIndex)` (pure, testable). |
| `web/src/types.ts` | Shared FE types mirroring backend shapes. |
| `web/src/App.tsx` | Top-level: library view ↔ project view. |
| `web/src/components/Library.tsx` | List projects + new-topic form. |
| `web/src/components/GraphView.tsx` | React Flow canvas from the index. |
| `web/src/components/NodeDetail.tsx` | Render node body; select-text→branch; sources. |
| `web/src/styles.css` | Minimal styling. |

---

### Task 1: Backend — node route, SPA fallback, decouple static tests

**Files:** modify `src/server/app.ts`, `test/server/app.test.ts`, `.gitignore`; delete `public/index.html`.

- [ ] **Step 1: Update the app tests first (TDD)**

Replace `test/server/app.test.ts` with a version that (a) builds its own temp `publicDir` with an `index.html` fixture (so tests don't depend on a generated `public/`), and (b) covers the new node route + SPA fallback:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../../src/server/app.js";
import type { ResearchService } from "../../src/service.js";
import { GraphStore } from "../../src/graph/store.js";

let dataDir: string;
let publicDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "searcher-data-"));
  publicDir = await fs.mkdtemp(path.join(os.tmpdir(), "searcher-pub-"));
  await fs.writeFile(path.join(publicDir, "index.html"), "<!doctype html><title>Searcher</title><div id=root></div>");
});
afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.rm(publicDir, { recursive: true, force: true });
});

function stubService(over: Partial<ResearchService> = {}): ResearchService {
  return {
    createTopic: async () => ({ projectId: "ai-security", findingCount: 3 }),
    branch: async () => ({ id: "n_1", kind: "finding", parents: ["topic"], question: "q", sources: [], created: "t", body: "b" }),
    synthesize: async () => "# Report",
    ...over,
  } as unknown as ResearchService;
}

describe("buildApp routes", () => {
  it("POST /api/projects returns projectId + findingCount", async () => {
    const app = buildApp({ dataDir, service: stubService(), publicDir });
    const res = await app.inject({ method: "POST", url: "/api/projects", payload: { topic: "AI security" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ projectId: "ai-security", findingCount: 3 });
    await app.close();
  });

  it("POST /api/projects 400s when topic missing", async () => {
    const app = buildApp({ dataDir, service: stubService(), publicDir });
    const res = await app.inject({ method: "POST", url: "/api/projects", payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("GET /api/projects/:id/nodes/:nodeId returns the full node", async () => {
    const store = new GraphStore(dataDir, "proj1");
    await store.createProject("AI security");
    const node = await store.addFinding({ parents: ["topic"], question: "Q?", body: "Answer body", sources: ["https://x"] });
    const app = buildApp({ dataDir, service: stubService(), publicDir });
    const res = await app.inject({ method: "GET", url: `/api/projects/proj1/nodes/${node.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().node.body).toBe("Answer body");
    await app.close();
  });

  it("GET unknown node 404s", async () => {
    const store = new GraphStore(dataDir, "proj1");
    await store.createProject("AI security");
    const app = buildApp({ dataDir, service: stubService(), publicDir });
    const res = await app.inject({ method: "GET", url: "/api/projects/proj1/nodes/n_999" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("GET /api/projects lists project folders", async () => {
    await fs.mkdir(path.join(dataDir, "proj-a"));
    const app = buildApp({ dataDir, service: stubService(), publicDir });
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    expect(res.json().projects).toContain("proj-a");
    await app.close();
  });

  it("serves index.html at / and falls back to it for client routes", async () => {
    const app = buildApp({ dataDir, service: stubService(), publicDir });
    const root = await app.inject({ method: "GET", url: "/" });
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain("Searcher");
    const deep = await app.inject({ method: "GET", url: "/project/ai-security" });
    expect(deep.statusCode).toBe(200);
    expect(deep.body).toContain("root"); // index.html served, not 404
    await app.close();
  });

  it("unknown /api route still 404s (no SPA fallback for api)", async () => {
    const app = buildApp({ dataDir, service: stubService(), publicDir });
    const res = await app.inject({ method: "GET", url: "/api/nope" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
```

- [ ] **Step 2: Run → fail** (`npx vitest run test/server/app.test.ts`): the node route and SPA fallback don't exist yet.

- [ ] **Step 3: Update `src/server/app.ts`**

Add the node route (after the `GET /api/projects/:id` route) and an SPA fallback. The node route:

```typescript
  app.get<{ Params: { id: string; nodeId: string } }>("/api/projects/:id/nodes/:nodeId", async (req, reply) => {
    const store = new GraphStore(deps.dataDir, req.params.id);
    try {
      const node = await store.getNode(req.params.nodeId);
      return { node };
    } catch {
      return reply.code(404).send({ error: "node not found" });
    }
  });
```

SPA fallback — register AFTER `fastifyStatic`, so unmatched GETs that are not `/api/*` return `index.html`:

```typescript
  app.setNotFoundHandler((req, reply) => {
    if (req.method === "GET" && !req.url.startsWith("/api")) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "not found" });
  });
```

(`reply.sendFile` is provided by `@fastify/static`.)

- [ ] **Step 4: `.gitignore`** — add `/public/` (it becomes Vite build output). Delete the committed `public/index.html` (`git rm public/index.html`).

- [ ] **Step 5: Run → pass.** `npm test` + `npm run typecheck`. (The main.smoke test builds its own server via `startServer`, which serves `process.cwd()/public`; since `public/` may now be empty/absent, update `test/main.smoke.test.ts` to create a temp `index.html`: have `startServer` accept and the test pass `publicDir`. **Implementer:** add an optional `publicDir?: string` to `StartOptions` and `startServer`, defaulting to `path.resolve(process.cwd(), "public")`, and in the smoke test create a temp dir with an `index.html` and pass it. Keep the existing assertions.)

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(server): node route + SPA fallback; public/ is now build output"`

---

### Task 2: Vite + React scaffold

**Files:** create `vite.config.ts`, `web/index.html`, `web/src/main.tsx`, `web/src/styles.css`; modify `package.json`, `tsconfig.json`.

- [ ] **Step 1: Install deps**

```bash
npm install react react-dom @xyflow/react react-markdown
npm install --save-dev @vitejs/plugin-react @types/react @types/react-dom @testing-library/react @testing-library/dom jsdom
```

- [ ] **Step 2: `vite.config.ts`** (root)

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../public", emptyOutDir: true },
  server: { proxy: { "/api": "http://localhost:4317" } },
});
```

- [ ] **Step 3: `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Searcher</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: `web/src/main.tsx`**

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 5: `web/src/styles.css`** — minimal:

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; color: #1a1a1a; }
.app { display: flex; flex-direction: column; height: 100vh; }
.topbar { padding: 10px 16px; border-bottom: 1px solid #e2e2e2; display: flex; gap: 12px; align-items: center; }
.main { flex: 1; display: flex; min-height: 0; }
.canvas { flex: 1; min-width: 0; }
.detail { width: 380px; border-left: 1px solid #e2e2e2; padding: 16px; overflow: auto; }
.library { padding: 32px; max-width: 720px; margin: 0 auto; }
.proj-list li { margin: 6px 0; cursor: pointer; color: #1558d6; }
button { cursor: pointer; }
.muted { color: #777; font-size: 13px; }
.sources a { display: block; font-size: 12px; }
```

- [ ] **Step 6: `tsconfig.json`** — ensure it covers `web` and JSX. Add `"web"` to `include` and add `"jsx": "react-jsx"`, `"lib": ["ES2022", "DOM", "DOM.Iterable"]` to compilerOptions. Add a Vitest jsdom environment note: update `vitest.config.ts` to set `environmentMatchGlobs: [["web/**", "jsdom"]]` (so node tests stay node, web tests get jsdom).

- [ ] **Step 7: `package.json` scripts** →

```json
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "build": "tsc --noEmit && vite build",
    "start": "npm run build && node dist/src/main.js",
    "serve": "node dist/src/main.js",
    "dev:web": "vite",
    "dev:server": "tsc && node dist/src/main.js"
  }
```

NOTE: `start` runs `vite build` (populates `public/`) then needs the compiled server. Change `start` to: `"start": "vite build && tsc -p tsconfig.server.json && node dist/src/main.js"` OR keep a single tsc that emits. Simpler: keep `build` = `vite build` only, and `start` = `vite build && tsc && node dist/src/main.js`. **Implementer:** ensure `npm start` (a) builds the web app into `public/`, (b) compiles the server to `dist/`, (c) runs `node dist/src/main.js`. Verify `dist/src/main.js` exists after `tsc`. Because `tsc` now also sees `web/`, exclude `web` from the server emit (add `"exclude": ["web"]` won't work since we include it for typecheck) — use a separate `tsconfig.build.json` that extends tsconfig but sets `"include": ["src"]` and `"noEmit": false`, and have `start` run `tsc -p tsconfig.build.json`. Create that file.

- [ ] **Step 8: Commit** — `git add -A && git commit -m "chore(web): vite + react scaffold"`

---

### Task 3: API client + anchor util (tested)

**Files:** create `web/src/types.ts`, `web/src/api.ts`, `web/src/anchor.ts`, `web/src/anchor.test.ts`, `web/src/api.test.ts`.

- [ ] **Step 1: Types** — `web/src/types.ts`

```typescript
export interface Anchor { text: string; offset: number; occurrence: number }
export interface NodeMeta { id: string; kind: "topic" | "finding"; parents: string[]; question: string; created: string }
export interface GraphIndex { topic: string; nextSeq: number; nodes: NodeMeta[] }
export interface ResearchNode extends NodeMeta { anchor?: Anchor; sources: string[]; body: string }
```

- [ ] **Step 2: anchor util test** — `web/src/anchor.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { computeAnchor } from "./anchor.js";

describe("computeAnchor", () => {
  it("finds offset and occurrence=1 for a unique selection", () => {
    const body = "Adversarial examples fool models.";
    expect(computeAnchor(body, "fool", body.indexOf("fool"))).toEqual({ text: "fool", offset: 21, occurrence: 1 });
  });
  it("computes occurrence for a repeated selection by the fromIndex", () => {
    const body = "models and more models here";
    const second = body.indexOf("models", 7);
    expect(computeAnchor(body, "models", second)).toEqual({ text: "models", offset: second, occurrence: 2 });
  });
  it("falls back to occurrence 1 / offset 0 when not found", () => {
    expect(computeAnchor("abc", "xyz", 0)).toEqual({ text: "xyz", offset: 0, occurrence: 1 });
  });
});
```

- [ ] **Step 3: anchor util** — `web/src/anchor.ts`

```typescript
import type { Anchor } from "./types.js";

/** Compute an Anchor from the body, the selected text, and the char index the selection starts at.
 *  occurrence = how many times `text` appears in body up to and including this one. */
export function computeAnchor(body: string, text: string, fromIndex: number): Anchor {
  const offset = body.indexOf(text, Math.max(0, fromIndex));
  if (offset === -1) return { text, offset: 0, occurrence: 1 };
  let occurrence = 0;
  let i = body.indexOf(text);
  while (i !== -1 && i <= offset) {
    occurrence++;
    i = body.indexOf(text, i + 1);
  }
  return { text, offset, occurrence: Math.max(1, occurrence) };
}
```

- [ ] **Step 4: API client test** — `web/src/api.test.ts`

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { api } from "./api.js";

afterEach(() => vi.restoreAllMocks());

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => body } as Response);
}

describe("api", () => {
  it("createTopic POSTs the topic and returns the result", async () => {
    const f = mockFetch({ projectId: "ai-security", findingCount: 2 });
    vi.stubGlobal("fetch", f);
    const res = await api.createTopic("AI security");
    expect(res).toEqual({ projectId: "ai-security", findingCount: 2 });
    expect(f).toHaveBeenCalledWith("/api/projects", expect.objectContaining({ method: "POST" }));
  });

  it("getProject returns the index", async () => {
    vi.stubGlobal("fetch", mockFetch({ index: { topic: "t", nextSeq: 1, nodes: [] } }));
    const res = await api.getProject("p");
    expect(res.topic).toBe("t");
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetch({ error: "boom" }, false, 500));
    await expect(api.listProjects()).rejects.toThrow();
  });
});
```

- [ ] **Step 5: API client** — `web/src/api.ts`

```typescript
import type { GraphIndex, ResearchNode, Anchor } from "./types.js";

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}
function post<T>(url: string, body: unknown): Promise<T> {
  return jsonFetch<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export const api = {
  listProjects: () => jsonFetch<{ projects: string[] }>("/api/projects").then((r) => r.projects),
  createTopic: (topic: string) => post<{ projectId: string; findingCount: number }>("/api/projects", { topic }),
  getProject: (id: string) => jsonFetch<{ index: GraphIndex }>(`/api/projects/${id}`).then((r) => r.index),
  getNode: (id: string, nodeId: string) =>
    jsonFetch<{ node: ResearchNode }>(`/api/projects/${id}/nodes/${nodeId}`).then((r) => r.node),
  branch: (id: string, parentId: string, anchor: Anchor, question: string) =>
    post<ResearchNode>(`/api/projects/${id}/branch`, { parentId, anchor, question }),
  synthesize: (id: string) => post<{ markdown: string }>(`/api/projects/${id}/synthesize`, {}).then((r) => r.markdown),
};
```

- [ ] **Step 6: Run** `npx vitest run web/src/anchor.test.ts web/src/api.test.ts` → PASS. Then `npm test` (web tests run under jsdom via the config glob).

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(web): typed api client + anchor util (tested)"`

---

### Task 4: UI components + wiring

**Files:** create `web/src/components/Library.tsx`, `GraphView.tsx`, `NodeDetail.tsx`, `web/src/App.tsx`. (No new tests required — these are visual; correctness is verified by build + manual load. Keep each component focused.)

- [ ] **Step 1: `web/src/components/Library.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api } from "../api.js";

export function Library({ onOpen }: { onOpen: (id: string) => void }) {
  const [projects, setProjects] = useState<string[]>([]);
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  async function create() {
    if (!topic.trim()) return;
    setBusy(true);
    setMsg("Researching… this calls Claude and may take a moment.");
    try {
      const { projectId, findingCount } = await api.createTopic(topic.trim());
      if (findingCount === 0) setMsg("No findings were produced — try a more specific topic.");
      else onOpen(projectId);
    } catch (e) {
      setMsg("Failed: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="library">
      <h1>Searcher</h1>
      <p className="muted">Start research on a topic, then branch your own questions to build a knowledge graph.</p>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. AI security"
               style={{ flex: 1, padding: 8 }} onKeyDown={(e) => e.key === "Enter" && create()} disabled={busy} />
        <button onClick={create} disabled={busy}>{busy ? "Researching…" : "Start research"}</button>
      </div>
      {msg && <p className="muted">{msg}</p>}
      <h3>Your research</h3>
      <ul className="proj-list">
        {projects.map((p) => <li key={p} onClick={() => onOpen(p)}>{p}</li>)}
        {projects.length === 0 && <li className="muted" style={{ cursor: "default", color: "#aaa" }}>none yet</li>}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: `web/src/components/GraphView.tsx`** — React Flow from the index. Lays nodes out in a simple radial/tiered layout.

```tsx
import { useMemo } from "react";
import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphIndex } from "../types.js";

export function GraphView({ index, onSelect }: { index: GraphIndex; onSelect: (nodeId: string) => void }) {
  const { nodes, edges } = useMemo(() => {
    const metas = index.nodes;
    const nodes: Node[] = metas.map((m, i) => ({
      id: m.id,
      position: m.kind === "topic" ? { x: 0, y: 0 } : { x: ((i % 4) - 1.5) * 240, y: 140 + Math.floor(i / 4) * 120 },
      data: { label: m.kind === "topic" ? `★ ${index.topic}` : m.question },
      style: {
        padding: 8, borderRadius: 8, width: 200, fontSize: 12,
        border: m.kind === "topic" ? "2px solid #1558d6" : "1px solid #bbb",
        background: m.kind === "topic" ? "#eaf1ff" : "#fff",
      },
    }));
    const edges: Edge[] = metas.flatMap((m) =>
      m.parents.map((p) => ({ id: `${p}->${m.id}`, source: p, target: m.id })),
    );
    return { nodes, edges };
  }, [index]);

  return (
    <div className="canvas">
      <ReactFlow nodes={nodes} edges={edges} fitView onNodeClick={(_, n) => onSelect(n.id)}>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
```

- [ ] **Step 3: `web/src/components/NodeDetail.tsx`** — render the node; capture a text selection to branch.

```tsx
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { ResearchNode } from "../types.js";
import { computeAnchor } from "../anchor.js";

export function NodeDetail({
  node, onBranch, busy,
}: {
  node: ResearchNode;
  onBranch: (anchor: ReturnType<typeof computeAnchor>, question: string) => void;
  busy: boolean;
}) {
  const [selection, setSelection] = useState("");
  const [question, setQuestion] = useState("");

  function captureSelection() {
    const sel = window.getSelection()?.toString().trim() ?? "";
    if (sel) setSelection(sel);
  }

  function submit() {
    const text = selection || node.body.slice(0, 40);
    const anchor = computeAnchor(node.body, text, node.body.indexOf(text));
    onBranch(anchor, question.trim());
    setQuestion("");
  }

  return (
    <div className="detail">
      <h3>{node.question}</h3>
      <div onMouseUp={captureSelection}>
        <ReactMarkdown>{node.body || "_(topic root)_"}</ReactMarkdown>
      </div>
      {node.sources?.length > 0 && (
        <div className="sources">
          <strong>Sources</strong>
          {node.sources.map((s) => <a key={s} href={s} target="_blank" rel="noreferrer">{s}</a>)}
        </div>
      )}
      <hr />
      <p className="muted">Selected: {selection ? `"${selection}"` : "(select text above to anchor a question)"}</p>
      <textarea value={question} onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask a follow-up question…" rows={3} style={{ width: "100%" }} disabled={busy} />
      <button onClick={submit} disabled={busy || !question.trim()}>{busy ? "Researching…" : "Branch question"}</button>
    </div>
  );
}
```

- [ ] **Step 4: `web/src/App.tsx`** — top-level state machine.

```tsx
import { useEffect, useState, useCallback } from "react";
import { Library } from "./components/Library.js";
import { GraphView } from "./components/GraphView.js";
import { NodeDetail } from "./components/NodeDetail.js";
import { api } from "./api.js";
import type { GraphIndex, ResearchNode } from "./types.js";

export function App() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [index, setIndex] = useState<GraphIndex | null>(null);
  const [node, setNode] = useState<ResearchNode | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);

  const refresh = useCallback(async (id: string) => setIndex(await api.getProject(id)), []);

  useEffect(() => { if (projectId) refresh(projectId); }, [projectId, refresh]);

  async function openNode(nodeId: string) {
    if (!projectId) return;
    setNode(await api.getNode(projectId, nodeId));
  }

  async function branch(anchor: Parameters<typeof api.branch>[2], question: string) {
    if (!projectId || !node) return;
    setBusy(true);
    try {
      await api.branch(projectId, node.id, anchor, question);
      await refresh(projectId);
    } finally { setBusy(false); }
  }

  async function synthesize() {
    if (!projectId) return;
    setBusy(true);
    try { setReport(await api.synthesize(projectId)); } finally { setBusy(false); }
  }

  if (!projectId) return <Library onOpen={setProjectId} />;

  return (
    <div className="app">
      <div className="topbar">
        <button onClick={() => { setProjectId(null); setIndex(null); setNode(null); }}>← Library</button>
        <strong>{index?.topic ?? projectId}</strong>
        <span style={{ flex: 1 }} />
        <button onClick={synthesize} disabled={busy}>Synthesize</button>
      </div>
      <div className="main">
        {index && <GraphView index={index} onSelect={openNode} />}
        {node
          ? <NodeDetail node={node} onBranch={branch} busy={busy} />
          : <div className="detail"><p className="muted">Click a node to read it and branch questions.</p></div>}
      </div>
      {report !== null && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", padding: 40 }} onClick={() => setReport(null)}>
          <div style={{ background: "#fff", padding: 24, maxWidth: 800, margin: "0 auto", maxHeight: "80vh", overflow: "auto" }}
               onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setReport(null)}>Close</button>
            <pre style={{ whiteSpace: "pre-wrap" }}>{report}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verify** `npm run typecheck` is clean (web included). Fix any type errors. Run `npm test` (unchanged web unit tests pass).

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(web): Library, GraphView, NodeDetail, App"`

---

### Task 5: Build + smoke the whole app

- [ ] **Step 1: Build** — `npm run build`. Expect `public/index.html` + `public/assets/*` produced, and typecheck clean.
- [ ] **Step 2: Boot** — `node dist/src/main.js` (or `npm run serve`) and confirm it logs "Searcher running at http://localhost:4317" and the page loads the React app (the Library view). The `GET /` and client routes serve the SPA. (Creating a topic spends subscription credit — optional manual check.)
- [ ] **Step 3: Commit any build-config fixes** discovered during the smoke.

---

## Self-Review

**Spec coverage (frontend):** topic creation (Library) ✓; navigable graph (GraphView/React Flow) ✓; click node → read (NodeDetail) ✓; select-text→branch (NodeDetail + computeAnchor + /branch) ✓; library of projects ✓; synthesize/export ✓; zero-findings surfaced to user ✓; one-command run serves built SPA (Task 1 SPA fallback + Task 2 build) ✓. **Deferred:** live token streaming; per-node cost display (findingCount surfaced, full cost UI later); fancy auto-layout (simple tiered layout for now); manual cross-link UI (data layer supports it; UI later).

**Placeholders:** none — testable units (api, anchor, routes) have complete code + tests; visual components have complete JSX. Build+smoke (Task 5) is the integration gate.

**Type consistency:** `web/src/types.ts` mirrors backend `GraphIndex`/`ResearchNode`/`Anchor`. `api.*` signatures match the route payloads (Plan 02). `computeAnchor` return shape == `Anchor`.

---

*This is the final milestone. After it merges, `npm start` builds the web app and serves the full Searcher experience on http://localhost:4317.*
