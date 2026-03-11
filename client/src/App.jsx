import { useState, useCallback } from "react";

import RecordSelector from "./components/RecordSelector.jsx";
import PipelineView from "./components/PipelineView.jsx";
import ResultPanel from "./components/ResultPanel.jsx";
import ScoreCard from "./components/ScoreCard.jsx";

const STAGES = [
  { id: "enricher", name: "Enricher", desc: "Pre-compute context (no LLM)" },
  {
    id: "analyst",
    name: "Analyst",
    desc: "Retrieve rulebook + few-shot examples",
  },
  { id: "strategist", name: "Strategist", desc: "Channel & timing decision" },
  {
    id: "copywriter",
    name: "Copywriter",
    desc: "Compose personalized message",
  },
  { id: "compliance", name: "Compliance", desc: "Check & repair violations" },
  { id: "planner", name: "Planner", desc: "Decide next CRM action" },
  { id: "critic", name: "Critic", desc: "Cross-component review" },
  { id: "evaluator", name: "Evaluator", desc: "Score vs expected" },
];

export default function App() {
  const [records, setRecords] = useState([]);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [learned, setLearned] = useState(false);
  const [rulebook, setRulebook] = useState("");
  const [stageStates, setStageStates] = useState({});
  const [stageData, setStageData] = useState({});
  const [result, setResult] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [allResults, setAllResults] = useState([]);

  const handleRecordsLoaded = useCallback((recs) => {
    setRecords(recs);
    setSelectedRecord(null);
    setResult(null);
    setStageStates({});
    setStageData({});
    setAllResults([]);
  }, []);

  const handleLearn = useCallback(async () => {
    try {
      const res = await fetch("/api/learn", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setLearned(true);
        setRulebook(data.rulebook);
      } else {
        alert("Learn failed: " + (data.error || "Unknown error"));
      }
    } catch (err) {
      alert("Learn failed: " + err.message);
    }
  }, []);

  const handleProcess = useCallback(async (record) => {
    if (!record) return;
    setProcessing(true);
    setResult(null);
    setStageData({});

    // Initialize all stages as pending
    const init = {};
    STAGES.forEach((s) => (init[s.id] = "pending"));
    setStageStates(init);

    try {
      const response = await fetch(`/api/process/${record.task_id}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = {};

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));

            if (evt.node === "__done__") {
              // Mark all remaining as done
              setStageStates((prev) => {
                const next = { ...prev };
                STAGES.forEach((s) => {
                  if (next[s.id] === "running") next[s.id] = "done";
                });
                return next;
              });
              setResult(accumulated);
            } else if (evt.node === "__error__") {
              setStageStates((prev) => {
                const next = { ...prev };
                for (const key of Object.keys(next)) {
                  if (next[key] === "running") next[key] = "error";
                }
                return next;
              });
            } else {
              // Mark previous running as done, this one as running
              setStageStates((prev) => {
                const next = { ...prev };
                for (const key of Object.keys(next)) {
                  if (next[key] === "running") next[key] = "done";
                }
                next[evt.node] = "running";
                return next;
              });
              setStageData((prev) => ({ ...prev, [evt.node]: evt.state }));
              accumulated = { ...accumulated, ...evt.state };
            }
          } catch {
            // skip malformed SSE
          }
        }
      }
    } catch (err) {
      alert("Process failed: " + err.message);
    } finally {
      setProcessing(false);
      // Ensure all stages show as done
      setStageStates((prev) => {
        const next = { ...prev };
        STAGES.forEach((s) => {
          if (next[s.id] === "running") next[s.id] = "done";
        });
        return next;
      });
    }
  }, []);

  const handleProcessAll = useCallback(async () => {
    setProcessing(true);
    setAllResults([]);
    setResult(null);

    try {
      const response = await fetch("/api/process-all", { method: "POST" });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "complete") {
              setAllResults((prev) => [...prev, evt.result]);
            } else if (evt.type === "summary") {
              // Final summary
              setAllResults(evt.results);
            }
          } catch {
            // skip
          }
        }
      }
    } catch (err) {
      alert("Process all failed: " + err.message);
    } finally {
      setProcessing(false);
    }
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Context-Aware Message Bot</h1>
          <div className="subtitle">
            Multi-Agent LangGraph Pipeline &bull; Pattern Learning &bull;
            Semantic Scoring
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {learned && (
            <span className="badge badge-success">Patterns Learned</span>
          )}
          {records.length > 0 && (
            <span className="badge badge-info">{records.length} records</span>
          )}
        </div>
      </header>

      <div className="row">
        <div className="col" style={{ maxWidth: 340 }}>
          <RecordSelector
            records={records}
            selectedRecord={selectedRecord}
            onRecordsLoaded={handleRecordsLoaded}
            onSelectRecord={setSelectedRecord}
            onLearn={handleLearn}
            learned={learned}
            onProcess={handleProcess}
            onProcessAll={handleProcessAll}
            processing={processing}
          />
        </div>

        <div className="col">
          {processing || Object.keys(stageStates).length > 0 ? (
            <PipelineView
              stages={STAGES}
              stageStates={stageStates}
              stageData={stageData}
            />
          ) : null}

          {result && selectedRecord && (
            <>
              <ResultPanel record={selectedRecord} result={result} />
              <ScoreCard scores={result.scores} />
            </>
          )}

          {allResults.length > 0 && !selectedRecord && (
            <div className="panel">
              <div className="panel-title">
                All Results
                <span className="badge badge-info">
                  {allResults.length} processed
                </span>
              </div>
              {allResults.map((r) => (
                <div
                  key={r.taskId}
                  className="record-card"
                  onClick={() => {
                    const rec = records.find((x) => x.task_id === r.taskId);
                    setSelectedRecord(rec);
                    setResult(r);
                  }}
                >
                  <div className="task-id">{r.taskId}</div>
                  <div className="meta">
                    Score:{" "}
                    <strong
                      className={
                        r.scores?.composite >= 0.8
                          ? "text-success"
                          : r.scores?.composite >= 0.6
                            ? "text-warning"
                            : "text-error"
                      }
                    >
                      {((r.scores?.composite || 0) * 100).toFixed(1)}%
                    </strong>{" "}
                    &bull; Channel: {r.channelDecision?.channel} &bull; Action:{" "}
                    {r.actionPlan?.type}
                  </div>
                </div>
              ))}
              {allResults.length > 0 && (
                <div style={{ marginTop: 12, textAlign: "center" }}>
                  <span className="composite-score" style={{ fontSize: 32 }}>
                    Avg:{" "}
                    {(
                      (allResults.reduce(
                        (a, r) => a + (r.scores?.composite || 0),
                        0,
                      ) /
                        allResults.length) *
                      100
                    ).toFixed(1)}
                    %
                  </span>
                </div>
              )}
            </div>
          )}

          {!processing &&
            Object.keys(stageStates).length === 0 &&
            !result &&
            allResults.length === 0 && (
              <div className="panel">
                <div
                  className="loading-overlay"
                  style={{ flexDirection: "column" }}
                >
                  <div style={{ fontSize: 40, marginBottom: 12 }}>🤖</div>
                  <div>
                    Load records, learn patterns, then process to see results
                  </div>
                </div>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
