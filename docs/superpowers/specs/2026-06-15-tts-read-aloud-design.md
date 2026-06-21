# Read-aloud with synced highlight — design

Date: 2026-06-15
Status: Approved for planning

## Goal

Add a "Listen" feature to the reading panel (`SidePanel`) that reads the open
node's body aloud and highlights the reading position **inline, where you
currently are** in the text — a moving reading cursor, not a status line at the
bottom of the panel. As it speaks it highlights the current **sentence** (a soft
band) and the **word** being spoken (brighter) within it, and auto-scrolls to
keep the active sentence in view. The user gets standard transport controls:
play, pause, stop, and speed.

The follow-up "Ask box" flow is **unchanged**.

## Constraints

- **All local. No premium voices, no cloud TTS, no API keys.** The project
  deliberately runs locally and its preflight refuses to start when metered-API
  env vars (`ANTHROPIC_API_KEY`, etc.) are set. TTS must not introduce any paid
  or networked dependency.
- Therefore the engine is the browser's built-in **Web Speech API**
  (`window.speechSynthesis`). It is free, fully client-side, needs no server
  changes, and natively provides both playback-rate control and word-boundary
  events for the synced highlight.
- Known trade-off (accepted): voice quality depends on the OS, and word-timing
  (`onboundary`) events are strong in Chrome/Edge/Safari but weaker in Firefox.
  The design degrades gracefully (see below).

## Coordinate space

The markdown renderer (`web/src/graph/markdown.tsx`) establishes the invariant we
build on: anchoring runs over the **rendered plain text** — the same string the
DOM exposes as the panel body's `textContent`. The existing selection/anchor
system already lives in this space (`offsetWithin` in `SidePanel`). TTS reads and
highlights in the same space, so it stays consistent with selection and anchors.

## Key decision: read per block, not one concatenated string

We walk the rendered **block elements** inside the body and speak each as its own
sequence of sentence-utterances, rather than speaking one big concatenated
string. Blocks read: `.md-p`, `.md-h*`, `.md-quote`, and list `<li>`. **Code
fences (`.md-pre`) are skipped** — reading code aloud is noise.

Reading per block buys three things:

1. **Natural pauses** between paragraphs/headings, and it sidesteps Chrome's
   ~15-second-per-utterance cutoff bug (individual sentences are short).
2. **No separator problem.** `textContent` glues adjacent blocks with no
   whitespace ("OverviewThe capital…"). Reading per block keeps each block's text
   clean for both prosody and sentence segmentation, and keeps char offsets
   local to one block.
3. **Exact highlight mapping.** A word/sentence char offset maps back to a DOM
   `Range` via a `TreeWalker` scoped to that block element — the inverse of the
   existing `offsetWithin` helper.

## Components

Small, single-purpose units, mirroring the codebase's pattern of pure,
unit-tested logic in `web/src/graph/*` with thin DOM/React glue around it.

1. **`web/src/graph/speech.ts`** (pure, unit-tested)
   - `segmentSentences(text: string): { start: number; end: number }[]` — split a
     block's text into sentence ranges. Uses `Intl.Segmenter` with granularity
     `'sentence'` when available, with a regex fallback.
   - `wordRangeAt(text: string, index: number): { start: number; end: number }` —
     compute the word range at a char index, for browsers whose `onboundary`
     events report a start index but omit word length.

2. **`web/src/graph/range.ts`**
   - `findNodeAtOffset(lengths: number[], offset: number): { index: number;
     local: number }` — **pure**, node-testable: given the char lengths of a
     container's successive text nodes and a target char offset, return which
     text node holds it and the local offset within that node (clamped to the
     last node). This is the tricky index math, extracted so it can be unit
     tested without a DOM.
   - `rangeWithin(container: HTMLElement, start: number, end: number): Range` —
     thin DOM glue: collect the container's text nodes + lengths, use
     `findNodeAtOffset` for both ends, build a `Range`.
   - `offsetWithin(container, node, nodeOffset): number` — moved here from
     `SidePanel` so both directions of the mapping live together and are reused
     by both the anchor flow and TTS. Thin DOM glue.

3. **`web/src/useReadAloud.ts`** (hook) — orchestration over
   `window.speechSynthesis`.
   - Builds the block → sentence utterance queue from the live body element.
   - Speaks sequentially; `onend` advances to the next sentence/block.
   - On `onboundary` (word), updates the active position
     `{ block, sentence: {start,end}, word: {start,end} | null }`.
   - Exposes `{ supported, status: 'idle' | 'playing' | 'paused', play, pause,
     resume, stop, rate, setRate }`.
   - Rate cannot change a live utterance, so `setRate` cancels and resumes from
     the current sentence at the new rate.
   - Cancels speech on unmount and on node change.

4. **`ReadAloudBar`** (UI, in `SidePanel`) — a speaker "Listen" button in the
   header meta row. While active it becomes a compact transport: play/pause,
   stop, and a click-to-cycle **speed chip** (0.75× / 1× / 1.25× / 1.5× / 2×).
   Placed in the **header** so it stays visible while the body scrolls, and away
   from the Ask box at the bottom.

5. **Highlight painting** (effect in `SidePanel`) — CSS **Custom Highlight API**
   (`CSS.highlights` + `::highlight(tts-sentence)` / `::highlight(tts-word)` in
   `styles.css`). This paints `Range`s **without mutating the DOM**, so it never
   disturbs the existing `<mark>` anchors, text selection, or the follow-up flow.
   The active sentence is kept in view with `scrollIntoView({ block: 'nearest' })`.
   - **Graceful degradation:** if `CSS.highlights` is unavailable, audio still
     plays and the active block receives a class-based band instead of per-range
     paint. If `onboundary` word events never fire (e.g. Firefox), the sentence
     band alone is the reading cursor (word highlight simply stays off).

## Data flow

1. `SidePanel` renders `body` (markdown) → DOM via `renderMarkdown`.
2. On **play**, `useReadAloud` reads the rendered block elements from the body
   ref, segments each block into sentences, and builds the utterance queue.
3. The hook speaks sentence-by-sentence and emits the active
   `{ block, sentence, word }`.
4. `SidePanel` paints `tts-sentence` and `tts-word` highlight ranges (mapped via
   `rangeWithin`) and scrolls the active sentence into view.
5. Transport controls call `play/pause/resume/stop/setRate` on the hook.

## Edge cases

- `window.speechSynthesis` undefined → the Listen button does not render
  (feature simply absent, nothing broken).
- Body empty or node still researching → control disabled.
- Panel close / node switch / component unmount → `speechSynthesis.cancel()`.
- Selection + "Follow up" keeps working untouched; the reading highlight is a
  visual-only paint in a separate layer and does not change selection or anchors.

## Testing

The test runner is vitest in the **node** environment (no jsdom). Following the
codebase's existing split, only pure logic is unit-tested; DOM-touching code is
thin, typecheck-verified glue (the existing `offsetWithin` in `SidePanel` is
likewise untested).

- Unit tests for `speech.ts`: sentence segmentation (abbreviations, trailing text
  with no terminal punctuation, multiple punctuation marks, empty string) and
  `wordRangeAt`.
- Unit tests for `range.ts`: `findNodeAtOffset` pure index math (offset inside
  first node, spanning into a later node, past the end → clamped, empty list).
- `rangeWithin` / `offsetWithin` (DOM glue) and the hook are verified by
  typecheck and manual run, not unit tests — consistent with the existing
  untested DOM helpers.

## Out of scope (YAGNI)

Voice picker, cloud/premium voices, resume-position memory across reopen, audio
export. All viable later follow-ups.
