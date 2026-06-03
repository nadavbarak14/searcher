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
  it("branch POSTs parentId + question (no anchor)", async () => {
    const f = mockFetch({ id: "n_2", kind: "finding", parents: ["n_1"], question: "why?", sources: [], created: "t", body: "b" });
    vi.stubGlobal("fetch", f);
    await api.branch("p1", "n_1", "why?");
    expect(f).toHaveBeenCalledWith(
      "/api/projects/p1/branch",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ parentId: "n_1", question: "why?" }) }),
    );
  });
  it("setPositions PATCHes the positions array", async () => {
    const f = mockFetch({ ok: true });
    vi.stubGlobal("fetch", f);
    await api.setPositions("p1", [{ id: "n_1", x: 1, y: 2 }]);
    expect(f).toHaveBeenCalledWith(
      "/api/projects/p1/positions",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ positions: [{ id: "n_1", x: 1, y: 2 }] }) }),
    );
  });
});
