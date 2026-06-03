import { useEffect, useState } from "react";
import type { PendingQuestion } from "./types";
import { loadPending, savePending } from "./pendingStore";

/** Per-(project,node) pending question list, mirrored to localStorage so it survives reloads. */
export function usePendingQuestions(
  projectId: string,
  nodeId: string,
): [PendingQuestion[], (next: PendingQuestion[]) => void] {
  const [items, setItems] = useState<PendingQuestion[]>(() => loadPending(localStorage, projectId, nodeId));

  // Reload when the active node changes.
  useEffect(() => {
    setItems(loadPending(localStorage, projectId, nodeId));
  }, [projectId, nodeId]);

  const update = (next: PendingQuestion[]) => {
    setItems(next);
    savePending(localStorage, projectId, nodeId, next);
  };

  return [items, update];
}
