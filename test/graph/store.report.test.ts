import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GraphStore } from "../../src/graph/store.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let baseDir: string;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "searcher-"));
});
afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

async function seed(): Promise<GraphStore> {
  const store = new GraphStore(baseDir, "proj1");
  await store.createProject("AI security");
  await store.updateNode("topic", { body: "An overview." });
  await store.addFinding({ parents: ["topic"], question: "What is X?", body: "X is a thing.", sources: [], researched: true });
  return store;
}

describe("GraphStore report persistence + staleness", () => {
  it("returns null before any synthesis", async () => {
    const store = await seed();
    expect(await store.report()).toBeNull();
    expect(await store.reportStatus()).toBeNull();
  });

  it("saves the report and reports it fresh", async () => {
    const store = await seed();
    await store.saveReport("# Report\n\nThe synthesis.");
    const report = await store.report();
    expect(report?.markdown).toBe("# Report\n\nThe synthesis.");
    expect(report?.stale).toBe(false);
    expect(Number.isNaN(Date.parse(report!.generatedAt))).toBe(false);
    expect((await store.reportStatus())?.stale).toBe(false);
  });

  it("marks the report stale when a node's content changes", async () => {
    const store = await seed();
    await store.saveReport("# Report");
    await store.updateNode("n_1", { body: "X is now something else." });
    expect((await store.report())?.stale).toBe(true);
    expect((await store.reportStatus())?.stale).toBe(true);
  });

  it("marks the report stale when a finding is added", async () => {
    const store = await seed();
    await store.saveReport("# Report");
    await store.addFinding({ parents: ["topic"], question: "What is Y?", body: "Y too.", sources: [], researched: true });
    expect((await store.report())?.stale).toBe(true);
  });

  it("does NOT mark stale on a position-only change", async () => {
    const store = await seed();
    await store.saveReport("# Report");
    await store.setPositions([{ id: "n_1", x: 10, y: 20 }]);
    expect((await store.report())?.stale).toBe(false);
  });

  it("re-saving after a change clears staleness", async () => {
    const store = await seed();
    await store.saveReport("# Report v1");
    await store.updateNode("n_1", { body: "Changed." });
    expect((await store.report())?.stale).toBe(true);
    await store.saveReport("# Report v2");
    const report = await store.report();
    expect(report?.markdown).toBe("# Report v2");
    expect(report?.stale).toBe(false);
  });

  it("keeps report.json out of the rebuilt index (not treated as a node)", async () => {
    const store = await seed();
    await store.saveReport("# Report");
    const index = await store.rebuildIndex();
    expect(index.nodes.map((n) => n.id).sort()).toEqual(["n_1", "topic"]);
  });
});
