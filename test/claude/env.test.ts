import { describe, it, expect } from "vitest";
import { scrubbedEnv, API_KEY_VARS } from "../../src/claude/env.js";

describe("scrubbedEnv", () => {
  it("removes every API-key/auth var so the CLI must use subscription OAuth", () => {
    const input = { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-ant-xxx", ANTHROPIC_AUTH_TOKEN: "tok", CLAUDE_CODE_USE_BEDROCK: "1", CLAUDE_CODE_USE_VERTEX: "1", KEEP_ME: "yes" };
    const out = scrubbedEnv(input);
    for (const v of API_KEY_VARS) expect(out[v]).toBeUndefined();
    expect(out.PATH).toBe("/usr/bin");
    expect(out.KEEP_ME).toBe("yes");
  });
  it("does not mutate the input object", () => {
    const input = { ANTHROPIC_API_KEY: "x" };
    scrubbedEnv(input);
    expect(input.ANTHROPIC_API_KEY).toBe("x");
  });
});
