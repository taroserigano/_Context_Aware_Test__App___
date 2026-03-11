import { useState } from "react";

export default function PipelineView({ stages, stageStates, stageData }) {
  const [expandedStage, setExpandedStage] = useState(null);

  const getIcon = (status) => {
    switch (status) {
      case "done":
        return "✓";
      case "running":
        return "⟳";
      case "error":
        return "✕";
      default:
        return "·";
    }
  };

  return (
    <div className="panel">
      <div className="panel-title">Pipeline Progress</div>
      <div className="stage-list">
        {stages.map((stage) => {
          const status = stageStates[stage.id] || "pending";
          const data = stageData[stage.id];
          const isExpanded = expandedStage === stage.id;

          return (
            <div key={stage.id}>
              <div
                className={`stage-item ${isExpanded ? "active" : ""}`}
                onClick={() => setExpandedStage(isExpanded ? null : stage.id)}
              >
                <div className={`stage-icon ${status}`}>{getIcon(status)}</div>
                <div className="stage-info">
                  <div className="stage-name">{stage.name}</div>
                  <div className="stage-desc">{stage.desc}</div>
                </div>
                {status === "done" && (
                  <span className="badge badge-success">Done</span>
                )}
                {status === "running" && (
                  <span className="badge badge-info">Running</span>
                )}
                {status === "error" && (
                  <span className="badge badge-error">Error</span>
                )}
              </div>

              {isExpanded && data && (
                <div style={{ marginLeft: 40, marginTop: 4, marginBottom: 4 }}>
                  {/* Show reasoning if available */}
                  {renderStageData(stage.id, data)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function renderStageData(stageId, data) {
  // Extract reasoning from various fields
  const reasoning = extractReasoning(data);
  const jsonPreview = sanitizeForDisplay(data);

  return (
    <div>
      {reasoning && (
        <div className="reasoning-box">
          <strong style={{ color: "var(--accent)" }}>Reasoning:</strong>
          {"\n" + reasoning}
        </div>
      )}
      <details style={{ marginTop: 6 }}>
        <summary
          style={{
            fontSize: 11,
            color: "var(--text-secondary)",
            cursor: "pointer",
          }}
        >
          Raw output
        </summary>
        <div className="json-viewer">
          {JSON.stringify(jsonPreview, null, 2)}
        </div>
      </details>
    </div>
  );
}

function extractReasoning(data) {
  if (!data) return null;
  const parts = [];
  for (const [key, val] of Object.entries(data)) {
    if (val && typeof val === "object" && val.reasoning) {
      parts.push(`[${key}] ${val.reasoning}`);
    }
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

function sanitizeForDisplay(data) {
  if (!data) return {};
  const clean = {};
  for (const [key, val] of Object.entries(data)) {
    // Skip large arrays and stage logs in preview
    if (key === "stageLog" || key === "allRecords") continue;
    clean[key] = val;
  }
  return clean;
}
