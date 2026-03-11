import { Router } from "express";
import { parseJsonl } from "../services/jsonlParser.js";
import { getLLMConfig } from "../services/llmClient.js";
import { getIsLearned, resetRuntime } from "../services/runtime.js";
import { learnPatterns } from "../graph/agents/analyst.js";
import { buildPipelineGraph } from "../graph/builder.js";

const router = Router();

let cachedRecords = null;

// ─── Config (read-only, from .env) ───

router.get("/config", (req, res) => {
  res.json(getLLMConfig());
});

// ─── Records ───

router.get("/records", (req, res) => {
  try {
    const jsonlPath = process.env.JSONL_PATH || "../sample.jsonl";
    cachedRecords = parseJsonl(jsonlPath);
    res.json({ records: cachedRecords });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/records/upload", (req, res) => {
  try {
    const { content } = req.body;
    cachedRecords = content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
    res.json({ records: cachedRecords });
  } catch (err) {
    res.status(400).json({ error: "Invalid JSONL: " + err.message });
  }
});

// ─── Learn Patterns ───

router.post("/learn", async (req, res) => {
  try {
    if (!cachedRecords || cachedRecords.length === 0) {
      return res
        .status(400)
        .json({ error: "No records loaded. Load records first." });
    }

    const result = await learnPatterns(cachedRecords);
    res.json({
      ok: true,
      rulebook: result.rulebook,
      patterns: result.patterns,
      recordCount: cachedRecords.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/learn/status", (req, res) => {
  res.json({ learned: getIsLearned() });
});

// ─── Process Single Record (SSE) ───

router.get("/process/:taskId", async (req, res) => {
  const { taskId } = req.params;

  if (!cachedRecords) {
    return res.status(400).json({ error: "No records loaded" });
  }
  if (!getIsLearned()) {
    return res
      .status(400)
      .json({ error: "Patterns not learned yet. Call /api/learn first." });
  }

  const record = cachedRecords.find((r) => r.task_id === taskId);
  if (!record) {
    return res.status(404).json({ error: `Record ${taskId} not found` });
  }

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  try {
    const graph = buildPipelineGraph();

    // Stream graph execution
    const stream = await graph.stream(
      { record, allRecords: cachedRecords },
      { streamMode: "updates" },
    );

    for await (const update of stream) {
      // Each update is { nodeName: partialState }
      const [nodeName, partialState] = Object.entries(update)[0];
      res.write(
        `data: ${JSON.stringify({ node: nodeName, state: partialState })}\n\n`,
      );
    }

    res.write(`data: ${JSON.stringify({ node: "__done__", state: {} })}\n\n`);
    res.end();
  } catch (err) {
    res.write(
      `data: ${JSON.stringify({ node: "__error__", error: err.message })}\n\n`,
    );
    res.end();
  }
});

// ─── Process All Records ───

router.post("/process-all", async (req, res) => {
  if (!cachedRecords) {
    return res.status(400).json({ error: "No records loaded" });
  }
  if (!getIsLearned()) {
    return res.status(400).json({ error: "Patterns not learned yet" });
  }

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const results = [];

  for (const record of cachedRecords) {
    try {
      res.write(
        `data: ${JSON.stringify({ type: "start", taskId: record.task_id })}\n\n`,
      );

      const graph = buildPipelineGraph();
      let finalState = {};

      const stream = await graph.stream(
        { record, allRecords: cachedRecords },
        { streamMode: "updates" },
      );

      for await (const update of stream) {
        const [nodeName, partialState] = Object.entries(update)[0];
        finalState = { ...finalState, ...partialState };
        res.write(
          `data: ${JSON.stringify({
            type: "stage",
            taskId: record.task_id,
            node: nodeName,
          })}\n\n`,
        );
      }

      results.push({
        taskId: record.task_id,
        scores: finalState.scores,
        channelDecision: finalState.channelDecision,
        timingDecision: finalState.timingDecision,
        messageOutput: finalState.messageOutput,
        actionPlan: finalState.actionPlan,
        complianceResult: finalState.complianceResult,
        criticResult: finalState.criticResult,
        stageLog: finalState.stageLog,
      });

      res.write(
        `data: ${JSON.stringify({
          type: "complete",
          taskId: record.task_id,
          result: results[results.length - 1],
        })}\n\n`,
      );
    } catch (err) {
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          taskId: record.task_id,
          error: err.message,
        })}\n\n`,
      );
    }
  }

  // Summary
  const composites = results
    .filter((r) => r.scores?.composite)
    .map((r) => r.scores.composite);
  const avgComposite =
    composites.length > 0
      ? composites.reduce((a, b) => a + b, 0) / composites.length
      : 0;

  res.write(
    `data: ${JSON.stringify({
      type: "summary",
      totalRecords: cachedRecords.length,
      processedRecords: results.length,
      averageComposite: Math.round(avgComposite * 1000) / 1000,
      results,
    })}\n\n`,
  );

  res.end();
});

export default router;
