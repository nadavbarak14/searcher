# Searcher: Selection-Anchored Follow-ups on a Left→Right Canvas — Design

**Date:** 2026-06-04
**Status:** Approved
**Supersedes:** the canvas-redesign decisions "Questions: whole-node (no
text-selection anchoring)" and "new branches never set anchor"
(`2026-06-03-searcher-canvas-redesign-design.md`).

## Goal

Make Searcher's canvas a **left→right** tree of **full research-answer** nodes
where follow-up questions are **anchored to a selected span of text**. Selecting
text inside a node surfaces a **"↳ Follow up"** button; clicking it spawns a child
node anchored to that span, auto-placed to the right at the span's height and then
freely movable. The selected span stays highlighted in the parent and the edge is
pinned to it, so the relationship reads as "this text → this answer."

## Non-negotiable constraint (carried forward)

Research runs via `claude -p` on the user's **subscription/OAuth only**, never
metered per-token API billing. The spawned-child env scrub
(`ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_BASE_URL`/
`CLAUDE_CODE_USE_BEDROCK`/`CLAUDE_CODE_USE_VERTEX`) and the preflight that refuses
to start when `ANTHROPIC_API_KEY` is set **must remain unchanged**.

## Confirmed decisions

- **Node = full answer.** The initial Search returns the answer **split into several
  path-nodes**, each a complete, readable answer for one research direction off the
  topic. The existing `findings[]` structure already carries N nodes; this is mainly
  a research-prompt change.
- **Layout: left → right.** Topic on the far left; depth grows rightward; siblings
  spread vertically within their column.
- **Core gesture:** select span → **"↳ Follow up"** button → child node. The child
  auto-places to the right at the selection's vertical height, opens an ask box, and
  is freely movable with persisted position.
- **Question entry:** the user **types the follow-up**; the selected text rides along
  as context to Claude (matches the existing `branch(question, anchor)` signature).
- **Multiple follow-ups per selection** are allowed — each is its own child node.
- **Anchor reborn:** each follow-up stores `Anchor { text, offset, occurrence }` on
  its parent; the span stays highlighted and the edge source is pinned to it,
  persistently across reloads.
- **No separate comment/note feature** — asking a follow-up is the only selection
  action.

## Architecture

### 1. Layout & handles (`web/src/graph/layout.ts`, `ResearchNodeCard`)

- `layoutNodes` flips axes: depth sets **x** (`x = depth * COL_W`), siblings spread
  on **y** (`y = (i - (n-1)/2) * ROW_H`), centered on y=0. Topic at x=0. Pure,
  unit-tested as today. (Used only for nodes without a saved `position`.)
- `ResearchNodeCard` React Flow handles move from Top/Bottom to **Left (target) /
  Right (source)**.

### 2. Selection → Anchor (`ResearchNodeCard` + pure helper)

- The expanded body is a `nodrag` region. Listen for `mouseup` / `selectionchange`;
  on a non-empty `Selection` whose range lies inside the body, compute an `Anchor`:
  - `text` — the selected string.
  - `offset` — character offset of the selection start within the full body text.
  - `occurrence` — which nth match of `text` within the body this is (the robust
    re-locator used on reload; `offset` is the fast path).
- Render a floating **"↳ Follow up"** button at the selection's
  `getBoundingClientRect()`. Clears when the selection collapses.
- The offset/occurrence computation is a **pure helper** (`anchorFromSelection` takes
  the body string + selected text + start index) so it is unit-testable without a DOM.

### 3. Follow-up flow (`Canvas.tsx`, `api.ts`)

- Click "Follow up" → create an **optimistic pending child** carrying the anchor,
  positioned at `{ x: parent.x + COL_W, y: parent.y + spanYOffset }`. Open its ask
  box.
- On submit → `api.branch(projectId, { parentId, question, anchor })`. On success the
  pending node becomes a real, expandable, re-questionable node filled with the
  answer + sources. On failure: error + retry (existing pending-node affordance).
- Position persists on drag-stop via the existing debounced `PATCH /positions`.

### 4. Persisted highlight (`web/src/graph/highlight.ts`, pure)

- `bodyToSegments(body, anchors[])` → ordered segments, each tagged with the anchor
  id(s) covering it; the expanded body renders highlighted runs in `<mark>`. Anchors
  re-located on load by `(text, occurrence)`. Overlapping anchors split at all
  boundaries so a segment may carry multiple ids. Pure, unit-tested without a DOM.
  (Revives the spirit of the previously-removed body-to-segments helper.)

### 5. Anchored edges — primary risk

- Each anchored child edge sets `sourceHandle = <anchorId>`. The parent card renders
  a **dynamic right-edge `Handle` per anchor**, positioned (absolute `top`) at the
  measured vertical offset of its highlighted `<mark>`; call
  `updateNodeInternals(parentId)` on expand/collapse/scroll/measure so React Flow
  recomputes edge geometry.
- **Scrollable-body edge case:** the body is `maxHeight: 260; overflow:auto`. When a
  span scrolls out of view, **clamp** its handle to the nearest body edge so the edge
  still points sensibly. When the parent is **collapsed**, all child edges fall back
  to a single right-mid handle.
- **De-risk fallback:** if precise per-span pinning proves costly, v1 ships
  highlight-in-parent + a single right-mid edge, with pinning as a fast follow-up.
  Build pinned, but keep this escape hatch.

### 6. Backend (small)

- `server/app.ts` `/branch` route + `api.branch` client: **re-add `anchor`
  passthrough** (the redesign trimmed the route to `parentId + question`).
  `service.branch` and `serialize` already round-trip `anchor`.
- `model.ts`: visible edges carry `sourceHandle`; visibility logic unchanged (a child
  is visible iff some parent is visible **and** expanded; edges only between visible
  nodes).
- `rootPrompt` / `ROOT_SYSTEM`: tune so each finding is a **full, self-contained
  answer for a research path** rather than a terse finding. Lightest-touch change,
  isolated in its own phase so it can be deferred without blocking the interaction
  work.

## Data model

No new types required. `Anchor { text; offset; occurrence }`, `Position`, and
`position?` on `ResearchNode`/`NodeMeta` already exist in both `src/graph/types.ts`
and `web/src/types.ts`. New follow-ups simply start setting `anchor` again.

## Build order (one spec, four phases)

1. **LR layout + handles** — isolated, pure; `layout.ts` axis flip + handle sides.
2. **Backend anchor passthrough + richer root prompt** — `/branch` route + client
   carry `anchor`; root prompt yields full-answer path nodes. (Prompt change is
   separable/deferrable.)
3. **Selection → "Follow up" → anchored optimistic child** — the heart: selection
   listener, anchor compute, floating button, optimistic child, auto-placement,
   submit→`api.branch`.
4. **Anchored edges + persisted highlight** — `bodyToSegments`, `<mark>` rendering,
   dynamic per-anchor handles, `updateNodeInternals`, scroll clamp + collapsed
   fallback (with the v1 fallback escape hatch).

## Testing

- Pure / unit-tested without a DOM: `layout.ts` (LR placement), `anchorFromSelection`
  (offset/occurrence from a known body string), `bodyToSegments` (segmentation incl.
  overlap), `model.ts` (edge `sourceHandle` mapping + visibility).
- Backend changes covered by app/service/serialize tests (anchor round-trips
  `/branch`).
- React Flow wiring (dynamic handles, `updateNodeInternals`, drag/persist) verified by
  `npm run typecheck`, `vite build`, and a manual smoke pass. No real `claude -p` runs
  during development (spends subscription usage).
