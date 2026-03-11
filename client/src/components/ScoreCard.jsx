export default function ScoreCard({ scores }) {
  if (!scores) return null;

  const fields = [
    { key: "channel", label: "Channel", weight: "15%" },
    { key: "timing", label: "Timing", weight: "15%" },
    { key: "subject", label: "Subject", weight: "5%" },
    { key: "body", label: "Body", weight: "35%" },
    { key: "cta", label: "CTA", weight: "15%" },
    { key: "action", label: "Action", weight: "15%" },
  ];

  const composite = scores.composite || 0;

  const getColor = (score) => {
    if (score >= 0.8) return "var(--success)";
    if (score >= 0.6) return "var(--warning)";
    return "var(--error)";
  };

  return (
    <div className="panel">
      <div className="panel-title">
        Accuracy Score
        <span
          className={`badge ${
            composite >= 0.8
              ? "badge-success"
              : composite >= 0.6
                ? "badge-warning"
                : "badge-error"
          }`}
        >
          {(composite * 100).toFixed(1)}%
        </span>
      </div>

      <div className="composite-score" style={{ color: getColor(composite) }}>
        {(composite * 100).toFixed(1)}%
      </div>

      <div>
        {fields.map(({ key, label, weight }) => {
          const score = scores[key]?.score ?? 0;
          return (
            <div key={key} className="score-row">
              <div className="score-label">
                {label}
                <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>
                  {" "}
                  ({weight})
                </span>
              </div>
              <div className="score-bar-bg">
                <div
                  className="score-bar-fill"
                  style={{
                    width: `${score * 100}%`,
                    background: getColor(score),
                  }}
                />
              </div>
              <div className="score-value" style={{ color: getColor(score) }}>
                {(score * 100).toFixed(0)}%
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail comparisons */}
      <div style={{ marginTop: 16 }}>
        <details>
          <summary
            style={{
              fontSize: 12,
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            Score details
          </summary>
          <div className="grid-2" style={{ marginTop: 8 }}>
            {fields.map(({ key, label }) => {
              const s = scores[key];
              if (!s) return null;
              return (
                <div
                  key={key}
                  style={{
                    fontSize: 12,
                    padding: 6,
                    background: "var(--bg-primary)",
                    borderRadius: 6,
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    {label}
                  </div>
                  {s.expected !== undefined && (
                    <div>
                      <span className="text-muted">Expected:</span>{" "}
                      {typeof s.expected === "object"
                        ? JSON.stringify(s.expected)
                        : String(s.expected)}
                    </div>
                  )}
                  {s.actual !== undefined && (
                    <div>
                      <span className="text-muted">Actual:</span>{" "}
                      {typeof s.actual === "object"
                        ? JSON.stringify(s.actual)
                        : String(s.actual)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      </div>
    </div>
  );
}
