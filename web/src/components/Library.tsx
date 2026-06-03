import { useEffect, useState } from "react";
import { api } from "../api";

export function Library({ onStart, onOpen }: { onStart: (topic: string) => void; onOpen: (id: string) => void }) {
  const [projects, setProjects] = useState<string[]>([]);
  const [topic, setTopic] = useState("");

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  const start = () => {
    if (topic.trim()) onStart(topic.trim());
  };

  return (
    <div className="library">
      <h1>Searcher</h1>
      <p className="muted">Start research on a topic, then ask questions to grow a knowledge graph.</p>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. AI security"
          style={{ flex: 1, padding: 8 }}
          onKeyDown={(e) => e.key === "Enter" && start()}
        />
        <button onClick={start}>Search</button>
      </div>
      <h3>Your research</h3>
      <ul className="proj-list">
        {projects.map((p) => (
          <li key={p} onClick={() => onOpen(p)}>
            {p}
          </li>
        ))}
        {projects.length === 0 && (
          <li className="muted" style={{ cursor: "default", color: "#aaa" }}>
            none yet
          </li>
        )}
      </ul>
    </div>
  );
}
