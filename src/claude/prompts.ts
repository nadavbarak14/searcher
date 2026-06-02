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
  "Identify 3-5 distinct, important sub-areas of the topic. Use web search where useful.",
  "Return ONLY a metadata block (minimal prose before it) in this exact form:",
  "<<<SEARCHER_META",
  '{ "findings": [ { "question": "the sub-area as a question", "body": "a concise 2-4 sentence finding", "sources": ["https://..."] }, ... ] }',
  "SEARCHER_META>>>",
  "Output nothing after the closing marker.",
].join("\n\n");

export function rootPrompt(topic: string): string {
  return `Research topic: "${topic}". Map out its key sub-areas as findings.`;
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
