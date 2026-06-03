# Searcher Canvas Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Searcher's sidebar UI with a movable React Flow node canvas where Search redirects to a loading canvas, nodes expand/collapse, asking a question fires `claude -p` immediately and the answer arrives as a connected child node, and node positions persist durably on the server.

**Architecture:** Positions are stored in each node's markdown frontmatter (source of truth) and mirrored into the index; saved on drag-stop via a new `PATCH /positions` route through the store's existing serialized write queue. Whole-node questions reuse the existing single `/branch` path (anchor made optional). The frontend isolates layout and the index→ReactFlow transform into pure, unit-tested helpers; the React Flow wiring is verified by build + manual smoke.

**Tech Stack:** TypeScript ESM (NodeNext), Vitest, Fastify, React 19 + Vite, `@xyflow/react` (already installed). `exactOptionalPropertyTypes` is ON — guard optional props (`if (x) obj.x = x`) rather than assigning `undefined`.

**Constraint:** Do NOT touch the `claude -p` subscription/OAuth guardrail (env scrub + `ANTHROPIC_API_KEY` preflight). Do NOT run a real `claude -p` batch during development.

---

## Task 1: Position type + serialize round-trip + metaOf

**Files:**
- Modify: `src/graph/types.ts`
- Modify: `src/graph/serialize.ts`
- Modify: `src/graph/store.ts:6-10` (`metaOf`)
- Test: `test/graph/serialize.test.ts`, `test/graph/types.test.ts`

- [ ] **Step 1: Write the failing serialize test**

Add to `test/graph/serialize.test.ts`:

```ts
it("round-trips a node position through frontmatter", () => {
  const node = {
    id: "n_1", kind: "finding" as const, parents: ["topic"], question: "Q",
    sources: [], created: "2026-06-03T00:00:00.000Z", body: "B",
    position: { x: 120, y: -40 },
  };
  const md = nodeToMarkdown(node);
  const back = markdownToNode("n_1", md);
  expect(back.position).toEqual({ x: 120, y: -40 });
});

it("omits position when absent", () => {
  const node = { id: "n_2", kind: "finding" as const, parents: ["topic"], question: "Q", sources: [], created: "2026-06-03T00:00:00.000Z", body: "B" };
  const back = markdownToNode("n_2", nodeToMarkdown(node));
  expect(back.position).toBeUndefined();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/graph/serialize.test.ts`
Expected: FAIL (`position` not preserved / property missing).

- [ ] **Step 3: Add the type**

In `src/graph/types.ts` add and wire in:

```ts
export interface Position { x: number; y: number }
```

Add `position?: Position;` to `ResearchNode` (after `body`) and to `NodeMeta` (after `created`).

- [ ] **Step 4: Persist position in serialize**

In `src/graph/serialize.ts`: add `position?: Position;` to `FrontMatter` (import `Position`), in `nodeToMarkdown` add `if (node.position) data.position = node.position;`, and in `markdownToNode` add `if (fm.position) node.position = fm.position;`.

- [ ] **Step 5: Carry position in metaOf**

In `src/graph/store.ts` `metaOf`:

```ts
function metaOf(node: ResearchNode): NodeMeta {
  const meta: NodeMeta = { id: node.id, kind: node.kind, parents: node.parents, question: node.question, created: node.created };
  if (node.anchor) meta.anchor = node.anchor;
  if (node.position) meta.position = node.position;
  return meta;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/graph/serialize.test.ts test/graph/types.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/graph/types.ts src/graph/serialize.ts src/graph/store.ts test/graph/serialize.test.ts
git commit -m "feat: persist node position in frontmatter + index"
```

---

## Task 2: store.setPositions + service.branch anchor-optional + remove batchBranch

**Files:**
- Modify: `src/graph/store.ts`
- Modify: `src/service.ts`
- Test: `test/graph/store.add.test.ts` (add a setPositions describe) or new `test/graph/store.positions.test.ts`
- Test: `test/service.test.ts`

- [ ] **Step 1: Write the failing store.setPositions test**

Create `test/graph/store.positions.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GraphStore } from "../../src/graph/store.js";

let baseDir: string;
afterEach(async () => baseDir && (await fs.rm(baseDir, { recursive: true, force: true })));
beforeEach(async () => { baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "searcher-pos-")); });

describe("GraphStore.setPositions", () => {
  it("persists positions to node files and the index, and survives a rebuild", async () => {
    const store = new GraphStore(baseDir, "p");
    await store.createProject("T");
    const n = await store.addFinding({ parents: ["topic"], question: "Q", body: "B", sources: [] });
    await store.setPositions([{ id: n.id, x: 10, y: 20 }, { id: "topic", x: 0, y: 0 }]);

    const index = await store.loadIndex();
    expect(index.nodes.find((m) => m.id === n.id)?.position).toEqual({ x: 10, y: 20 });

    const rebuilt = await store.rebuildIndex(); // proves it lives in the .md, not just the index
    expect(rebuilt.nodes.find((m) => m.id === n.id)?.position).toEqual({ x: 10, y: 20 });
  });

  it("ignores unknown ids without throwing", async () => {
    const store = new GraphStore(baseDir, "p");
    await store.createProject("T");
    await expect(store.setPositions([{ id: "nope", x: 1, y: 2 }])).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/graph/store.positions.test.ts`
