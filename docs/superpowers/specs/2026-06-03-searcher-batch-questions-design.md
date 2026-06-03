# Searcher — Batched Annotation Questions (GitHub-Review-Style) Design

**Date:** 2026-06-03
**Status:** Approved (design phase)
**Builds on:** `2026-06-02-searcher-research-canvas-design.md`

## Goal

Let the user read any node (the root/topic answer **and** every finding) as a document they
annotate in place: select a span of text, attach one or more questions to it, stage several
across the node, then run them all at once — the GitHub pull-request "review" pattern. Each
question still becomes a branch node in the existing graph. This replaces the current
one-question-at-a-time flow with a single, consistent staged-batch flow.

## What stays the same

- **Graph data model is unchanged.** Every question produces a `ResearchNode` finding with
  `parents: [parentId]`, an `anchor` (`{ text, offset, occurrence }`), `question`, `sources`,
  and the answer `body`. A batch of N questions creates N such finding nodes.
- **Result shape: siblings.** All questions asked about a node create direct children of that
  node. Three questions → three sibling children. No intermediate "review" node.
- **Engine unchanged.** Each question runs through the existing `claude -p` runner (Sonnet,
  `--strict-mcp-config`, subscription/OAuth, env-scrubbed). No new model or billing path.

## What changes

### 1. Flow: batch-only

The current "select text → ask one question → it runs immediately" path is **removed**. The only
path is:

```
select span → "Add question" → type → it joins the pending list
... repeat for as many spans / questions as desired ...
→ "Run all N" → all fire in parallel → N sibling nodes appear
```

A single question is simply a batch of one (`Add`, then `Run all 1`).

### 2. Pending questions are client-side state

