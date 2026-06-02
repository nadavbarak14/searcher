import { useEffect, useState } from "react";
import { api } from "../api";

export function Library({ onOpen }: { onOpen: (id: string) => void }) {
  const [projects, setProjects] = useState<string[]>([]);
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  async function create() {
    if (!topic.trim()) return;
    setBusy(true);
    setMsg("Researching… this calls Claude and may take a moment.");
    try {
      const { projectId, findingCount } = await api.createTopic(topic.trim());
      if (findingCount === 0) setMsg("No findings were produced — try a more specific topic.");
      else onOpen(projectId);
    } catch (e) {
      setMsg("Failed: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="library">
      <h1>Searcher</h1>
      <p className="muted">Start research on a topic, then branch your own questions to build a knowledge graph.</p>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. AI security"
               style={{ flex: 1, padding: 8 }} onKeyDown={(e) => e.key === "Enter" && create()} disabled={busy} />
        <button onClick={create} disabled={busy}>{busy ? "Researching…" : "Start research"}</button>
      </div>
      {msg && <p className="muted">{msg}</p>}
      <h3>Your research</h3>
      <ul className="proj-list">
        {projects.map((p) => <li key={p} onClick={() => onOpen(p)}>{p}</li>)}
        {projects.length === 0 && <li className="muted" style={{ cursor: "default", color: "#aaa" }}>none yet</li>}
      </ul>
    </div>
  );
}
