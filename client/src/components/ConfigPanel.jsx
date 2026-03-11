import { useState } from "react";

export default function ConfigPanel() {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-4o-mini");
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, model }),
      });
      const data = await res.json();
      if (data.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (err) {
      alert("Config save failed: " + err.message);
    }
  };

  return (
    <div className="panel">
      <div className="panel-title">
        Configuration
        {saved && <span className="badge badge-success">Saved</span>}
      </div>
      <div className="input-row">
        <div style={{ flex: 2 }}>
          <label>OpenAI API Key</label>
          <input
            type="password"
            placeholder="sk-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label>Model</label>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="gpt-4o-mini">gpt-4o-mini</option>
            <option value="gpt-4o">gpt-4o</option>
            <option value="gpt-4-turbo">gpt-4-turbo</option>
            <option value="o4-mini">o4-mini</option>
          </select>
        </div>
        <div style={{ flex: 0 }}>
          <label>&nbsp;</label>
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={!apiKey}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
