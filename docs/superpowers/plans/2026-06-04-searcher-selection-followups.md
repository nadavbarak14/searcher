# Selection-Anchored Follow-ups (Left→Right Canvas) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Searcher's canvas a left→right tree of full-answer nodes where selecting a span of text inside a node surfaces a "Follow up" button that spawns a child research node anchored to that span (highlighted in the parent, edge pinned to it).

**Architecture:** All work is frontend. Pure, unit-tested helpers (`layout`, `anchor`, `highlight`, `model`) carry the logic; React Flow wiring in `Canvas.tsx`/`ResearchNodeCard.tsx` is verified by typecheck + build + a manual smoke pass (no real `claude -p` runs in dev — that spends subscription usage). The backend anchor pipeline (`/branch` route → `service.branch` → serialize → `api.branch`) **already works end-to-end**; Phase 2 only adds a regression test for it. Phases are ordered so each ships working software and the risky per-span edge-pinning is isolated in the final phase behind a working fallback.

**Tech Stack:** TypeScript, React 18, `@xyflow/react` (React Flow), Vitest. Single root `package.json`. Tests colocated next to source (`web/src/graph/*.test.ts`).

**Spec:** `docs/superpowers/specs/2026-06-04-searcher-selection-followups-design.md`

**Commands (memorize):**
- Run one test file: `npx vitest run web/src/graph/<file>.test.ts`
- Run all tests: `npm test`
- Typecheck (server + web): `npm run typecheck`
- Full build (typecheck + vite build): `npm run build`

---

## File Structure

**New files:**
- `web/src/graph/anchor.ts` — pure anchor math: `anchorKey`, `anchorFromSelection`, `locateAnchor`. (+ `anchor.test.ts`)
- `web/src/graph/highlight.ts` — pure `highlightSegments(body, anchors)` → render-ready segments. (+ `highlight.test.ts`)

**Modified files:**
- `web/src/graph/layout.ts` — flip layout to left→right; export `COL_W`/`ROW_H`. (+ `layout.test.ts`)
- `web/src/graph/model.ts` — drafts, pending-anchor, per-node child-anchors, edge `sourceHandle`. (+ `model.test.ts`)
- `web/src/components/ResearchNodeCard.tsx` — Left/Right handles; text-selection → "Follow up" button; draft compose card; `<mark>` highlights; per-anchor source handles.
- `web/src/components/Canvas.tsx` — thread `anchor` through `ask`; draft state; wire new card props; per-anchor handle measurement.
- `src/claude/prompts.ts` — (Phase 5, separable) richer root prompt for full-answer path nodes.

**Interfaces locked here (used across tasks):**

```ts
// web/src/types.ts — ALREADY EXISTS, do not redefine:
export interface Anchor { text: string; offset: number; occurrence: number }

// web/src/graph/anchor.ts — anchorKey(a) === `a${a.occurrence}_${a.offset}`
// web/src/graph/model.ts — new exports:
export interface DraftNode { id: string; parentId: string; anchor: Anchor }
// PendingNode gains:  anchor?: Anchor
// CanvasEdge gains:   sourceHandle?: string
// CanvasNode gains:   draft?: boolean; anchor?: Anchor; anchors?: Anchor[]
```

---

## Phase 1 — Left→Right layout + handle sides

Ships: the existing canvas, unchanged in behavior, but growing rightward with edges entering on the left and leaving on the right.

### Task 1: Flip `layoutNodes` to left→right

**Files:**
- Modify: `web/src/graph/layout.ts`
- Test: `web/src/graph/layout.test.ts`

- [ ] **Step 1: Rewrite the failing tests for horizontal growth**

Replace the body of the first two `it(...)` blocks in `web/src/graph/layout.test.ts` so they assert depth→x and siblings→y. Keep the existing `meta()` helper and any cycle/multi-parent tests; only the directional assertions change.

```ts
describe("layoutNodes", () => {
  it("puts the topic at x=0 and children in deeper columns to the right", () => {
    const pos = layoutNodes([meta("topic", []), meta("n_1", ["topic"]), meta("n_2", ["topic"])]);
    expect(pos.topic.x).toBe(0);
    expect(pos.n_1.x).toBeGreaterThan(0);
    expect(pos.n_2.x).toBe(pos.n_1.x); // siblings share a column (x)
    expect(pos.n_1.y).not.toBe(pos.n_2.y); // and are spread vertically
  });

  it("places a grandchild in a column further right than its parent", () => {
    const pos = layoutNodes([meta("topic", []), meta("n_1", ["topic"]), meta("n_2", ["n_1"])]);
    expect(pos.n_2.x).toBeGreaterThan(pos.n_1.x);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run web/src/graph/layout.test.ts`
Expected: FAIL (current code sets `y` by depth, so `n_1.x === n_2.x` is false / `topic.x` assertions fail).

- [ ] **Step 3: Rewrite `layout.ts` to grow rightward and export the gaps**

Replace the constants and the final placement loop in `web/src/graph/layout.ts`. Keep `depthOf` and the `rows`/grouping logic exactly as-is (it groups ids by depth correctly); only the constants, the doc comment, and the coordinate assignment change.

