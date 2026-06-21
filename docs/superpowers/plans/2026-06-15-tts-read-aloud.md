# TTS Read-aloud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local "Listen" feature to the reading panel that reads a node's body aloud with the browser's `SpeechSynthesis`, highlighting the current sentence + spoken word inline and auto-scrolling, with play/pause/stop/speed controls.

**Architecture:** Pure, node-tested logic in `web/src/graph/` (sentence segmentation, word ranges, offset→node math) under a thin React hook (`useReadAloud`) that drives `speechSynthesis` block-by-block, sentence-by-sentence. `SidePanel` paints sentence/word highlights with the CSS Custom Highlight API (no DOM mutation) and renders a transport bar in its header.

**Tech Stack:** TypeScript, React 19, Vite, vitest (node env — no DOM tests), Web Speech API, CSS Custom Highlight API.

---

## Context the engineer needs

- Run all commands from the worktree root: `/home/ubuntu/projects/searcher/.claude/worktrees/dreamy-kindling-gadget`. `node_modules` resolves to the parent repo automatically.
- Test runner: vitest, `environment: "node"` (`vitest.config.ts`). There is **no jsdom**. Only pure logic gets unit tests; DOM code is thin glue verified by `npm run typecheck`.
- Test command for one file: `npx vitest run <path>`. Full suite: `npx vitest run`. Typecheck: `npm run typecheck`. Build: `npm run build`.
- The reading panel is `web/src/components/SidePanel.tsx`. It renders markdown via `renderMarkdown` (`web/src/graph/markdown.tsx`) into a `.md-body` div held by `bodyRef`. Rendered block classes: `.md-p`, `.md-h1/2/3` (also carry `.md-h`), `.md-quote`, `.md-list` with `<li>`, and `.md-pre` (code — NOT read aloud).
- `SidePanel` is mounted in `web/src/components/Canvas.tsx` as `<SidePanel key={selectedNode.id} … />`. The `key` means switching nodes **remounts** the panel, so the hook's unmount cleanup covers node changes.
- Existing CSS color vars (in `web/src/styles.css` `:root`): `--accent-soft`, `--accent-line`, `--accent-deep`, `--ink`, `--accent`. Icons (`web/src/components/ui.tsx`) are stroke-only SVGs on a 24×24 viewBox with `fill="none" stroke="currentColor"`.
- Commit message trailer for every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```

---

## File structure

- Create `web/src/graph/speech.ts` — pure: `Span`, `segmentSentences`, `wordRangeAt`.
- Create `web/src/graph/speech.test.ts` — tests for the above.
- Create `web/src/graph/range.ts` — pure `findNodeAtOffset`; DOM glue `offsetWithin`, `rangeWithin`.
- Create `web/src/graph/range.test.ts` — tests for `findNodeAtOffset`.
- Create `web/src/useReadAloud.ts` — the `speechSynthesis` hook.
- Modify `web/src/components/ui.tsx` — add `play`, `pause`, `stop`, `headphones` icons.
- Modify `web/src/components/SidePanel.tsx` — drop local `offsetWithin` (import from `range.ts`), add `ReadAloudBar`, wire the hook + highlight effect + auto-scroll.
- Modify `web/src/styles.css` — `::highlight(tts-sentence)`, `::highlight(tts-word)`, `.tts-block-active`.

---

## Task 1: Add transport icons

**Files:**
- Modify: `web/src/components/ui.tsx:7-10` (IconName union) and `:12-33` (PATHS map)

- [ ] **Step 1: Extend the IconName union**

In `web/src/components/ui.tsx`, replace the type (lines 7-10):

```tsx
export type IconName =
  | "search" | "plus" | "minus" | "chevron" | "arrowLeft" | "arrowUpRight"
  | "sparkle" | "link" | "copy" | "x" | "retry" | "fit" | "dot" | "home"
  | "branch" | "trash" | "target" | "check" | "expandAll" | "collapseAll"
  | "play" | "pause" | "stop" | "headphones";
