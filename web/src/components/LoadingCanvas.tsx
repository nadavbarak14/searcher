import { useEffect } from "react";
import { Icon } from "./ui";

export function LoadingCanvas({
  topic,
  error,
  activity,
  onRetry,
  onHome,
}: {
  topic: string;
  error?: string;
  activity?: string[];
  onRetry: () => void;
  onHome: () => void;
}) {
  // Esc cancels and returns home (only while actively researching).
  useEffect(() => {
    if (error) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onHome();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [error, onHome]);

  return (
    <div
      style={{
        height: "100%",
        display: "grid",
        placeItems: "center",
        background: "var(--paper-2)",
        backgroundImage: "radial-gradient(var(--line) 1px, transparent 1px)",
        backgroundSize: "26px 26px",
      }}
    >
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-xl)",
          boxShadow: "var(--shadow-lg)",
          padding: "40px 44px",
          maxWidth: 460,
          textAlign: "center",
        }}
      >
        {error ? (
          <>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                margin: "0 auto 18px",
                display: "grid",
                placeItems: "center",
                color: "var(--danger)",
                background: "var(--danger-soft)",
                border: "1px solid oklch(0.86 0.06 32)",
              }}
            >
              <Icon name="x" size={22} />
            </div>
            <div className="eyebrow" style={{ color: "var(--danger)", marginBottom: 10 }}>Research failed</div>
            <p style={{ fontSize: 15, lineHeight: 1.5, color: "var(--ink-soft)", margin: "0 0 24px" }}>{error}</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button className="btn btn-primary" onClick={onRetry}>
                <Icon name="retry" size={16} /> Try again
              </button>
              <button className="btn btn-ghost" onClick={onHome}>
                <Icon name="arrowLeft" size={16} /> Home
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 22 }}>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: "50%",
                    background: "var(--accent)",
                    display: "block",
                    animation: `breathe 1.4s ease-in-out ${i * 0.18}s infinite`,
                  }}
                />
              ))}
            </div>
            <div className="eyebrow" style={{ marginBottom: 12 }}>Researching</div>
            <h2
              className="serif"
              style={{
                fontSize: 24,
                fontWeight: 400,
                lineHeight: 1.25,
                letterSpacing: "-0.01em",
                margin: "0 0 14px",
                color: "var(--ink)",
                textWrap: "balance",
              }}
            >
              &ldquo;{topic}&rdquo;
            </h2>
            {activity && activity.length > 0 ? (
              (() => {
                const recent = activity.slice(-5);
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, margin: "0 0 24px", minHeight: 90, justifyContent: "flex-end" }}>
                    {recent.map((line, i) => (
                      <div
                        key={activity.length - recent.length + i}
                        style={{
                          fontSize: 13,
                          lineHeight: 1.4,
                          color: "var(--ink-soft)",
                          // older lines fade out; newest (bottom) is fully opaque
                          opacity: 0.35 + (0.65 * (i + 1)) / recent.length,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {line}
                      </div>
                    ))}
                  </div>
                );
              })()
            ) : (
              <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--muted)", margin: "0 0 24px" }}>
                Claude is reading the web and mapping the findings. This runs on your subscription and may take a moment.
              </p>
            )}
            <button className="btn btn-ghost btn-sm" onClick={onHome}>
              <Icon name="x" size={15} /> Cancel <span className="kbd" style={{ marginLeft: 2 }}>Esc</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
