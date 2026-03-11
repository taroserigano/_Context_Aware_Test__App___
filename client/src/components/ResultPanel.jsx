import { useState } from "react";

export default function ResultPanel({ record, result }) {
  const [tab, setTab] = useState("comparison");
  const expected = record?.expected;
  const msg = result?.messageOutput;
  const action = result?.actionPlan;

  if (!expected || !msg) return null;

  return (
    <div className="panel">
      <div className="panel-title">Results</div>

      <div className="tabs">
        <button
          className={`tab ${tab === "comparison" ? "active" : ""}`}
          onClick={() => setTab("comparison")}
        >
          Side-by-Side
        </button>
        <button
          className={`tab ${tab === "compliance" ? "active" : ""}`}
          onClick={() => setTab("compliance")}
        >
          Compliance
        </button>
        <button
          className={`tab ${tab === "raw" ? "active" : ""}`}
          onClick={() => setTab("raw")}
        >
          Raw JSON
        </button>
      </div>

      {tab === "comparison" && (
        <div className="comparison">
          <div className="comparison-col expected">
            <h3>Expected</h3>
            <MessageView
              msg={expected.next_message}
              action={expected.next_action}
            />
          </div>
          <div className="comparison-col generated">
            <h3>Generated</h3>
            <MessageView
              msg={{
                channel: msg.channel,
                send_at: msg.sendAt,
                subject: msg.subject,
                body: msg.body,
                cta: msg.cta,
              }}
              action={action}
            />
          </div>
        </div>
      )}

      {tab === "compliance" && (
        <ComplianceView result={result.complianceResult} />
      )}

      {tab === "raw" && (
        <div className="json-viewer">
          {JSON.stringify(
            {
              channelDecision: result.channelDecision,
              timingDecision: result.timingDecision,
              messageOutput: result.messageOutput,
              actionPlan: result.actionPlan,
            },
            null,
            2,
          )}
        </div>
      )}
    </div>
  );
}

function MessageView({ msg, action }) {
  if (!msg) return <div className="text-muted">No message</div>;

  return (
    <div>
      <Field label="Channel" value={msg.channel} />
      <Field label="Send At" value={msg.send_at || msg.sendAt} />
      {msg.subject && <Field label="Subject" value={msg.subject} />}
      <Field label="Body" value={msg.body} />
      <Field label="CTA" value={JSON.stringify(msg.cta, null, 2)} />
      {action && (
        <Field label="Next Action" value={JSON.stringify(action, null, 2)} />
      )}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div className="msg-field">
      <div className="field-label">{label}</div>
      <div className="field-value">{value || "—"}</div>
    </div>
  );
}

function ComplianceView({ result }) {
  if (!result) return <div className="text-muted">No compliance data</div>;

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        Status:{" "}
        {result.passed ? (
          <span className="text-success">✓ Passed</span>
        ) : (
          <span className="text-error">
            ✕ Failed ({result.violations.length} violations)
          </span>
        )}
      </div>
      {result.violations?.length > 0 && (
        <div>
          {result.violations.map((v, i) => (
            <div
              key={i}
              style={{
                padding: 8,
                background: "var(--bg-primary)",
                borderRadius: 6,
                marginBottom: 6,
              }}
            >
              <div
                style={{ fontSize: 12, fontWeight: 600 }}
                className="text-error"
              >
                {v.category}
              </div>
              <div style={{ fontSize: 12, marginTop: 2 }}>{v.description}</div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-secondary)",
                  marginTop: 2,
                }}
              >
                Fix: {v.fix}
              </div>
            </div>
          ))}
        </div>
      )}
      {result.reasoning && (
        <div className="reasoning-box">{result.reasoning}</div>
      )}
    </div>
  );
}


