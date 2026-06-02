import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../../src/server/app.js";
import type { ResearchService } from "../../src/service.js";
import { GraphStore } from "../../src/graph/store.js";

let dataDir: string;
let publicDir: string;
beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "searcher-data-"));
  publicDir = await fs.mkdtemp(path.join(os.tmpdir(), "searcher-pub-"));
  await fs.writeFile(path.join(publicDir, "index.html"), "<!doctype html><title>Searcher</title><div id=root></div>");
});
afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.rm(publicDir, { recursive: true, force: true });
});

function stubService(over: Partial<ResearchService> = {}): ResearchService {
  return {
    createTopic: async () => ({ projectId: "ai-security", findingCount: 3 }),
    branch: async () => ({ id: "n_1", kind: "finding", parents: ["topic"], question: "q", sources: [], created: "t", body: "b" }),
    synthesize: async () => "# Report",
    ...over,
  } as unknown as ResearchService;
}

describe("buildApp routes", () => {
  it("POST /api/projects returns projectId + findingCount", async () => {
    const app = buildApp({ dataDir, service: stubService(), publicDir });
    const res = await app.inject({ method: "POST", url: "/api/projects", payload: { topic: "AI security" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ projectId: "ai-security", findingCount: 3 });
    await app.close();
  });
  it("POST /api/projects 400s when topic missing", async () => {
    const app = buildApp({ dataDir, service: stubService(), publicDir });
    const res = await app.inject({ method: "POST", url: "/api/projects", payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
  it("GET /api/projects/:id/nodes/:nodeId returns the full node", async () => {
    const store = new GraphStore(dataDir, "proj1");
    await store.createProject("AI security");
    const node = await store.addFinding({ parents: ["topic"], question: "Q?", body: "Answer body", sources: ["https://x"] });
    const app = buildApp({ dataDir, service: stubService(), publicDir });
    const res = await app.inject({ method: "GET", url: `/api/projects/proj1/nodes/${node.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().node.body).toBe("Answer body");
    await app.close();
  });
  it("GET unknown node 404s", async () => {
    const store = new GraphStore(dataDir, "proj1");
    await store.createProject("AI security");
    const app = buildApp({ dataDir, service: stubService(), publicDir });
    const res = await app.inject({ method: "GET", url: "/api/projects/proj1/nodes/n_999" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
  it("GET /api/projects lists project folders", async () => {
    await fs.mkdir(path.join(dataDir, "proj-a"));
    const app = buildApp({ dataDir, service: stubService(), publicDir });
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    expect(res.json().projects).toContain("proj-a");
    await app.close();
  });
  it("serves index.html at / and falls back to it for client routes", async () => {
    const app = buildApp({ dataDir, service: stubService(), publicDir });
    const root = await app.inject({ method: "GET", url: "/" });
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain("Searcher");
    const deep = await app.inject({ method: "GET", url: "/project/ai-security" });
    expect(deep.statusCode).toBe(200);
    expect(deep.body).toContain("root");
    await app.close();
  });
  it("unknown /api route still 404s (no SPA fallback for api)", async () => {
    const app = buildApp({ dataDir, service: stubService(), publicDir });
    const res = await app.inject({ method: "GET", url: "/api/nope" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
