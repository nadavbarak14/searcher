import { describe, it, expect, vi, afterEach } from "vitest";
import { api } from "./api";

afterEach(() => vi.restoreAllMocks());

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => body } as Response);
}

/** A fetch mock that returns an NDJSON ReadableStream built from the given lines. */
function mockStreamFetch(lines: string[], ok = true, status = 200) {
  const text = lines.join("\n") + "\n";
  return vi.fn().mockResolvedValue({
    ok,
    status,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        const bytes = new TextEncoder().encode(text);
        // emit in two chunks to exercise the line buffer
        const mid = Math.floor(bytes.length / 2);
        controller.enqueue(bytes.slice(0, mid));
        controller.enqueue(bytes.slice(mid));
        controller.close();
      },
    }),
  } as unknown as Response);
}

describe("api", () => {
  it("createTopic streams activity and resolves with the result data", async () => {
    const f = mockStreamFetch([
      JSON.stringify({ type: "tool", label: 'Searching the web for "x"' }),
      JSON.stringify({ type: "status", label: "Composing the answer…" }),
      JSON.stringify({ type: "result", data: { projectId: "ai-security", findingCount: 2 } }),
    ]);
    vi.stubGlobal("fetch", f);
    const activity: { type: string; label: string }[] = [];
    const res = await api.createTopic("AI security", (e) => activity.push(e));
    expect(res).toEqual({ projectId: "ai-security", findingCount: 2 });
    expect(activity).toEqual([
      { type: "tool", label: 'Searching the web for "x"' },
      { type: "status", label: "Composing the answer…" },
    ]);
    expect(f).toHaveBeenCalledWith("/api/projects", expect.objectContaining({ method: "POST" }));
  });
  it("createTopic rejects when the stream emits an error line", async () => {
    vi.stubGlobal("fetch", mockStreamFetch([JSON.stringify({ type: "error", message: "boom" })]));
    await expect(api.createTopic("AI security")).rejects.toThrow(/boom/);
  });
  it("getProject returns the index and report status", async () => {
    vi.stubGlobal("fetch", mockFetch({ index: { topic: "t", nextSeq: 1, nodes: [] }, report: { generatedAt: "2026-06-15T00:00:00Z", stale: true } }));
    const res = await api.getProject("p");
    expect(res.index.topic).toBe("t");
    expect(res.report?.stale).toBe(true);
  });
  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetch({ error: "boom" }, false, 500));
    await expect(api.listProjects()).rejects.toThrow();
  });
  it("branch POSTs parentId + question (no anchor) and resolves with the node", async () => {
    const node = { id: "n_2", kind: "finding", parents: ["n_1"], question: "why?", sources: [], created: "t", body: "b" };
    const f = mockStreamFetch([JSON.stringify({ type: "result", data: node })]);
    vi.stubGlobal("fetch", f);
    const res = await api.branch("p1", "n_1", "why?");
    expect(res).toEqual(node);
    expect(f).toHaveBeenCalledWith(
      "/api/projects/p1/branch",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ parentId: "n_1", question: "why?" }) }),
    );
  });
  it("researchNode streams activity and resolves with the researched node", async () => {
    const node = { id: "n_1", kind: "finding", parents: ["topic"], question: "q", sources: ["https://x"], created: "t", body: "researched", researched: true };
    const f = mockStreamFetch([
      JSON.stringify({ type: "tool", label: "Searching" }),
      JSON.stringify({ type: "result", data: node }),
    ]);
    vi.stubGlobal("fetch", f);
    const activity: { type: string; label: string }[] = [];
    const res = await api.researchNode("p1", "n_1", (e) => activity.push(e));
    expect(res).toEqual(node);
    expect(activity).toEqual([{ type: "tool", label: "Searching" }]);
    expect(f).toHaveBeenCalledWith("/api/projects/p1/nodes/n_1/research", expect.objectContaining({ method: "POST" }));
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
