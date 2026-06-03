export function LoadingCanvas({
  topic,
  error,
  onRetry,
  onHome,
}: {
  topic: string;
  error?: string;
  onRetry: () => void;
  onHome: () => void;
}) {
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100%", textAlign: "center" }}>
      {error ? (
        <div>
          <p style={{ color: "#b00020" }}>⚠ {error}</p>
          <button onClick={onRetry}>Try again</button> <button onClick={onHome}>← Home</button>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 40 }}>⏳</div>
          <p className="muted">Researching “{topic}”… this calls Claude and may take a moment.</p>
        </div>
      )}
    </div>
  );
}
