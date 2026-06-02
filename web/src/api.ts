import type { GraphIndex, ResearchNode, Anchor } from "./types";

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}
function post<T>(url: string, body: unknown): Promise<T> {
  return jsonFetch<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export const api = {
  listProjects: () => jsonFetch<{ projects: string[] }>("/api/projects").then((r) => r.projects),
  createTopic: (topic: string) => post<{ projectId: string; findingCount: number }>("/api/projects", { topic }),
  getProject: (id: string) => jsonFetch<{ index: GraphIndex }>(`/api/projects/${id}`).then((r) => r.index),
  getNode: (id: string, nodeId: string) =>
    jsonFetch<{ node: ResearchNode }>(`/api/projects/${id}/nodes/${nodeId}`).then((r) => r.node),
  branch: (id: string, parentId: string, anchor: Anchor, question: string) =>
    post<ResearchNode>(`/api/projects/${id}/branch`, { parentId, anchor, question }),
  synthesize: (id: string) => post<{ markdown: string }>(`/api/projects/${id}/synthesize`, {}).then((r) => r.markdown),
};
