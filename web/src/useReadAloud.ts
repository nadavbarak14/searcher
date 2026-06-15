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