```

- [ ] **Step 2: Add the four icon paths**

In the `PATHS` object, add these entries before the closing `};` (after the `collapseAll` line):

```tsx
  play: <><path d="M8 5v14l11-7z" /></>,
  pause: <><path d="M9 5v14M15 5v14" /></>,
  stop: <><rect x="6" y="6" width="12" height="12" rx="1.5" /></>,
  headphones: <><path d="M5 13a7 7 0 0 1 14 0" /><rect x="3" y="13" width="4.5" height="6.5" rx="1.6" /><rect x="16.5" y="13" width="4.5" height="6.5" rx="1.6" /></>,
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ui.tsx
git commit -m "$(printf 'feat(web): add play/pause/stop/headphones icons\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: Sentence segmentation (`segmentSentences`)

**Files:**
- Create: `web/src/graph/speech.ts`
- Test: `web/src/graph/speech.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/graph/speech.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { segmentSentences } from "./speech";

describe("segmentSentences", () => {
  it("splits on terminal punctuation followed by a capitalized next sentence", () => {
    const text = "The cat sat. The dog ran.";
    expect(segmentSentences(text)).toEqual([
      { start: 0, end: 12 },
      { start: 13, end: 25 },
    ]);
  });

  it("keeps trailing text with no terminal punctuation as a final sentence", () => {
    expect(segmentSentences("Hello world")).toEqual([{ start: 0, end: 11 }]);
  });

  it("does not split lowercase abbreviations like e.g.", () => {
    const text = "See e.g. the case works. Next.";
    expect(segmentSentences(text)).toEqual([
      { start: 0, end: 24 },
      { start: 25, end: 30 },
    ]);
  });

  it("handles multiple punctuation marks", () => {
    expect(segmentSentences("Wait!! Really?")).toEqual([
      { start: 0, end: 6 },
      { start: 7, end: 14 },
    ]);
  });

  it("returns [] for empty string", () => {
    expect(segmentSentences("")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/src/graph/speech.test.ts`
Expected: FAIL — `segmentSentences` is not exported / module missing.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/graph/speech.ts`:

```ts
export interface Span { start: number; end: number }

function pushTrimmed(spans: Span[], text: string, s: number, e: number): void {
  const slice = text.slice(s, e);
  const lead = slice.length - slice.trimStart().length;
  const trimmed = slice.trim();
  if (trimmed) spans.push({ start: s + lead, end: s + lead + trimmed.length });
}

/**
 * Split `text` into sentence spans whose offsets index into `text`. A sentence
 * ends at terminal punctuation (. ! ?) that is followed by whitespace + an
 * opening/capitalized character, or by end of string. Deterministic and
 * dependency-free; lowercase abbreviations (e.g., i.e.) are not split.
 */
