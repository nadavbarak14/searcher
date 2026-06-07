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
    researchNode: async () => ({ id: "n_1", kind: "finding", parents: ["topic"], question: "q", sources: [], created: "t", body: "researched body", researched: true }),
    setPositions: async () => undefined,
    synthesize: async () => "# Report",
    ...over,
  } as unknown as ResearchService;
}

/** Parse an NDJSON response body into its constituent JSON objects. */
function parseNdjson(body: string): any[] {
  return body.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

describe("buildApp routes", () => {
  it("POST /api/projects streams activity then a result line with projectId + findingCount", async () => {
    const svc = stubService({
      createTopic: (async (_topic: string, onActivity?: (e: { type: string; label: string }) => void) => {
        onActivity?.({ type: "tool", label: 'Searching the web for "ai"' });
        onActivity?.({ type: "status", label: "Composing the answer…" });
        return { projectId: "ai-security", findingCount: 3 };
      }) as unknown as ResearchService["createTopic"],
    });
    const app = buildApp({ dataDir, service: svc, publicDir });
    const res = await app.inject({ method: "POST", url: "/api/projects", payload: { topic: "AI security" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/x-ndjson");
    const lines = parseNdjson(res.body);
    expect(lines[0]).toEqual({ type: "tool", label: 'Searching the web for "ai"' });
    expect(lines[1]).toEqual({ type: "status", label: "Composing the answer…" });
    expect(lines[lines.length - 1]).toEqual({ type: "result", data: { projectId: "ai-security", findingCount: 3 } });
    await app.close();
  });
  it("POST /api/projects emits an error line when the service throws", async () => {
    const svc = stubService({ createTopic: (async () => { throw new Error("kaboom"); }) as unknown as ResearchService["createTopic"] });
    const app = buildApp({ dataDir, service: svc, publicDir });
    const res = await app.inject({ method: "POST", url: "/api/projects", payload: { topic: "AI security" } });
    expect(res.statusCode).toBe(200);
    const lines = parseNdjson(res.body);
    expect(lines[lines.length - 1]).toEqual({ type: "error", message: "kaboom" });
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
  it("GET /api/projects returns a summary per project (topic, nodes, sources, depth)", async () => {
    const store = new GraphStore(dataDir, "proj-a");
    await store.createProject("AI security");
    await store.addFinding({ parents: ["topic"], question: "Q?", body: "b", sources: ["https://x", "https://y"] });
    await fs.mkdir(path.join(dataDir, "empty-dir")); // no index — must be skipped, not crash
    const app = buildApp({ dataDir, service: stubService(), publicDir });
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    const projects = res.json().projects as { id: string; topic: string; nodes: number; sources: number; depth: number }[];
    expect(projects.map((p) => p.id)).toEqual(["proj-a"]);
    expect(projects[0]).toMatchObject({ topic: "AI security", nodes: 2, sources: 2, depth: 1 });
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
  it("POST /branch accepts a whole-node question without an anchor and streams a result node", async () => {
    const app = buildApp({ dataDir, service: stubService(), publicDir });
    const res = await app.inject({ method: "POST", url: "/api/projects/p1/branch", payload: { parentId: "n_1", question: "why?" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/x-ndjson");
    const lines = parseNdjson(res.body);
    const last = lines[lines.length - 1];
    expect(last.type).toBe("result");
    expect(last.data.id).toBe("n_1");
    await app.close();
  });
  it("POST /nodes/:nodeId/research streams activity then a result node", async () => {
    const svc = stubService({
      researchNode: (async (_id: string, _nodeId: string, onActivity?: (e: { type: string; label: string }) => void) => {
        onActivity?.({ type: "tool", label: 'Searching the web for "x"' });
        return { id: "n_1", kind: "finding", parents: ["topic"], question: "q", sources: ["https://x"], created: "t", body: "researched body", researched: true };
      }) as unknown as ResearchService["researchNode"],
    });
    const app = buildApp({ dataDir, service: svc, publicDir });
    const res = await app.inject({ method: "POST", url: "/api/projects/p1/nodes/n_1/research", payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/x-ndjson");
    const lines = parseNdjson(res.body);
    expect(lines[0]).toEqual({ type: "tool", label: 'Searching the web for "x"' });
    const last = lines[lines.length - 1];
    expect(last.type).toBe("result");
    expect(last.data.id).toBe("n_1");
    expect(last.data.researched).toBe(true);
    await app.close();
  });

  it("POST /branch 400s without parentId or question", async () => {
    const app = buildApp({ dataDir, service: stubService(), publicDir });
    const res = await app.inject({ method: "POST", url: "/api/projects/p1/branch", payload: { parentId: "n_1" } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
  it("PATCH /positions persists and returns ok", async () => {
    let received: unknown = null;
    const svc = stubService({ setPositions: async (_id: string, updates: unknown) => { received = updates; } } as Partial<ResearchService>);
    const app = buildApp({ dataDir, service: svc, publicDir });
    const res = await app.inject({ method: "PATCH", url: "/api/projects/p1/positions", payload: { positions: [{ id: "n_1", x: 1, y: 2 }] } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(received).toEqual([{ id: "n_1", x: 1, y: 2 }]);
    await app.close();
  });
  it("PATCH /positions 400s on a non-array body", async () => {
    const app = buildApp({ dataDir, service: stubService(), publicDir });
    const res = await app.inject({ method: "PATCH", url: "/api/projects/p1/positions", payload: { positions: "nope" } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
  it("PATCH /positions 400s when an entry is malformed", async () => {
    const app = buildApp({ dataDir, service: stubService(), publicDir });
    const res = await app.inject({ method: "PATCH", url: "/api/projects/p1/positions", payload: { positions: [{ id: "n_1", x: "no" }] } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