A "pending question" is an un-run staged item. It is **never persisted to the graph** and costs
nothing. It is held in the browser and saved to **`localStorage`, keyed per `(projectId, nodeId)`**,
so reloading the page or switching to another node and back preserves the staged list (mirrors
GitHub's pending-review behavior). Pending items are cleared from `localStorage` for a node once
their batch runs successfully.

A pending question is:

```ts
interface PendingQuestion {
  id: string;          // client-generated, e.g. crypto.randomUUID()
  anchor: Anchor;      // { text, offset, occurrence } into the node body
  question: string;
  error?: string;      // set if a prior Run attempt failed for this item
}
```

### 3. Persistent "explored" highlights

When a node's body is rendered, every existing child's `anchor` is drawn as a **persistent
highlight** (distinct visual style from pending highlights). Clicking a persistent highlight
selects/navigates to the corresponding child node in the graph. This is the always-on
"this passage has been explored" / comment-thread affordance, and it is derived entirely from
existing `anchor` data — no new persisted fields.

Highlight styles are visually distinct:
- **Pending** (staged, not yet run): e.g. dashed/amber underline with the pending item's number.
- **Explored** (has a child node): e.g. solid/blue background, clickable.

## Architecture

### Backend: one new endpoint + one new service method

**Service** — add `batchBranch` to `ResearchService` (`src/service.ts`):

```ts
interface BatchItem { parentId: string; anchor: Anchor; question: string; }
interface BatchOutcome {
  created: ResearchNode[];                       // successful, in input order
  failures: { index: number; error: string }[]; // per-item failures, by input index
}

async batchBranch(projectId: string, items: BatchItem[]): Promise<BatchOutcome>;
```

- Runs each item through the **existing** `branch()` method via `Promise.allSettled` so the calls
  execute in parallel and one failure does not abort the others.
- `fulfilled` results go into `created`; `rejected` results become `failures` with their input
  `index` and the error message.
- No change to `branch()` internals — `batchBranch` is a thin parallel wrapper. (Note: `branch()`
  appends a finding node to the graph store; the store's writes must be safe under the concurrent
  fan-out — see "Write safety" below.)

**Write safety:** The graph store's index update / id allocation (`nextSeq`) must not corrupt under
concurrent `addFinding` calls from `Promise.allSettled`. The store currently allocates ids and
rewrites the index per finding. To keep the batch correct without a broader refactor,
`batchBranch` **serializes the `store.addFinding` persistence step** while still running the
**`claude -p` calls in parallel**: fan out all runner calls concurrently, collect answers, then
write the resulting findings to the store sequentially. This preserves the "3 questions ≈ wall-clock
of 1" benefit (the slow part is the model calls) while avoiding index races. This is the
already-noted "atomic index writes + queue-serialized rebuild" carryover, scoped to this feature.

**HTTP** — add to `src/server/app.ts`:

```
POST /api/projects/:id/branch-batch
body: { items: { parentId: string; anchor: Anchor; question: string }[] }
→ 200 { created: ResearchNode[], failures: { index, error }[] }
→ 400 if items is empty or malformed
```

### Frontend: NodeDetail becomes an annotation surface

`web/src/components/NodeDetail.tsx` (and a small new `usePendingQuestions` hook +
`web/src/api.ts` client method):

- **Selection capture:** on text selection within the rendered body, show an "Add question"
  popover anchored near the selection. On submit, compute the `Anchor` (existing
  `computeAnchor`) and append a `PendingQuestion`.
- **Pending gutter:** a right-hand list of numbered pending items for the current node. Each row
  shows the anchored snippet + the question, with **edit** and **delete** controls, and an inline
  **error** note if its last run failed.
- **Run control:** a button labeled **"Run all N →"** (N = pending count) so the user always sees
  how many usage calls they are committing before any spend. Disabled while a batch is in flight.
- **On Run:** POST the batch. On response:
  - For each `created` node: remove its pending item, refresh the graph (new sibling nodes appear),
    and the node's span becomes a persistent "explored" highlight.
  - For each `failure`: keep its pending item, set `error` so the user can retry just those.
- **Persistence:** the pending list is mirrored to `localStorage` under a key like
  `searcher:pending:{projectId}:{nodeId}`; loaded on mount, saved on change, the node's entry
  cleared when its list empties.
- **Highlight rendering:** the body renderer overlays both pending highlights (from local state)
  and explored highlights (from the node's children's anchors). Clicking an explored highlight
  triggers selection of that child in the graph view (existing selection mechanism).

## Data flow (batch run)

```
NodeDetail (pending list, N items)
   └─ POST /api/projects/:id/branch-batch { items }
        └─ ResearchService.batchBranch
             ├─ Promise.allSettled( items.map → claude -p branch call )   // parallel
             └─ for each fulfilled answer: store.addFinding(...)          // serialized writes
        ← { created[], failures[] }
   ├─ created → clear those pending items, refresh graph, draw explored highlights
   └─ failures → keep pending items with .error for retry
```

## Error handling

- **Empty / malformed batch:** endpoint returns 400; UI disables Run when N = 0.
- **Partial failure:** successes persist as nodes; failures remain staged with an error note.
  Re-running re-submits only the still-pending (failed) items.
- **Whole-request failure (network / server):** all pending items kept; a single batch-level
  error is shown; nothing is lost (localStorage still holds them).
- **Anchor no longer matches** (e.g. body changed): `computeAnchor` already records
  `occurrence`; if a span cannot be located at run time the item fails like any other and stays
  pending with an explanatory error.

## Testing

All tests use the injectable fake runner — **no real `claude -p` spend**.

1. **`service.batchBranch` — happy path:** fake runner returns distinct answers for 3 items;
   assert 3 findings created as siblings of the parent, in input order, with correct anchors.
2. **`service.batchBranch` — partial failure:** fake runner throws for item index 1; assert
   `created` has the 2 successes and `failures` contains `{ index: 1, error }`; assert the store
   ends with exactly 2 new nodes (no corruption from the rejected item).
3. **`service.batchBranch` — write serialization:** with a fake runner resolving out of order,
   assert all successful findings persist and `nextSeq` / ids are unique and contiguous.
4. **Anchor → explored-highlight rendering:** a node with two children whose anchors point into
   the body renders two explored highlights at the right offsets.
5. **API client:** `branchBatch(projectId, items)` posts the correct shape and parses
   `{ created, failures }`.
6. **Pending persistence (hook):** adding items writes to `localStorage`; remounting restores
   them; clearing on success removes the node's entry.

## Out of scope (deferred)

- Threaded follow-ups *inside* a pending item (a pending item is a single question).
- Reordering pending questions (delete + re-add if needed).
- Server-side persistence of pending questions (client `localStorage` only).
- Live token streaming of batch answers (still the deferred `stream-json` fast-follow).
- Manual cross-link UI and per-node cost UI (unchanged carryovers from v1).

## File structure (created / modified)

- **Modify** `src/service.ts` — add `BatchItem`, `BatchOutcome`, `batchBranch`.
- **Modify** `src/server/app.ts` — add `POST /api/projects/:id/branch-batch`.
- **Modify** `web/src/api.ts` — add `branchBatch` client method + types.
- **Create** `web/src/usePendingQuestions.ts` — localStorage-backed pending-list hook.
- **Modify** `web/src/components/NodeDetail.tsx` — selection popover, pending gutter, Run-all,
  pending + explored highlight rendering.
- **Test** `src/service.batchBranch.test.ts`, `web/src/usePendingQuestions.test.ts`, and additions
  to `web/src/api.test.ts` / a NodeDetail highlight test.
