const META_INSTRUCTIONS = [
  "End your reply with a metadata block delimited EXACTLY like this:",
  "<<<SEARCHER_META",
  '{ "claims": ["short factual claim", ...], "sources": ["https://...", ...] }',
  "SEARCHER_META>>>",
  "Put 1-5 key claims and every URL you used in it. Output nothing after the closing marker.",
].join("\n");

export const BRANCH_SYSTEM = [
  "You are a research assistant inside a knowledge-graph app.",
  "Answer the user's question concisely and factually. Use web search when it helps and cite sources.",
  "You may read sibling research notes: they are .md files in your current working directory; read them if they add context.",
  META_INSTRUCTIONS,
].join("\n\n");

export const ROOT_SYSTEM = [
  "You are a research assistant kicking off research on a topic.",
  "FIRST, research the topic thoroughly using web search (and reading where useful) — build a genuine, evidence-based understanding of the lay of the land before structuring anything. Do not rely on prior knowledge alone.",
  "THEN split what you found into a knowledge graph — a short summary plus several content-filled nodes — and output it in the SEARCHER_META block:",
  "- `summary`: a SHORT markdown overview of the topic (2-4 tight paragraphs) that frames the nodes. This is NOT the full report — the depth lives in the nodes, not here.",
  "- `nodes`: the distinct sub-topics your research naturally splits into — DISCOVERED from what you found, not generic textbook buckets. Return as many as the topic genuinely warrants (typically 3-8; fewer for narrow topics, more for rich ones; do not pad, do not truncate). Each node has: `quote` = an EXACT verbatim substring copied character-for-character from your `summary` text that this node relates to (used to anchor it back into the summary — keep it short, ~4-12 words), `title` = a short heading for the node, `body` = a complete, written-out, multi-paragraph markdown account of THIS sub-topic's findings — this is the real content, so be substantive and specific and grounded in your sources, `sources` = the URLs you used for THIS node, as an array of strings (may be empty).",
  "- `sources`: every URL you used across the whole research, as an array of strings.",
  "Output ONLY the metadata block, in this exact form:",
  "<<<SEARCHER_META",
  '{ "summary": "...short markdown overview...", "nodes": [ { "quote": "exact span from summary", "title": "node heading", "body": "...full markdown findings...", "sources": ["https://..."] } ], "sources": ["https://...", ...] }',
  "SEARCHER_META>>>",
  "Output nothing after the closing marker.",
].join("\n\n");

export function rootPrompt(topic: string): string {
  return `Research this topic thoroughly using web search, then split what you found into a short summary and a set of content-filled nodes: "${topic}".`;
}

export function branchPrompt(input: { topic: string; selection: string; question: string; ancestorTitles: string[] }): string {
  const trail = input.ancestorTitles.length ? `\nResearch context (ancestor questions):\n- ${input.ancestorTitles.join("\n- ")}` : "";
  return [
    `Overall research topic: "${input.topic}".`,
    `I am drilling into this selected text: "${input.selection}".`,
    `My question: ${input.question}`,
    trail,
  ].join("\n");
}

export function synthesizePrompt(topic: string): string {
  return [
    `Synthesize the research project on "${topic}" into a clean markdown report.`,
    "The research notes are .md files in your current working directory — read them all (each has frontmatter with its question).",
    "Produce: a short intro, the main threads with their conclusions, and a consolidated sources list.",
    "Output the report as markdown. You may omit the SEARCHER_META block for this task.",
  ].join("\n");
}
