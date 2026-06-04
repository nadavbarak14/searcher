import type { GraphIndex, ResearchNode, ProjectSummary } from "./types";

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}
function send<T>(method: string, url: string, body: unknown): Promise<T> {
  return jsonFetch<T>(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export const api = {
  listProjects: () => jsonFetch<{ projects: ProjectSummary[] }>("/api/projects").then((r) => r.projects),
  createTopic: (topic: string) => send<{ projectId: string; findingCount: number }>("POST", "/api/projects", { topic }),
  getProject: (id: string) => jsonFetch<{ index: GraphIndex }>(`/api/projects/${id}`).then((r) => r.index),
  getNode: (id: string, nodeId: string) =>
    jsonFetch<{ node: ResearchNode }>(`/api/projects/${id}/nodes/${nodeId}`).then((r) => r.node),
  branch: (id: string, parentId: string, question: string, anchor?: { text: string; offset: number; occurrence: number }) =>
    send<ResearchNode>("POST", `/api/projects/${id}/branch`, anchor ? { parentId, question, anchor } : { parentId, question }),
  setPositions: (id: string, positions: { id: string; x: number; y: number }[]) =>
    send<{ ok: true }>("PATCH", `/api/projects/${id}/positions`, { positions }),
  synthesize: (id: string) => send<{ markdown: string }>("POST", `/api/projects/${id}/synthesize`, {}).then((r) => r.markdown),
};
