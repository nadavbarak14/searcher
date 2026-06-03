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

describe("GraphStore.addFinding", () => {
  it("allocates sequential ids n_1, n_2 and bumps nextSeq", async () => {
    const a = await store.addFinding({
      parents: ["topic"],
      question: "What are adversarial examples?",
      body: "Inputs crafted to fool a model.",
      sources: [],
    });
    const b = await store.addFinding({
      parents: ["topic"],
      question: "What is data poisoning?",
      body: "Corrupting training data.",
      sources: [],
    });
    expect(a.id).toBe("n_1");
    expect(b.id).toBe("n_2");
    const index = await store.loadIndex();
    expect(index.nextSeq).toBe(3);
    expect(index.nodes.map((n) => n.id).sort()).toEqual(["n_1", "n_2", "topic"]);
  });

  it("writes the node file with kind=finding and persists optional anchor", async () => {
    const node = await store.addFinding({
      parents: ["topic"],
      anchor: { text: "adversarial", offset: 5, occurrence: 1 },
      question: "Why?",
      body: "Because.",
      sources: ["https://x.test"],
    });
    const reread = await store.getNode(node.id);
    expect(reread.kind).toBe("finding");
    expect(reread.anchor).toEqual({ text: "adversarial", offset: 5, occurrence: 1 });
    expect(reread.sources).toEqual(["https://x.test"]);
  });

  it("records the finding's anchor in the index meta", async () => {
    const store = new GraphStore(baseDir, "p-anchor");
    await store.createProject("Topic");
    await store.addFinding({
      parents: ["topic"],
      anchor: { text: "spoofing", offset: 12, occurrence: 1 },
      question: "why?",
      body: "Because UDP.",
      sources: [],
    });
    const index = await store.load();
    const child = index.nodes.find((n) => n.id === "n_1");
    expect(child?.anchor).toEqual({ text: "spoofing", offset: 12, occurrence: 1 });
  });
});
