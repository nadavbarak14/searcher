const START = "<<<SEARCHER_META";
const END = "SEARCHER_META>>>";

export interface SplitMeta {
  answer: string;
  meta: Record<string, unknown> | null;
}

export function splitMeta(reply: string): SplitMeta {
  const start = reply.lastIndexOf(START);
  if (start === -1) return { answer: reply.trim(), meta: null };
  const answer = reply.slice(0, start).trim();
  const end = reply.indexOf(END, start);
  const jsonText = reply.slice(start + START.length, end === -1 ? undefined : end).trim();
  try {
    return { answer, meta: JSON.parse(jsonText) as Record<string, unknown> };
  } catch {
    return { answer, meta: null };
  }
}
