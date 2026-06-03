# Batched Annotation Questions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user select text in any node (root or finding), stage several questions GitHub-review-style, and run them all at once — each producing a sibling branch node — with staged questions surviving reloads and explored passages shown as clickable highlights.

**Architecture:** Backend adds one `batchBranch` service method (parallel `claude -p` calls, race-free via a single shared `GraphStore` whose internal write-queue serializes index writes) and one HTTP endpoint. Frontend turns `NodeDetail` into an annotation surface: a `localStorage`-backed pending list, a "Run all N" batch submit, and body rendering that overlays pending + explored highlights via a pure segmentation helper.

**Tech Stack:** TypeScript ESM (NodeNext), Vitest, Fastify, React + Vite. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-03-searcher-batch-questions-design.md`

---

## File structure

- **Modify** `src/graph/types.ts` — add `anchor?: Anchor` to `NodeMeta`.
- **Modify** `src/graph/store.ts` — carry `anchor` through `metaOf`.
- **Modify** `web/src/types.ts` — mirror `NodeMeta.anchor`; add `PendingQuestion`.
- **Modify** `src/service.ts` — `BatchItem`, `BatchOutcome`, `batchBranch`.
- **Modify** `src/server/app.ts` — `POST /api/projects/:id/branch-batch`.
- **Modify** `web/src/api.ts` — `branchBatch` client method.
- **Create** `web/src/pendingStore.ts` — pure load/save of pending questions to a `Storage`.
- **Create** `web/src/usePendingQuestions.ts` — React hook wrapping `pendingStore` over `localStorage`.
- **Create** `web/src/highlights.ts` — pure body→segments helper for rendering highlights.
- **Modify** `web/src/components/NodeDetail.tsx` — selection popover, pending gutter, Run-all, highlight rendering.
- **Modify** `web/src/App.tsx` — pass children/anchor + change handler to `NodeDetail`; drop old single-branch handler.
- **Test** `test/service.test.ts`, `test/server/app.test.ts`, `web/src/api.test.ts`, `web/src/pendingStore.test.ts`, `web/src/highlights.test.ts`.

**Test commands:** backend `npm test` (Vitest, root config). Web `npm test` inside `web/` (`cd web; npm test`). Typecheck `npm run typecheck`.

---

## Task 1: Carry `anchor` into the index metadata

So the client can draw "explored" highlights for a node from `index.nodes` without fetching every child. The `.md` frontmatter already persists `anchor`; this only widens the derived index.

**Files:**
- Modify: `src/graph/types.ts:23-29`
- Modify: `src/graph/store.ts:6-8`
- Test: `test/graph/store.add.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/graph/store.add.test.ts` (a new `it` inside the existing top-level `describe`; keep existing imports — it already imports `GraphStore`, `fs`, `os`, `path` and sets up a temp `baseDir`):

```ts
it("records the finding's anchor in the index meta", async () => {
  const store = new GraphStore(baseDir, "p-anchor");
  await store.createProject("Topic");
  await store.addFinding({
    parents: ["topic"],
    anchor: { text: "spoofing", offset: 12, occurrence: 1 },
    question: "why?",
    body: "Because UDP.",
    sources: [],
  });
  const index = await store.load();
  const child = index.nodes.find((n) => n.id === "n_1");
  expect(child?.anchor).toEqual({ text: "spoofing", offset: 12, occurrence: 1 });
});
```

If `test/graph/store.add.test.ts` does not define `baseDir`/`beforeEach` the same way, open it first and match its existing setup (temp dir per test). Use its existing `baseDir` variable.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- store.add`
Expected: FAIL — `child.anchor` is `undefined` (TypeScript may also error that `anchor` is not on `NodeMeta`).

- [ ] **Step 3: Add `anchor` to `NodeMeta`**

In `src/graph/types.ts`, change the `NodeMeta` interface to include the optional anchor:

```ts
/** Lightweight per-node metadata stored in the index (everything reconstructable from .md files). */
export interface NodeMeta {
  id: string;
  kind: NodeKind;
  parents: string[];
  anchor?: Anchor; // present on findings that branch from a selection; mirrors the node's anchor
  question: string;
  created: string;
}
```

