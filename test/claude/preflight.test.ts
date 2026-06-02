import { describe, it, expect } from "vitest";
import { preflight } from "../../src/claude/preflight.js";

describe("preflight", () => {
  it("passes when claude is present and no API key is set", async () => {
    const res = await preflight({ env: { PATH: "/x" }, checkClaude: async () => true });
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
  });
  it("fails when an API key var is present (would bill metered)", async () => {
    const res = await preflight({ env: { ANTHROPIC_API_KEY: "sk" }, checkClaude: async () => true });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/ANTHROPIC_API_KEY/);
  });
  it("fails when the claude CLI is not found", async () => {
    const res = await preflight({ env: {}, checkClaude: async () => false });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/claude/i);
  });
});