Expected: FAIL (`setPositions` is not a function).

- [ ] **Step 3: Implement store.setPositions**

Add to `src/graph/store.ts` (uses `enqueue` for race-safety; writes the `.md` so `rebuildIndex` keeps positions):

```ts
/** Persist x/y for the given node ids. Unknown ids are skipped. Race-safe via the write queue. */
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
```

- [ ] **Step 4: Run the store test to verify it passes**

Run: `npx vitest run test/graph/store.positions.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing service tests (anchor-optional branch, setPositions, no batchBranch)**

In `test/service.test.ts`: DELETE the entire `describe("ResearchService.batchBranch", ...)` block. Replace the `ResearchService.branch` describe's body with two tests:

```ts
describe("ResearchService.branch", () => {
  async function seed() {
    const rootRun: RunFn = async () => ({ answer: "", claims: [], sources: [], costUsd: 0, sessionId: "s", meta: { findings: [{ question: "Q1", body: "B1", sources: [] }] } });
    const { projectId } = await svcWith(rootRun).createTopic("AI security");
    return projectId;
  }
  it("creates a child finding for a whole-node question (no anchor)", async () => {
    const projectId = await seed();
    const branchRun: RunFn = async () => ({ answer: "Because reasons.", claims: [], sources: ["https://x"], costUsd: 0, sessionId: "s2", meta: null });
    const node = await new ResearchService(baseDir, branchRun).branch(projectId, { parentId: "n_1", question: "why?" });
    expect(node.kind).toBe("finding");
    expect(node.parents).toEqual(["n_1"]);
    expect(node.anchor).toBeUndefined();
    expect(node.body).toBe("Because reasons.");
  });
  it("still accepts an optional anchor", async () => {
    const projectId = await seed();
    const branchRun: RunFn = async () => ({ answer: "x", claims: [], sources: [], costUsd: 0, sessionId: "s2", meta: null });
    const node = await new ResearchService(baseDir, branchRun).branch(projectId, { parentId: "n_1", question: "q", anchor: { text: "B1", offset: 0, occurrence: 1 } });
    expect(node.anchor?.text).toBe("B1");
  });
});

