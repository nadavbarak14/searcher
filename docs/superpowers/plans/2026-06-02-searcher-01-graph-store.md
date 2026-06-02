# Searcher — Plan 01: Scaffold + Graph Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data layer for Searcher — research nodes persisted as markdown-with-frontmatter files, a rebuildable `graph.json` index, and a single-writer store that is safe under concurrent writes.

**Architecture:** A `GraphStore` class owns one research project = one folder on disk. Each node is a `.md` file (frontmatter = metadata, body = the answer). `graph.json` is a *derived, rebuildable* index for fast loading; per-node frontmatter is the source of truth. All mutations pass through a serialized write queue so two concurrent branches can't corrupt the index. The store knows nothing about Claude or HTTP — it's a pure library, fully unit-tested.

**Tech Stack:** Node.js 20+, TypeScript (ESM), Vitest (test runner), gray-matter (frontmatter parse/stringify).

This is **Milestone 1 of 3**. Plan 02 (Claude runner + backend API) and Plan 03 (frontend) build on top. Nothing here imports Claude or Fastify.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `package.json` | Scripts, deps. ESM (`"type": "module"`). |
| `tsconfig.json` | TS config, ESM + NodeNext resolution. |
| `vitest.config.ts` | Test runner config. |
| `src/graph/types.ts` | All graph type definitions. No logic. |
| `src/graph/serialize.ts` | `nodeToMarkdown` / `markdownToNode` — pure functions, no I/O. |
| `src/graph/paths.ts` | Resolve project/node file paths from a base data dir. |
| `src/graph/store.ts` | `GraphStore` class — create project, add/read nodes, load/rebuild index, write queue. |
| `test/graph/*.test.ts` | Unit tests mirroring each module. |

`nextSeq` (the node-id counter) lives in `graph.json`. Node ids are `n_<seq>` (e.g. `n_1`); the synthetic topic node is always `topic`.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Test: `test/smoke.test.ts`

- [ ] **Step 1: Write the failing smoke test**

