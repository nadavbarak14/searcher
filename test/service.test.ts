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

describe("ResearchService.createTopic", () => {
  it("creates the project topic node + one finding per returned finding", async () => {
    const run: RunFn = async () => ({
      answer: "", claims: [], sources: [], costUsd: 0, sessionId: "s",
      meta: { findings: [ { question: "Q1", body: "B1", sources: ["https://1"] }, { question: "Q2", body: "B2", sources: [] } ] },
    });
    const svc = svcWith(run);
    const result = await svc.createTopic("AI security");
    const { projectId } = result;
    const store = new GraphStore(baseDir, projectId);
    const index = await store.load();
    expect(index.topic).toBe("AI security");
    expect(index.nodes.filter((n) => n.kind === "finding")).toHaveLength(2);
    expect(result.findingCount).toBe(2);
  });
  it("does not clobber an existing project with the same slug", async () => {
    const run: RunFn = async () => ({ answer: "", claims: [], sources: [], costUsd: 0, sessionId: "s", meta: { findings: [{ question: "Q", body: "B", sources: [] }] } });
    const svc = svcWith(run);
    const a = await svc.createTopic("AI security");
    const b = await svc.createTopic("AI security");
    expect(a.projectId).toBe("ai-security");
    expect(b.projectId).toBe("ai-security-2");
  });
});

describe("ResearchService.branch", () => {
  async function seed() {
    const rootRun: RunFn = async () => ({ answer: "", claims: [], sources: [], costUsd: 0, sessionId: "s", meta: { findings: [{ question: "Q1", body: "B1", sources: [] }] } });
    const { projectId } = await svcWith(rootRun).createTopic("AI security");
    return projectId;
  }

  it("creates a child finding for a whole-node question (no anchor)", async () => {
    const projectId = await seed();
    const branchRun: RunFn = async () => ({ answer: "Because of shared features.", claims: ["c"], sources: ["https://x"], costUsd: 0.02, sessionId: "s2", meta: null });
    const node = await new ResearchService(baseDir, branchRun).branch(projectId, { parentId: "n_1", question: "why?" });
    expect(node.kind).toBe("finding");
    expect(node.parents).toEqual(["n_1"]);
    expect(node.anchor).toBeUndefined();
    expect(node.body).toBe("Because of shared features.");
    expect(node.sources).toEqual(["https://x"]);
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
});

describe("ResearchService.setPositions", () => {
  it("delegates to the store and persists positions", async () => {
    const rootRun: RunFn = async () => ({ answer: "", claims: [], sources: [], costUsd: 0, sessionId: "s", meta: { findings: [{ question: "Q1", body: "B1", sources: [] }] } });
    const svc = svcWith(rootRun);
    const { projectId } = await svc.createTopic("AI security");
    await svc.setPositions(projectId, [{ id: "n_1", x: 5, y: 6 }]);
    const store = new GraphStore(baseDir, projectId);
    expect((await store.loadIndex()).nodes.find((m) => m.id === "n_1")?.position).toEqual({ x: 5, y: 6 });
  });
});

describe("ResearchService.synthesize", () => {
  it("returns the runner's answer as the report", async () => {
    const rootRun: RunFn = async () => ({ answer: "", claims: [], sources: [], costUsd: 0, sessionId: "s", meta: { findings: [{ question: "Q1", body: "B1", sources: [] }] } });
    const { projectId } = await svcWith(rootRun).createTopic("AI security");
    const synthRun: RunFn = async () => ({ answer: "# Report\nAll about AI security.", claims: [], sources: [], costUsd: 0.05, sessionId: "s3", meta: null });
    const report = await new ResearchService(baseDir, synthRun).synthesize(projectId);
    expect(report).toContain("# Report");
  });
});

