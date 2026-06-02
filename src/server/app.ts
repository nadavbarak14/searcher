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
    if (!parentId || !anchor || !question) {
      return reply.code(400).send({ error: "parentId, anchor and question are required" });
    }
    return deps.service.branch(req.params.id, { parentId, anchor, question });
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/synthesize", async (req) => {
    const markdown = await deps.service.synthesize(req.params.id);
    return { markdown };
  });

  app.register(fastifyStatic, { root: deps.publicDir });

  return app;
}
