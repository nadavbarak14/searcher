import { describe, it, expect } from "vitest";
import { resolveConfig } from "../src/config.js";
import os from "node:os";
import path from "node:path";

describe("resolveConfig", () => {
  it("uses defaults when env is empty", () => {
    const cfg = resolveConfig({});
    expect(cfg.port).toBe(4317);
    expect(cfg.dataDir).toBe(path.join(os.homedir(), "Searcher"));
  });
  it("honors SEARCHER_PORT and SEARCHER_DATA_DIR", () => {
    const cfg = resolveConfig({ SEARCHER_PORT: "5000", SEARCHER_DATA_DIR: "/tmp/x" });
    expect(cfg.port).toBe(5000);
    expect(cfg.dataDir).toBe("/tmp/x");
  });
  it("ignores a non-numeric port and falls back to default", () => {
    const cfg = resolveConfig({ SEARCHER_PORT: "abc" });
    expect(cfg.port).toBe(4317);
  });
});
