import { describe, it, expect } from "vitest";
import { runClaudeStream, type ActivityEvent, type StreamSpawnFn } from "../../src/claude/runner.js";

/** Feed canned stream-json lines (optionally split across chunks) to the streaming spawn. */
function fakeStreamSpawn(chunks: string[], code = 0): { fn: StreamSpawnFn; calls: any[] } {
  const calls: any[] = [];
  const fn: StreamSpawnFn = async (args, opts, onStdout) => {
    calls.push({ args, opts });
    for (const c of chunks) onStdout(c);
    return { code };
  };
  return { fn, calls };
}

const lines = [
  JSON.stringify({ type: "system", subtype: "init" }),
  JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "WebSearch", input: { query: "best EV 2026" } }] } }),
  JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/notes/solar-costs.md" } }] } }),
  JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Grep", input: { pattern: "tariff" } }] } }),
  JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Glob", input: { pattern: "*.md" } }] } }),
  JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Here is" }] } }),
  JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: " more text" }] } }), // should NOT re-emit status
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "The answer.\n<<<SEARCHER_META\n{\"claims\":[\"c1\"],\"sources\":[\"https://s.test\"]}\nSEARCHER_META>>>",
    total_cost_usd: 0.02,
    session_id: "sess-stream",
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      cache_creation_input_tokens: 30,
      cache_read_input_tokens: 4,
      server_tool_use: { web_search_requests: 1 },
    },
  }),
];

describe("runClaudeStream", () => {
  it("maps tool_use blocks to ActivityEvents and assembles the ClaudeResult", async () => {
    // split the NDJSON arbitrarily across two chunks to exercise the line buffer
    const joined = lines.join("\n") + "\n";
    const mid = Math.floor(joined.length / 2);
    const { fn, calls } = fakeStreamSpawn([joined.slice(0, mid), joined.slice(mid)]);
    const events: ActivityEvent[] = [];
    const res = await runClaudeStream(
      { cwd: "/proj", prompt: "Q?", systemPrompt: "SYS", env: { PATH: "/x" } },
      (e) => events.push(e),
      fn,
    );

    expect(events).toEqual([
      { type: "tool", label: 'Searching the web for "best EV 2026"' },
      { type: "tool", label: "Reading solar-costs.md" },
      { type: "tool", label: 'Scanning notes for "tariff"' },
      { type: "tool", label: "Looking through notes" },
      { type: "status", label: "Composing the answer…" },
    ]);

    expect(res.answer).toBe("The answer.");
    expect(res.claims).toEqual(["c1"]);
    expect(res.sources).toEqual(["https://s.test"]);
    expect(res.costUsd).toBe(0.02);
    expect(res.tokens).toBe(334); // 100 + 200 + 30 + 4
    expect(res.sessionId).toBe("sess-stream");

    const argv: string[] = calls[0].args;
    expect(argv).toEqual(expect.arrayContaining(["--output-format", "stream-json"]));
    expect(argv).toContain("--include-partial-messages");
    expect(argv).toContain("--verbose");
    expect(argv).toContain("WebSearch");
    expect(calls[0].opts.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("defaults tokens to 0 when the result event has no usage", async () => {
    const noUsage = [
      JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Hi.", total_cost_usd: 0, session_id: "s" }) + "\n",
    ];
    const { fn } = fakeStreamSpawn(noUsage);
    const res = await runClaudeStream({ cwd: "/p", prompt: "q", systemPrompt: "s", env: {} }, () => {}, fn);
    expect(res.tokens).toBe(0);
  });

  it("throws when the result event reports is_error", async () => {
    const errLines = [JSON.stringify({ type: "result", is_error: true, result: "boom", subtype: "error" }) + "\n"];
    const { fn } = fakeStreamSpawn(errLines);
    await expect(
      runClaudeStream({ cwd: "/p", prompt: "q", systemPrompt: "s", env: {} }, () => {}, fn),
    ).rejects.toThrow(/boom|error/i);
  });

  it("throws when the stream ends without a result event", async () => {
    const { fn } = fakeStreamSpawn([JSON.stringify({ type: "system" }) + "\n"]);
    await expect(
      runClaudeStream({ cwd: "/p", prompt: "q", systemPrompt: "s", env: {} }, () => {}, fn),
    ).rejects.toThrow(/without a result/i);
  });
});
