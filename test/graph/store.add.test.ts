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

  it("persists tokens/costUsd onto the finding node and index meta", async () => {
    const node = await store.addFinding({
      parents: ["topic"],
      question: "Why?",
      body: "Because.",
      sources: [],
      tokens: 4200,
      costUsd: 0.013,
    });
    const reread = await store.getNode(node.id);
    expect(reread.tokens).toBe(4200);
    expect(reread.costUsd).toBe(0.013);
    const index = await store.loadIndex();
    const meta = index.nodes.find((m) => m.id === node.id);
    expect(meta?.tokens).toBe(4200);
    expect(meta?.costUsd).toBe(0.013);
  });

  it("setNodeUsage attaches totals to the topic node + index, surviving a rebuild", async () => {
    await store.setNodeUsage("topic", { tokens: 120000, costUsd: 0.5 });
    const topic = await store.getNode("topic");
    expect(topic.tokens).toBe(120000);
    expect(topic.costUsd).toBe(0.5);
    const index = await store.loadIndex();
    expect(index.nodes.find((m) => m.id === "topic")?.tokens).toBe(120000);
    const rebuilt = await store.rebuildIndex(); // proves it lives in the .md, not just the index
    expect(rebuilt.nodes.find((m) => m.id === "topic")?.tokens).toBe(120000);
    expect(rebuilt.nodes.find((m) => m.id === "topic")?.costUsd).toBe(0.5);
  });

  it("setNodeUsage ignores unknown ids without throwing", async () => {
    await expect(store.setNodeUsage("nope", { tokens: 1 })).resolves.toBeUndefined();
  });

  it("addFinding persists teaser/researched onto the node + index meta", async () => {
    const node = await store.addFinding({
      parents: ["topic"], question: "Q?", body: "", sources: [], teaser: "why it matters", researched: false,
    });
    const reread = await store.getNode(node.id);
    expect(reread.teaser).toBe("why it matters");
    expect(reread.researched).toBe(false);
    const meta = (await store.loadIndex()).nodes.find((m) => m.id === node.id);
    expect(meta?.teaser).toBe("why it matters");
    expect(meta?.researched).toBe(false);
  });

  it("updateNode patches body/sources/teaser/researched and mirrors onto the index meta", async () => {
    const node = await store.addFinding({ parents: ["topic"], question: "Q?", body: "", sources: [], teaser: "w", researched: false });
    const updated = await store.updateNode(node.id, { body: "Now researched.", sources: ["https://s"], tokens: 99, researched: true });
    expect(updated.body).toBe("Now researched.");
    expect(updated.sources).toEqual(["https://s"]);
    expect(updated.tokens).toBe(99);
    expect(updated.researched).toBe(true);
    expect(updated.teaser).toBe("w"); // untouched
    const reread = await store.getNode(node.id);
    expect(reread.body).toBe("Now researched.");
    const meta = (await store.loadIndex()).nodes.find((m) => m.id === node.id);
    expect(meta?.researched).toBe(true);
    expect(meta?.tokens).toBe(99);
  });

  it("updateNode throws on an unknown id", async () => {
    await expect(store.updateNode("nope", { body: "x" })).rejects.toThrow(/unknown node nope/);
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
