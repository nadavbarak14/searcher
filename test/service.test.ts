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
  it("creates a child finding anchored to the selection", async () => {
    const rootRun: RunFn = async () => ({ answer: "", claims: [], sources: [], costUsd: 0, sessionId: "s", meta: { findings: [{ question: "Q1", body: "B1", sources: [] }] } });
    const { projectId } = await svcWith(rootRun).createTopic("AI security");
    const branchRun: RunFn = async () => ({ answer: "Because of shared features.", claims: ["c"], sources: ["https://x"], costUsd: 0.02, sessionId: "s2", meta: null });
    const node = await new ResearchService(baseDir, branchRun).branch(projectId, {
      parentId: "n_1",
      anchor: { text: "features", offset: 3, occurrence: 1 },
      question: "why?",
    });
    expect(node.kind).toBe("finding");
    expect(node.parents).toEqual(["n_1"]);
    expect(node.anchor?.text).toBe("features");
    expect(node.body).toBe("Because of shared features.");
    expect(node.sources).toEqual(["https://x"]);
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

describe("ResearchService.batchBranch", () => {
  async function seedProject() {
    const rootRun: RunFn = async () => ({ answer: "", claims: [], sources: [], costUsd: 0, sessionId: "s", meta: { findings: [{ question: "Q1", body: "B1 about spoofing and forging", sources: [] }] } });
    const { projectId } = await svcWith(rootRun).createTopic("AI security");
    return projectId;
  }

  it("runs all questions in parallel and creates one sibling finding each, in input order", async () => {
    const projectId = await seedProject();
    const run: RunFn = async ({ prompt }) => ({ answer: `answer for ${prompt.includes("forge") ? "forge" : "spoof"}`, claims: [], sources: ["https://x"], costUsd: 0, sessionId: "s", meta: null });
    const svc = new ResearchService(baseDir, run);
    const out = await svc.batchBranch(projectId, [
      { parentId: "n_1", anchor: { text: "spoofing", offset: 0, occurrence: 1 }, question: "why spoof?" },
      { parentId: "n_1", anchor: { text: "forging", offset: 0, occurrence: 1 }, question: "why forge?" },
    ]);
    expect(out.failures).toEqual([]);
    expect(out.created).toHaveLength(2);
    expect(out.created.every((n) => n.parents.includes("n_1"))).toBe(true);
    const ids = out.created.map((n) => n.id);
    expect(new Set(ids).size).toBe(2); // unique ids — no index race
  });

  it("isolates failures: successes persist, the failed item is reported by index", async () => {
    const projectId = await seedProject();
    const run: RunFn = async ({ prompt }) => {
      if (prompt.includes("BOOM")) throw new Error("model failed");
      return { answer: "ok", claims: [], sources: [], costUsd: 0, sessionId: "s", meta: null };
    };
    const svc = new ResearchService(baseDir, run);
    const out = await svc.batchBranch(projectId, [
      { parentId: "n_1", anchor: { text: "spoofing", offset: 0, occurrence: 1 }, question: "fine one" },
      { parentId: "n_1", anchor: { text: "spoofing", offset: 0, occurrence: 1 }, question: "BOOM please" },
      { parentId: "n_1", anchor: { text: "forging", offset: 0, occurrence: 1 }, question: "another fine" },
    ]);
    expect(out.created).toHaveLength(2);
    expect(out.failures).toEqual([{ index: 1, error: "model failed" }]);
    const store = new GraphStore(baseDir, projectId);
    const index = await store.load();
    expect(index.nodes.filter((n) => n.kind === "finding")).toHaveLength(3); // 1 seeded + 2 new
  });
});
