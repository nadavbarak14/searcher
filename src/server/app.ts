import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fs from "node:fs/promises";
import type { ResearchService } from "../service.js";
import { GraphStore } from "../graph/store.js";

export interface AppDeps {
  dataDir: string;
  service: ResearchService;
  publicDir: string;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/api/projects", async () => {
    const entries = await fs.readdir(deps.dataDir, { withFileTypes: true }).catch(() => []);
    const projects = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    return { projects };
  });

  app.post<{ Body: { topic?: string } }>("/api/projects", async (req, reply) => {
    const topic = req.body?.topic?.trim();
    if (!topic) return reply.code(400).send({ error: "topic is required" });
    return deps.service.createTopic(topic);
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id", async (req, reply) => {
    const store = new GraphStore(deps.dataDir, req.params.id);
    try {
      const index = await store.load();
      return { index };
    } catch {
      return reply.code(404).send({ error: "project not found" });
    }
  });

  app.post<{
    Params: { id: string };
    Body: { parentId?: string; anchor?: { text: string; offset: number; occurrence: number }; question?: string };
  }>("/api/projects/:id/branch", async (req, reply) => {
    const { parentId, anchor, question } = req.body ?? {};
    if (!parentId || !question) {
      return reply.code(400).send({ error: "parentId and question are required" });
    }
    const input: { parentId: string; question: string; anchor?: typeof anchor } = { parentId, question };
    if (anchor) input.anchor = anchor;
    return deps.service.branch(req.params.id, input);
  });

  app.patch<{
    Params: { id: string };
    Body: { positions?: { id: string; x: number; y: number }[] };
  }>("/api/projects/:id/positions", async (req, reply) => {
    const positions = req.body?.positions;
    if (!Array.isArray(positions)) {
      return reply.code(400).send({ error: "positions must be an array" });
    }
    for (const p of positions) {
      if (typeof p?.id !== "string" || typeof p.x !== "number" || typeof p.y !== "number") {
        return reply.code(400).send({ error: "each position needs id:string, x:number, y:number" });
      }
    }
    await deps.service.setPositions(req.params.id, positions);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/synthesize", async (req) => {
    const markdown = await deps.service.synthesize(req.params.id);
    return { markdown };
  });

  app.get<{ Params: { id: string; nodeId: string } }>("/api/projects/:id/nodes/:nodeId", async (req, reply) => {
    const store = new GraphStore(deps.dataDir, req.params.id);
    try {
      const node = await store.getNode(req.params.nodeId);
      return { node };
    } catch {
      return reply.code(404).send({ error: "node not found" });
    }
  });

  app.register(fastifyStatic, { root: deps.publicDir });

  app.setNotFoundHandler((req, reply) => {
    if (req.method === "GET" && !req.url.startsWith("/api")) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "not found" });
  });

  return app;
}
