import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GraphStore } from "../../src/graph/store.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let baseDir: string;
let store: GraphStore;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "searcher-"));
  store = new GraphStore(baseDir, "proj1");
  await store.createProject("AI security");
  await store.addFinding({ parents: ["topic"], question: "Q1", body: "A1", sources: [] }); // n_1
  await store.addFinding({ parents: ["topic"], question: "Q2", body: "A2", sources: [] }); // n_2
});
afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

describe("GraphStore.rebuildIndex", () => {
  it("reconstructs the index from .md files alone", async () => {
    await fs.rm(path.join(baseDir, "proj1", "graph.json"));
    const rebuilt = await store.rebuildIndex();
    expect(rebuilt.topic).toBe("AI security");
    expect(rebuilt.nodes.map((n) => n.id).sort()).toEqual(["n_1", "n_2", "topic"]);
    expect(rebuilt.nextSeq).toBe(3);
  });

  it("load() returns the existing index when present", async () => {
    const index = await store.load();
    expect(index.nodes).toHaveLength(3);
  });

  it("load() rebuilds when graph.json is missing", async () => {
    await fs.rm(path.join(baseDir, "proj1", "graph.json"));
    const index = await store.load();
    expect(index.nodes).toHaveLength(3);
    expect(index.nextSeq).toBe(3);
    const onDisk = JSON.parse(await fs.readFile(path.join(baseDir, "proj1", "graph.json"), "utf8"));
    expect(onDisk.nodes).toHaveLength(3);
  });
});
