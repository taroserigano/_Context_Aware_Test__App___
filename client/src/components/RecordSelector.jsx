import { useState } from "react";

export default function RecordSelector({
  records,
  selectedRecord,
  onRecordsLoaded,
  onSelectRecord,
  onLearn,
  learned,
  onProcess,
  onProcessAll,
  processing,
}) {
  const [loading, setLoading] = useState(false);
  const [learning, setLearning] = useState(false);

  const handleLoad = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/records");
      const data = await res.json();
      onRecordsLoaded(data.records || []);
    } catch (err) {
      alert("Load failed: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const res = await fetch("/api/records/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      const data = await res.json();
      if (data.records) {
        onRecordsLoaded(data.records);
      } else {
        alert("Upload error: " + (data.error || "Unknown"));
      }
    } catch (err) {
      alert("Upload failed: " + err.message);
    }
  };

  const handleLearn = async () => {
    setLearning(true);
    await onLearn();
    setLearning(false);
  };

  return (
    <div className="panel">
      <div className="panel-title">Records</div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button className="btn-primary" onClick={handleLoad} disabled={loading}>
          {loading ? <span className="spinner" /> : "Load Sample"}
        </button>
        <label
          className="btn-secondary"
          style={{
            display: "inline-flex",
            alignItems: "center",
            cursor: "pointer",
          }}
        >
          Upload JSONL
          <input
            type="file"
            accept=".jsonl,.json"
            onChange={handleUpload}
            style={{ display: "none" }}
          />
        </label>
      </div>

      {records.length > 0 && (
        <>
          <div style={{ marginBottom: 12 }}>
            <button
              className="btn-success"
              onClick={handleLearn}
              disabled={learning || learned}
              style={{ width: "100%" }}
            >
              {learning ? (
                <>
                  <span className="spinner" /> Learning Patterns...
                </>
              ) : learned ? (
                "✓ Patterns Learned"
              ) : (
                "🧠 Learn Patterns from Data"
              )}
            </button>
          </div>

          <div
            style={{
              marginBottom: 8,
              fontSize: 12,
              color: "var(--text-secondary)",
            }}
          >
            Select a record to process:
          </div>

          {records.map((r) => (
            <div
              key={r.task_id}
              className={`record-card ${selectedRecord?.task_id === r.task_id ? "selected" : ""}`}
              onClick={() => onSelectRecord(r)}
            >
              <div className="task-id">{r.task_id}</div>
              <div className="meta">
                {r.persona} &bull; {r.lifecycle_stage} &bull;{" "}
                {r.input?.profile?.first_name || "Unknown"}
              </div>
            </div>
          ))}

          {learned && (
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                className="btn-primary"
                onClick={() => selectedRecord && onProcess(selectedRecord)}
                disabled={!selectedRecord || processing}
                style={{ flex: 1 }}
              >
                {processing ? (
                  <>
                    <span className="spinner" /> Processing...
                  </>
                ) : (
                  "Process Selected"
                )}
              </button>
              <button
                className="btn-secondary"
                onClick={onProcessAll}
                disabled={processing}
                style={{ flex: 1 }}
              >
                Process All
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
