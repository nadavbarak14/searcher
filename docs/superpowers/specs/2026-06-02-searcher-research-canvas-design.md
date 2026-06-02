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

- **Runs on the user's Claude Code subscription, via the Agent SDK credit — never
  metered per-token API billing.** The backend shells out to the locally-installed,
  subscription-authenticated Claude Code CLI in headless mode (`claude -p`). Headless
  usage draws from the plan's monthly **Agent SDK credit** (a finite dollar budget
  separate from interactive chat limits — roughly $20/mo Pro, $100/mo Max 5×, $200/mo
  Max 20×), *not* the unlimited chat quota. This is an accepted, known budget: the engine
  is the subscription's Agent SDK credit, and the design must keep it from silently
  spilling into metered API billing.

  **Footgun guards (hard requirements, not aspirations):**
  - The backend MUST spawn `claude -p` with a **scrubbed environment** — explicitly
    delete `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and the Bedrock/Vertex vars from
    the child's `env`. A stray API key takes precedence over subscription OAuth and bills
    the API account per-token (documented real-world case: ~$1,800 of surprise charges
    from this exact pattern).
  - Auth path is **OAuth subscription login only** (`claude setup-token` /
    `CLAUDE_CODE_OAUTH_TOKEN`). Do **not** use `--bare` (it bypasses OAuth and requires an
    API key); pin this even though `--bare` is slated to become the `-p` default.
  - A **pre-flight check** on startup fails loudly if an API-key env var is present or if
    OAuth isn't configured — refuse to run rather than risk metered billing.
  - **Credit-exhausted is a distinct stop-state**, handled separately from rate limits
    (see Error handling). The app must surface "Agent SDK credit exhausted" and stop, not
    silently fall through to per-token API rates.
- **Personal use only.** Riding the subscription this way is fine for a tool the owner
  uses locally; it must not be turned into a hosted service for others.
- **Local-first.** Everything runs on `localhost`; data lives in plain files on disk.

## The core loop (the experience)

1. Create a **new research** by naming a topic. A synthetic **topic node** is created,
   then Claude does an initial deep pass that returns several discrete findings — a
   delimited/structured list of `{ title, body, sources }` — which the backend fans out
   into **finding nodes** parented to the topic node (the lay of the land).
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
      ↕ spawns `claude -p` with:
          cwd = the project folder            (so Read/Glob/Grep are naturally scoped)
          --output-format stream-json         (live answer streaming)
          --allowedTools "Read,Glob,Grep,WebSearch"
          --permission-mode <non-interactive> (else the run aborts on first tool prompt)
          env scrubbed of all API-key vars    (force subscription OAuth)
Claude Code CLI → user's subscription (Agent SDK credit)
      ↕
Graph store: one markdown file per node + a graph.json index, on disk
```

No API key, no database, no MCP. Just the subscription and files.

**Read scoping note:** scoping is achieved by setting `cwd` to the project folder, *not*
by `--add-dir`/`additionalDirectories` (which is reported not to actually grant the Read
tool access — files outside CWD return `EPERM`). Keeping node files inside the CWD is what
lets Claude read sibling nodes.

## Components

Each component has one purpose, a clear interface, and is testable in isolation.

### Graph store
- Reads/writes nodes as markdown-with-frontmatter; maintains `graph.json`
  (nodes + edges) as the fast-load index.
- Owns the on-disk layout of a research project.
- Knows nothing about Claude or the UI.
- **Source of truth:** the per-node frontmatter is authoritative; `graph.json` is a
  derived, rebuildable index. On load, if they diverge, rebuild `graph.json` from
  frontmatter. Provide an explicit `rebuildIndex()`.
- **Write order & atomicity:** write the node `.md` first, then update `graph.json`. If
  the process dies between the two, load-time rebuild reconciles. (`graph.json` holds only
  ids, edges, titles, timestamps — everything reconstructable from the `.md` files.)
- **Single-writer queue:** all mutations go through a per-project serialized write queue,
  so two concurrent branches can't race on `graph.json` (lost-update). Reads are free.

### Claude runner
- Builds a prompt from `{ topic, selected text, question }` plus a lightweight index
  of existing node titles.
- Spawns `claude -p` per the invocation contract above (`cwd` = project folder,
  `stream-json`, allowed tools, permission mode, scrubbed env).
