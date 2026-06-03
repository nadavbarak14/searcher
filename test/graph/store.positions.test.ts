import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GraphStore } from "../../src/graph/store.js";

let baseDir: string;
afterEach(async () => baseDir && (await fs.rm(baseDir, { recursive: true, force: true })));
beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "searcher-pos-"));
});

describe("GraphStore.setPositions", () => {
  it("persists positions to node files and the index, and survives a rebuild", async () => {
    const store = new GraphStore(baseDir, "p");
    await store.createProject("T");
    const n = await store.addFinding({ parents: ["topic"], question: "Q", body: "B", sources: [] });
    await store.setPositions([
      { id: n.id, x: 10, y: 20 },
      { id: "topic", x: 0, y: 0 },
    ]);

    const index = await store.loadIndex();
    expect(index.nodes.find((m) => m.id === n.id)?.position).toEqual({ x: 10, y: 20 });

    const rebuilt = await store.rebuildIndex(); // proves it lives in the .md, not just the index
    expect(rebuilt.nodes.find((m) => m.id === n.id)?.position).toEqual({ x: 10, y: 20 });
  });

  it("ignores unknown ids without throwing", async () => {
    const store = new GraphStore(baseDir, "p");
    await store.createProject("T");
    await expect(store.setPositions([{ id: "nope", x: 1, y: 2 }])).resolves.toBeUndefined();
  });
});
