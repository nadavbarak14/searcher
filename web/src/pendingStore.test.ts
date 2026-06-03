import { describe, it, expect } from "vitest";
import { pendingKey, loadPending, savePending } from "./pendingStore";
import type { PendingQuestion } from "./types";

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

const item: PendingQuestion = { id: "1", anchor: { text: "x", offset: 0, occurrence: 1 }, question: "why?" };

describe("pendingStore", () => {
  it("keys by project and node", () => {
    expect(pendingKey("p", "n_1")).toBe("searcher:pending:p:n_1");
  });
  it("round-trips items", () => {
    const s = fakeStorage();
    savePending(s, "p", "n_1", [item]);
    expect(loadPending(s, "p", "n_1")).toEqual([item]);
  });
  it("returns [] for missing or corrupt data", () => {
    const s = fakeStorage();
    expect(loadPending(s, "p", "missing")).toEqual([]);
    s.setItem(pendingKey("p", "bad"), "{not json");
    expect(loadPending(s, "p", "bad")).toEqual([]);
  });
  it("removes the key when saving an empty list", () => {
    const s = fakeStorage();
    savePending(s, "p", "n_1", [item]);
    savePending(s, "p", "n_1", []);
    expect(s.getItem(pendingKey("p", "n_1"))).toBeNull();
  });
});
