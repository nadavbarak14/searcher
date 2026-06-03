import type { PendingQuestion } from "./types";

export function pendingKey(projectId: string, nodeId: string): string {
  return `searcher:pending:${projectId}:${nodeId}`;
}

export function loadPending(storage: Storage, projectId: string, nodeId: string): PendingQuestion[] {
  const raw = storage.getItem(pendingKey(projectId, nodeId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingQuestion[]) : [];
  } catch {
    return [];
  }
}

export function savePending(storage: Storage, projectId: string, nodeId: string, items: PendingQuestion[]): void {
  const key = pendingKey(projectId, nodeId);
  if (items.length === 0) storage.removeItem(key);
  else storage.setItem(key, JSON.stringify(items));
}