- Spawns via `shell: true` (or the explicit `claude.cmd` path) — on Windows `claude` is a
  `.cmd`/`.ps1` shim, so a bare `spawn("claude", ...)` fails.
- Knows nothing about the UI.

**Streaming → structured `{ answer, claims, sources }` strategy (chosen):** keep live
streaming and derive structure, rather than sacrificing streaming for `--json-schema`.
Concretely:
- **answer** — streamed live from `stream-json` token deltas (SSE to the browser).
- **sources** — harvested from `web_search` tool-result events in the same stream.
- **claims** — the system prompt instructs Claude to end its answer with a delimited,
  machine-parseable block (e.g. a fenced `claims`/`sources` section) that the runner
  parses after the stream completes.

This avoids the `stream-json`-can't-also-be-schema conflict: stream the prose, parse the
trailing delimited block for structure.

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
kind: finding            # "topic" (the synthetic root) | "finding"
parents: [n_03]          # array → allows manual cross-links (graph, not just tree)
anchor:                  # how the selection maps back to the parent's rendered answer
  text: "adversarial examples transfer across models"
  offset: 412            # char offset into parent body
  occurrence: 1          # Nth match, to disambiguate duplicate phrases
question: "Why do adversarial examples transfer?"
sources: ["https://..."]
created: 2026-06-02T18:30:00Z
---
<Claude's answer in markdown>
```

**Root case:** each project has exactly one synthetic **topic node** (`kind: topic`,
empty `parents`, no `anchor`) whose `question` is the topic itself. The root deep pass
produces several **finding nodes** as its children. So every non-topic node has at least
one parent, and the schema has no "parentless finding" edge case.

**Anchor re-highlighting** is best-effort: the runner stores `text` + `offset` +
`occurrence`; the UI re-highlights by offset, falling back to Nth-occurrence text match.
If the parent answer changes such that none resolve, the node keeps its edge but simply
doesn't paint a highlight (acceptable degradation, not an error).

A **research project** = one folder of these files plus `graph.json`. Files use
wikilinks, so the folder also opens cleanly in Obsidian if the graph view is ever wanted.

## Context strategy — let Claude manage its own depth

The antidote to "the agent researches alone" is that **the human curates direction**
while **Claude curates depth**. When branching, the runner gives Claude:

- the **selected text** + the **question** (always),
- a lightweight **index of existing nodes** (ids + question titles), and
- **Read access to the project folder** (via `cwd` = the folder; see the invocation
  contract — node files live in CWD so `Read`/`Glob`/`Grep` reach them).

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

- **Pre-flight auth failure** — `claude` not found, not OAuth-logged-in, or an API-key
  env var present → refuse to start with an explicit setup message (never run in a state
  that could bill the API).
- **Agent SDK credit exhausted** — a distinct stop-state: surface "monthly Agent SDK
  credit used up, resets on ~X" and stop. Do **not** silently continue at per-token API
  rates.
- **Rate limit hit** (transient) → "limit reached, retry in ~X" — distinct from credit
  exhaustion above.
- **Cancel** — killing the child process discards the in-flight node (not saved as a
  partial); note that tokens already consumed still draw down the credit.
- Long-running queries → live streaming + the cancel button.

## Testing

- **Graph store:** unit tests on read/write round-trips and edge integrity.
- **Claude runner:** unit tests with a mocked spawn — assert prompt construction and
  output parsing; one real `claude -p` smoke test.
- **Frontend:** component tests for graph render and the select → branch flow.

## Scope (YAGNI)

**In v1:** topic root pass, select-text → branch, per-node web search, Claude-managed
context depth, file persistence, streaming answers, pan/zoom graph canvas, manual
node-to-node linking, research library (create/list/reopen), export/synthesize.

> Note: **export/synthesize** is effectively a *second* Claude integration (whole-graph
> context, different prompt, different parse, its own credit draw). Keep it in v1 but
> treat it as its own milestone, not a freebie bolted onto the branch flow.

**Deferred:** auto-detecting branch reconvergence, MCP/database, sharing/multi-user,
fancy auto-layout, mobile, hand-picking extra sibling context per query (v1.1 toggle).

## Proposed stack

- **Frontend:** React + Vite + React Flow (node/edge canvas built for interactive graphs).
- **Backend:** TypeScript + Fastify; `child_process` to spawn `claude -p`.
- **Storage:** markdown + frontmatter files; `graph.json` index. No database.
- **AI engine:** local Claude Code CLI, headless, subscription-authenticated.