export function segmentSentences(text: string): Span[] {
  const spans: Span[] = [];
  const re = /[.!?]+(?=\s+["'“([A-Z]|\s*$)/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    pushTrimmed(spans, text, start, end);
    start = end;
  }
  if (start < text.length) pushTrimmed(spans, text, start, text.length);
  return spans;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/src/graph/speech.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/graph/speech.ts web/src/graph/speech.test.ts
git commit -m "$(printf 'feat(web): sentence segmentation for read-aloud\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: Word range (`wordRangeAt`)

**Files:**
- Modify: `web/src/graph/speech.ts`
- Test: `web/src/graph/speech.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `web/src/graph/speech.test.ts` (add the import name and a new describe block):

```ts
import { segmentSentences, wordRangeAt } from "./speech";

describe("wordRangeAt", () => {
  it("returns the whitespace-delimited word containing the index", () => {
    expect(wordRangeAt("the quick brown", 6)).toEqual({ start: 4, end: 9 });
  });
  it("works at the start of the string", () => {
    expect(wordRangeAt("the quick brown", 0)).toEqual({ start: 0, end: 3 });
  });
  it("returns an empty range when the index is on whitespace", () => {
    expect(wordRangeAt("the quick", 3)).toEqual({ start: 3, end: 3 });
  });
  it("returns an empty range when the index is out of bounds", () => {
    expect(wordRangeAt("hi", 100)).toEqual({ start: 100, end: 100 });
  });
});
```

(Replace the existing `import { segmentSentences } from "./speech";` line with the combined import above.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/src/graph/speech.test.ts`
Expected: FAIL — `wordRangeAt` is not exported.

- [ ] **Step 3: Implement**

Append to `web/src/graph/speech.ts`:

```ts
const WS = /\s/;

/** The whitespace-delimited word covering `index`; empty range if on whitespace or out of bounds. */
export function wordRangeAt(text: string, index: number): Span {
  if (index < 0 || index >= text.length || WS.test(text[index])) return { start: index, end: index };
  let s = index;
  let e = index + 1;
  while (s > 0 && !WS.test(text[s - 1])) s--;
  while (e < text.length && !WS.test(text[e])) e++;
  return { start: s, end: e };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/src/graph/speech.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/graph/speech.ts web/src/graph/speech.test.ts
git commit -m "$(printf 'feat(web): word-range helper for read-aloud highlight\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: Offset↔DOM mapping (`range.ts`)

**Files:**
- Create: `web/src/graph/range.ts`
- Test: `web/src/graph/range.test.ts`

- [ ] **Step 1: Write the failing test (pure math only)**

Create `web/src/graph/range.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { findNodeAtOffset } from "./range";

describe("findNodeAtOffset", () => {
  it("finds an offset inside the first node", () => {
    expect(findNodeAtOffset([5, 5, 5], 3)).toEqual({ index: 0, local: 3 });
  });
  it("finds an offset that falls into a later node", () => {
    expect(findNodeAtOffset([5, 5, 5], 7)).toEqual({ index: 1, local: 2 });
  });
  it("clamps an offset past the end to the last node", () => {
    expect(findNodeAtOffset([5, 5, 5], 100)).toEqual({ index: 2, local: 5 });
  });
  it("returns the start of the next node at a boundary", () => {
    expect(findNodeAtOffset([5, 5], 5)).toEqual({ index: 0, local: 5 });
  });
  it("handles an empty list", () => {
    expect(findNodeAtOffset([], 3)).toEqual({ index: 0, local: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/src/graph/range.test.ts`
Expected: FAIL — module/`findNodeAtOffset` missing.

- [ ] **Step 3: Implement (pure math + DOM glue)**

Create `web/src/graph/range.ts`:

```ts
/**
 * Given the char lengths of a container's successive text nodes and a target
 * char offset, return which text node holds it and the local offset within
 * that node. Offsets past the end clamp to the end of the last node. Pure.
 */
export function findNodeAtOffset(lengths: number[], offset: number): { index: number; local: number } {
  if (!lengths.length) return { index: 0, local: 0 };
  let acc = 0;
  for (let i = 0; i < lengths.length; i++) {
    if (offset <= acc + lengths[i]) return { index: i, local: Math.max(0, offset - acc) };
    acc += lengths[i];
  }
  const last = lengths.length - 1;
  return { index: last, local: lengths[last] };
}

/** Char offset of (node, nodeOffset) within container.textContent. DOM glue. */
export function offsetWithin(container: HTMLElement, node: Node, nodeOffset: number): number {
  let total = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (n === node) return total + nodeOffset;
    total += (n.textContent ?? "").length;
  }
  return total;
}

/** Build a DOM Range over [start, end) char offsets of container.textContent. DOM glue. */
export function rangeWithin(container: HTMLElement, start: number, end: number): Range {
  const nodes: Text[] = [];
  const lengths: number[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    nodes.push(n as Text);
    lengths.push((n.textContent ?? "").length);
  }
  const range = document.createRange();
  if (!nodes.length) {
    range.selectNodeContents(container);
    return range;
  }
  const a = findNodeAtOffset(lengths, start);
  const b = findNodeAtOffset(lengths, end);
  range.setStart(nodes[a.index], Math.min(a.local, lengths[a.index]));
  range.setEnd(nodes[b.index], Math.min(b.local, lengths[b.index]));
  return range;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/src/graph/range.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/graph/range.ts web/src/graph/range.test.ts
git commit -m "$(printf 'feat(web): offset<->DOM range mapping helpers\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: The `useReadAloud` hook

No unit test (async `speechSynthesis` + DOM glue; not testable in the node env). Verified by typecheck here and manual smoke test in Task 8.

**Files:**
- Create: `web/src/useReadAloud.ts`

- [ ] **Step 1: Implement the hook**

Create `web/src/useReadAloud.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { segmentSentences, wordRangeAt } from "./graph/speech";

export type ReadStatus = "idle" | "playing" | "paused";

export interface ActivePos {
  block: HTMLElement;
  sentence: { start: number; end: number };
  word: { start: number; end: number } | null;
}

interface Unit { block: HTMLElement; text: string; start: number; end: number }

const READABLE = ".md-p, .md-h1, .md-h2, .md-h3, .md-quote, .md-list li";
const SPEECH_OK = typeof window !== "undefined" && "speechSynthesis" in window;

function buildUnits(container: HTMLElement): Unit[] {
  const units: Unit[] = [];
  container.querySelectorAll<HTMLElement>(READABLE).forEach((block) => {
    const text = block.textContent ?? "";
    if (!text.trim()) return;
    for (const s of segmentSentences(text)) {
      if (text.slice(s.start, s.end).trim()) units.push({ block, text, start: s.start, end: s.end });
    }
  });
  return units;
}

export interface ReadAloud {
  supported: boolean;
  status: ReadStatus;
  active: ActivePos | null;
  rate: number;
  play: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  setRate: (r: number) => void;
}

/** Drive window.speechSynthesis over the rendered blocks in `getContainer()`, one sentence per utterance. */
export function useReadAloud(getContainer: () => HTMLElement | null): ReadAloud {
  const [status, setStatus] = useState<ReadStatus>("idle");
  const [active, setActive] = useState<ActivePos | null>(null);
  const [rate, setRateState] = useState(1);

  const unitsRef = useRef<Unit[]>([]);
  const idxRef = useRef(0);
  const rateRef = useRef(1);
  const genRef = useRef(0); // bumped on any interruption to invalidate stale utterance callbacks

  const speakFrom = useCallback((i: number) => {
    const units = unitsRef.current;
    if (i >= units.length) {
      setStatus("idle");
      setActive(null);
      idxRef.current = 0;
      return;
    }
    idxRef.current = i;
    const gen = genRef.current;
    const u = units[i];
    const utter = new SpeechSynthesisUtterance(u.text.slice(u.start, u.end));
    utter.rate = rateRef.current;
    setActive({ block: u.block, sentence: { start: u.start, end: u.end }, word: null });
    utter.onboundary = (e: SpeechSynthesisEvent) => {
      if (genRef.current !== gen) return;
      if (e.name && e.name !== "word") return;
      const abs = u.start + e.charIndex;
      const len = e.charLength;
      const word = len && len > 0
        ? { start: abs, end: abs + len }
        : (() => { const r = wordRangeAt(u.text, abs); return r.end > r.start ? r : null; })();
      setActive({ block: u.block, sentence: { start: u.start, end: u.end }, word });
    };
    utter.onend = () => {
      if (genRef.current !== gen) return;
      speakFrom(i + 1);
    };
    window.speechSynthesis.speak(utter);
  }, []);

  const play = useCallback(() => {
    if (!SPEECH_OK) return;
    const container = getContainer();
    if (!container) return;
    genRef.current++;
    window.speechSynthesis.cancel();
    unitsRef.current = buildUnits(container);
    if (!unitsRef.current.length) return;
    setStatus("playing");
    speakFrom(0);
  }, [getContainer, speakFrom]);

  const pause = useCallback(() => {
    if (!SPEECH_OK) return;
    window.speechSynthesis.pause();
    setStatus("paused");
  }, []);

  const resume = useCallback(() => {
    if (!SPEECH_OK) return;
    window.speechSynthesis.resume();
    setStatus("playing");
  }, []);

  const stop = useCallback(() => {
    if (SPEECH_OK) {
      genRef.current++;
      window.speechSynthesis.cancel();
    }
    idxRef.current = 0;
    setStatus("idle");
    setActive(null);
  }, []);

  const setRate = useCallback((r: number) => {
    rateRef.current = r;
    setRateState(r);
    // rate can't change a live utterance — restart the current sentence at the new rate
    if (SPEECH_OK && status !== "idle") {
      genRef.current++;
      window.speechSynthesis.cancel();
      setStatus("playing");
      speakFrom(idxRef.current);
    }
  }, [status, speakFrom]);

  // Cleanup on unmount. SidePanel is keyed by node id, so this also fires on node change.
  useEffect(() => () => { if (SPEECH_OK) window.speechSynthesis.cancel(); }, []);

  return { supported: SPEECH_OK, status, active, rate, play, pause, resume, stop, setRate };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (`SpeechSynthesisUtterance`, `SpeechSynthesisEvent`, `e.charLength` are in the DOM lib already enabled by `web/tsconfig.json`.)

- [ ] **Step 3: Commit**

```bash
git add web/src/useReadAloud.ts
git commit -m "$(printf 'feat(web): useReadAloud speechSynthesis hook\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 6: Highlight styles

**Files:**
- Modify: `web/src/styles.css` (append near the `.anchor-mark` rules, ~line 238)

- [ ] **Step 1: Add the highlight CSS**

Append to `web/src/styles.css`:

```css
/* Read-aloud (TTS) synced highlight. ::highlight only honors a small set of
   properties — background-color/color are safe; border-radius is ignored. */
::highlight(tts-sentence) { background-color: var(--accent-soft); }
::highlight(tts-word) { background-color: var(--accent-line); color: var(--accent-deep); }
/* Fallback band when the CSS Custom Highlight API is unavailable. */
.tts-block-active { background-color: var(--accent-soft); border-radius: 4px; }
```

- [ ] **Step 2: Commit**

```bash
git add web/src/styles.css
git commit -m "$(printf 'feat(web): styles for read-aloud highlight\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 7: Wire `SidePanel`

**Files:**
- Modify: `web/src/components/SidePanel.tsx`

- [ ] **Step 1: Replace the local `offsetWithin` with imports**

Remove the local `offsetWithin` function (lines 15-25, the comment + function) and add imports. At the top of the file, after the existing `import { renderMarkdown } from "../graph/markdown";` line, add:

```tsx
import { offsetWithin, rangeWithin } from "../graph/range";
import { useReadAloud, type ReadAloud } from "../useReadAloud";
```

Then delete this block (the `// char offset…` comment and the whole `function offsetWithin(...) { … }`):

```tsx
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

(The remaining call to `offsetWithin(bodyEl, range.startContainer, range.startOffset)` in `onBodyMouseUp` now resolves to the import — unchanged.)

- [ ] **Step 2: Add the `ReadAloudBar` component**

Add this near the other local components (e.g., right after the `AskBox` function, before `export interface PendingChild`):

```tsx
const SPEEDS = [1, 1.25, 1.5, 2, 0.75];

/** Transport for read-aloud: Listen → (pause/resume, stop, speed). */
function ReadAloudBar({ tts }: { tts: ReadAloud }) {
  const playing = tts.status === "playing";
  if (tts.status === "idle") {
    return (
      <button className="iconbtn bare accent nodrag" title="Read aloud" onClick={tts.play}
        style={{ width: "auto", padding: "0 9px", gap: 6, display: "inline-flex", alignItems: "center", fontFamily: "var(--sans)", fontSize: 12.5 }}>
        <Icon name="headphones" size={15} /> Listen
      </button>
    );
  }
  return (
    <div className="nodrag" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <button className="iconbtn bare" title={playing ? "Pause" : "Resume"} onClick={playing ? tts.pause : tts.resume}>
        <Icon name={playing ? "pause" : "play"} size={15} />
      </button>
      <button className="iconbtn bare" title="Stop" onClick={tts.stop}><Icon name="stop" size={15} /></button>
      <button className="chip" title="Playback speed"
        onClick={() => tts.setRate(SPEEDS[(SPEEDS.indexOf(tts.rate) + 1) % SPEEDS.length])}
        style={{ fontSize: 11.5, padding: "3px 8px" }}>
        {tts.rate}×
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Instantiate the hook and highlight effect inside `SidePanel`**

Inside the `SidePanel` function, after the existing `const [askAnchor, setAskAnchor] = useState<Anchor | null>(null);` line, add:

```tsx
  const tts = useReadAloud(() => bodyRef.current);
  const lastSentRef = useRef<string>("");
  const lastBlockRef = useRef<HTMLElement | null>(null);

  // Paint the active sentence/word via the CSS Custom Highlight API (no DOM mutation),
  // falling back to a class band. Scroll only when the sentence (not the word) changes.
  useEffect(() => {
    const w = window as unknown as {
      CSS?: { highlights?: Map<string, unknown> };
      Highlight?: new (...ranges: Range[]) => unknown;
    };
    const hasHL = !!(w.CSS && w.CSS.highlights && typeof w.Highlight === "function");
    const a = tts.active;

    if (!hasHL) {
      document.querySelectorAll(".tts-block-active").forEach((el) => el.classList.remove("tts-block-active"));
      if (a) a.block.classList.add("tts-block-active");
      return;
    }
    const highlights = w.CSS!.highlights!;
    const Highlight = w.Highlight!;
    if (!a) {
      highlights.delete("tts-sentence");
      highlights.delete("tts-word");
      return;
    }
    highlights.set("tts-sentence", new Highlight(rangeWithin(a.block, a.sentence.start, a.sentence.end)));
    if (a.word) highlights.set("tts-word", new Highlight(rangeWithin(a.block, a.word.start, a.word.end)));
    else highlights.delete("tts-word");

    const sentKey = `${a.sentence.start}-${a.sentence.end}`;
    if (a.block !== lastBlockRef.current || sentKey !== lastSentRef.current) {
      lastBlockRef.current = a.block;
      lastSentRef.current = sentKey;
      a.block.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [tts.active]);

  // Stop speech (and clear highlights via the effect above) if the body content changes.
  useEffect(() => { tts.stop(); }, [body]);

  // Clear highlights on unmount.
  useEffect(() => () => {
    const w = window as unknown as { CSS?: { highlights?: Map<string, unknown> } };
    w.CSS?.highlights?.delete("tts-sentence");
    w.CSS?.highlights?.delete("tts-word");
    document.querySelectorAll(".tts-block-active").forEach((el) => el.classList.remove("tts-block-active"));
  }, []);
```

- [ ] **Step 4: Render `ReadAloudBar` in the header**

In the header `<div>` (the flex row with `padding: "18px 20px 14px"`), between the title `<div style={{ minWidth: 0, flex: 1 }}>…</div>` and the close `<button …><Icon name="x" …/></button>`, insert:

```tsx
        {tts.supported && body && !researching && <ReadAloudBar tts={tts} />}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/SidePanel.tsx
git commit -m "$(printf 'feat(web): read-aloud transport + synced highlight in panel\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 8: Integration — full suite, build, manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass, including the new `speech.test.ts` (9) and `range.test.ts` (5).

- [ ] **Step 2: Typecheck + build**

Run: `npm run build`
Expected: typecheck passes and `vite build` completes (writes `public/`).

- [ ] **Step 3: Manual smoke test**

Run: `SEARCHER_HOST=0.0.0.0 SEARCHER_PORT=3009 node dist/src/main.js` (or `npm start`), open the app, open a node with a multi-paragraph body, and verify in Chrome:
- A "Listen" button shows in the panel header (hidden while a node is still researching).
- Clicking it reads aloud; the current sentence shows a soft band and the spoken word is brighter.
- The view auto-scrolls to follow the reading position.
- Pause/Resume, Stop, and the speed chip (1× → 1.25× → 1.5× → 2× → 0.75×) all work; changing speed continues from the current sentence.
- Closing the panel or switching nodes stops the audio.
- Code blocks are skipped (not read aloud).

- [ ] **Step 4: Final commit (if any build artifacts/notes), else done**

No code changes expected here. If `public/` is gitignored (it is per `.gitignore`), there is nothing to commit.

---

## Self-review notes (for the planner — already checked)

- **Spec coverage:** engine = Web Speech API (Task 5); per-block sentence reading (Task 5 `buildUnits`); word+sentence highlight (Tasks 4/6/7); Custom Highlight API + fallback (Task 7); transport play/pause/stop/speed (Task 7 `ReadAloudBar`); code blocks skipped (`READABLE` selector excludes `.md-pre`); cleanup on node change/unmount (keyed remount + unmount effects); pure-logic tests only (Tasks 2-4) per node-only test env.
- **Type consistency:** `ActivePos`/`ReadAloud` defined in Task 5 and consumed unchanged in Task 7; `Span` from `speech.ts` used by hook; `findNodeAtOffset` signature matches between `range.ts` and its tests.
- **No placeholders:** every code step shows complete code; every test step shows real assertions and the exact run command + expected result.
