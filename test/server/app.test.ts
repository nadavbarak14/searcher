import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../../src/server/app.js";
import type { ResearchService } from "../../src/service.js";

let baseDir: string;
const PUBLIC = path.resolve(process.cwd(), "public");
beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "searcher-app-"));
});
afterEach(async () => baseDir && (await fs.rm(baseDir, { recursive: true, force: true })));

function stubService(over: Partial<ResearchService> = {}): ResearchService {
  return {
    createTopic: async () => ({ projectId: "ai-security" }),
    branch: async () => ({ id: "n_1", kind: "finding", parents: ["topic"], question: "q", sources: [], created: "t", body: "b" }),
    synthesize: async () => "# Report",
    ...over,
  } as unknown as ResearchService;
}

describe("buildApp routes", () => {
  it("POST /api/projects creates a topic", async () => {
    const app = buildApp({ dataDir: baseDir, service: stubService(), publicDir: PUBLIC });
    const res = await app.inject({ method: "POST", url: "/api/projects", payload: { topic: "AI security" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().projectId).toBe("ai-security");
    await app.close();
  });
  it("POST /api/projects 400s when topic missing", async () => {
    const app = buildApp({ dataDir: baseDir, service: stubService(), publicDir: PUBLIC });
    const res = await app.inject({ method: "POST", url: "/api/projects", payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
  it("POST /api/projects/:id/branch returns the new node", async () => {
    const app = buildApp({ dataDir: baseDir, service: stubService(), publicDir: PUBLIC });
    const res = await app.inject({ method: "POST", url: "/api/projects/ai-security/branch", payload: { parentId: "topic", anchor: { text: "x", offset: 0, occurrence: 1 }, question: "why?" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe("n_1");
    await app.close();
  });
  it("GET /api/projects lists project folders in the data dir", async () => {
    await fs.mkdir(path.join(baseDir, "proj-a"));
    await fs.mkdir(path.join(baseDir, "proj-b"));
    const app = buildApp({ dataDir: baseDir, service: stubService(), publicDir: PUBLIC });
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    expect(res.statusCode).toBe(200);
    expect(res.json().projects.sort()).toEqual(["proj-a", "proj-b"]);
    await app.close();
  });
  it("serves the placeholder index.html at /", async () => {
    const app = buildApp({ dataDir: baseDir, service: stubService(), publicDir: PUBLIC });
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Searcher");
    await app.close();
  });
});
