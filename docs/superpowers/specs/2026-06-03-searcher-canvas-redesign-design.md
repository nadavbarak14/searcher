# Searcher Canvas Redesign — Design

**Date:** 2026-06-03
**Status:** Approved (supersedes the batch-questions annotation UX)

## Goal

Turn Searcher's research UI into a movable node canvas. Pressing Search redirects
immediately to a loading canvas; results populate as nodes. Each node can be
expanded (full text + an inline ask box) or collapsed. Asking a question about a
node fires `claude -p` **immediately** and the answer arrives as a new child node,
connected by an edge. Nodes are draggable and their positions **persist durably on
the server**.

## Non-negotiable constraint (carried forward)

Research runs via `claude -p` on the user's **subscription/OAuth only**, never
metered per-token API billing. The spawned-child env scrub
(`ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_BASE_URL`/
`CLAUDE_CODE_USE_BEDROCK`/`CLAUDE_CODE_USE_VERTEX`) and the preflight that refuses
to start when `ANTHROPIC_API_KEY` is set **must remain unchanged**.

## Decisions

- **Canvas:** React Flow (`@xyflow/react`, already a dependency).
- **Node layout:** card-grows-in-place. Collapsed = compact titled card with a
  chevron. Expanded = full body text + inline ask box, and the node's direct child
  result-nodes + edges become visible. A single `expanded` flag drives both body
  and child visibility. Topic starts expanded; findings start collapsed.
- **Questions:** whole-node (no text-selection anchoring). Edge runs parent → result;
  the question text is the edge label.
- **Immediate fire:** asking creates an optimistic pending node (spinner) edged from
  the parent, then `POST /branch`. On success it becomes a real, expandable,
  re-questionable node. On failure it shows the error + a retry.
- **Positions:** durable, server-side. `position?: {x,y}` is stored in each node's
  markdown frontmatter (source of truth) and mirrored into the index. Saved on
  drag-stop (debounced) via `PATCH /positions`, through the store's existing write
  queue so it is race-safe.
- **Expanded/collapsed:** session-only in-memory state (not persisted).
- **Bodies:** the index payload carries titles only; a node's body is fetched lazily
  the first time it is expanded (`GET /nodes/:id`) and cached in memory.
- **Removed (dead under the new model):** `branch-batch` route, `service.batchBranch`,
  `api.branchBatch`; web files `NodeDetail`, `GraphView`, `highlights`, `anchor`,
  `pendingStore`, `usePendingQuestions`; the unused `react-markdown` dependency.
  Text-selection anchoring is dropped (`anchor` stays an optional field for backward
  compatibility with already-saved nodes, but new branches never set it).

## Views (App state machine: `home | loading | canvas`)

1. **home** — topic input + Search, plus existing-project list. Opening an existing
   project goes straight to `canvas` (no research call).
2. **loading** — entered the instant Search is pressed: empty canvas with a centered
   "Researching '<topic>'…" spinner while `createTopic` runs. On success → `canvas`.
   On error → message + retry, still on this view.
3. **canvas** — the React Flow graph.

## Backend changes

- `types.ts`: add `Position {x:number;y:number}`; add `position?: Position` to
  `ResearchNode` and `NodeMeta`.
- `serialize.ts`: round-trip `position` through frontmatter.
- `store.ts`: `metaOf` carries `position`; new `setPositions(updates)` (enqueue'd)
  writes each node's `.md` and patches the index in one index write.
- `service.ts`: `branch` input anchor becomes optional (prompt falls back to the
  parent's question as context when no anchor); add `setPositions`; delete
  `batchBranch`/`BatchItem`/`BatchOutcome`.
- `server/app.ts`: `/branch` validates `parentId` + `question` only; add
  `PATCH /api/projects/:id/positions` (`{positions:{id,x,y}[]}` → `{ok:true}`);
  remove `/branch-batch`.

## Frontend structure

- `web/src/graph/layout.ts` (pure, tested) — layered tree layout: depth from topic
  sets the row, siblings spread across the row. Returns `Record<id,{x,y}>`. Used only
  for nodes without a saved `position`.
- `web/src/graph/model.ts` (pure, tested) — given metas + bodies cache + expanded set
  + pending list + positions, produce visible domain nodes/edges. Visibility: topic
  always visible; a finding/pending node is visible iff some parent is visible **and**
  expanded. Edges only between visible nodes.
- `web/src/components/ResearchNodeCard.tsx` — custom React Flow node: collapsed vs
  expanded rendering, body / "loading…" / ask box / pending spinner / error+retry.
- `web/src/components/Canvas.tsx` — owns expanded set, bodies cache, pending nodes,
  positions; wires React Flow with the custom node type; debounced drag-stop persist;
  lazy body fetch on expand; optimistic ask → `api.branch` → refresh.
- `web/src/components/LoadingCanvas.tsx` — spinner view.
- `web/src/App.tsx` — the `home | loading | canvas` machine; `Library` becomes a dumb
  topic collector that calls `onStart(topic)`.

## Testing

Pure helpers unit-tested without a DOM: `layout.ts`, `model.ts` (visibility +
transform). Backend changes covered by store/serialize/service/app tests. React Flow
wiring verified by `npm run typecheck`, `vite build`, and a manual smoke pass. No
real `claude -p` batch is run during development (it spends subscription usage).
