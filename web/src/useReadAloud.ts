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

// Names of higher-quality voices across platforms (Chrome's network voices, macOS/iOS, Windows, Android).
const GOOD_VOICE = /(google|natural|neural|enhanced|premium|siri|samantha|daniel|karen|moira|aria|jenny|libby|sonia|fiona|serena)/i;

/** Best available voice for English content; null lets the browser pick its (often poor) default. */
function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const en = voices.filter((v) => /^en/i.test(v.lang));
  const pool = en.length ? en : voices;
  // Prefer known good names, then any non-local (network) voice, then en-US, then the first.
  return (
    pool.find((v) => GOOD_VOICE.test(v.name)) ||
    pool.find((v) => v.localService === false) ||
    pool.find((v) => /en[-_]?US/i.test(v.lang)) ||
    pool[0] ||
    null
  );
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
  const playingRef = useRef(false); // synchronous source of truth: are we actively advancing?
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  const speakFrom = useCallback((i: number) => {
    const units = unitsRef.current;
    if (i >= units.length) {
      playingRef.current = false;
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
    if (!voiceRef.current) voiceRef.current = pickVoice();
    if (voiceRef.current) { utter.voice = voiceRef.current; utter.lang = voiceRef.current.lang; }
    setActive({ block: u.block, sentence: { start: u.start, end: u.end }, word: null });
    utter.onboundary = (e: SpeechSynthesisEvent) => {
      if (genRef.current !== gen) return;
      if (e.name !== "word") return;
      const abs = u.start + e.charIndex;
      const len = e.charLength;
      const word = len && len > 0
        ? { start: abs, end: abs + len }
        : (() => { const r = wordRangeAt(u.text, abs); return r.end > r.start ? r : null; })();
      setActive({ block: u.block, sentence: { start: u.start, end: u.end }, word });
    };
    utter.onend = () => {
      // genRef invalidates a cancelled utterance; playingRef stops us advancing while
      // paused (Chrome can fire onend on an utterance that ends just as the user pauses).
      if (genRef.current !== gen || !playingRef.current) return;
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
    playingRef.current = true;
    setStatus("playing");
    speakFrom(0);
  }, [getContainer, speakFrom]);

  // Native pause()/resume() is unreliable (Chrome often won't resume), so pause cancels and
  // remembers the current sentence; resume re-speaks it from the start.
  const pause = useCallback(() => {
    if (!SPEECH_OK) return;
    playingRef.current = false;
    genRef.current++;
    window.speechSynthesis.cancel();
    setStatus("paused");
  }, []);

  const resume = useCallback(() => {
    if (!SPEECH_OK) return;
    playingRef.current = true;
    setStatus("playing");
    speakFrom(idxRef.current);
  }, [speakFrom]);

  const stop = useCallback(() => {
    if (SPEECH_OK) {
      genRef.current++;
      window.speechSynthesis.cancel();
    }
    playingRef.current = false;
    idxRef.current = 0;
    setStatus("idle");
    setActive(null);
  }, []);

  const setRate = useCallback((r: number) => {
    rateRef.current = r;
    setRateState(r);
    // Rate can't change a live utterance. If playing, restart the current sentence at the
    // new rate; if paused, the new rate simply applies to subsequent sentences.
    if (SPEECH_OK && playingRef.current) {
      genRef.current++;
      window.speechSynthesis.cancel();
      speakFrom(idxRef.current);
    }
  }, [speakFrom]);

  // Resolve the best available voice once the browser has loaded its (async) voice list.
  useEffect(() => {
    if (!SPEECH_OK) return;
    const prime = () => { voiceRef.current = pickVoice() ?? voiceRef.current; };
    prime();
    window.speechSynthesis.addEventListener("voiceschanged", prime);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", prime);
  }, []);

  // Cleanup on unmount. SidePanel is keyed by node id, so this also fires on node change.
  useEffect(() => () => { if (SPEECH_OK) window.speechSynthesis.cancel(); }, []);

  return { supported: SPEECH_OK, status, active, rate, play, pause, resume, stop, setRate };
}
