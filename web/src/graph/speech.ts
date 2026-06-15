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
  const re = /[.!?]+(?=\s+["'"([A-Z]|\s*$)/g;
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