- [ ] **Step 4: Carry it through `metaOf`**

In `src/graph/store.ts`, replace the `metaOf` function:

```ts
function metaOf(node: ResearchNode): NodeMeta {
  const meta: NodeMeta = { id: node.id, kind: node.kind, parents: node.parents, question: node.question, created: node.created };
  if (node.anchor) meta.anchor = node.anchor;
  return meta;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- store`
Expected: PASS (new test plus existing store tests, including `store.rebuild` and `store.concurrency`, all green — `rebuildIndex` already calls `getNode` so it picks up `anchor` automatically).

- [ ] **Step 6: Mirror the type on the web side**

In `web/src/types.ts`, add `anchor` to `NodeMeta`:

```ts
export interface Anchor { text: string; offset: number; occurrence: number }
export interface NodeMeta { id: string; kind: "topic" | "finding"; parents: string[]; anchor?: Anchor; question: string; created: string }
export interface GraphIndex { topic: string; nextSeq: number; nodes: NodeMeta[] }
export interface ResearchNode extends NodeMeta { sources: string[]; body: string }
export interface PendingQuestion { id: string; anchor: Anchor; question: string; error?: string }
```

(Note: `ResearchNode` previously redeclared `anchor?: Anchor`; now it inherits it from `NodeMeta`, so the explicit `anchor?` is removed. `PendingQuestion` is added here for use in Task 5.)

- [ ] **Step 7: Typecheck both sides**

Run: `npm run typecheck`
Then: `cd web; npm run typecheck; cd ..`
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add src/graph/types.ts src/graph/store.ts web/src/types.ts test/graph/store.add.test.ts
git commit -m "feat: carry node anchor into index meta for explored highlights"
```

---

## Task 2: `batchBranch` service method

Runs N questions about a node in parallel and persists them race-free using one shared `GraphStore`.

**Files:**
- Modify: `src/service.ts:76-84` (after the existing `branch` method)
- Test: `test/service.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `test/service.test.ts` (imports already include `ResearchService`, `RunFn`, `GraphStore`, temp `baseDir`):

```ts
describe("ResearchService.batchBranch", () => {
  async function seedProject() {
    const rootRun: RunFn = async () => ({ answer: "", claims: [], sources: [], costUsd: 0, sessionId: "s", meta: { findings: [{ question: "Q1", body: "B1 about spoofing and forging", sources: [] }] } });
    const { projectId } = await svcWith(rootRun).createTopic("AI security");
    return projectId;
  }

  it("runs all questions in parallel and creates one sibling finding each, in input order", async () => {
    const projectId = await seedProject();
    const run: RunFn = async ({ prompt }) => ({ answer: `answer for ${prompt.includes("forge") ? "forge" : "spoof"}`, claims: [], sources: ["https://x"], costUsd: 0, sessionId: "s", meta: null });
    const svc = new ResearchService(baseDir, run);
    const out = await svc.batchBranch(projectId, [
      { parentId: "n_1", anchor: { text: "spoofing", offset: 0, occurrence: 1 }, question: "why spoof?" },
      { parentId: "n_1", anchor: { text: "forging", offset: 0, occurrence: 1 }, question: "why forge?" },
    ]);
    expect(out.failures).toEqual([]);
    expect(out.created).toHaveLength(2);
    expect(out.created.every((n) => n.parents.includes("n_1"))).toBe(true);
    const ids = out.created.map((n) => n.id);
    expect(new Set(ids).size).toBe(2); // unique ids — no index race
  });

  it("isolates failures: successes persist, the failed item is reported by index", async () => {
    const projectId = await seedProject();
    const run: RunFn = async ({ prompt }) => {
      if (prompt.includes("BOOM")) throw new Error("model failed");
      return { answer: "ok", claims: [], sources: [], costUsd: 0, sessionId: "s", meta: null };
    };
    const svc = new ResearchService(baseDir, run);
    const out = await svc.batchBranch(projectId, [
      { parentId: "n_1", anchor: { text: "spoofing", offset: 0, occurrence: 1 }, question: "fine one" },
      { parentId: "n_1", anchor: { text: "spoofing", offset: 0, occurrence: 1 }, question: "BOOM please" },
      { parentId: "n_1", anchor: { text: "forging", offset: 0, occurrence: 1 }, question: "another fine" },
    ]);
    expect(out.created).toHaveLength(2);
    expect(out.failures).toEqual([{ index: 1, error: "model failed" }]);
    const store = new GraphStore(baseDir, projectId);
    const index = await store.load();
    expect(index.nodes.filter((n) => n.kind === "finding")).toHaveLength(3); // 1 seeded + 2 new
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- service`
Expected: FAIL — `svc.batchBranch is not a function`.

