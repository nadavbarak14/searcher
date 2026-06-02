# Searcher — Personal Research-Canvas App

**Date:** 2026-06-02
**Status:** Design approved, pending spec review
**Author:** ronbrk

## Problem

Autonomous AI research agents (and linear chat) are the wrong shape for real research.
Real research *branches*: one topic spawns ten questions, one question reveals a new
branch, branches reconverge. Agents answer **their own** questions and hand back a
report; the moment you have a follow-up you're back in linear chat, where each new
question buries the last and the *shape* of the investigation is lost.

We want the AI's output to be a **starting point, not an endpoint** — then let the human
drive the branching, building a knowledge graph that is genuinely theirs.

## Concept

A **local** web app where you research a topic as a **navigable graph you build
yourself**. Claude Code (headless `-p`, on the user's own Pro/Max subscription) answers
at every node and can search the web. The human sets direction and prunes; the AI is an
instrument on tap at every node.

## Hard constraints

- **Uses the user's Claude Code subscription, never metered API usage.** The backend
  shells out to the locally-installed, subscription-authenticated Claude Code CLI in
  headless mode (`claude -p`). No API key anywhere in the system.
- **Personal use only.** Riding the subscription this way is fine for a tool the owner
  uses locally; it must not be turned into a hosted service for others.
- **Local-first.** Everything runs on `localhost`; data lives in plain files on disk.

## The core loop (the experience)

1. Create a **new research** by naming a topic. Claude does an initial deep pass →
   a few **root nodes** (the lay of the land).
2. Read a node, **select a phrase** that interests you, type a follow-up question.
3. That spawns a **child node anchored to your selection**. Claude answers it (web
   search allowed), deciding for itself how much of the existing graph to read first.
4. The node lands on the canvas wired to its parent. Repeat — fanning out, doubling
   back, manually linking two nodes when branches reconverge.
5. Close it, reopen it next week — the whole graph reloads from disk.
6. Hit **Export / synthesize** anytime to get a usable markdown report from the graph.

## Architecture

```
Browser (React + React Flow canvas)
      ↕ localhost (HTTP + SSE for streaming answers)
Local backend (TypeScript: Fastify)
      ↕ spawns `claude -p --output-format stream-json` (WebSearch enabled,
        Read scoped to the project folder)
Claude Code CLI → user's Pro/Max subscription
      ↕
Graph store: one markdown file per node + a graph.json index, on disk
```

No API key, no database, no MCP. Just the subscription and files.

## Components

Each component has one purpose, a clear interface, and is testable in isolation.

### Graph store
- Reads/writes nodes as markdown-with-frontmatter; maintains `graph.json`
  (nodes + edges) as the fast-load index.
- Owns the on-disk layout of a research project.
- Knows nothing about Claude or the UI.

### Claude runner
- Builds a prompt from `{ topic, selected text, question }` plus a lightweight index
  of existing node titles.
- Spawns `claude -p --output-format stream-json` with WebSearch enabled and Read access
  scoped to the project folder.
- Streams/parses output into `{ answer, key claims, sources }`.
- Knows nothing about the UI.

### Backend API
- `POST /topic` — create a project + run the root deep pass.
- `POST /branch` — `{ selected text, question, parent id }` → child node.
- `GET /project/:id` — load a graph.
- `GET /projects` — library listing.
- `POST /project/:id/synthesize` — produce an export report.
- Streams answers back to the browser via SSE.

### Frontend canvas
- Renders the graph (pan/zoom), the node-detail panel (markdown answer + sources),
  the **select-text → branch** interaction, and live-streaming answers.
- Library view to create / list / reopen research projects.
- Manual node-to-node linking.

## Data model — node file

```yaml
---
id: n_07
parents: [n_03]          # array → allows manual cross-links (graph, not just tree)
anchor: "adversarial examples transfer across models"  # the selected text
question: "Why do adversarial examples transfer?"
sources: ["https://..."]
created: 2026-06-02T18:30:00Z
---
<Claude's answer in markdown>
```

A **research project** = one folder of these files plus `graph.json`. Files use
wikilinks, so the folder also opens cleanly in Obsidian if the graph view is ever wanted.

## Context strategy — let Claude manage its own depth

The antidote to "the agent researches alone" is that **the human curates direction**
while **Claude curates depth**. When branching, the runner gives Claude:

- the **selected text** + the **question** (always),
- a lightweight **index of existing nodes** (ids + question titles), and
- **Read access scoped to the project folder**.

Claude then decides for itself whether it has enough or should read specific existing
nodes first, and whether to web-search — before answering. No fixed ancestor chain is
force-fed; no echo chamber, no over-stuffed prompts.

## Research library (create / save / use)

- **New research** — name a topic → creates a project folder → runs the root pass.
- **Auto-save** — every node and edge is written to disk as created; nothing to save
  manually, nothing lost.
- **Library view** — list all past research projects to reopen.
- **Export / synthesize** — Claude walks the current graph and produces a clean markdown
  synthesis (threads, conclusions, sources) to save out, paste elsewhere, or keep in a
  vault. This is the *usable output* of a session.

## Error handling

- `claude` not found / not logged in → explicit setup message, not a crash.
- Subscription rate limit hit → "limit reached, resets in ~X" — never a silent failure,
  never a surprise charge.
- Long-running queries → live streaming + a cancel button.

## Testing

- **Graph store:** unit tests on read/write round-trips and edge integrity.
- **Claude runner:** unit tests with a mocked spawn — assert prompt construction and
  output parsing; one real `claude -p` smoke test.
- **Frontend:** component tests for graph render and the select → branch flow.

## Scope (YAGNI)

**In v1:** topic root pass, select-text → branch, per-node web search, Claude-managed
context depth, file persistence, streaming answers, pan/zoom graph canvas, manual
node-to-node linking, research library (create/list/reopen), export/synthesize.

**Deferred:** auto-detecting branch reconvergence, MCP/database, sharing/multi-user,
fancy auto-layout, mobile, hand-picking extra sibling context per query (v1.1 toggle).

## Proposed stack

- **Frontend:** React + Vite + React Flow (node/edge canvas built for interactive graphs).
- **Backend:** TypeScript + Fastify; `child_process` to spawn `claude -p`.
- **Storage:** markdown + frontmatter files; `graph.json` index. No database.
- **AI engine:** local Claude Code CLI, headless, subscription-authenticated.
