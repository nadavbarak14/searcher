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
});
afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

describe("GraphStore concurrent writes", () => {
  it("ten parallel addFinding calls produce ten distinct ids and a consistent index", async () => {
    const tasks = Array.from({ length: 10 }, (_, i) =>
      store.addFinding({ parents: ["topic"], question: `Q${i}`, body: `A${i}`, sources: [] }),
    );
    const created = await Promise.all(tasks);
    const ids = created.map((n) => n.id);
    expect(new Set(ids).size).toBe(10);

    const index = await store.loadIndex();
    expect(index.nextSeq).toBe(11);
    expect(index.nodes).toHaveLength(11);
    for (const id of ids) {
      expect(index.nodes.filter((n) => n.id === id)).toHaveLength(1);
    }
  });
});
