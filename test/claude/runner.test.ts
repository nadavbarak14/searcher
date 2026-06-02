import { describe, it, expect } from "vitest";
import { runClaude, type SpawnResult, type SpawnFn } from "../../src/claude/runner.js";

function fakeSpawn(stdout: string, code = 0): { fn: SpawnFn; calls: any[] } {
  const calls: any[] = [];
  const fn: SpawnFn = async (args, opts) => {
    calls.push({ args, opts });
    return { stdout, code } as SpawnResult;
  };
  return { fn, calls };
}

const sampleJson = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "The answer.\n<<<SEARCHER_META\n{\"claims\":[\"c1\"],\"sources\":[\"https://s.test\"]}\nSEARCHER_META>>>",
  total_cost_usd: 0.01,
  session_id: "sess-1",
});

describe("runClaude", () => {
  it("builds the correct argv and parses answer + meta + cost", async () => {
    const { fn, calls } = fakeSpawn(sampleJson);
    const res = await runClaude({ cwd: "/proj", prompt: "Q?", systemPrompt: "SYS", env: { PATH: "/x" } }, fn);
    expect(res.answer).toBe("The answer.");
    expect(res.claims).toEqual(["c1"]);
    expect(res.sources).toEqual(["https://s.test"]);
    expect(res.costUsd).toBe(0.01);
    expect(res.sessionId).toBe("sess-1");
    expect(res.meta).toEqual({ claims: ["c1"], sources: ["https://s.test"] });
    const argv: string[] = calls[0].args;
    expect(argv).toContain("-p");
    expect(argv).toContain("Q?");
    expect(argv).toEqual(expect.arrayContaining(["--output-format", "json"]));
    expect(argv).toEqual(expect.arrayContaining(["--permission-mode", "dontAsk"]));
    expect(argv).toEqual(expect.arrayContaining(["--append-system-prompt", "SYS"]));
    expect(argv).toContain("WebSearch");
    expect(calls[0].opts.cwd).toBe("/proj");
    expect(calls[0].opts.env.ANTHROPIC_API_KEY).toBeUndefined();
  });
  it("throws when claude reports is_error", async () => {
    const errJson = JSON.stringify({ is_error: true, result: "boom", subtype: "error" });
    const { fn } = fakeSpawn(errJson);
    await expect(runClaude({ cwd: "/p", prompt: "q", systemPrompt: "s", env: {} }, fn)).rejects.toThrow(/boom|error/i);
  });
  it("throws on non-zero exit with unparseable stdout", async () => {
    const { fn } = fakeSpawn("not json", 1);
    await expect(runClaude({ cwd: "/p", prompt: "q", systemPrompt: "s", env: {} }, fn)).rejects.toThrow();
  });
  it("returns null meta when reply has no block", async () => {
    const json = JSON.stringify({ is_error: false, result: "plain answer", total_cost_usd: 0, session_id: "s" });
    const { fn } = fakeSpawn(json);
    const res = await runClaude({ cwd: "/p", prompt: "q", systemPrompt: "s", env: {} }, fn);
    expect(res.answer).toBe("plain answer");
    expect(res.meta).toBeNull();
    expect(res.claims).toEqual([]);
  });
  it("tolerates a non-JSON banner line printed before the JSON object", async () => {
    const json = JSON.stringify({ is_error: false, result: "ok", total_cost_usd: 0, session_id: "s" });
    const { fn } = fakeSpawn("Update available! Run npm i -g ...\n" + json);
    const res = await runClaude({ cwd: "/p", prompt: "q", systemPrompt: "s", env: {} }, fn);
    expect(res.answer).toBe("ok");
  });
});