- [ ] **Step 3: Implement `batchBranch`**

In `src/service.ts`, add these interfaces near the top (after the `Finding` interface, around line 23):

```ts
export interface BatchItem {
  parentId: string;
  anchor: Anchor;
  question: string;
}
export interface BatchOutcome {
  created: ResearchNode[];
  failures: { index: number; error: string }[];
}
```

Then add the method to the `ResearchService` class, right after `branch` (after line 84):

```ts
/**
 * Run several questions about a node at once. The claude -p calls fan out in parallel;
 * persistence is race-free because all items share ONE GraphStore, whose internal write
 * queue serializes index updates. Per-item failures are isolated (Promise.allSettled), so
 * one bad question never drops the others.
 */
async batchBranch(projectId: string, items: BatchItem[]): Promise<BatchOutcome> {
  const store = new GraphStore(this.baseDir, projectId);
  const index = await store.load();
  const cwd = projectDir(this.baseDir, projectId);

  const settled = await Promise.allSettled(
    items.map(async (item) => {
      const parent = await store.getNode(item.parentId);
      const prompt = branchPrompt({ topic: index.topic, selection: item.anchor.text, question: item.question, ancestorTitles: [parent.question] });
      const res = await this.run({ cwd, prompt, systemPrompt: BRANCH_SYSTEM });
      return store.addFinding({ parents: [item.parentId], anchor: item.anchor, question: item.question, body: res.answer, sources: res.sources });
    }),
  );

  const created: ResearchNode[] = [];
  const failures: { index: number; error: string }[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") created.push(r.value);
    else failures.push({ index: i, error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
  });
  return { created, failures };
}
```

