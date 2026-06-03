import { describe, it, expect, vi, afterEach } from "vitest";
import { api } from "./api";

afterEach(() => vi.restoreAllMocks());

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => body } as Response);
}

describe("api", () => {
  it("createTopic POSTs the topic and returns the result", async () => {
    const f = mockFetch({ projectId: "ai-security", findingCount: 2 });
    vi.stubGlobal("fetch", f);
    const res = await api.createTopic("AI security");
    expect(res).toEqual({ projectId: "ai-security", findingCount: 2 });
    expect(f).toHaveBeenCalledWith("/api/projects", expect.objectContaining({ method: "POST" }));
  });
  it("getProject returns the index", async () => {
    vi.stubGlobal("fetch", mockFetch({ index: { topic: "t", nextSeq: 1, nodes: [] } }));
    const res = await api.getProject("p");
    expect(res.topic).toBe("t");
  });
  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetch({ error: "boom" }, false, 500));
    await expect(api.listProjects()).rejects.toThrow();
  });
  it("branchBatch POSTs items and returns created + failures", async () => {
    const f = mockFetch({ created: [{ id: "n_2" }], failures: [{ index: 1, error: "boom" }] });
    vi.stubGlobal("fetch", f);
    const res = await api.branchBatch("p1", [
      { parentId: "n_1", anchor: { text: "x", offset: 0, occurrence: 1 }, question: "why?" },
    ]);
    expect(res.created).toHaveLength(1);
    expect(res.failures[0]).toEqual({ index: 1, error: "boom" });
    expect(f).toHaveBeenCalledWith("/api/projects/p1/branch-batch", expect.objectContaining({ method: "POST" }));
  });
});
