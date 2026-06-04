import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { ProjectSummary } from "../types";
import { Icon, Wordmark, MiniGraph } from "./ui";

const EXAMPLES = [
  "Why is the sky blue at noon but red at dusk?",
  "The economics of desalination at scale",
  "Post-quantum cryptography migration paths",
];

/** "2 hours ago" / "yesterday" / "3 days ago" from an ISO timestamp. */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  const weeks = Math.round(days / 7);
  if (days < 60) return `${weeks} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

function projectMeta(p: ProjectSummary): string {
  return `${p.nodes} NODES · ${p.sources} SOURCES · ${timeAgo(p.updated).toUpperCase()}`;
}

export function Library({ onStart, onOpen }: { onStart: (topic: string) => void; onOpen: (id: string) => void }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [topic, setTopic] = useState("");
  const [focus, setFocus] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  const start = () => {
    if (topic.trim()) onStart(topic.trim());
  };

  const featured = projects[0]; // listing is sorted most-recently-updated first
  const rest = projects.slice(1);

  return (
    <div style={{ height: "100%", overflow: "auto", background: "var(--paper)" }}>
      {/* slim header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "20px 32px",
          maxWidth: 1080,
          margin: "0 auto",
        }}
      >
        <Wordmark size={20} />
        <span className="mono" style={{ fontSize: 11.5, color: "var(--faint)", letterSpacing: "0.06em" }}>
          LOCAL&nbsp;·&nbsp;PRIVATE&nbsp;·&nbsp;YOURS
        </span>
      </header>

      <main style={{ maxWidth: 720, margin: "0 auto", padding: "0 32px 80px" }}>
        {/* hero */}
        <section style={{ paddingTop: "9vh" }}>
          <div className="eyebrow" style={{ marginBottom: 18 }}>Research canvas</div>
          <h1
            className="serif"
            style={{
              fontSize: "clamp(34px, 5vw, 52px)",
              lineHeight: 1.05,
              fontWeight: 400,
              letterSpacing: "-0.02em",
              margin: "0 0 20px",
              color: "var(--ink)",
              textWrap: "balance",
            }}
          >
            What do you want to
            <br />
            understand?
          </h1>
          <p style={{ fontSize: 17, lineHeight: 1.55, color: "var(--ink-soft)", maxWidth: 520, margin: "0 0 28px" }}>
            Name a topic and Claude maps the lay of the land. Then you branch from any finding, prune what doesn&rsquo;t
            matter, and grow a knowledge graph that is genuinely yours.
          </p>

          {/* search — command bar */}
          <div
            onClick={() => inputRef.current?.focus()}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              cursor: "text",
              background: "var(--card)",
              border: `1.5px solid ${focus ? "var(--accent)" : "var(--line-strong)"}`,
              borderRadius: "var(--r-lg)",
              padding: "8px 8px 8px 16px",
              boxShadow: focus ? "0 0 0 4px var(--accent-soft), var(--shadow-md)" : "var(--shadow-md)",
              transition: "border-color .15s ease, box-shadow .15s ease",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", color: focus ? "var(--accent)" : "var(--faint)", transition: "color .15s ease" }}>
              <Icon name="search" size={20} />
            </span>
            <input
              ref={inputRef}
              autoFocus
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onFocus={() => setFocus(true)}
              onBlur={() => setFocus(false)}
              onKeyDown={(e) => e.key === "Enter" && start()}
              placeholder="Name a topic to research…"
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                background: "transparent",
                fontFamily: "var(--sans)",
                fontSize: 16.5,
                color: "var(--ink)",
                padding: "9px 0",
              }}
            />
            {topic.trim() && <span className="kbd" style={{ marginRight: 4 }}>↵</span>}
            <button
              className="btn btn-primary"
              onClick={(e) => {
                e.stopPropagation();
                start();
              }}
              disabled={!topic.trim()}
              style={{ padding: "0 20px", alignSelf: "stretch" }}
            >
              Begin research <Icon name="arrowUpRight" size={16} />
            </button>
          </div>

          {/* example chips */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--faint)", letterSpacing: "0.06em" }}>OR TRY</span>
            {EXAMPLES.map((ex) => (
              <button key={ex} className="chip" onClick={() => onStart(ex)}>
                <Icon name="sparkle" size={13} style={{ color: "var(--accent)" }} />
                {ex.length > 38 ? ex.slice(0, 37) + "…" : ex}
              </button>
            ))}
          </div>

          {/* how-it-works rail */}
          <div style={{ display: "flex", gap: 28, marginTop: 30, flexWrap: "wrap" }}>
            {([
              ["01", "Map", "Claude returns the findings"],
              ["02", "Branch", "Ask follow-ups at any node"],
              ["03", "Synthesize", "Export a clean report"],
            ] as const).map(([n, h, d]) => (
              <div key={n} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                <span className="mono" style={{ fontSize: 11, color: "var(--accent)" }}>{n}</span>
                <span style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>
                  <strong style={{ fontWeight: 600, color: "var(--ink)" }}>{h}</strong>
                  &nbsp;— {d}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* library */}
        <section style={{ marginTop: 64 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              borderBottom: "1px solid var(--line)",
              paddingBottom: 12,
              marginBottom: 18,
            }}
          >
            <h2 className="serif" style={{ fontSize: 19, fontWeight: 500, margin: 0, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
              Your research
            </h2>
            <span className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>
              {projects.length} {projects.length === 1 ? "PROJECT" : "PROJECTS"}
            </span>
          </div>

          {projects.length === 0 && (
            <p className="serif" style={{ fontSize: 16, color: "var(--muted)", lineHeight: 1.5, margin: "4px 0 0" }}>
              Nothing here yet — name a topic above and your first knowledge graph will appear here.
            </p>
          )}

          {/* featured / continue card */}
          {featured && (
            <button
              onClick={() => onOpen(featured.id)}
              style={{
                width: "100%",
                textAlign: "left",
                display: "flex",
                alignItems: "center",
                gap: 18,
                padding: "20px 22px",
                marginBottom: 14,
                cursor: "pointer",
                color: "inherit",
                background: "var(--clay-soft)",
                border: "1px solid var(--clay-line)",
                borderRadius: "var(--r-lg)",
                boxShadow: "var(--shadow-sm)",
                transition: "box-shadow .15s ease, transform .06s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "var(--shadow-md)")}
              onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "var(--shadow-sm)")}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: 52,
                  height: 44,
                  display: "grid",
                  placeItems: "center",
                  background: "var(--card)",
                  border: "1px solid var(--clay-line)",
                  borderRadius: "var(--r-md)",
                }}
              >
                <MiniGraph nodes={featured.nodes} size={36} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="eyebrow" style={{ color: "var(--clay)", display: "block", marginBottom: 5 }}>
                  Continue where you left off
                </span>
                <span
                  className="serif"
                  style={{
                    display: "block",
                    fontSize: 19,
                    color: "var(--ink)",
                    lineHeight: 1.25,
                    letterSpacing: "-0.01em",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {featured.topic}
                </span>
                <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                  {projectMeta(featured)}
                </span>
              </span>
              <span className="btn btn-sm" style={{ flexShrink: 0, background: "var(--card)", borderColor: "var(--clay-line)", color: "var(--clay)" }}>
                Resume <Icon name="arrowUpRight" size={15} />
              </span>
            </button>
          )}

          {/* the rest */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            {rest.map((p) => (
              <button
                key={p.id}
                onClick={() => onOpen(p.id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "15px 12px",
                  background: "transparent",
                  border: "none",
                  borderTop: "1px solid var(--line)",
                  cursor: "pointer",
                  color: "inherit",
                  borderRadius: "var(--r-md)",
                  transition: "background .12s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--card-2)";
                  const open = e.currentTarget.querySelector<HTMLElement>("[data-open]");
                  if (open) open.style.opacity = "1";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  const open = e.currentTarget.querySelector<HTMLElement>("[data-open]");
                  if (open) open.style.opacity = "0";
                }}
              >
                <span style={{ flexShrink: 0, opacity: 0.92 }}>
                  <MiniGraph nodes={p.nodes} size={38} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    className="serif"
                    style={{
                      display: "block",
                      fontSize: 17,
                      color: "var(--ink)",
                      lineHeight: 1.3,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {p.topic}
                  </span>
                  <span className="mono" style={{ fontSize: 11.5, color: "var(--muted)" }}>
                    {projectMeta(p)}
                  </span>
                </span>
                <span
                  data-open
                  className="mono"
                  style={{
                    flexShrink: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11.5,
                    color: "var(--accent)",
                    opacity: 0,
                    transition: "opacity .12s ease",
                  }}
                >
                  OPEN <Icon name="arrowUpRight" size={15} />
                </span>
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