```ts
import type { NodeMeta } from "../types";

export const COL_W = 480; // x gap between depth columns (answer nodes are wide)
export const ROW_H = 200; // y gap between siblings within a column

/**
 * Layered tree layout, growing LEFT→RIGHT. The topic sits at column 0 (x=0); a node's
 * column is 1 + the shallowest resolvable parent. Siblings in a column are spread
 * vertically, centered on y=0. Used only to place nodes that have no saved position yet.
 */
export function layoutNodes(metas: NodeMeta[]): Record<string, { x: number; y: number }> {
  const byId = new Map(metas.map((m) => [m.id, m]));
  const depthCache = new Map<string, number>();

  const depthOf = (id: string, seen: Set<string> = new Set()): number => {
    if (id === "topic") return 0;
    const cached = depthCache.get(id);
    if (cached !== undefined) return cached;
    if (seen.has(id)) return 1; // cycle guard
    seen.add(id);
    const m = byId.get(id);
    const parents = m?.parents.filter((p) => byId.has(p)) ?? [];
    const d = parents.length ? 1 + Math.min(...parents.map((p) => depthOf(p, seen))) : 1;
    depthCache.set(id, d);
    return d;
  };

  const cols = new Map<number, string[]>();
  for (const m of metas) {
    const d = depthOf(m.id);
    const col = cols.get(d) ?? cols.set(d, []).get(d)!;
    col.push(m.id);
  }

  const out: Record<string, { x: number; y: number }> = {};
  for (const [d, ids] of cols) {
    ids.forEach((id, i) => {
      out[id] = { x: d * COL_W, y: (i - (ids.length - 1) / 2) * ROW_H };
    });
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run web/src/graph/layout.test.ts`
Expected: PASS (all cases, including any retained cycle/multi-parent tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/graph/layout.ts web/src/graph/layout.test.ts
git commit -m "feat(web): left→right tree layout; export COL_W/ROW_H"
```

### Task 2: Move React Flow handles to Left (target) / Right (source)

**Files:**
- Modify: `web/src/components/ResearchNodeCard.tsx` (three handle pairs: pending node ~lines 185/209, topic node ~227/238, finding node ~260/315)

- [ ] **Step 1: Swap every handle's `position`**

In `web/src/components/ResearchNodeCard.tsx`, change **every** `<Handle type="target" position={RFPosition.Top} />` to `position={RFPosition.Left}` and **every** `<Handle type="source" position={RFPosition.Bottom} />` to `position={RFPosition.Right}`. There are three pairs (pending, topic, finding). Leave everything else untouched.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no type errors).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Manual smoke**

Start the app (`npm run dev:web`), open an existing project, confirm: nodes lay out left→right, the topic is leftmost, expanding a node reveals children to its right, and edges connect right-edge → left-edge. Drag a node and reload — position persists.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ResearchNodeCard.tsx
git commit -m "feat(web): node handles on Left/Right for horizontal canvas"
```

---

## Phase 2 — Select → "Follow up" → draft node → branch (with anchor)

Ships: selecting text in an expanded node shows a "Follow up" button; clicking it creates a draft child card (to the right) with a compose box; submitting fires `claude -p` with the anchor and the answer lands as a real node. Interim: the draft/child edge leaves the node's right-mid handle (per-span pinning is Phase 4).

### Task 3: Pure anchor helpers

**Files:**
- Create: `web/src/graph/anchor.ts`
- Test: `web/src/graph/anchor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { anchorKey, anchorFromSelection, locateAnchor } from "./anchor";

describe("anchorFromSelection", () => {
  it("records text, offset, and 0-based occurrence", () => {
    const body = "alpha beta alpha gamma";
    // second "alpha" starts at index 11
    const a = anchorFromSelection(body, "alpha", 11);
    expect(a).toEqual({ text: "alpha", offset: 11, occurrence: 1 });
  });
  it("treats the first match as occurrence 0", () => {
    expect(anchorFromSelection("one two", "one", 0)).toEqual({ text: "one", offset: 0, occurrence: 0 });
  });
});

describe("locateAnchor", () => {
  it("finds the occurrence-th match", () => {
    const body = "alpha beta alpha gamma";
    expect(locateAnchor(body, { text: "alpha", offset: 11, occurrence: 1 })).toEqual({ start: 11, end: 16 });
  });
  it("falls back to offset when occurrence is gone but offset still matches", () => {
    const body = "xx alpha yy";
    expect(locateAnchor(body, { text: "alpha", offset: 3, occurrence: 5 })).toEqual({ start: 3, end: 8 });
  });
  it("returns null when the text is absent", () => {
    expect(locateAnchor("nothing here", { text: "zzz", offset: 0, occurrence: 0 })).toBeNull();
  });
});

describe("anchorKey", () => {
  it("is stable per (occurrence, offset)", () => {
    expect(anchorKey({ text: "x", offset: 11, occurrence: 1 })).toBe("a1_11");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run web/src/graph/anchor.test.ts`
Expected: FAIL with "Cannot find module './anchor'".

- [ ] **Step 3: Implement `anchor.ts`**

```ts
import type { Anchor } from "../types";

/** Stable id for an anchored span, used as a React Flow sourceHandle id and a <mark> key. */
export function anchorKey(a: Anchor): string {
  return `a${a.occurrence}_${a.offset}`;
}

/** Build an Anchor from a selection: 0-based occurrence = count of earlier matches before startIndex. */
export function anchorFromSelection(body: string, selectedText: string, startIndex: number): Anchor {
  let occurrence = 0;
  let from = 0;
  let idx = body.indexOf(selectedText, from);
  while (idx !== -1 && idx < startIndex) {
    occurrence++;
    from = idx + 1;
    idx = body.indexOf(selectedText, from);
  }
  return { text: selectedText, offset: startIndex, occurrence };
}

/** Resolve an anchor back to a [start,end) range: prefer the occurrence-th match, fall back to offset. */
export function locateAnchor(body: string, a: Anchor): { start: number; end: number } | null {
  if (!a.text) return null;
  let from = 0;
  let idx = -1;
  for (let i = 0; i <= a.occurrence; i++) {
    idx = body.indexOf(a.text, from);
    if (idx === -1) break;
    from = idx + 1;
  }
  if (idx !== -1) return { start: idx, end: idx + a.text.length };
  if (body.substr(a.offset, a.text.length) === a.text) return { start: a.offset, end: a.offset + a.text.length };
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run web/src/graph/anchor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/graph/anchor.ts web/src/graph/anchor.test.ts
git commit -m "feat(web): pure anchor helpers (key, fromSelection, locate)"
```

### Task 4: Verify the backend anchor round-trip (regression test)

**Files:**
- Test: add one case to the existing service test (find it: `ls test/**/*service* src/**/*service*` — the service test lives under `test/`).

- [ ] **Step 1: Locate the existing branch test**

Run: `grep -rn "branch(" test | grep -i anchor` and `grep -rln "service" test`
Expected: find the service test file that already exercises `branch`. (Confirms the harness/fake-runner pattern to copy.)

- [ ] **Step 2: Add a failing-then-passing assertion that anchor persists**

Add a test that calls `service.branch(projectId, { parentId, question, anchor: { text: "X", offset: 0, occurrence: 0 } })` with the injected fake runner and asserts the returned node's `anchor` equals that anchor (round-tripped through the store). Mirror the existing test's setup exactly (same fake `RunFn`, same temp dir helper).

```ts
it("persists the anchor on a branched child", async () => {
  // ...reuse the file's existing service + fake-runner + temp-dir setup...
  const anchor = { text: "selected span", offset: 4, occurrence: 0 };
  const child = await service.branch(projectId, { parentId: "topic", question: "why?", anchor });
  expect(child.anchor).toEqual(anchor);
});
```

- [ ] **Step 3: Run it**

Run: `npm test`
Expected: PASS (the backend already supports this — this test locks it against regression). If it fails, STOP and re-read `src/service.ts:80-100` and `serialize.ts` before changing anything.

- [ ] **Step 4: Commit**

```bash
git add -A test
git commit -m "test: lock branch() anchor round-trip"
```

### Task 5: Model support for drafts + pending anchors

**Files:**
- Modify: `web/src/graph/model.ts`
- Test: `web/src/graph/model.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `web/src/graph/model.test.ts` (reuse its existing `meta()`/input helpers; pass `drafts: []` to existing `buildCanvas` calls if TS complains about the new optional field — it is optional, so existing calls keep working):

```ts
it("renders a draft child node and edge under its expanded parent", () => {
  const metas = [meta("topic", []), meta("n_1", ["topic"])];
  const { nodes, edges } = buildCanvas({
    metas, expanded: new Set(["topic", "n_1"]), bodies: { n_1: "body" },
    pending: [], positions: {},
    drafts: [{ id: "draft_0", parentId: "n_1", anchor: { text: "body", offset: 0, occurrence: 0 } }],
  });
  const draft = nodes.find((n) => n.id === "draft_0");
  expect(draft?.draft).toBe(true);
  expect(draft?.anchor?.text).toBe("body");
  expect(edges.some((e) => e.source === "n_1" && e.target === "draft_0")).toBe(true);
});

it("hides a draft whose parent is collapsed", () => {
  const metas = [meta("topic", []), meta("n_1", ["topic"])];
  const { nodes } = buildCanvas({
    metas, expanded: new Set(["topic"]), bodies: {}, pending: [], positions: {},
    drafts: [{ id: "draft_0", parentId: "n_1", anchor: { text: "x", offset: 0, occurrence: 0 } }],
  });
  expect(nodes.find((n) => n.id === "draft_0")).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run web/src/graph/model.test.ts`
Expected: FAIL (TS/`draft` undefined; `drafts` not accepted).

- [ ] **Step 3: Extend `model.ts`**

In `web/src/graph/model.ts`: import `Anchor`; add the `anchor?` field to `PendingNode`; add `DraftNode`; add `draft?`/`anchor?` to `CanvasNode`; accept `drafts` in `buildCanvas`; emit draft nodes+edges with the same visibility gate used for pending (`visible.has(parentId) && expanded.has(parentId)`).

```ts
import type { NodeMeta, Position, Anchor } from "../types";

export interface PendingNode { id: string; parentId: string; question: string; error?: string; anchor?: Anchor }
export interface DraftNode { id: string; parentId: string; anchor: Anchor }

export interface CanvasNode {
  id: string;
  kind: "topic" | "finding";
  title: string;
  expanded: boolean;
  pending: boolean;
  draft?: boolean;
  anchor?: Anchor;
  parentId?: string;
  body?: string;
  sources?: string[];
  childCount?: number;
  error?: string;
  position?: Position;
}
export interface CanvasEdge { id: string; source: string; target: string; label?: string }
```

Add `drafts` to the input type and (after the existing pending loop) a draft loop:

```ts
export function buildCanvas(input: {
  metas: NodeMeta[];
  expanded: Set<string>;
  bodies: Record<string, string>;
  sources?: Record<string, string[]>;
  pruned?: Set<string>;
  pending: PendingNode[];
  drafts?: DraftNode[];
  positions: Record<string, Position>;
}): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  // ...existing destructuring; add:
  const drafts = input.drafts ?? [];
  // ...existing visibility + nodes/edges + pending loop unchanged...

  for (const dr of drafts) {
    if (pruned.has(dr.id)) continue;
    if (!(visible.has(dr.parentId) && expanded.has(dr.parentId))) continue;
    const node: CanvasNode = {
      id: dr.id, kind: "finding", title: "", expanded: true, pending: false,
      draft: true, anchor: dr.anchor, parentId: dr.parentId,
    };
    nodes.push(node);
    edges.push({ id: `${dr.parentId}->${dr.id}`, source: dr.parentId, target: dr.id });
  }

  return { nodes, edges };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run web/src/graph/model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/graph/model.ts web/src/graph/model.test.ts
git commit -m "feat(web): model support for draft nodes and pending anchors"
```

### Task 6: Card — selection → "Follow up" button + draft compose UI

**Files:**
- Modify: `web/src/components/ResearchNodeCard.tsx`

- [ ] **Step 1: Add the new `CardData` fields**

Add `import type { Anchor } from "../types";` at the top of the file, then extend the `CardData` interface with:

```ts
  id?: string;          // node id (used for updateNodeInternals in Phase 4)
  draft?: boolean;
  anchorText?: string;  // for a draft card: the quoted span it branches from
  anchors?: Anchor[];   // child-anchors to highlight (Phase 3)
  onFollowUp?: (anchor: Anchor) => void;
  onDraftSubmit?: (question: string) => void; // draft: fire the branch
  onDraftCancel?: () => void;                  // draft: discard
```

- [ ] **Step 2: Render the draft compose card**

Near the top of `ResearchNodeCardImpl`, before the pending branch, add a draft branch that renders a compose card (quoted span + textarea + Ask/Cancel). It reuses the page's `.field`/`.btn` classes.

```tsx
  if (d.draft) {
    return <DraftCard anchorText={d.anchorText ?? ""} onSubmit={d.onDraftSubmit!} onCancel={d.onDraftCancel!} />;
  }
```

Add the `DraftCard` component (above `ResearchNodeCardImpl`):

```tsx
function DraftCard({ anchorText, onSubmit, onCancel }: { anchorText: string; onSubmit: (q: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState("");
  const submit = () => { const q = draft.trim(); if (q) onSubmit(q); };
  return (
    <div style={{ position: "relative", width: 320, background: "var(--card)", borderRadius: "var(--r-lg)", border: "1px dashed var(--accent-line)", boxShadow: "var(--shadow-md)", padding: "16px 18px" }}>
      <Handle type="target" position={RFPosition.Left} />
      <div className="eyebrow" style={{ color: "var(--accent-deep)", marginBottom: 8 }}>↳ Follow up</div>
      {anchorText && (
        <blockquote className="serif nodrag" style={{ margin: "0 0 12px", paddingLeft: 10, borderLeft: "2px solid var(--accent-line)", fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.4 }}>
          “{anchorText.length > 140 ? anchorText.slice(0, 139) + "…" : anchorText}”
        </blockquote>
      )}
      <textarea autoFocus value={draft} rows={2} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } if (e.key === "Escape") onCancel(); }}
        placeholder="Ask about this selection — Claude answers here…" className="field nodrag"
        style={{ fontSize: 13.5, resize: "none", lineHeight: 1.45 }} />
      <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost btn-sm nodrag" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary btn-sm nodrag" disabled={!draft.trim()} onClick={submit}><Icon name="sparkle" size={14} /> Ask</button>
      </div>
      <Handle type="source" position={RFPosition.Right} />
    </div>
  );
}
```

- [ ] **Step 3: Add the selection listener + floating "Follow up" button to the expanded finding body**

In the finding branch, wrap the expanded-body block with a positioned container and a body `ref`. On `mouseUp`, read the selection, compute the char offset within the body, build the anchor via `anchorFromSelection`, and show a button at the selection rect. Add this helper above the component:

```tsx
import { anchorFromSelection } from "../graph/anchor";

// char offset of a node/offset pair within container.textContent
function offsetWithin(container: HTMLElement, node: Node, nodeOffset: number): number {
  let total = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (n === node) return total + nodeOffset;
    total += (n.textContent ?? "").length;
  }
  return total;
}
```

Inside `ResearchNodeCardImpl` (finding branch) add local state and a handler:

```tsx
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [sel, setSel] = useState<{ anchor: Anchor; top: number; left: number } | null>(null);

  const onBodyMouseUp = () => {
    const s = window.getSelection();
    const body = bodyRef.current;
    if (!s || s.isCollapsed || !body) { setSel(null); return; }
    const range = s.getRangeAt(0);
    if (!body.contains(range.startContainer) || !body.contains(range.endContainer)) { setSel(null); return; }
    const text = s.toString();
    if (!text.trim()) { setSel(null); return; }
    const start = offsetWithin(body, range.startContainer, range.startOffset);
    const anchor = anchorFromSelection(body.textContent ?? "", text, start);
    const r = range.getBoundingClientRect();
    const cardRect = body.getBoundingClientRect();
    setSel({ anchor, top: r.bottom - cardRect.top + 6, left: r.left - cardRect.left });
  };
```

Render the body div with `ref={bodyRef}` and `onMouseUp={onBodyMouseUp}`, and the floating button when `sel` is set and `d.onFollowUp` exists:

```tsx
  {sel && d.onFollowUp && (
    <button className="btn btn-primary btn-sm nodrag" style={{ position: "absolute", top: sel.top, left: sel.left, zIndex: 5, boxShadow: "var(--shadow-md)" }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => { d.onFollowUp!(sel.anchor); window.getSelection()?.removeAllRanges(); setSel(null); }}>
      <Icon name="branch" size={13} /> Follow up
    </button>
  )}
```

Make the finding card's outer `<div>` `position: relative` (it already is) so the absolute button anchors to it; move the `ref`/`onMouseUp` onto the scrollable body div (the one with `maxHeight: 260`).

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS. (If `Anchor` is unused-imported elsewhere, ensure the `import type { Anchor } from "../types"` is present.)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ResearchNodeCard.tsx
git commit -m "feat(web): text-selection Follow-up button + draft compose card"
```

### Task 7: Canvas — draft state + thread anchor through `ask`

**Files:**
- Modify: `web/src/components/Canvas.tsx`

- [ ] **Step 1: Extend `ask` to accept an anchor**

Change the `ask` callback signature to `(parentId, question, anchor?)`, pass the anchor into the optimistic `PendingNode`, and forward it to `api.branch`:

```tsx
  const ask = useCallback(
    async (parentId: string, question: string, anchor?: import("../types").Anchor) => {
      const pid = `pending_${pendSeq.current++}`;
      setPending((p) => [...p, anchor ? { id: pid, parentId, question, anchor } : { id: pid, parentId, question }]);
      setExpanded((prev) => new Set(prev).add(parentId));
      try {
        const created = await api.branch(projectId, parentId, question, anchor);
        setDetails((b) => ({ ...b, [created.id]: { body: created.body, sources: created.sources } }));
        setPending((p) => p.filter((x) => x.id !== pid));
        await onReloadIndex();
        setExpanded((prev) => new Set(prev).add(created.id));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setPending((p) => p.map((x) => (x.id === pid ? { ...x, error: msg } : x)));
      }
    },
    [projectId, onReloadIndex],
  );
```

(`api.branch` already accepts the 4th `anchor` arg — see `web/src/api.ts:18`.)

- [ ] **Step 2: Add draft state and handlers**

```tsx
import { buildCanvas, type PendingNode, type DraftNode } from "../graph/model";
import { COL_W } from "../graph/layout";
// ...
  const [drafts, setDrafts] = useState<DraftNode[]>([]);
  const draftSeq = useRef(0);

  const startFollowUp = useCallback((parentId: string, anchor: import("../types").Anchor) => {
    const id = `draft_${draftSeq.current++}`;
    setDrafts((d) => [...d, { id, parentId, anchor }]);
    setExpanded((prev) => new Set(prev).add(parentId));
  }, []);

  const cancelDraft = useCallback((id: string) => setDrafts((d) => d.filter((x) => x.id !== id)), []);

  const submitDraft = useCallback((draft: DraftNode, question: string) => {
    setDrafts((d) => d.filter((x) => x.id !== draft.id));
    void ask(draft.parentId, question, draft.anchor);
  }, [ask]);
```

- [ ] **Step 3: Auto-place drafts and pass them to `buildCanvas`**

Compute draft positions (to the right of the parent) and merge into the `positions` map; include `drafts` in the `buildCanvas` call:

```tsx
  const draftPositions = useMemo<Record<string, Position>>(() => {
    const out: Record<string, Position> = {};
    for (const dr of drafts) {
      const base = positions[dr.parentId] ?? layout[dr.parentId] ?? { x: 0, y: 0 };
      out[dr.id] = { x: base.x + COL_W, y: base.y };
    }
    return out;
  }, [drafts, positions, layout]);

  const model = useMemo(
    () => buildCanvas({ metas: index.nodes, expanded, bodies, sources, pruned, pending, drafts, positions: { ...positions, ...draftPositions } }),
    [index, expanded, bodies, sources, pruned, pending, drafts, positions, draftPositions],
  );
```

(`layout` and `positions` are already defined above the existing `model` memo; move the `model` memo below `draftPositions`, and ensure `layout` is declared before `draftPositions`.)

- [ ] **Step 4: Wire the new card props in `rfNodes`**

In the `model.nodes.map`, pass the follow-up + draft callbacks:

```tsx
    if (n.kind !== "topic") data.onFollowUp = (anchor) => startFollowUp(n.id, anchor);
    if (n.draft) {
      data.draft = true;
      data.anchorText = n.anchor?.text ?? "";
      const dr = drafts.find((x) => x.id === n.id)!;
      data.onDraftSubmit = (q: string) => submitDraft(dr, q);
      data.onDraftCancel = () => cancelDraft(n.id);
    }
```

Also keep the existing `onAsk` wiring (whole-node ask, no anchor) — it remains the no-selection fallback.

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 6: Manual smoke**

`npm run dev:web`, open a project, expand a finding, select a sentence → a "Follow up" button appears → click it → a draft card appears to the right with the quote → type a question → Ask → spinner → real answer node. Confirm the answer node persists after reload, and that the whole-node "Branch a question from here" box still works.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/Canvas.tsx
git commit -m "feat(web): selection follow-up drafts wired to anchored branch"
```

---

## Phase 3 — Persisted highlight of anchored spans

Ships: spans that have follow-up children are visibly highlighted in the parent body, re-located on reload by `(text, occurrence)`.

### Task 8: Pure `highlightSegments`

**Files:**
- Create: `web/src/graph/highlight.ts`
- Test: `web/src/graph/highlight.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { highlightSegments } from "./highlight";

describe("highlightSegments", () => {
  it("returns one plain segment when there are no anchors", () => {
    expect(highlightSegments("hello world", [])).toEqual([{ text: "hello world", keys: [] }]);
  });
  it("splits a single mid-body anchor into plain/marked/plain", () => {
    const segs = highlightSegments("aa BB cc", [{ text: "BB", offset: 3, occurrence: 0 }]);
    expect(segs).toEqual([
      { text: "aa ", keys: [] },
      { text: "BB", keys: ["a0_3"] },
      { text: " cc", keys: [] },
    ]);
  });
  it("tags an overlapping region with both keys", () => {
    // "abcd": anchor1 = "abc"@0, anchor2 = "bcd"@1 → middle "bc" carries both
    const segs = highlightSegments("abcd", [
      { text: "abc", offset: 0, occurrence: 0 },
      { text: "bcd", offset: 1, occurrence: 0 },
    ]);
    expect(segs).toEqual([
      { text: "a", keys: ["a0_0"] },
      { text: "bc", keys: ["a0_0", "a0_1"] },
      { text: "d", keys: ["a0_1"] },
    ]);
  });
  it("drops anchors whose text is gone", () => {
    expect(highlightSegments("only this", [{ text: "missing", offset: 0, occurrence: 0 }]))
      .toEqual([{ text: "only this", keys: [] }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run web/src/graph/highlight.test.ts`
Expected: FAIL with "Cannot find module './highlight'".

- [ ] **Step 3: Implement `highlight.ts`**

```ts
import type { Anchor } from "../types";
import { anchorKey, locateAnchor } from "./anchor";

export interface Segment { text: string; keys: string[] }

/** Split `body` into ordered segments; each segment lists the anchor keys covering it. Unfound anchors are dropped. */
export function highlightSegments(body: string, anchors: Anchor[]): Segment[] {
  const ranges = anchors
    .map((a) => { const r = locateAnchor(body, a); return r ? { key: anchorKey(a), ...r } : null; })
    .filter((r): r is { key: string; start: number; end: number } => r !== null);

  if (!ranges.length) return body ? [{ text: body, keys: [] }] : [];

  const bounds = new Set<number>([0, body.length]);
  for (const r of ranges) { bounds.add(r.start); bounds.add(r.end); }
  const points = [...bounds].sort((a, b) => a - b);

  const segs: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const s = points[i];
    const e = points[i + 1];
    if (s === e) continue;
    const keys = ranges.filter((r) => r.start <= s && e <= r.end).map((r) => r.key);
    segs.push({ text: body.slice(s, e), keys });
  }
  return segs;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run web/src/graph/highlight.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/graph/highlight.ts web/src/graph/highlight.test.ts
git commit -m "feat(web): pure highlightSegments for anchored spans"
```

### Task 9: Model — collect each node's child-anchors

**Files:**
- Modify: `web/src/graph/model.ts`
- Test: `web/src/graph/model.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("attaches a parent's child-anchors for highlighting", () => {
  const metas: NodeMeta[] = [
    meta("topic", []),
    { ...meta("n_1", ["topic"]), anchor: { text: "span", offset: 0, occurrence: 0 } },
  ];
  const { nodes } = buildCanvas({
    metas, expanded: new Set(["topic"]), bodies: { topic: "" }, pending: [], positions: {}, drafts: [],
  });
  const topic = nodes.find((n) => n.id === "topic")!;
  expect(topic.anchors?.map((a) => a.text)).toEqual(["span"]);
});

it("dedupes child-anchors by key and includes draft anchors", () => {
  const metas = [meta("topic", []), meta("n_1", ["topic"])];
  const dup = { text: "span", offset: 0, occurrence: 0 };
  const { nodes } = buildCanvas({
    metas, expanded: new Set(["topic", "n_1"]), bodies: { n_1: "span here" }, pending: [], positions: {},
    drafts: [{ id: "draft_0", parentId: "n_1", anchor: dup }, { id: "draft_1", parentId: "n_1", anchor: dup }],
  });
  expect(nodes.find((n) => n.id === "n_1")!.anchors?.length).toBe(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run web/src/graph/model.test.ts`
Expected: FAIL (`anchors` undefined on `CanvasNode`).

- [ ] **Step 3: Add `anchors` collection**

Add `anchors?: Anchor[]` to `CanvasNode`, and `import { anchorKey } from "./anchor"`. After building the `nodes` array (and after the pending+draft loops so their anchors are included), attach anchors per parent:

```ts
  // collect, per visible parent, the distinct anchors of its children (real + pending + draft)
  const anchorsByParent = new Map<string, Anchor[]>();
  const seen = new Map<string, Set<string>>();
  const addAnchor = (parentId: string, a?: Anchor) => {
    if (!a) return;
    const key = anchorKey(a);
    const s = seen.get(parentId) ?? seen.set(parentId, new Set()).get(parentId)!;
    if (s.has(key)) return;
    s.add(key);
    (anchorsByParent.get(parentId) ?? anchorsByParent.set(parentId, []).get(parentId)!).push(a);
  };
  for (const m of metas) if (visible.has(m.id)) for (const p of m.parents) if (visible.has(p)) addAnchor(p, m.anchor);
  for (const pn of pending) if (visible.has(pn.parentId) && expanded.has(pn.parentId)) addAnchor(pn.parentId, pn.anchor);
  for (const dr of drafts) if (visible.has(dr.parentId) && expanded.has(dr.parentId)) addAnchor(dr.parentId, dr.anchor);
  for (const node of nodes) { const a = anchorsByParent.get(node.id); if (a) node.anchors = a; }

  return { nodes, edges };
```

(`m.anchor` already exists on `NodeMeta` in `web/src/types.ts`.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run web/src/graph/model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/graph/model.ts web/src/graph/model.test.ts
git commit -m "feat(web): collect per-node child-anchors for highlighting"
```

### Task 10: Card — render `<mark>` highlights from segments

**Files:**
- Modify: `web/src/components/ResearchNodeCard.tsx`
- Modify: `web/src/components/Canvas.tsx` (pass `anchors` into `CardData`)
- Modify: `web/src/styles.css` (a `<mark>` style)

- [ ] **Step 1: Pass `anchors` through to the card**

In `Canvas.tsx` `rfNodes` map, add: `if (n.anchors) data.anchors = n.anchors;`. In `ResearchNodeCard.tsx`, add `anchors?: import("../types").Anchor[];` to `CardData`.

- [ ] **Step 2: Render the body as segments when anchors exist**

In the expanded finding body, replace the plain `{d.body}` render with a segmented render when `d.anchors?.length`. Add `import { highlightSegments } from "../graph/highlight";` and:

```tsx
  const bodyContent = (d.body && d.anchors?.length)
    ? highlightSegments(d.body, d.anchors).map((seg, i) =>
        seg.keys.length
          ? <mark key={i} data-akey={seg.keys[0]} className="anchor-mark">{seg.text}</mark>
          : <span key={i}>{seg.text}</span>)
    : d.body;
```

Render `{d.body === undefined ? <Loading/> : bodyContent}` inside the existing body div (keep the `ref`/`onMouseUp` from Task 6).

- [ ] **Step 3: Add the highlight style**

In `web/src/styles.css`:

```css
.anchor-mark { background: var(--accent-soft); border-bottom: 1.5px solid var(--accent-line); border-radius: 2px; padding: 0 1px; color: inherit; }
```

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 5: Manual smoke**

Create a follow-up off a selection, then collapse/expand the parent (or reload): the selected span stays highlighted. Selecting a *different* span and following up adds a second highlight.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/ResearchNodeCard.tsx web/src/components/Canvas.tsx web/src/styles.css
git commit -m "feat(web): persistent highlight of anchored spans in the parent body"
```

---

## Phase 4 — Pin edges to the anchored span (the risk, with fallback)

Ships the headline behavior: each anchored child's edge leaves the parent at the vertical position of its highlighted span. **Fallback already shipped:** Phases 2–3 leave anchored edges on the default right-mid handle, which is a fully working state. If any step here proves too costly, stop after Task 11 and keep the right-mid edges.

### Task 11: Model — set `sourceHandle` on anchored edges

**Files:**
- Modify: `web/src/graph/model.ts`
- Test: `web/src/graph/model.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("sets sourceHandle to the anchor key on an anchored child edge", () => {
  const metas: NodeMeta[] = [
    meta("topic", []),
    { ...meta("n_1", ["topic"]), anchor: { text: "span", offset: 0, occurrence: 0 } },
  ];
  const { edges } = buildCanvas({
    metas, expanded: new Set(["topic"]), bodies: {}, pending: [], positions: {}, drafts: [],
  });
  const e = edges.find((x) => x.target === "n_1")!;
  expect(e.sourceHandle).toBe("a0_0");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run web/src/graph/model.test.ts`
Expected: FAIL (`sourceHandle` undefined).

- [ ] **Step 3: Add `sourceHandle` to `CanvasEdge` and set it**

Add `sourceHandle?: string` to `CanvasEdge`. In the three edge-pushes (real children, pending, draft), set `sourceHandle: anchorKey(anchor)` when the child/pending/draft has an anchor:

```ts
// real child:
for (const p of m.parents) {
  if (!visible.has(p)) continue;
  const edge: CanvasEdge = { id: `${p}->${m.id}`, source: p, target: m.id };
  if (m.anchor) edge.sourceHandle = anchorKey(m.anchor);
  edges.push(edge);
}
// pending:  if (pn.anchor) edge.sourceHandle = anchorKey(pn.anchor);
// draft:    edge.sourceHandle = anchorKey(dr.anchor);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run web/src/graph/model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/graph/model.ts web/src/graph/model.test.ts
git commit -m "feat(web): edges carry sourceHandle = anchor key"
```

### Task 12: Card — render per-anchor source handles at measured span positions

**Files:**
- Modify: `web/src/components/ResearchNodeCard.tsx`

- [ ] **Step 1: Render a source handle per anchor + keep a default**

In the finding card, render the default right-mid source handle (id omitted → default) **plus** one `Handle` per `d.anchors` entry, keyed by `anchorKey`, absolutely positioned by a measured top. Add `import { useReactFlow } from "@xyflow/react";` and `import { anchorKey } from "../graph/anchor";`.

```tsx
  const markTops = useRef<Record<string, number>>({});
  const { updateNodeInternals } = useReactFlow();

  // after render, measure each mark's top within the card and pin its handle
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || !d.anchors?.length) return;
    let moved = false;
    for (const a of d.anchors) {
      const key = anchorKey(a);
      const mark = card.querySelector<HTMLElement>(`mark[data-akey="${key}"]`);
      if (!mark) continue;
      const top = mark.getBoundingClientRect().top - card.getBoundingClientRect().top;
      const clamped = Math.max(8, Math.min(top, card.offsetHeight - 8)); // clamp into the card
      if (markTops.current[key] !== clamped) { markTops.current[key] = clamped; moved = true; }
    }
    if (moved) updateNodeInternals(d.id as string);
  });
```

Render the handles (inside the finding card, after the body):

```tsx
  <Handle type="source" position={RFPosition.Right} />{/* default, for unanchored edges */}
  {d.expanded && d.anchors?.map((a) => {
    const key = anchorKey(a);
    return <Handle key={key} id={key} type="source" position={RFPosition.Right} style={{ top: markTops.current[key] ?? "50%" }} />;
  })}
```

Add `cardRef` to the finding card's outer div (`ref={cardRef}`), `const cardRef = useRef<HTMLDivElement | null>(null);`, and `id` to `CardData` (`id?: string`) — set it in `Canvas.tsx` (`data.id = n.id;`). Import `useLayoutEffect`.

- [ ] **Step 2: Re-measure on expand/collapse/scroll**

Call `updateNodeInternals(d.id)` inside the body's `onScroll` handler and whenever `d.expanded` changes (the `useLayoutEffect` above already re-runs each render; add `onScroll={() => updateNodeInternals(d.id as string)}` to the scrollable body div). When `d.expanded` is false there are no per-anchor handles, so all edges fall back to the default right handle automatically.

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 4: Manual smoke (the headline behavior)**

Expand a node with two anchored children at different vertical positions: each child's edge should leave the parent at its span's height. Scroll the body — edges track (or clamp to the body edge when the span scrolls out). Collapse the parent — children hide and (when re-expanded) edges re-pin. Confirm no console errors from React Flow about unknown handle ids.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ResearchNodeCard.tsx web/src/components/Canvas.tsx
git commit -m "feat(web): pin child edges to the anchored span's vertical position"
```

---

## Phase 5 — Richer root research (separable / deferrable)

Independent of Phases 1–4. Skip without affecting the interaction work.

### Task 13: Root prompt yields full-answer path nodes

**Files:**
- Modify: `src/claude/prompts.ts:16-28`
- Test: `test/**` (the existing prompts/service test, if present)

- [ ] **Step 1: Update `ROOT_SYSTEM` + `rootPrompt`**

Reword so each finding is a full, self-contained answer for a research path, not a 2–4 sentence finding. Keep the exact `<<<SEARCHER_META … findings[] …>>>` envelope (the parser in `src/service.ts:30-40` depends on `question`/`body`/`sources`).

```ts
export const ROOT_SYSTEM = [
  "You are a research assistant kicking off research on a topic.",
  "Identify 3-5 distinct, important research paths through the topic. Use web search where useful.",
  "For EACH path, write a full, self-contained answer (a few rich paragraphs) that someone could read on its own — not a terse finding.",
  "Return ONLY a metadata block (minimal prose before it) in this exact form:",
  "<<<SEARCHER_META",
  '{ "findings": [ { "question": "the path as a question", "body": "a full multi-paragraph answer", "sources": ["https://..."] }, ... ] }',
  "SEARCHER_META>>>",
  "Output nothing after the closing marker.",
].join("\n\n");

export function rootPrompt(topic: string): string {
  return `Research topic: "${topic}". Identify its key research paths and write a full answer for each.`;
}
```

- [ ] **Step 2: Keep existing tests green**

Run: `npm test`
Expected: PASS. If a prompt test asserts exact `ROOT_SYSTEM` text, update that assertion to match the new copy (it is a copy change, not a contract change — the `findings[]` shape is unchanged).

- [ ] **Step 3: Commit**

```bash
git add src/claude/prompts.ts test
git commit -m "feat: root research returns full-answer path nodes"
```

---

## Final verification

- [ ] **All tests:** `npm test` → PASS
- [ ] **Typecheck + build:** `npm run build` → PASS
- [ ] **End-to-end manual pass:** new topic → full-answer path nodes laid out left→right → expand one → select text → "Follow up" → draft card → ask → answer node appears anchored, span highlighted, edge pinned to the span → drag the child, reload → position + highlight persist.

---

## Self-Review notes (for the executor)

- **Spec coverage:** LR layout (Task 1–2), node=full-answer (Task 13), select→Follow up→child (Task 6–7), anchor reborn/persisted highlight (Task 8–10), anchored edges + fallback (Task 11–12), backend passthrough (already done; locked by Task 4), no-comment-feature (nothing to build). All sections map to tasks.
- **Whole-node ask retained:** the existing `AskBox` ("Branch a question from here") stays as the no-selection fallback; it calls `ask(parentId, question)` with no anchor, so its edge uses the default right handle. This is additive, not a regression.
- **Type consistency:** `anchorKey` = `a${occurrence}_${offset}` everywhere; `DraftNode`/`PendingNode.anchor`/`CanvasEdge.sourceHandle`/`CanvasNode.{draft,anchor,anchors}` defined in Task 5/9/11 and consumed in Tasks 6/7/10/12. `api.branch(id, parentId, question, anchor?)` matches `web/src/api.ts:18`.
- **Risk isolation:** Phases 2–3 ship with right-mid edges (working). Only Task 12 introduces measured per-span handles; if it misbehaves, revert Task 11–12 and the product still works.
