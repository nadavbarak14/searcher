import { describe, it, expect } from "vitest";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { runClaude } from "../../src/claude/runner.js";

const live = process.env.SEARCHER_LIVE === "1";

describe.skipIf(!live)("runClaude (LIVE, spends credit)", () => {
  it("gets a real answer from claude -p", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "searcher-live-"));
    const res = await runClaude({
      cwd,
      prompt: "In one sentence, what is an adversarial example in ML?",
      systemPrompt: "Answer in one sentence. End with the SEARCHER_META block containing sources (may be empty).",
      env: process.env as Record<string, string | undefined>,
      model: "haiku",
    });
    expect(res.answer.length).toBeGreaterThan(0);
    await fs.rm(cwd, { recursive: true, force: true });
  }, 60_000);
});