describe("ResearchService.setPositions", () => {
  it("delegates to the store", async () => {
    const rootRun: RunFn = async () => ({ answer: "", claims: [], sources: [], costUsd: 0, sessionId: "s", meta: { findings: [{ question: "Q1", body: "B1", sources: [] }] } });
    const { projectId } = await svcWith(rootRun).createTopic("AI security");
    const svc = svcWith(rootRun);
    await svc.setPositions(projectId, [{ id: "n_1", x: 5, y: 6 }]);
    const store = new GraphStore(baseDir, projectId);
    expect((await store.loadIndex()).nodes.find((m) => m.id === "n_1")?.position).toEqual({ x: 5, y: 6 });
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run test/service.test.ts`
Expected: FAIL (branch requires anchor / `setPositions` missing).

- [ ] **Step 7: Implement service changes**

In `src/service.ts`:
- Remove `BatchItem`, `BatchOutcome` interfaces and the entire `batchBranch` method.
- Change `branch` signature to `input: { parentId: string; question: string; anchor?: Anchor }` and body:

```ts
async branch(projectId: string, input: { parentId: string; question: string; anchor?: Anchor }): Promise<ResearchNode> {
  const store = new GraphStore(this.baseDir, projectId);
  const index = await store.load();
  const parent = await store.getNode(input.parentId);
  const cwd = projectDir(this.baseDir, projectId);
  const prompt = branchPrompt({ topic: index.topic, selection: input.anchor?.text ?? parent.question, question: input.question, ancestorTitles: [parent.question] });
  const res = await this.run({ cwd, prompt, systemPrompt: BRANCH_SYSTEM });
  const finding: Parameters<typeof store.addFinding>[0] = { parents: [input.parentId], question: input.question, body: res.answer, sources: res.sources };
  if (input.anchor) finding.anchor = input.anchor;
  return store.addFinding(finding);
}
```

- Add:

```ts
async setPositions(projectId: string, updates: { id: string; x: number; y: number }[]): Promise<void> {
  return new GraphStore(this.baseDir, projectId).setPositions(updates);
}
```

- [ ] **Step 8: Run service tests to verify they pass**

Run: `npx vitest run test/service.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/graph/store.ts src/service.ts test/graph/store.positions.test.ts test/service.test.ts
git commit -m "feat: store.setPositions + whole-node branch; drop batchBranch"
```

---

## Task 3: Server routes — PATCH /positions, /branch anchor-optional, remove /branch-batch

**Files:**
- Modify: `src/server/app.ts`
- Test: `test/server/app.test.ts`

- [ ] **Step 1: Write failing route tests**

In `test/server/app.test.ts` add (match the file's existing harness for building the app + injecting a fake service; mirror existing tests' style):

```ts
it("POST /branch accepts a question without an anchor", async () => {
  // fake service.branch resolves to a node; assert 200 and that anchor was not required
  const res = await app.inject({ method: "POST", url: `/api/projects/p/branch`, payload: { parentId: "n_1", question: "why?" } });
  expect(res.statusCode).toBe(200);
});

it("POST /branch 400s without parentId or question", async () => {
  const res = await app.inject({ method: "POST", url: `/api/projects/p/branch`, payload: { parentId: "n_1" } });
  expect(res.statusCode).toBe(400);
});

it("PATCH /positions persists and returns ok", async () => {
  const res = await app.inject({ method: "PATCH", url: `/api/projects/p/positions`, payload: { positions: [{ id: "n_1", x: 1, y: 2 }] } });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ok: true });
});

it("PATCH /positions 400s on a non-array body", async () => {
  const res = await app.inject({ method: "PATCH", url: `/api/projects/p/positions`, payload: { positions: "nope" } });
  expect(res.statusCode).toBe(400);
});
```

Remove any existing `/branch-batch` tests in this file.

> Note for implementer: read `test/server/app.test.ts` first to reuse its exact app-construction/fake-service pattern; adapt the snippets above to it rather than re-inventing setup.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/server/app.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update routes**

In `src/server/app.ts`:
- Remove the `import type { ... BatchItem }` usage (drop `BatchItem`); keep `ResearchService`.
- Delete the `/branch-batch` route entirely.
- Replace the `/branch` route with anchor-optional validation:

```ts
app.post<{
  Params: { id: string };
  Body: { parentId?: string; anchor?: { text: string; offset: number; occurrence: number }; question?: string };
}>("/api/projects/:id/branch", async (req, reply) => {
  const { parentId, anchor, question } = req.body ?? {};
  if (!parentId || !question) {
    return reply.code(400).send({ error: "parentId and question are required" });
  }
  const input: { parentId: string; question: string; anchor?: typeof anchor } = { parentId, question };
  if (anchor) input.anchor = anchor;
  return deps.service.branch(req.params.id, input);
});
```

- Add the positions route:

```ts
app.patch<{
  Params: { id: string };
  Body: { positions?: { id: string; x: number; y: number }[] };
}>("/api/projects/:id/positions", async (req, reply) => {
  const positions = req.body?.positions;
  if (!Array.isArray(positions)) {
    return reply.code(400).send({ error: "positions must be an array" });
  }
  for (const p of positions) {
    if (typeof p?.id !== "string" || typeof p.x !== "number" || typeof p.y !== "number") {
      return reply.code(400).send({ error: "each position needs id:string, x:number, y:number" });
    }
  }
  await deps.service.setPositions(req.params.id, positions);
  return { ok: true };
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/server/app.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/app.ts test/server/app.test.ts
git commit -m "feat: PATCH /positions + anchor-optional branch; remove /branch-batch route"
```

---

## Task 4: Web types + api client

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/api.ts`
- Test: `web/src/api.test.ts`

- [ ] **Step 1: Update web types**

`web/src/types.ts` final contents:

```ts
export interface Position { x: number; y: number }
export interface Anchor { text: string; offset: number; occurrence: number }
export interface NodeMeta { id: string; kind: "topic" | "finding"; parents: string[]; anchor?: Anchor; question: string; created: string; position?: Position }
export interface GraphIndex { topic: string; nextSeq: number; nodes: NodeMeta[] }
export interface ResearchNode extends NodeMeta { sources: string[]; body: string }
```

(Removes `PendingQuestion`.)

- [ ] **Step 2: Write the failing api test**

In `web/src/api.test.ts`: remove the `branchBatch` test. Update/replace the `branch` test and add a `setPositions` test (match the file's existing fetch-mock style):

```ts
it("branch posts parentId + question (no anchor)", async () => {
  // arrange fetch mock to capture the body; call api.branch("p", "n_1", "why?")
  // assert URL /api/projects/p/branch and body { parentId: "n_1", question: "why?" }
});
it("setPositions PATCHes the positions array", async () => {
  // call api.setPositions("p", [{ id: "n_1", x: 1, y: 2 }])
  // assert method PATCH, URL /api/projects/p/positions, body { positions: [...] }
});
```

> Implementer: read `web/src/api.test.ts` to reuse its fetch-mock harness; fill the asserts in that style.

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run web/src/api.test.ts`
Expected: FAIL.

- [ ] **Step 4: Update the api client**

`web/src/api.ts`: drop the `Anchor` import if now unused, add a `patch` helper, change `branch`, add `setPositions`, remove `branchBatch`:

```ts
function patch<T>(url: string, body: unknown): Promise<T> {
  return jsonFetch<T>(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
// ...
  branch: (id: string, parentId: string, question: string) =>
    post<ResearchNode>(`/api/projects/${id}/branch`, { parentId, question }),
  setPositions: (id: string, positions: { id: string; x: number; y: number }[]) =>
    patch<{ ok: true }>(`/api/projects/${id}/positions`, { positions }),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run web/src/api.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/types.ts web/src/api.ts web/src/api.test.ts
git commit -m "feat: web types + api for positions and whole-node branch"
```

---

## Task 5: Pure layered layout helper

**Files:**
- Create: `web/src/graph/layout.ts`
- Test: `web/src/graph/layout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/graph/layout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { layoutNodes } from "./layout";
import type { NodeMeta } from "../types";

const meta = (id: string, parents: string[]): NodeMeta => ({ id, kind: id === "topic" ? "topic" : "finding", parents, question: id, created: "" });

describe("layoutNodes", () => {
  it("puts the topic at row 0 and children on deeper rows", () => {
    const pos = layoutNodes([meta("topic", []), meta("n_1", ["topic"]), meta("n_2", ["topic"])]);
    expect(pos.topic.y).toBe(0);
    expect(pos.n_1.y).toBeGreaterThan(0);
    expect(pos.n_2.y).toBe(pos.n_1.y); // siblings share a row
    expect(pos.n_1.x).not.toBe(pos.n_2.x); // and are spread horizontally
  });
  it("assigns a position to every node", () => {
    const pos = layoutNodes([meta("topic", []), meta("n_1", ["topic"]), meta("n_2", ["n_1"])]);
    expect(Object.keys(pos).sort()).toEqual(["n_1", "n_2", "topic"]);
    expect(pos.n_2.y).toBeGreaterThan(pos.n_1.y);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run web/src/graph/layout.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement layout**

Create `web/src/graph/layout.ts`. Compute depth by walking parents up to `topic` (topic depth 0; a node's depth = 1 + min parent depth; nodes with no resolvable parent default to depth 1). Group ids by depth, then within each row spread across x centered on 0.

```ts
import type { NodeMeta } from "../types";

const ROW_H = 180;
const COL_W = 260;

export function layoutNodes(metas: NodeMeta[]): Record<string, { x: number; y: number }> {
  const byId = new Map(metas.map((m) => [m.id, m]));
  const depthCache = new Map<string, number>();
  const depthOf = (id: string, seen = new Set<string>()): number => {
    if (id === "topic") return 0;
    if (depthCache.has(id)) return depthCache.get(id)!;
    if (seen.has(id)) return 1; // cycle guard
    seen.add(id);
    const m = byId.get(id);
    const parents = m?.parents.filter((p) => byId.has(p)) ?? [];
    const d = parents.length ? 1 + Math.min(...parents.map((p) => depthOf(p, seen))) : 1;
    depthCache.set(id, d);
    return d;
  };

  const rows = new Map<number, string[]>();
  for (const m of metas) {
    const d = depthOf(m.id);
    (rows.get(d) ?? rows.set(d, []).get(d)!).push(m.id);
  }
  const out: Record<string, { x: number; y: number }> = {};
  for (const [d, ids] of rows) {
    ids.forEach((id, i) => {
      out[id] = { x: (i - (ids.length - 1) / 2) * COL_W, y: d * ROW_H };
    });
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run web/src/graph/layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/graph/layout.ts web/src/graph/layout.test.ts
git commit -m "feat: pure layered canvas layout helper"
```

---

## Task 6: Pure index→canvas model helper (visibility + transform)

**Files:**
- Create: `web/src/graph/model.ts`
- Test: `web/src/graph/model.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/graph/model.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildCanvas, type PendingNode } from "./model";
import type { NodeMeta } from "../types";

const meta = (id: string, parents: string[]): NodeMeta => ({ id, kind: id === "topic" ? "topic" : "finding", parents, question: id, created: "" });
const metas = [meta("topic", []), meta("n_1", ["topic"]), meta("n_2", ["n_1"])];

describe("buildCanvas", () => {
  it("topic is always visible; children only when their parent is expanded", () => {
    const collapsed = buildCanvas({ metas, expanded: new Set(), bodies: {}, pending: [], positions: {} });
    expect(collapsed.nodes.map((n) => n.id)).toEqual(["topic"]);

    const open = buildCanvas({ metas, expanded: new Set(["topic"]), bodies: {}, pending: [], positions: {} });
    expect(open.nodes.map((n) => n.id).sort()).toEqual(["n_1", "topic"]);
    expect(open.edges).toContainEqual(expect.objectContaining({ source: "topic", target: "n_1" }));
  });

  it("hides grandchildren until the intermediate node is also expanded", () => {
    const open = buildCanvas({ metas, expanded: new Set(["topic"]), bodies: {}, pending: [], positions: {} });
    expect(open.nodes.map((n) => n.id)).not.toContain("n_2");
    const both = buildCanvas({ metas, expanded: new Set(["topic", "n_1"]), bodies: {}, pending: [], positions: {} });
    expect(both.nodes.map((n) => n.id)).toContain("n_2");
  });

  it("includes pending nodes under an expanded parent with an edge + label", () => {
    const pending: PendingNode[] = [{ id: "pending_1", parentId: "topic", question: "why?" }];
    const out = buildCanvas({ metas, expanded: new Set(["topic"]), bodies: {}, pending, positions: {} });
    expect(out.nodes.find((n) => n.id === "pending_1")?.pending).toBe(true);
    expect(out.edges).toContainEqual(expect.objectContaining({ source: "topic", target: "pending_1", label: "why?" }));
  });

  it("carries body + saved position when present", () => {
    const out = buildCanvas({ metas, expanded: new Set(["topic"]), bodies: { n_1: "BODY" }, pending: [], positions: { n_1: { x: 9, y: 9 } } });
    const n1 = out.nodes.find((n) => n.id === "n_1")!;
    expect(n1.body).toBe("BODY");
    expect(n1.position).toEqual({ x: 9, y: 9 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run web/src/graph/model.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the model**

Create `web/src/graph/model.ts`. A node is visible iff it is `topic`, or some parent is visible AND in `expanded`. Compute visibility iteratively over depth (BFS from topic through expanded parents). Pending nodes attach to a parent and are visible iff that parent is visible-and-expanded.

```ts
import type { NodeMeta, Position } from "../types";

export interface PendingNode { id: string; parentId: string; question: string; error?: string }

export interface CanvasNode {
  id: string; kind: "topic" | "finding"; title: string;
  expanded: boolean; pending: boolean;
  body?: string; error?: string; position?: Position;
}
export interface CanvasEdge { id: string; source: string; target: string; label?: string }

export function buildCanvas(input: {
  metas: NodeMeta[];
  expanded: Set<string>;
  bodies: Record<string, string>;
  pending: PendingNode[];
  positions: Record<string, Position>;
}): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const { metas, expanded, bodies, pending, positions } = input;
  const visible = new Set<string>(["topic"]);
  // Repeatedly reveal children of visible+expanded nodes until stable.
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of metas) {
      if (visible.has(m.id)) continue;
      if (m.parents.some((p) => visible.has(p) && expanded.has(p))) { visible.add(m.id); changed = true; }
    }
  }

  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  for (const m of metas) {
    if (!visible.has(m.id)) continue;
    const node: CanvasNode = { id: m.id, kind: m.kind, title: m.question, expanded: expanded.has(m.id), pending: false };
    if (bodies[m.id] !== undefined) node.body = bodies[m.id];
    if (positions[m.id]) node.position = positions[m.id];
    nodes.push(node);
    for (const p of m.parents) if (visible.has(p)) edges.push({ id: `${p}->${m.id}`, source: p, target: m.id });
  }
  for (const pn of pending) {
    if (!(visible.has(pn.parentId) && expanded.has(pn.parentId))) continue;
    const node: CanvasNode = { id: pn.id, kind: "finding", title: pn.question, expanded: false, pending: true };
    if (pn.error) node.error = pn.error;
    nodes.push(node);
    edges.push({ id: `${pn.parentId}->${pn.id}`, source: pn.parentId, target: pn.id, label: pn.question });
  }
  return { nodes, edges };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run web/src/graph/model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/graph/model.ts web/src/graph/model.test.ts
git commit -m "feat: pure index-to-canvas model with expand/collapse visibility"
```

---

## Task 7: ResearchNodeCard custom node component

**Files:**
- Create: `web/src/components/ResearchNodeCard.tsx`

This is a React Flow custom node. Verified by build + manual smoke (no unit test).

- [ ] **Step 1: Implement the component**

The node receives its display data via `data` (set by Canvas). Use `Handle` for edge connection points. Card grows when `expanded`.

```tsx
import { memo, useState } from "react";
import { Handle, Position as RFPosition, type NodeProps } from "@xyflow/react";

export interface CardData {
  kind: "topic" | "finding";
  title: string;
  expanded: boolean;
  pending: boolean;
  body?: string;
  error?: string;
  onToggle: () => void;          // expand/collapse (also triggers lazy body fetch)
  onAsk: (question: string) => void;
  onRetry?: () => void;          // present on errored pending nodes
}

function ResearchNodeCardImpl({ data }: NodeProps & { data: CardData }) {
  const [draft, setDraft] = useState("");
  const isTopic = data.kind === "topic";

  return (
    <div style={{
      width: data.expanded ? 320 : 200, background: "#fff", borderRadius: 10,
      border: isTopic ? "2px solid #1558d6" : data.pending ? "1px dashed #d08700" : "1px solid #bbb",
      boxShadow: "0 1px 4px rgba(0,0,0,.08)", fontSize: 13, overflow: "hidden",
    }}>
      <Handle type="target" position={RFPosition.Top} />
      <div onClick={data.pending ? undefined : data.onToggle}
           style={{ display: "flex", gap: 6, alignItems: "center", padding: "8px 10px", cursor: data.pending ? "default" : "pointer", background: isTopic ? "#eaf1ff" : "#f7f7f7" }}>
        {!data.pending && <span>{data.expanded ? "▾" : "▸"}</span>}
        {data.pending && <span className="spinner" aria-label="researching">⏳</span>}
        <strong style={{ flex: 1 }}>{isTopic ? `★ ${data.title}` : data.title}</strong>
      </div>

      {data.expanded && (
        <div style={{ padding: "8px 10px" }}>
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.45, maxHeight: 260, overflow: "auto" }}>
            {data.body === undefined ? <em className="muted">loading…</em> : data.body || <em className="muted">(no text)</em>}
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
            <input
              className="nodrag" value={draft} onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask a question…" style={{ flex: 1, padding: 6 }}
              onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) { data.onAsk(draft.trim()); setDraft(""); } }}
            />
            <button className="nodrag" disabled={!draft.trim()} onClick={() => { data.onAsk(draft.trim()); setDraft(""); }}>Ask</button>
          </div>
        </div>
      )}

      {data.pending && data.error && (
        <div style={{ padding: "6px 10px", color: "#b00020" }}>
          ⚠ {data.error} {data.onRetry && <button className="nodrag" onClick={data.onRetry}>retry</button>}
        </div>
      )}
      <Handle type="source" position={RFPosition.Bottom} />
    </div>
  );
}

export const ResearchNodeCard = memo(ResearchNodeCardImpl);
```

> Notes: the `nodrag` class on inputs/buttons stops React Flow from hijacking pointer events so the user can type and click. The header is the drag handle.

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS (or only errors from not-yet-wired Canvas — fix any in this file).

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ResearchNodeCard.tsx
git commit -m "feat: ResearchNodeCard custom canvas node"
```

---

## Task 8: Canvas component (state, lazy body, drag-persist, optimistic ask)

**Files:**
- Create: `web/src/components/Canvas.tsx`

Verified by build + manual smoke.

- [ ] **Step 1: Implement the Canvas**

Owns: `expanded: Set<string>`, `bodies: Record<string,string>`, `pending: PendingNode[]`, `positions: Record<string,Position>`. Derives React Flow nodes/edges via `buildCanvas`, merges layout for nodes lacking a saved position, and maps each `CanvasNode` to a React Flow node of `type: "research"` with `data` including the callbacks. A counter ref generates pending ids deterministically (avoid `crypto.randomUUID` is fine here too, but a monotonic counter is simplest).

```tsx
import { useCallback, useMemo, useRef, useState } from "react";
import { ReactFlow, Background, Controls, type Node, type Edge, type NodeChange, applyNodeChanges } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphIndex, Position } from "../types";
import { api } from "../api";
import { buildCanvas, type PendingNode } from "../graph/model";
import { layoutNodes } from "../graph/layout";
import { ResearchNodeCard, type CardData } from "./ResearchNodeCard";

const nodeTypes = { research: ResearchNodeCard };

export function Canvas({ projectId, index, onReloadIndex }: {
  projectId: string;
  index: GraphIndex;
  onReloadIndex: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["topic"]));
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<PendingNode[]>([]);
  const [drag, setDrag] = useState<Record<string, Position>>({}); // live drag overrides
  const pendSeq = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const savedPositions: Record<string, Position> = useMemo(() => {
    const out: Record<string, Position> = {};
    for (const m of index.nodes) if (m.position) out[m.id] = m.position;
    return out;
  }, [index]);

  const toggle = useCallback(async (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    // lazy-load body on first expand
    if (bodies[id] === undefined) {
      const node = await api.getNode(projectId, id);
      setBodies((b) => ({ ...b, [id]: node.body }));
    }
  }, [bodies, projectId]);

  const ask = useCallback(async (parentId: string, question: string) => {
    const pid = `pending_${pendSeq.current++}`;
    setPending((p) => [...p, { id: pid, parentId, question }]);
    try {
      await api.branch(projectId, parentId, question);
      setPending((p) => p.filter((x) => x.id !== pid));
      await onReloadIndex();
      setExpanded((prev) => new Set(prev).add(parentId)); // keep parent open so the new child shows
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPending((p) => p.map((x) => (x.id === pid ? { ...x, error: msg } : x)));
    }
  }, [projectId, onReloadIndex]);

  const positions = { ...savedPositions, ...drag };
  const model = useMemo(
    () => buildCanvas({ metas: index.nodes, expanded, bodies, pending, positions }),
    [index, expanded, bodies, pending, positions],
  );
  const layout = useMemo(() => layoutNodes(index.nodes), [index]);

  const rfNodes: Node[] = model.nodes.map((n) => ({
    id: n.id,
    type: "research",
    position: n.position ?? layout[n.id] ?? { x: 0, y: 0 },
    data: {
      kind: n.kind, title: n.title, expanded: n.expanded, pending: n.pending,
      body: n.body, error: n.error,
      onToggle: () => toggle(n.id),
      onAsk: (q: string) => ask(n.id, q),
      onRetry: n.pending ? () => { /* drop + re-ask */ setPending((p) => p.filter((x) => x.id !== n.id)); ask(n.id.startsWith("pending_") ? /* parent */ "" : "", n.title); } : undefined,
    } as CardData,
  }));
  const rfEdges: Edge[] = model.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label }));

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // track live drag positions; persist on drag-stop (dragging:false)
    for (const c of changes) {
      if (c.type === "position" && c.position) {
        setDrag((d) => ({ ...d, [c.id]: c.position! }));
        if (c.dragging === false && !c.id.startsWith("pending_")) {
          if (saveTimer.current) clearTimeout(saveTimer.current);
          const id = c.id, pos = c.position;
          saveTimer.current = setTimeout(() => { void api.setPositions(projectId, [{ id, x: pos.x, y: pos.y }]); }, 400);
        }
      }
    }
  }, [projectId]);

  return (
    <div className="canvas" style={{ width: "100%", height: "100%" }}>
      <ReactFlow nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} fitView>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
```

> Implementer guidance:
> - The `onRetry` sketch above is awkward because a pending node's parent id is encoded only in `pending` state. Fix it cleanly: look up the `PendingNode` by `n.id` in the `pending` array to recover `parentId`, then `onRetry = () => { remove the pending entry; ask(parentId, n.title); }`. Adjust the `model.nodes`→`rfNodes` mapping so each pending node closes over its real `parentId` (e.g., include `parentId` on `CanvasNode` when `pending`, or zip against the `pending` array).
> - Keep `applyNodeChanges` available if you prefer the controlled pattern; the minimal `setDrag` tracking above is enough because positions are derived. Do NOT fight React Flow — let it own transient drag, persist only on stop.

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS (fix any issues in Canvas/ResearchNodeCard).

- [ ] **Step 3: Commit**

```bash
git add web/src/components/Canvas.tsx
git commit -m "feat: Canvas with lazy bodies, optimistic ask, drag-persist"
```

---

## Task 9: App view machine + Library refactor + LoadingCanvas + delete dead code

**Files:**
- Create: `web/src/components/LoadingCanvas.tsx`
- Modify: `web/src/components/Library.tsx`
- Rewrite: `web/src/App.tsx`
- Delete: `web/src/components/NodeDetail.tsx`, `web/src/components/GraphView.tsx`, `web/src/highlights.ts`, `web/src/highlights.test.ts`, `web/src/anchor.ts`, `web/src/anchor.test.ts`, `web/src/pendingStore.ts`, `web/src/pendingStore.test.ts`, `web/src/usePendingQuestions.ts`
- Modify: `package.json` (remove `react-markdown`)

- [ ] **Step 1: LoadingCanvas**

```tsx
export function LoadingCanvas({ topic, error, onRetry, onHome }: { topic: string; error?: string; onRetry: () => void; onHome: () => void }) {
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100%", textAlign: "center" }}>
      {error ? (
        <div>
          <p style={{ color: "#b00020" }}>⚠ {error}</p>
          <button onClick={onRetry}>Try again</button> <button onClick={onHome}>← Home</button>
        </div>
      ) : (
        <div>
          <div className="spinner-lg">⏳</div>
          <p className="muted">Researching “{topic}”… this calls Claude and may take a moment.</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Library becomes a dumb collector**

Rewrite `web/src/components/Library.tsx` so it does NOT call `createTopic` itself; it calls `onStart(topic)` and `onOpen(id)`:

```tsx
import { useEffect, useState } from "react";
import { api } from "../api";

export function Library({ onStart, onOpen }: { onStart: (topic: string) => void; onOpen: (id: string) => void }) {
  const [projects, setProjects] = useState<string[]>([]);
  const [topic, setTopic] = useState("");
  useEffect(() => { api.listProjects().then(setProjects).catch(() => setProjects([])); }, []);
  const start = () => { if (topic.trim()) onStart(topic.trim()); };
  return (
    <div className="library">
      <h1>Searcher</h1>
      <p className="muted">Start research on a topic, then ask questions to grow a knowledge graph.</p>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. AI security"
               style={{ flex: 1, padding: 8 }} onKeyDown={(e) => e.key === "Enter" && start()} />
        <button onClick={start}>Search</button>
      </div>
      <h3>Your research</h3>
      <ul className="proj-list">
        {projects.map((p) => <li key={p} onClick={() => onOpen(p)}>{p}</li>)}
        {projects.length === 0 && <li className="muted" style={{ cursor: "default", color: "#aaa" }}>none yet</li>}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite App as the view machine**

```tsx
import { useCallback, useEffect, useState } from "react";
import { Library } from "./components/Library";
import { Canvas } from "./components/Canvas";
import { LoadingCanvas } from "./components/LoadingCanvas";
import { api } from "./api";
import type { GraphIndex } from "./types";

type View = { name: "home" } | { name: "loading"; topic: string; error?: string } | { name: "canvas"; projectId: string };

export function App() {
  const [view, setView] = useState<View>({ name: "home" });
  const [index, setIndex] = useState<GraphIndex | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const projectId = view.name === "canvas" ? view.projectId : null;
  const reload = useCallback(async (id: string) => setIndex(await api.getProject(id)), []);
  useEffect(() => { if (projectId) void reload(projectId); }, [projectId, reload]);

  const start = useCallback(async (topic: string) => {
    setView({ name: "loading", topic });
    try {
      const { projectId } = await api.createTopic(topic);
      setView({ name: "canvas", projectId });
    } catch (e) {
      setView({ name: "loading", topic, error: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const open = useCallback((id: string) => setView({ name: "canvas", projectId: id }), []);
  const home = useCallback(() => { setView({ name: "home" }); setIndex(null); }, []);

  if (view.name === "home") return <Library onStart={start} onOpen={open} />;
  if (view.name === "loading")
    return <div className="app"><div className="main"><LoadingCanvas topic={view.topic} error={view.error} onRetry={() => start(view.topic)} onHome={home} /></div></div>;

  // canvas
  async function synthesize() {
    if (!projectId) return;
    setBusy(true);
    try { setReport(await api.synthesize(projectId)); } finally { setBusy(false); }
  }
  return (
    <div className="app">
      <div className="topbar">
        <button onClick={home}>← Home</button>
        <strong>{index?.topic ?? projectId}</strong>
        <span style={{ flex: 1 }} />
        <button onClick={synthesize} disabled={busy}>Synthesize</button>
      </div>
      <div className="main" style={{ height: "calc(100vh - 48px)" }}>
        {index && projectId && <Canvas projectId={projectId} index={index} onReloadIndex={() => reload(projectId)} />}
      </div>
      {report !== null && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", padding: 40 }} onClick={() => setReport(null)}>
          <div style={{ background: "#fff", padding: 24, maxWidth: 800, margin: "0 auto", maxHeight: "80vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setReport(null)}>Close</button>
            <pre style={{ whiteSpace: "pre-wrap" }}>{report}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Delete dead files**

```bash
git rm web/src/components/NodeDetail.tsx web/src/components/GraphView.tsx \
  web/src/highlights.ts web/src/highlights.test.ts \
  web/src/anchor.ts web/src/anchor.test.ts \
  web/src/pendingStore.ts web/src/pendingStore.test.ts \
  web/src/usePendingQuestions.ts
```

- [ ] **Step 5: Remove the unused dependency**

Edit `package.json`: delete the `"react-markdown": "^10.1.0"` line from `dependencies`. Then `npm install` to update the lockfile.

- [ ] **Step 6: Verify everything**

Run: `npm test` then `npm run typecheck` then `npx vite build`
Expected: all pass; no references to deleted modules.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: canvas view machine; remove sidebar/anchor/batch dead code + react-markdown"
```

---

## Task 10: Full build + manual smoke verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck + tests + build**

Run: `npm run typecheck && npm test && npx vite build`
Expected: all green.

- [ ] **Step 2: Build server + start**

Run: `npm start` (builds web → public/, compiles server, runs `dist/src/main.js` on port 4317). Confirm the preflight still refuses to start if `ANTHROPIC_API_KEY` is set (do NOT remove the guard).

- [ ] **Step 3: Manual smoke (document results, do not run a real batch unprompted)**

Verify, on `http://localhost:4317`:
- Pressing Search immediately shows the loading canvas, then the graph.
- Topic node renders expanded with its findings as children.
- Expand/collapse a finding shows/hides its body (lazy-loaded) and its children.
- Dragging a node and reloading the page keeps the new position (server persistence).
- Asking a question shows a pending spinner node, then a real child node with an edge labelled by the question. (This step spends subscription usage — only run with the user's go-ahead.)

- [ ] **Step 4: Final review + finishing-a-development-branch**

Dispatch the final code review, then use superpowers:finishing-a-development-branch.
