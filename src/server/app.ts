import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import fastifyStatic from "@fastify/static";
import fs from "node:fs/promises";
import type { ResearchService, ActivityEvent } from "../service.js";
import { GraphStore } from "../graph/store.js";

/**
 * Stream a service call as NDJSON: forward each ActivityEvent as a line, then a terminal
 * {type:"result",data} (or {type:"error",message}) line, then end. Validation/headers must
 * be handled by the caller before invoking this (we hijack the reply here).
 */
async function streamNdjson(reply: FastifyReply, work: (onActivity: (e: ActivityEvent) => void) => Promise<unknown>): Promise<void> {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, { "content-type": "application/x-ndjson" });
  const write = (obj: unknown) => raw.write(JSON.stringify(obj) + "\n");
  try {
    const data = await work((e) => write(e));
    write({ type: "result", data });
  } catch (err) {
    write({ type: "error", message: String(err instanceof Error ? err.message : err) });
  } finally {
    raw.end();
  }
}

export interface AppDeps {
  dataDir: string;
  service: ResearchService;
  publicDir: string;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/api/projects", async () => {
    const entries = await fs.readdir(deps.dataDir, { withFileTypes: true }).catch(() => []);
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    const summaries = await Promise.all(
      dirs.map((id) =>
        new GraphStore(deps.dataDir, id).summary().then(
          (s) => s,
          () => null, // skip a project that can't be summarised (e.g. no index yet)
        ),
      ),
    );
    const projects = summaries
      .filter((s): s is NonNullable<typeof s> => s !== null && s.nodes > 0) // skip empty/non-project folders
      .sort((a, b) => b.updated.localeCompare(a.updated)); // most-recently-updated first
    return { projects };
  });

  app.post<{ Body: { topic?: string } }>("/api/projects", async (req, reply) => {
    const topic = req.body?.topic?.trim();
    if (!topic) return reply.code(400).send({ error: "topic is required" });
    await streamNdjson(reply, (onActivity) => deps.service.createTopic(topic, onActivity));
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
    await streamNdjson(reply, (onActivity) => deps.service.branch(req.params.id, input, onActivity));
  });

  app.post<{ Params: { id: string; nodeId: string } }>("/api/projects/:id/nodes/:nodeId/research", async (req, reply) => {
    await streamNdjson(reply, (onActivity) => deps.service.researchNode(req.params.id, req.params.nodeId, onActivity));
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
