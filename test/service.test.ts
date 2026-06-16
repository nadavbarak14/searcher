import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GraphStore } from "../src/graph/store.js";
import { ResearchService, type RunFn } from "../src/service.js";

let baseDir: string;
afterEach(async () => baseDir && (await fs.rm(baseDir, { recursive: true, force: true })));
beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "searcher-svc-"));
});

function svcWith(run: RunFn) {
  return new ResearchService(baseDir, run);
}

const SUMMARY = "Adversarial examples fool models. Data poisoning corrupts training data badly.";

describe("ResearchService.createTopic", () => {
  it("stores the summary as the topic body and one content-filled node per returned node", async () => {
    const run: RunFn = async () => ({
      answer: "", claims: [], sources: ["https://root"], costUsd: 0.4, tokens: 120000, sessionId: "s",
      meta: {
        summary: SUMMARY,
        nodes: [
          { quote: "Adversarial examples", title: "T1", body: "Body one.", sources: ["https://a"] },
          { quote: "Data poisoning", title: "T2", body: "Body two.", sources: [] },
        ],
      },
    });
    const svc = svcWith(run);
    const result = await svc.createTopic("AI security");
    const { projectId } = result;
    const store = new GraphStore(baseDir, projectId);
    const index = await store.load();
    expect(index.topic).toBe("AI security");
    expect(index.nodes.filter((n) => n.kind === "finding")).toHaveLength(2);
    expect(result.findingCount).toBe(2);
    expect(result.tokens).toBe(120000);

    // the short summary is stored as the topic node's body, with the run's totals + sources
    const topic = await store.getNode("topic");
    expect(topic.body).toBe(SUMMARY);
    expect(topic.sources).toEqual(["https://root"]);
    expect(topic.tokens).toBe(120000);
    expect(topic.costUsd).toBe(0.4);
    expect(index.nodes.find((n) => n.id === "topic")?.tokens).toBe(120000);

    // each node is an anchored, already-researched node carrying its own findings + sources
    const t1 = await store.getNode("n_1");
    expect(t1.question).toBe("T1");
    expect(t1.body).toBe("Body one.");
    expect(t1.sources).toEqual(["https://a"]);
    expect(t1.researched).toBe(true);
    expect(t1.anchor).toEqual({ text: "Adversarial examples", offset: 0, occurrence: 0 });

    const t2 = await store.getNode("n_2");
    expect(t2.body).toBe("Body two.");
    expect(t2.anchor).toEqual({ text: "Data poisoning", offset: SUMMARY.indexOf("Data poisoning"), occurrence: 0 });
  });

  it("leaves a node unanchored when its quote is absent from the summary", async () => {
    const run: RunFn = async () => ({
      answer: "", claims: [], sources: [], costUsd: 0, sessionId: "s",
      meta: { summary: SUMMARY, nodes: [{ quote: "not in the summary", title: "T", body: "B", sources: [] }] },
    });
    const { projectId } = await svcWith(run).createTopic("AI security");
    const store = new GraphStore(baseDir, projectId);
    expect((await store.getNode("n_1")).anchor).toBeUndefined();
  });

  it("does not clobber an existing project with the same slug", async () => {
    const run: RunFn = async () => ({ answer: "", claims: [], sources: [], costUsd: 0, sessionId: "s", meta: { summary: "O", nodes: [{ quote: "O", title: "T", body: "B", sources: [] }] } });
    const svc = svcWith(run);
    const a = await svc.createTopic("AI security");
    const b = await svc.createTopic("AI security");
    expect(a.projectId).toBe("ai-security");
    expect(b.projectId).toBe("ai-security-2");
  });
});

describe("ResearchService.researchNode", () => {
  async function seedNode() {
    const rootRun: RunFn = async () => ({
      answer: "", claims: [], sources: [], costUsd: 0, sessionId: "s",
      meta: { summary: SUMMARY, nodes: [{ quote: "Adversarial examples", title: "How do adversarial examples work?", body: "Seed body.", sources: [] }] },
    });
    const { projectId } = await svcWith(rootRun).createTopic("AI security");
    return projectId;
  }

  it("fills body/sources/tokens and keeps researched true on the node + index meta", async () => {
    const projectId = await seedNode();
    const runResearch: RunFn = async () => ({ answer: "Crafted inputs.", claims: [], sources: ["https://x"], costUsd: 0.03, tokens: 5555, sessionId: "s2", meta: null });
    const node = await new ResearchService(baseDir, runResearch).researchNode(projectId, "n_1");
    expect(node.body).toBe("Crafted inputs.");
    expect(node.sources).toEqual(["https://x"]);
    expect(node.tokens).toBe(5555);
    expect(node.researched).toBe(true);
    const store = new GraphStore(baseDir, projectId);
    expect((await store.getNode("n_1")).body).toBe("Crafted inputs.");
    const meta = (await store.loadIndex()).nodes.find((m) => m.id === "n_1");
    expect(meta?.researched).toBe(true);
    expect(meta?.tokens).toBe(5555);
  });
});