Create `test/smoke.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("scaffold", () => {
  it("runs vitest", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails (no runner yet)**

Run: `npm test`
Expected: FAIL — `npm` errors with "Missing script: test" (or command not found). This confirms scaffold is absent.

- [ ] **Step 3: Create the scaffold files**

Create `package.json`:

```json
{
  "name": "searcher",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "gray-matter": "^4.0.3"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "@types/node": "^20.14.0"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

Create `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
```

Create `.gitignore`:

```
node_modules/
dist/
*.log
```

- [ ] **Step 4: Install and run the test to verify it passes**

Run: `npm install` then `npm test`
Expected: PASS — 1 test passes (`scaffold > runs vitest`).

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore test/smoke.test.ts package-lock.json
git commit -m "chore: scaffold Searcher project (TS ESM + vitest)"
```

---

### Task 2: Graph types

**Files:**
- Create: `src/graph/types.ts`
- Test: `test/graph/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/graph/types.test.ts`:

```typescript
import { describe, it, expectTypeOf } from "vitest";
import type { ResearchNode, GraphIndex, Anchor, NodeKind } from "../../src/graph/types.js";

describe("graph types", () => {
  it("ResearchNode has the expected shape", () => {
    const node: ResearchNode = {
      id: "n_1",
      kind: "finding",
      parents: ["topic"],
      anchor: { text: "transfer", offset: 10, occurrence: 1 },
      question: "Why do adversarial examples transfer?",
      sources: ["https://example.com"],
      created: "2026-06-02T18:30:00.000Z",
      body: "Because models learn similar features.",
    };
    expectTypeOf(node.kind).toEqualTypeOf<NodeKind>();
    expectTypeOf(node.anchor).toEqualTypeOf<Anchor | undefined>();
  });

  it("topic node may omit anchor", () => {
    const topic: ResearchNode = {
      id: "topic",
      kind: "topic",
      parents: [],
      question: "AI security",
      sources: [],
      created: "2026-06-02T18:30:00.000Z",
      body: "",
    };
    expectTypeOf(topic).toEqualTypeOf<ResearchNode>();
  });

  it("GraphIndex tracks nextSeq and node metas", () => {
    const index: GraphIndex = {
      topic: "AI security",
      nextSeq: 1,
      nodes: [{ id: "topic", kind: "topic", parents: [], question: "AI security", created: "2026-06-02T18:30:00.000Z" }],
    };
    expectTypeOf(index.nextSeq).toEqualTypeOf<number>();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/graph/types.test.ts`
Expected: FAIL — cannot find module `../../src/graph/types.js`.

- [ ] **Step 3: Write the types**

Create `src/graph/types.ts`:

```typescript
export type NodeKind = "topic" | "finding";

/** How a child node's selection maps back into the parent's rendered answer. */
export interface Anchor {
  text: string;
  offset: number; // char offset into the parent body
  occurrence: number; // Nth match of `text`, to disambiguate duplicates (1-based)
}

/** A single research node. Persisted as one markdown file: frontmatter = metadata, body = answer. */
export interface ResearchNode {
  id: string; // "topic" for the root, else "n_<seq>"
  kind: NodeKind;
  parents: string[]; // empty for the topic node; >=1 otherwise. Array → graph, not just tree.
  anchor?: Anchor; // absent on the topic node and on manual cross-links
  question: string;
  sources: string[];
  created: string; // ISO 8601
  body: string; // markdown answer (the topic node's body is "")
}

/** Lightweight per-node metadata stored in the index (everything reconstructable from .md files). */
export interface NodeMeta {
  id: string;
  kind: NodeKind;
  parents: string[];
  question: string;
  created: string;
}

/** Derived, rebuildable index for fast project loading. Source of truth is the .md frontmatter. */
export interface GraphIndex {
  topic: string;
  nextSeq: number; // next finding id will be `n_<nextSeq>`
  nodes: NodeMeta[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/graph/types.test.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/graph/types.ts test/graph/types.test.ts
git commit -m "feat(graph): add node and index type definitions"
```

---

### Task 3: Node ⇄ markdown serialization

**Files:**
- Create: `src/graph/serialize.ts`
- Test: `test/graph/serialize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/graph/serialize.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { nodeToMarkdown, markdownToNode } from "../../src/graph/serialize.js";
import type { ResearchNode } from "../../src/graph/types.js";

const node: ResearchNode = {
  id: "n_1",
  kind: "finding",
  parents: ["topic"],
  anchor: { text: "transfer across models", offset: 412, occurrence: 1 },
  question: "Why do adversarial examples transfer?",
  sources: ["https://example.com/a"],
  created: "2026-06-02T18:30:00.000Z",
  body: "Because models converge on similar decision boundaries.",
};

describe("serialize", () => {
  it("round-trips a finding node through markdown", () => {
    const md = nodeToMarkdown(node);
    const parsed = markdownToNode("n_1", md);
    expect(parsed).toEqual(node);
  });

  it("emits frontmatter then body", () => {
    const md = nodeToMarkdown(node);
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("Because models converge");
  });

  it("round-trips a topic node with no anchor and empty body", () => {
    const topic: ResearchNode = {
      id: "topic",
      kind: "topic",
      parents: [],
      question: "AI security",
      sources: [],
      created: "2026-06-02T18:30:00.000Z",
      body: "",
    };
    const parsed = markdownToNode("topic", nodeToMarkdown(topic));
    expect(parsed).toEqual(topic);
    expect(parsed.anchor).toBeUndefined();
  });

  it("uses the id argument, not any id in the frontmatter", () => {
    const md = nodeToMarkdown(node);
    const parsed = markdownToNode("n_99", md);
    expect(parsed.id).toBe("n_99");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/graph/serialize.test.ts`
Expected: FAIL — cannot find module `serialize.js`.

- [ ] **Step 3: Write the implementation**

Create `src/graph/serialize.ts`:

```typescript
import matter from "gray-matter";
import type { ResearchNode, NodeKind, Anchor } from "./types.js";

interface FrontMatter {
  kind: NodeKind;
  parents: string[];
  anchor?: Anchor;
  question: string;
  sources: string[];
  created: string;
}

/** Serialize a node to a markdown string: YAML frontmatter + body. `id` is NOT stored (it's the filename). */
export function nodeToMarkdown(node: ResearchNode): string {
  const data: FrontMatter = {
    kind: node.kind,
    parents: node.parents,
    question: node.question,
    sources: node.sources,
    created: node.created,
  };
  if (node.anchor) data.anchor = node.anchor;
  // gray-matter appends a trailing newline to the body; keep body verbatim.
  return matter.stringify(node.body, data);
}

/** Parse a markdown string back into a node. The id comes from the caller (the filename), not the content. */
export function markdownToNode(id: string, md: string): ResearchNode {
  const { data, content } = matter(md);
  const fm = data as FrontMatter;
  const node: ResearchNode = {
    id,
    kind: fm.kind,
    parents: fm.parents ?? [],
    question: fm.question,
    sources: fm.sources ?? [],
    created: fm.created,
    body: content.replace(/\n$/, ""), // strip the single trailing newline gray-matter adds
  };
  if (fm.anchor) node.anchor = fm.anchor;
  return node;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/graph/serialize.test.ts`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/graph/serialize.ts test/graph/serialize.test.ts
git commit -m "feat(graph): node <-> markdown serialization"
```

---

### Task 4: Path helpers

**Files:**
- Create: `src/graph/paths.ts`
- Test: `test/graph/paths.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/graph/paths.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { projectDir, nodePath, indexPath } from "../../src/graph/paths.js";
import path from "node:path";

describe("paths", () => {
  const base = "/data/Searcher";

  it("projectDir joins base + project id", () => {
    expect(projectDir(base, "proj1")).toBe(path.join(base, "proj1"));
  });

  it("nodePath is <project>/<id>.md", () => {
    expect(nodePath(base, "proj1", "n_1")).toBe(path.join(base, "proj1", "n_1.md"));
  });

  it("indexPath is <project>/graph.json", () => {
    expect(indexPath(base, "proj1")).toBe(path.join(base, "proj1", "graph.json"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/graph/paths.test.ts`
Expected: FAIL — cannot find module `paths.js`.

- [ ] **Step 3: Write the implementation**

Create `src/graph/paths.ts`:

```typescript
import path from "node:path";

/** Absolute folder for one research project. */
export function projectDir(baseDir: string, projectId: string): string {
  return path.join(baseDir, projectId);
}

/** Absolute path to a node's markdown file. */
export function nodePath(baseDir: string, projectId: string, nodeId: string): string {
  return path.join(baseDir, projectId, `${nodeId}.md`);
}

/** Absolute path to a project's index file. */
export function indexPath(baseDir: string, projectId: string): string {
  return path.join(baseDir, projectId, "graph.json");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/graph/paths.test.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/graph/paths.ts test/graph/paths.test.ts
git commit -m "feat(graph): project/node/index path helpers"
```

---

### Task 5: GraphStore — create project with topic node

**Files:**
- Create: `src/graph/store.ts`
- Test: `test/graph/store.create.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/graph/store.create.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GraphStore } from "../../src/graph/store.js";
import { markdownToNode } from "../../src/graph/serialize.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let baseDir: string;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "searcher-"));
});
afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

describe("GraphStore.createProject", () => {
  it("creates the folder, a topic node file, and graph.json", async () => {
    const store = new GraphStore(baseDir, "proj1");
    await store.createProject("AI security");

    const topicMd = await fs.readFile(path.join(baseDir, "proj1", "topic.md"), "utf8");
    const topic = markdownToNode("topic", topicMd);
    expect(topic.kind).toBe("topic");
    expect(topic.question).toBe("AI security");
    expect(topic.parents).toEqual([]);

    const index = JSON.parse(await fs.readFile(path.join(baseDir, "proj1", "graph.json"), "utf8"));
    expect(index.topic).toBe("AI security");
    expect(index.nextSeq).toBe(1);
    expect(index.nodes).toHaveLength(1);
    expect(index.nodes[0].id).toBe("topic");
  });

  it("sets a valid ISO created timestamp on the topic node", async () => {
    const store = new GraphStore(baseDir, "proj1");
    await store.createProject("AI security");
    const topic = await store.getNode("topic");
    expect(Number.isNaN(Date.parse(topic.created))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/graph/store.create.test.ts`
Expected: FAIL — cannot find module `store.js`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/graph/store.ts`:

```typescript
import fs from "node:fs/promises";
import type { ResearchNode, GraphIndex, NodeMeta } from "./types.js";
import { nodeToMarkdown, markdownToNode } from "./serialize.js";
import { projectDir, nodePath, indexPath } from "./paths.js";

function metaOf(node: ResearchNode): NodeMeta {
  return { id: node.id, kind: node.kind, parents: node.parents, question: node.question, created: node.created };
}

export class GraphStore {
  constructor(
    private readonly baseDir: string,
    private readonly projectId: string,
  ) {}

  /** Create the project folder, the synthetic topic node, and the initial index. */
  async createProject(topic: string): Promise<void> {
    await fs.mkdir(projectDir(this.baseDir, this.projectId), { recursive: true });
    const topicNode: ResearchNode = {
      id: "topic",
      kind: "topic",
      parents: [],
      question: topic,
      sources: [],
      created: new Date().toISOString(),
      body: "",
    };
    await fs.writeFile(nodePath(this.baseDir, this.projectId, "topic"), nodeToMarkdown(topicNode), "utf8");
    const index: GraphIndex = { topic, nextSeq: 1, nodes: [metaOf(topicNode)] };
    await fs.writeFile(indexPath(this.baseDir, this.projectId), JSON.stringify(index, null, 2), "utf8");
  }

  /** Read a single node by id from its markdown file. */
  async getNode(id: string): Promise<ResearchNode> {
    const md = await fs.readFile(nodePath(this.baseDir, this.projectId, id), "utf8");
    return markdownToNode(id, md);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/graph/store.create.test.ts`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/graph/store.ts test/graph/store.create.test.ts
git commit -m "feat(graph): GraphStore.createProject + getNode"
```

---

### Task 6: GraphStore — addNode (write .md, then index) + id allocation

**Files:**
- Modify: `src/graph/store.ts`
- Test: `test/graph/store.add.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/graph/store.add.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GraphStore } from "../../src/graph/store.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let baseDir: string;
let store: GraphStore;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "searcher-"));
  store = new GraphStore(baseDir, "proj1");
  await store.createProject("AI security");
});
afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

describe("GraphStore.addFinding", () => {
  it("allocates sequential ids n_1, n_2 and bumps nextSeq", async () => {
    const a = await store.addFinding({
      parents: ["topic"],
      question: "What are adversarial examples?",
      body: "Inputs crafted to fool a model.",
      sources: [],
    });
    const b = await store.addFinding({
      parents: ["topic"],
      question: "What is data poisoning?",
      body: "Corrupting training data.",
      sources: [],
    });
    expect(a.id).toBe("n_1");
    expect(b.id).toBe("n_2");
    const index = await store.loadIndex();
    expect(index.nextSeq).toBe(3);
    expect(index.nodes.map((n) => n.id).sort()).toEqual(["n_1", "n_2", "topic"]);
  });

  it("writes the node file with kind=finding and persists optional anchor", async () => {
    const node = await store.addFinding({
      parents: ["topic"],
      anchor: { text: "adversarial", offset: 5, occurrence: 1 },
      question: "Why?",
      body: "Because.",
      sources: ["https://x.test"],
    });
    const reread = await store.getNode(node.id);
    expect(reread.kind).toBe("finding");
    expect(reread.anchor).toEqual({ text: "adversarial", offset: 5, occurrence: 1 });
    expect(reread.sources).toEqual(["https://x.test"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/graph/store.add.test.ts`
Expected: FAIL — `store.addFinding is not a function` and `store.loadIndex is not a function`.

- [ ] **Step 3: Add `loadIndex`, `writeIndex`, and `addFinding`**

In `src/graph/store.ts`, add these imports/usages and methods. First extend the imports at the top (replace the existing import line for paths):

```typescript
import { projectDir, nodePath, indexPath } from "./paths.js";
```

(unchanged — already present). Then add these methods inside the `GraphStore` class, after `getNode`:

```typescript
  /** Read the derived index. */
  async loadIndex(): Promise<GraphIndex> {
    const raw = await fs.readFile(indexPath(this.baseDir, this.projectId), "utf8");
    return JSON.parse(raw) as GraphIndex;
  }

  private async writeIndex(index: GraphIndex): Promise<void> {
    await fs.writeFile(indexPath(this.baseDir, this.projectId), JSON.stringify(index, null, 2), "utf8");
  }

  /**
   * Add a finding node. Allocates the next id, writes the .md FIRST, then updates the index.
   * (If the process dies between the two writes, rebuildIndex() reconciles on next load.)
   */
  async addFinding(input: {
    parents: string[];
    anchor?: import("./types.js").Anchor;
    question: string;
    body: string;
    sources: string[];
  }): Promise<ResearchNode> {
    const index = await this.loadIndex();
    const id = `n_${index.nextSeq}`;
    const node: ResearchNode = {
      id,
      kind: "finding",
      parents: input.parents,
      question: input.question,
      sources: input.sources,
      created: new Date().toISOString(),
      body: input.body,
    };
    if (input.anchor) node.anchor = input.anchor;

    // 1. write the node file first (source of truth)
    await fs.writeFile(nodePath(this.baseDir, this.projectId, id), nodeToMarkdown(node), "utf8");
    // 2. then update the derived index
    index.nextSeq += 1;
    index.nodes.push(metaOf(node));
    await this.writeIndex(index);

    return node;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/graph/store.add.test.ts`
Expected: PASS — 2 tests pass. Also run `npm test` — all prior tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/graph/store.ts test/graph/store.add.test.ts
git commit -m "feat(graph): addFinding with sequential ids + md-before-index write order"
```

---

### Task 7: GraphStore — rebuildIndex (reconciliation) + load-or-rebuild

**Files:**
- Modify: `src/graph/store.ts`
- Test: `test/graph/store.rebuild.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/graph/store.rebuild.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GraphStore } from "../../src/graph/store.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let baseDir: string;
let store: GraphStore;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "searcher-"));
  store = new GraphStore(baseDir, "proj1");
  await store.createProject("AI security");
  await store.addFinding({ parents: ["topic"], question: "Q1", body: "A1", sources: [] }); // n_1
  await store.addFinding({ parents: ["topic"], question: "Q2", body: "A2", sources: [] }); // n_2
});
afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

describe("GraphStore.rebuildIndex", () => {
  it("reconstructs the index from .md files alone", async () => {
    // corrupt/delete the index
    await fs.rm(path.join(baseDir, "proj1", "graph.json"));
    const rebuilt = await store.rebuildIndex();
    expect(rebuilt.topic).toBe("AI security");
    expect(rebuilt.nodes.map((n) => n.id).sort()).toEqual(["n_1", "n_2", "topic"]);
    // nextSeq must be max finding seq + 1, so the next id won't collide
    expect(rebuilt.nextSeq).toBe(3);
  });

  it("load() returns the existing index when present", async () => {
    const index = await store.load();
    expect(index.nodes).toHaveLength(3);
  });

  it("load() rebuilds when graph.json is missing", async () => {
    await fs.rm(path.join(baseDir, "proj1", "graph.json"));
    const index = await store.load();
    expect(index.nodes).toHaveLength(3);
    expect(index.nextSeq).toBe(3);
    // and it wrote the file back out
    const onDisk = JSON.parse(await fs.readFile(path.join(baseDir, "proj1", "graph.json"), "utf8"));
    expect(onDisk.nodes).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/graph/store.rebuild.test.ts`
Expected: FAIL — `store.rebuildIndex is not a function`.

- [ ] **Step 3: Add `rebuildIndex` and `load`**

Add to the top of `src/graph/store.ts` (extend the node:fs import — it is already `import fs from "node:fs/promises";`, so add `path`):

```typescript
import path from "node:path";
```

Add these methods inside the `GraphStore` class:

```typescript
  /** Rebuild the index purely from the .md files on disk, then persist it. Source of truth = frontmatter. */
  async rebuildIndex(): Promise<GraphIndex> {
    const dir = projectDir(this.baseDir, this.projectId);
    const entries = await fs.readdir(dir);
    const ids = entries.filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3));

    const nodes: NodeMeta[] = [];
    let topic = "";
    let maxSeq = 0;
    for (const id of ids) {
      const node = await this.getNode(id);
      nodes.push(metaOf(node));
      if (node.kind === "topic") topic = node.question;
      const m = /^n_(\d+)$/.exec(id);
      if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
    }
    const index: GraphIndex = { topic, nextSeq: maxSeq + 1, nodes };
    await this.writeIndex(index);
    return index;
  }

  /** Load the index, rebuilding from .md files if it is missing or unreadable. */
  async load(): Promise<GraphIndex> {
    try {
      return await this.loadIndex();
    } catch {
      return await this.rebuildIndex();
    }
  }
```

Note: `path` is imported for parity with future tasks; if your linter flags it as unused here, it is used in Plan 02. Leave it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/graph/store.rebuild.test.ts`
Expected: PASS — 3 tests pass. Run `npm test` — all pass.

- [ ] **Step 5: Commit**

```bash
git add src/graph/store.ts test/graph/store.rebuild.test.ts
git commit -m "feat(graph): rebuildIndex from .md files + load-or-rebuild"
```

---

### Task 8: GraphStore — single-writer queue (concurrency safety)

**Files:**
- Modify: `src/graph/store.ts`
- Test: `test/graph/store.concurrency.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/graph/store.concurrency.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GraphStore } from "../../src/graph/store.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let baseDir: string;
let store: GraphStore;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "searcher-"));
  store = new GraphStore(baseDir, "proj1");
  await store.createProject("AI security");
});
afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

describe("GraphStore concurrent writes", () => {
  it("ten parallel addFinding calls produce ten distinct ids and a consistent index", async () => {
    const tasks = Array.from({ length: 10 }, (_, i) =>
      store.addFinding({ parents: ["topic"], question: `Q${i}`, body: `A${i}`, sources: [] }),
    );
    const created = await Promise.all(tasks);
    const ids = created.map((n) => n.id);
    expect(new Set(ids).size).toBe(10); // no duplicate ids

    const index = await store.loadIndex();
    expect(index.nextSeq).toBe(11);
    expect(index.nodes).toHaveLength(11); // topic + 10
    // every created node id is present in the index exactly once
    for (const id of ids) {
      expect(index.nodes.filter((n) => n.id === id)).toHaveLength(1);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/graph/store.concurrency.test.ts`
Expected: FAIL — without serialization, parallel `addFinding` calls read the same `nextSeq`, producing duplicate ids and/or a `nextSeq` < 11 and missing index entries.

- [ ] **Step 3: Add a serialized write queue and route `addFinding` through it**

In `src/graph/store.ts`, add a private field and helper to the class (place the field right after the constructor parameters region, e.g. as the first class member):

```typescript
  /** Serializes all mutating operations so concurrent writers can't race on the index. */
  private writeChain: Promise<unknown> = Promise.resolve();

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(fn, fn); // run regardless of a prior failure
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
```

Then wrap the body of `addFinding`. Rename the current method body into the queue. Replace the entire `addFinding` method with:

```typescript
  async addFinding(input: {
    parents: string[];
    anchor?: import("./types.js").Anchor;
    question: string;
    body: string;
    sources: string[];
  }): Promise<ResearchNode> {
    return this.enqueue(async () => {
      const index = await this.loadIndex();
      const id = `n_${index.nextSeq}`;
      const node: ResearchNode = {
        id,
        kind: "finding",
        parents: input.parents,
        question: input.question,
        sources: input.sources,
        created: new Date().toISOString(),
        body: input.body,
      };
      if (input.anchor) node.anchor = input.anchor;

      await fs.writeFile(nodePath(this.baseDir, this.projectId, id), nodeToMarkdown(node), "utf8");
      index.nextSeq += 1;
      index.nodes.push(metaOf(node));
      await this.writeIndex(index);
      return node;
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/graph/store.concurrency.test.ts`
Expected: PASS — 1 test passes (10 distinct ids, nextSeq=11, 11 index nodes). Run `npm test` — all suites pass.

- [ ] **Step 5: Commit**

```bash
git add src/graph/store.ts test/graph/store.concurrency.test.ts
git commit -m "feat(graph): serialize mutations through a single-writer queue"
```

---

## Self-Review

**Spec coverage (Plan 01's slice — the graph store):**
- Node = markdown + frontmatter (id, kind, parents, anchor, question, sources, created, body) → Task 2 (types), Task 3 (serialize). ✓
- Anchor with text/offset/occurrence → Task 2, Task 3, Task 6. ✓
- Synthetic topic node, empty parents, findings as children → Task 5, Task 6. ✓
- `graph.json` is a rebuildable index; frontmatter authoritative → Task 7 (`rebuildIndex`, `load`). ✓
- Write `.md` first, then index → Task 6, Task 8. ✓
- Single-writer queue for concurrency → Task 8. ✓
- One-research-project-per-folder layout → Task 4 (paths), Task 5. ✓
- *Deferred to later plans (correctly out of scope here):* Claude runner, HTTP API, SSE, frontend, synthesize, one-command run, preflight/env-scrub. These are Plans 02–03.

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows complete code; every run step shows the exact command and expected result. ✓

**Type consistency:** `GraphStore(baseDir, projectId)` constructor, `createProject`, `getNode`, `loadIndex`, `writeIndex`, `rebuildIndex`, `load`, `addFinding`, and `enqueue` names are used identically across Tasks 5–8. `metaOf` and `NodeMeta`/`GraphIndex`/`ResearchNode`/`Anchor` match the Task 2 definitions. `addFinding` input shape is identical in Tasks 6 and 8. ✓

---

## Next milestones (not part of this plan)

- **Plan 02 — Claude runner + backend API:** preflight auth + env-scrub, `claude -p` spawn (Windows `.cmd` shim, `cwd`=project folder, `--allowedTools`, `--permission-mode`, `stream-json`), stream parse + sources harvest + trailing claims block, Fastify endpoints (`/topic`, `/branch`, `/project`, `/projects`, `/synthesize`), SSE, static-serve the built frontend on one port, auto-open browser.

  **Data-layer hardening carried over from the Plan 01 final review (do these in Plan 02, where the store is driven concurrently from an HTTP server):**
  - Route `rebuildIndex` through the `GraphStore` write queue (`enqueue`) so a `load()`-triggered rebuild can't interleave with a concurrent `addFinding` index write.
  - Make index writes atomic (write `graph.json.tmp`, then rename) so a crash mid-write can't leave a truncated index — today it's recoverable only via rebuild-on-load.
  - Decide `createProject`'s behavior when the project folder already exists (today it silently overwrites `topic.md`/`graph.json`); guard it before wiring to the `/project` endpoint.
- **Plan 03 — Frontend:** React Flow canvas, node-detail panel, select-text→branch, streaming display, library view, manual cross-linking.
