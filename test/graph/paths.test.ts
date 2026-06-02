import { describe, it, expect } from "vitest";
import { projectDir, nodePath, indexPath } from "../../src/graph/paths.js";
import path from "node:path";

describe("paths", () => {
  const base = "/data/Searcher";

  it("projectDir joins base + project id", () => {
    expect(projectDir(base, "proj1")).toBe(path.join(base, "proj1"));
  });

  it("nodePath is <project>/<id>.md", () => {
    expect(nodePath(base, "proj1", "n_1")).toBe(path.join(base, "proj1", "n_1.md"));
  });

  it("indexPath is <project>/graph.json", () => {
    expect(indexPath(base, "proj1")).toBe(path.join(base, "proj1", "graph.json"));
  });
});
