import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GraphStore } from "../../src/graph/store.js";
import { markdownToNode } from "../../src/graph/serialize.js";
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

describe("GraphStore.createProject", () => {
  it("creates the folder, a topic node file, and graph.json", async () => {
    const store = new GraphStore(baseDir, "proj1");
    await store.createProject("AI security");

    const topicMd = await fs.readFile(path.join(baseDir, "proj1", "topic.md"), "utf8");
    const topic = markdownToNode("topic", topicMd);
    expect(topic.kind).toBe("topic");
    expect(topic.question).toBe("AI security");
    expect(topic.parents).toEqual([]);

    const index = JSON.parse(await fs.readFile(path.join(baseDir, "proj1", "graph.json"), "utf8"));
    expect(index.topic).toBe("AI security");
    expect(index.nextSeq).toBe(1);
    expect(index.nodes).toHaveLength(1);
    expect(index.nodes[0].id).toBe("topic");
  });

  it("sets a valid ISO created timestamp on the topic node", async () => {
    const store = new GraphStore(baseDir, "proj1");
    await store.createProject("AI security");
    const topic = await store.getNode("topic");
    expect(Number.isNaN(Date.parse(topic.created))).toBe(false);
  });
});