describe("ResearchService.branch", () => {
  async function seed() {
    const rootRun: RunFn = async () => ({ answer: "", claims: [], sources: [], costUsd: 0, sessionId: "s", meta: { summary: "Q1 summary", nodes: [{ quote: "Q1", title: "Q1", body: "B1", sources: [] }] } });
    const { projectId } = await svcWith(rootRun).createTopic("AI security");
    return projectId;
  }

  it("creates a child finding for a whole-node question (no anchor)", async () => {
    const projectId = await seed();
    const branchRun: RunFn = async () => ({ answer: "Because of shared features.", claims: ["c"], sources: ["https://x"], costUsd: 0.02, tokens: 7777, sessionId: "s2", meta: null });
    const node = await new ResearchService(baseDir, branchRun).branch(projectId, { parentId: "n_1", question: "why?" });
    expect(node.kind).toBe("finding");
    expect(node.parents).toEqual(["n_1"]);
    expect(node.anchor).toBeUndefined();
    expect(node.body).toBe("Because of shared features.");
    expect(node.sources).toEqual(["https://x"]);
    expect(node.tokens).toBe(7777);
    expect(node.costUsd).toBe(0.02);
  });

  it("injects a research brief (goal + prior findings) into the branch prompt", async () => {
    const projectId = await seed();
    let seenPrompt = "";
    const branchRun: RunFn = async ({ prompt }) => {
      seenPrompt = prompt;
      return { answer: "x", claims: [], sources: [], costUsd: 0, sessionId: "s2", meta: null };
    };
    await new ResearchService(baseDir, branchRun).branch(projectId, { parentId: "n_1", question: "why?" });
    expect(seenPrompt).toContain("RESEARCH GOAL: AI security");
    expect(seenPrompt).toContain("Q1 — B1"); // the existing finding shows up as accumulated memory
  });

  it("still accepts an optional anchor", async () => {
    const projectId = await seed();
    const branchRun: RunFn = async () => ({ answer: "x", claims: [], sources: [], costUsd: 0, sessionId: "s2", meta: null });
    const node = await new ResearchService(baseDir, branchRun).branch(projectId, {
      parentId: "n_1",
      question: "q",
      anchor: { text: "features", offset: 3, occurrence: 1 },
    });
    expect(node.anchor?.text).toBe("features");
  });

  it("persists the anchor on a branched child", async () => {
    const projectId = await seed();
    const branchRun: RunFn = async () => ({ answer: "x", claims: [], sources: [], costUsd: 0, sessionId: "s2", meta: null });
    const anchor = { text: "selected span", offset: 4, occurrence: 0 };
    const child = await new ResearchService(baseDir, branchRun).branch(projectId, { parentId: "n_1", question: "why?", anchor });
    expect(child.anchor).toEqual(anchor);
  });
});

describe("ResearchService.setPositions", () => {
  it("delegates to the store and persists positions", async () => {
    const rootRun: RunFn = async () => ({ answer: "", claims: [], sources: [], costUsd: 0, sessionId: "s", meta: { summary: "Q1 summary", nodes: [{ quote: "Q1", title: "Q1", body: "B1", sources: [] }] } });
    const svc = svcWith(rootRun);
    const { projectId } = await svc.createTopic("AI security");
    await svc.setPositions(projectId, [{ id: "n_1", x: 5, y: 6 }]);
    const store = new GraphStore(baseDir, projectId);
    expect((await store.loadIndex()).nodes.find((m) => m.id === "n_1")?.position).toEqual({ x: 5, y: 6 });
  });
});

describe("ResearchService.synthesize", () => {
  it("returns the runner's answer as the report", async () => {
    const rootRun: RunFn = async () => ({ answer: "", claims: [], sources: [], costUsd: 0, sessionId: "s", meta: { summary: "Q1 summary", nodes: [{ quote: "Q1", title: "Q1", body: "B1", sources: [] }] } });
    const { projectId } = await svcWith(rootRun).createTopic("AI security");
    const synthRun: RunFn = async () => ({ answer: "# Report\nAll about AI security.", claims: [], sources: [], costUsd: 0.05, sessionId: "s3", meta: null });
    const svc = new ResearchService(baseDir, synthRun);
    const report = await svc.synthesize(projectId);
    expect(report.markdown).toContain("# Report");
    expect(report.stale).toBe(false);
    // persisted and re-readable
    expect((await svc.getReport(projectId))?.markdown).toContain("# Report");
  });
});

