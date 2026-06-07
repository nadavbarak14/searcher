import type { GraphIndex, ResearchNode, ProjectSummary } from "./types";

/** A live activity item from the backend stream (mirrors backend ActivityEvent). */
export type ActivityEvent = { type: "tool" | "status"; label: string };

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}
function send<T>(method: string, url: string, body: unknown): Promise<T> {
  return jsonFetch<T>(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

/**
 * POST a JSON body and consume an NDJSON activity stream. Activity lines (type "tool"/"status")
 * are forwarded to onActivity; the terminal {type:"result",data} resolves the promise, and
 * {type:"error",message} rejects it.
 */
async function streamNdjson<T>(url: string, body: unknown, onActivity: (e: ActivityEvent) => void): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) throw new Error(`POST ${url} failed: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | undefined;
  let resolved = false;

  const handle = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const e = JSON.parse(trimmed) as { type: string; label?: string; data?: T; message?: string };
    if (e.type === "tool" || e.type === "status") onActivity({ type: e.type, label: e.label ?? "" });
    else if (e.type === "result") { result = e.data as T; resolved = true; }
    else if (e.type === "error") throw new Error(e.message ?? "stream error");
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      handle(line);
    }
  }
  if (buffer.trim()) handle(buffer); // flush a trailing line not terminated by a newline
  if (!resolved) throw new Error(`POST ${url} ended without a result`);
  return result as T;
}

export const api = {
  listProjects: () => jsonFetch<{ projects: ProjectSummary[] }>("/api/projects").then((r) => r.projects),
  createTopic: (topic: string, onActivity: (e: ActivityEvent) => void = () => {}) =>
    streamNdjson<{ projectId: string; findingCount: number }>("/api/projects", { topic }, onActivity),
  getProject: (id: string) => jsonFetch<{ index: GraphIndex }>(`/api/projects/${id}`).then((r) => r.index),
  getNode: (id: string, nodeId: string) =>
    jsonFetch<{ node: ResearchNode }>(`/api/projects/${id}/nodes/${nodeId}`).then((r) => r.node),
  branch: (
    id: string,
    parentId: string,
    question: string,
    anchor?: { text: string; offset: number; occurrence: number },
    onActivity: (e: ActivityEvent) => void = () => {},
  ) =>
    streamNdjson<ResearchNode>(`/api/projects/${id}/branch`, anchor ? { parentId, question, anchor } : { parentId, question }, onActivity),
  researchNode: (id: string, nodeId: string, onActivity: (e: ActivityEvent) => void = () => {}) =>
    streamNdjson<ResearchNode>(`/api/projects/${id}/nodes/${nodeId}/research`, {}, onActivity),
  setPositions: (id: string, positions: { id: string; x: number; y: number }[]) =>
    send<{ ok: true }>("PATCH", `/api/projects/${id}/positions`, { positions }),
  synthesize: (id: string) => send<{ markdown: string }>("POST", `/api/projects/${id}/synthesize`, {}).then((r) => r.markdown),
};
