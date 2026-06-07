/**
 * The "research brief" — Searcher's curated memory.
 *
 * Each Claude call is a fresh, stateless `claude -p` (see claude/runner.ts), so on its own
 * it has no sense of the overall goal or what the project has already discovered. The brief
 * is a compact, always-fresh summary — the goal plus a one-line takeaway per finding —
 * derived on the fly from the persisted .md graph and injected into every branch prompt so
 * Claude continues ONE research project instead of answering each question in isolation.
 *
 * It is intentionally derived (not stored): the graph is the source of truth, and a future
 * Claude-synthesized brief can replace buildBrief() without changing its callers.
 */

export interface BriefFinding {
  question: string;
  body: string;
}

export interface BriefInput {
  goal: string;
  findings: BriefFinding[];
}

/** Keep the brief bounded so a large tree can't blow up per-call token cost. */
const MAX_FINDINGS = 40;
const MAX_TAKEAWAY = 160;

/** The first sentence of a finding's body, whitespace-collapsed and length-capped. */
function takeaway(body: string): string {
  const collapsed = body.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  const m = /^(.*?[.!?])(\s|$)/.exec(collapsed);
  let s = m ? m[1] : collapsed;
  if (s.length > MAX_TAKEAWAY) s = s.slice(0, MAX_TAKEAWAY - 1).trimEnd() + "…";
  return s;
}

/** Build the injected memory block: the research goal + what's been found so far. */
export function buildBrief(input: BriefInput): string {
  const lines: string[] = [
    "You are continuing ONE ongoing research project — not answering in isolation.",
    "",
    `RESEARCH GOAL: ${input.goal}`,
    "",
  ];

  const findings = input.findings.filter((f) => f.question.trim() || f.body.trim());
  if (findings.length === 0) {
    lines.push("WHAT WE'VE FOUND SO FAR: (nothing yet — this is the start of the research.)");
    return lines.join("\n");
  }

  lines.push("WHAT WE'VE FOUND SO FAR:");
  const shown = findings.slice(-MAX_FINDINGS);
  const omitted = findings.length - shown.length;
  if (omitted > 0) lines.push(`(…${omitted} earlier finding(s) omitted for brevity…)`);
  for (const f of shown) {
    const head = f.question.trim();
    const t = takeaway(f.body);
    lines.push(head && t ? `- ${head} — ${t}` : `- ${head || t}`);
  }
  return lines.join("\n");
}