(`Anchor`, `ResearchNode`, `projectDir`, `branchPrompt`, `BRANCH_SYSTEM`, `GraphStore` are already imported at the top of `service.ts`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- service`
Expected: PASS — both new tests plus the existing `createTopic`/`branch`/`synthesize` tests.

- [ ] **Step 5: Commit**

```bash
git add src/service.ts test/service.test.ts
git commit -m "feat: batchBranch — parallel multi-question branching, race-free writes"
```

---

## Task 3: `POST /api/projects/:id/branch-batch` endpoint

**Files:**
- Modify: `src/server/app.ts:38-47` (after the existing `/branch` route)
- Test: `test/server/app.test.ts`

- [ ] **Step 1: Write the failing tests**

In `test/server/app.test.ts`, first extend the default stub so `batchBranch` exists. Replace the `stubService` function body's object literal to include `batchBranch`:

```ts
function stubService(over: Partial<ResearchService> = {}): ResearchService {
  return {
    createTopic: async () => ({ projectId: "ai-security", findingCount: 3 }),
    branch: async () => ({ id: "n_1", kind: "finding", parents: ["topic"], question: "q", sources: [], created: "t", body: "b" }),
    batchBranch: async () => ({
      created: [{ id: "n_2", kind: "finding", parents: ["n_1"], question: "q", sources: [], created: "t", body: "b" }],
      failures: [],
    }),
    synthesize: async () => "# Report",
    ...over,
  } as unknown as ResearchService;
}
```

Then add tests inside the `describe("buildApp routes", ...)` block:

```ts
it("POST /branch-batch returns created + failures", async () => {
  const app = buildApp({ dataDir, service: stubService(), publicDir });
  const res = await app.inject({
    method: "POST",
    url: "/api/projects/p1/branch-batch",
    payload: { items: [{ parentId: "n_1", anchor: { text: "x", offset: 0, occurrence: 1 }, question: "why?" }] },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().created).toHaveLength(1);
  expect(res.json().failures).toEqual([]);
  await app.close();
});
it("POST /branch-batch 400s on empty items", async () => {
  const app = buildApp({ dataDir, service: stubService(), publicDir });
  const res = await app.inject({ method: "POST", url: "/api/projects/p1/branch-batch", payload: { items: [] } });
  expect(res.statusCode).toBe(400);
  await app.close();
});
it("POST /branch-batch 400s when an item is missing a field", async () => {
  const app = buildApp({ dataDir, service: stubService(), publicDir });
  const res = await app.inject({ method: "POST", url: "/api/projects/p1/branch-batch", payload: { items: [{ parentId: "n_1", question: "why?" }] } });
  expect(res.statusCode).toBe(400);
  await app.close();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- app`
Expected: FAIL — route returns 404 (not registered) for the 200 case.

- [ ] **Step 3: Add the route**

In `src/server/app.ts`, add immediately after the `/branch` route (after line 47):

```ts
app.post<{
  Params: { id: string };
  Body: { items?: { parentId?: string; anchor?: { text: string; offset: number; occurrence: number }; question?: string }[] };
}>("/api/projects/:id/branch-batch", async (req, reply) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return reply.code(400).send({ error: "items must be a non-empty array" });
  }
  for (const it of items) {
    if (!it?.parentId || !it.anchor || !it.question) {
      return reply.code(400).send({ error: "each item needs parentId, anchor and question" });
    }
  }
  return deps.service.batchBranch(req.params.id, items as { parentId: string; anchor: { text: string; offset: number; occurrence: number }; question: string }[]);
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- app`
Expected: PASS — all three new tests plus the existing route tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/server/app.ts test/server/app.test.ts
git commit -m "feat: add POST /branch-batch endpoint with item validation"
```

---

## Task 4: Web API client `branchBatch`

**Files:**
- Modify: `web/src/api.ts:18-20`
- Test: `web/src/api.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `web/src/api.test.ts` inside `describe("api", ...)`:

```ts
it("branchBatch POSTs items and returns created + failures", async () => {
  const f = mockFetch({ created: [{ id: "n_2" }], failures: [{ index: 1, error: "boom" }] });
  vi.stubGlobal("fetch", f);
  const res = await api.branchBatch("p1", [
    { parentId: "n_1", anchor: { text: "x", offset: 0, occurrence: 1 }, question: "why?" },
  ]);
  expect(res.created).toHaveLength(1);
  expect(res.failures[0]).toEqual({ index: 1, error: "boom" });
  expect(f).toHaveBeenCalledWith("/api/projects/p1/branch-batch", expect.objectContaining({ method: "POST" }));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web; npm test -- api; cd ..`
Expected: FAIL — `api.branchBatch is not a function`.

- [ ] **Step 3: Implement the client method**

In `web/src/api.ts`, add to the `api` object (after the `branch` entry, line 19). Also ensure `Anchor` and `ResearchNode` remain imported (they already are at line 1):

```ts
  branchBatch: (id: string, items: { parentId: string; anchor: Anchor; question: string }[]) =>
    post<{ created: ResearchNode[]; failures: { index: number; error: string }[] }>(
      `/api/projects/${id}/branch-batch`,
      { items },
    ),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web; npm test -- api; cd ..`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/api.ts web/src/api.test.ts
git commit -m "feat: web api.branchBatch client"
```

---

## Task 5: Pending-questions storage (pure) + hook

`pendingStore` is pure and fully tested over a fake `Storage`; the hook is a thin React wrapper over `localStorage`.

**Files:**
- Create: `web/src/pendingStore.ts`
- Create: `web/src/usePendingQuestions.ts`
- Test: `web/src/pendingStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/pendingStore.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pendingKey, loadPending, savePending } from "./pendingStore";
import type { PendingQuestion } from "./types";

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

const item: PendingQuestion = { id: "1", anchor: { text: "x", offset: 0, occurrence: 1 }, question: "why?" };

describe("pendingStore", () => {
  it("keys by project and node", () => {
    expect(pendingKey("p", "n_1")).toBe("searcher:pending:p:n_1");
  });
  it("round-trips items", () => {
    const s = fakeStorage();
    savePending(s, "p", "n_1", [item]);
    expect(loadPending(s, "p", "n_1")).toEqual([item]);
  });
  it("returns [] for missing or corrupt data", () => {
    const s = fakeStorage();
    expect(loadPending(s, "p", "missing")).toEqual([]);
    s.setItem(pendingKey("p", "bad"), "{not json");
    expect(loadPending(s, "p", "bad")).toEqual([]);
  });
  it("removes the key when saving an empty list", () => {
    const s = fakeStorage();
    savePending(s, "p", "n_1", [item]);
    savePending(s, "p", "n_1", []);
    expect(s.getItem(pendingKey("p", "n_1"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web; npm test -- pendingStore; cd ..`
Expected: FAIL — cannot resolve `./pendingStore`.

- [ ] **Step 3: Implement `pendingStore.ts`**

Create `web/src/pendingStore.ts`:

```ts
import type { PendingQuestion } from "./types";

export function pendingKey(projectId: string, nodeId: string): string {
  return `searcher:pending:${projectId}:${nodeId}`;
}

export function loadPending(storage: Storage, projectId: string, nodeId: string): PendingQuestion[] {
  const raw = storage.getItem(pendingKey(projectId, nodeId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingQuestion[]) : [];
  } catch {
    return [];
  }
}

export function savePending(storage: Storage, projectId: string, nodeId: string, items: PendingQuestion[]): void {
  const key = pendingKey(projectId, nodeId);
  if (items.length === 0) storage.removeItem(key);
  else storage.setItem(key, JSON.stringify(items));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web; npm test -- pendingStore; cd ..`
Expected: PASS.

- [ ] **Step 5: Implement the hook**

Create `web/src/usePendingQuestions.ts`:

```ts
import { useEffect, useState } from "react";
import type { PendingQuestion } from "./types";
import { loadPending, savePending } from "./pendingStore";

/** Per-(project,node) pending question list, mirrored to localStorage so it survives reloads. */
export function usePendingQuestions(
  projectId: string,
  nodeId: string,
): [PendingQuestion[], (next: PendingQuestion[]) => void] {
  const [items, setItems] = useState<PendingQuestion[]>(() => loadPending(localStorage, projectId, nodeId));

  // Reload when the active node changes.
  useEffect(() => {
    setItems(loadPending(localStorage, projectId, nodeId));
  }, [projectId, nodeId]);

  const update = (next: PendingQuestion[]) => {
    setItems(next);
    savePending(localStorage, projectId, nodeId, next);
  };

  return [items, update];
}
```

- [ ] **Step 6: Typecheck**

Run: `cd web; npm run typecheck; cd ..`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/pendingStore.ts web/src/usePendingQuestions.ts web/src/pendingStore.test.ts
git commit -m "feat: localStorage-backed pending questions store + hook"
```

---

## Task 6: Highlight segmentation (pure)

Turns a body string + a set of anchored marks into ordered segments for rendering. Pure and fully tested — no DOM.

**Files:**
- Create: `web/src/highlights.ts`
- Test: `web/src/highlights.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/highlights.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveRange, segmentBody, type Mark } from "./highlights";

const pending: Mark = { kind: "pending", label: "1", ref: "p1" };
const explored: Mark = { kind: "explored", label: "", ref: "n_2" };

describe("resolveRange", () => {
  it("finds the Nth occurrence", () => {
    expect(resolveRange("ab ab ab", { text: "ab", offset: 0, occurrence: 2 })).toEqual([3, 5]);
  });
  it("returns null when not found", () => {
    expect(resolveRange("abc", { text: "zzz", offset: 0, occurrence: 1 })).toBeNull();
  });
});

describe("segmentBody", () => {
  it("splits body and marks the anchored spans", () => {
    const segs = segmentBody("DNS spoofing is bad", [
      { anchor: { text: "spoofing", offset: 4, occurrence: 1 }, mark: pending },
    ]);
    expect(segs).toEqual([
      { text: "DNS " },
      { text: "spoofing", mark: pending },
      { text: " is bad" },
    ]);
  });
  it("orders multiple marks and skips unresolved anchors", () => {
    const segs = segmentBody("alpha beta gamma", [
      { anchor: { text: "gamma", offset: 11, occurrence: 1 }, mark: explored },
      { anchor: { text: "alpha", offset: 0, occurrence: 1 }, mark: pending },
      { anchor: { text: "missing", offset: 0, occurrence: 1 }, mark: pending },
    ]);
    expect(segs.map((s) => s.mark?.ref ?? null)).toEqual(["p1", null, "n_2"]);
    expect(segs.map((s) => s.text).join("")).toBe("alpha beta gamma");
  });
  it("drops overlapping later marks (earlier start wins)", () => {
    const segs = segmentBody("abcdef", [
      { anchor: { text: "abcd", offset: 0, occurrence: 1 }, mark: pending },
      { anchor: { text: "cdef", offset: 2, occurrence: 1 }, mark: explored },
    ]);
    expect(segs).toEqual([{ text: "abcd", mark: pending }, { text: "ef" }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web; npm test -- highlights; cd ..`
Expected: FAIL — cannot resolve `./highlights`.

- [ ] **Step 3: Implement `highlights.ts`**

Create `web/src/highlights.ts`:

```ts
import type { Anchor } from "./types";

export interface Mark {
  kind: "pending" | "explored";
  label: string; // number badge for pending; "" for explored
  ref: string; // pending id, or child node id for explored
}
export interface Segment {
  text: string;
  mark?: Mark;
}

/** Resolve an anchor to a [start, end) range in body using its occurrence; null if absent. */
export function resolveRange(body: string, anchor: Anchor): [number, number] | null {
  let from = 0;
  let seen = 0;
  for (;;) {
    const i = body.indexOf(anchor.text, from);
    if (i === -1) return null;
    seen += 1;
    if (seen === anchor.occurrence) return [i, i + anchor.text.length];
    from = i + 1;
  }
}

/** Split body into ordered segments, marking anchored ranges. On overlap, the earlier start wins. */
export function segmentBody(body: string, marks: { anchor: Anchor; mark: Mark }[]): Segment[] {
  const ranges = marks
    .map((m) => {
      const r = resolveRange(body, m.anchor);
      return r ? { start: r[0], end: r[1], mark: m.mark } : null;
    })
    .filter((r): r is { start: number; end: number; mark: Mark } => r !== null)
    .sort((a, b) => a.start - b.start);

  const segments: Segment[] = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.start < pos) continue; // overlaps an already-emitted mark — skip
    if (r.start > pos) segments.push({ text: body.slice(pos, r.start) });
    segments.push({ text: body.slice(r.start, r.end), mark: r.mark });
    pos = r.end;
  }
  if (pos < body.length) segments.push({ text: body.slice(pos) });
  return segments;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web; npm test -- highlights; cd ..`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/highlights.ts web/src/highlights.test.ts
git commit -m "feat: pure body→segments highlight helper"
```

---

## Task 7: NodeDetail annotation surface + App wiring

Replace the single-question flow with: select → Add to pending → stage more → Run all. Render body as highlightable segments (pending = amber dashed with a number badge; explored = solid, clickable → opens the child). Because highlight offsets must match the raw `body` string that anchors are computed against, the body is rendered as **plain text segments** (whitespace preserved), not Markdown. (Markdown rendering of highlighted bodies is intentionally deferred — see spec "Out of scope".)

**Files:**
- Modify: `web/src/components/NodeDetail.tsx` (full rewrite)
- Modify: `web/src/App.tsx:23-30,50-52`
- Verify: browser (no unit test — DOM-heavy; logic lives in the pure helpers tested in Tasks 5–6)

- [ ] **Step 1: Rewrite `NodeDetail.tsx`**

Replace the entire contents of `web/src/components/NodeDetail.tsx`:

```tsx
import { useState } from "react";
import type { ResearchNode, Anchor, PendingQuestion } from "../types";
import { computeAnchor } from "../anchor";
import { segmentBody, type Mark } from "../highlights";
import { usePendingQuestions } from "../usePendingQuestions";
import { api } from "../api";

export function NodeDetail({
  node, projectId, exploredChildren, onChanged, onSelectChild,
}: {
  node: ResearchNode;
  projectId: string;
  exploredChildren: { id: string; anchor: Anchor; question: string }[];
  onChanged: () => void | Promise<void>;
  onSelectChild: (nodeId: string) => void;
}) {
  const [pending, setPending] = usePendingQuestions(projectId, node.id);
  const [selection, setSelection] = useState("");
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);

  function captureSelection() {
    const sel = window.getSelection()?.toString().trim() ?? "";
    if (sel) setSelection(sel);
  }

  function addQuestion() {
    const text = selection || node.body.slice(0, 40);
    const q = draft.trim();
    if (!q) return;
    const anchor = computeAnchor(node.body, text, node.body.indexOf(text));
    setPending([...pending, { id: crypto.randomUUID(), anchor, question: q }]);
    setDraft("");
    setSelection("");
  }

  function removeQuestion(id: string) {
    setPending(pending.filter((p) => p.id !== id));
  }

  async function runAll() {
    if (pending.length === 0) return;
    setRunning(true);
    try {
      const items = pending.map((p) => ({ parentId: node.id, anchor: p.anchor, question: p.question }));
      const { failures } = await api.branchBatch(projectId, items);
      const failed = new Map(failures.map((f) => [f.index, f.error]));
      const remaining = pending
        .map((p, i) => (failed.has(i) ? { ...p, error: failed.get(i) } : null))
        .filter((p): p is PendingQuestion => p !== null);
      setPending(remaining);
      await onChanged();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPending(pending.map((p) => ({ ...p, error: msg })));
    } finally {
      setRunning(false);
    }
  }

  // Build marks: explored children first (so they win on overlap), then pending with number badges.
  const marks: { anchor: Anchor; mark: Mark }[] = [
    ...exploredChildren.map((c) => ({ anchor: c.anchor, mark: { kind: "explored", label: "", ref: c.id } as Mark })),
    ...pending.map((p, i) => ({ anchor: p.anchor, mark: { kind: "pending", label: String(i + 1), ref: p.id } as Mark })),
  ];
  const segments = node.body ? segmentBody(node.body, marks) : [];

  return (
    <div className="detail">
      <h3>{node.question}</h3>

      <div className="body" onMouseUp={captureSelection} style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
        {node.body
          ? segments.map((s, i) =>
              s.mark ? (
                <mark
                  key={i}
                  onClick={s.mark.kind === "explored" ? () => onSelectChild(s.mark!.ref) : undefined}
                  style={{
                    cursor: s.mark.kind === "explored" ? "pointer" : "text",
                    background: s.mark.kind === "explored" ? "#cfe3ff" : "transparent",
                    borderBottom: s.mark.kind === "pending" ? "2px dashed #d08700" : "none",
                    padding: "0 1px",
                  }}
                  title={s.mark.kind === "explored" ? "Open child node" : `Pending question ${s.mark.label}`}
                >
                  {s.text}
                  {s.mark.kind === "pending" ? <sup style={{ color: "#d08700" }}>{s.mark.label}</sup> : null}
                </mark>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )
          : <em>(This node has no body text to annotate. Open one of its findings to ask anchored questions.)</em>}
      </div>

      {node.sources?.length > 0 && (
        <div className="sources">
          <strong>Sources</strong>
          {node.sources.map((s) => <a key={s} href={s} target="_blank" rel="noreferrer">{s}</a>)}
        </div>
      )}

      <hr />

      <p className="muted">Selected: {selection ? `"${selection}"` : "(select text above to anchor a question)"}</p>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Type a question, then Add it to the batch…"
        rows={3}
        style={{ width: "100%" }}
        disabled={running}
      />
      <button onClick={addQuestion} disabled={running || !draft.trim()}>Add question</button>

      {pending.length > 0 && (
        <div className="pending" style={{ marginTop: 12 }}>
          <strong>Pending questions ({pending.length})</strong>
          <ol>
            {pending.map((p) => (
              <li key={p.id} style={{ marginBottom: 6 }}>
                <span className="muted">“{p.anchor.text.slice(0, 40)}”</span> — {p.question}
                <button onClick={() => removeQuestion(p.id)} style={{ marginLeft: 8 }} disabled={running}>delete</button>
                {p.error ? <div style={{ color: "#b00020" }}>⚠ {p.error}</div> : null}
              </li>
            ))}
          </ol>
          <button onClick={runAll} disabled={running}>
            {running ? "Researching…" : `Run all ${pending.length} →`}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire `App.tsx`**

In `web/src/App.tsx`, remove the old `branch` handler and pass the new props. Replace the `branch` function (lines 23-30) with a no-op removal and update the render of `NodeDetail`.

Delete this block (lines 23-30):

```tsx
  async function branch(anchor: Anchor, question: string) {
    if (!projectId || !node) return;
    setBusy(true);
    try {
      await api.branch(projectId, node.id, anchor, question);
      await refresh(projectId);
    } finally { setBusy(false); }
  }
```

Then replace the `NodeDetail` usage (lines 50-52) with:

```tsx
        {node
          ? <NodeDetail
              node={node}
              projectId={projectId}
              exploredChildren={(index?.nodes ?? [])
                .filter((n) => n.parents.includes(node.id) && n.anchor)
                .map((n) => ({ id: n.id, anchor: n.anchor!, question: n.question }))}
              onChanged={() => refresh(projectId)}
              onSelectChild={openNode}
            />
          : <div className="detail"><p className="muted">Click a node to read it and branch questions.</p></div>}
```

Finally, remove the now-unused `Anchor` import on line 6 if TypeScript flags it (change `import type { GraphIndex, ResearchNode, Anchor } from "./types";` to `import type { GraphIndex, ResearchNode } from "./types";`). Leave `busy`/`setBusy` in place — they are still used by `synthesize`.

- [ ] **Step 3: Typecheck the web app**

Run: `cd web; npm run typecheck; cd ..`
Expected: clean. If `Anchor` is reported unused in `App.tsx`, apply the import change from Step 2.

- [ ] **Step 4: Run the full web test suite**

Run: `cd web; npm test; cd ..`
Expected: PASS — `api`, `anchor`, `pendingStore`, `highlights` suites all green.

- [ ] **Step 5: Build and verify in the browser**

Run: `npm start` (from repo root — builds web → `public/`, compiles server → `dist/`, serves http://localhost:4317).

Manual verification checklist:
1. Open an existing project (or create a topic) and click a finding node.
2. Select a phrase in the body → type a question → **Add question**. Confirm it appears in "Pending questions" and the phrase gets an amber dashed underline with a number badge.
3. Add a second question on a different phrase. Confirm both are staged and badges are numbered 1, 2.
4. Reload the page, reopen the same node → confirm both pending questions are still there (localStorage).
5. Click **Run all 2 →**. Confirm two new sibling nodes appear under the node in the graph, the pending list clears, and the two phrases now show solid blue (explored) highlights.
6. Click an explored highlight → confirm it opens that child node.
7. Switch to another node and back → confirm pending list is per-node (empty on the other node).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/NodeDetail.tsx web/src/App.tsx
git commit -m "feat: NodeDetail batch-question annotation surface with highlights"
```

---

## Final verification

- [ ] **Run the entire backend suite:** `npm test` — expected: all pass (service, app, store, plus existing suites).
- [ ] **Run the entire web suite:** `cd web; npm test; cd ..` — expected: all pass.
- [ ] **Typecheck both:** `npm run typecheck && cd web && npm run typecheck && cd ..` — expected: clean.
- [ ] **Dispatch a final code review** over the whole change set before finishing the branch.
