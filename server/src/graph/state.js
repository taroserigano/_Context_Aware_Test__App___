import { Annotation } from "@langchain/langgraph";

/**
 * Pipeline state flowing through the LangGraph multi-agent system.
 * Each agent reads what it needs and writes its output fields.
 */
export const PipelineState = Annotation.Root({
  // ─── Inputs ───
  record: Annotation({ reducer: (_, v) => v, default: () => null }),
  allRecords: Annotation({ reducer: (_, v) => v, default: () => [] }),

  // ─── Enricher (pure code, no LLM) ───
  enrichedContext: Annotation({ reducer: (_, v) => v, default: () => null }),

  // ─── Analyst agent ───
  rulebook: Annotation({ reducer: (_, v) => v, default: () => "" }),
  fewShotExamples: Annotation({ reducer: (_, v) => v, default: () => [] }),

  // ─── Strategist agent ───
  channelDecision: Annotation({ reducer: (_, v) => v, default: () => null }),
  timingDecision: Annotation({ reducer: (_, v) => v, default: () => null }),

  // ─── Copywriter agent ───
  messageOutput: Annotation({ reducer: (_, v) => v, default: () => null }),

  // ─── Compliance agent ───
  complianceResult: Annotation({ reducer: (_, v) => v, default: () => null }),
  complianceAttempts: Annotation({ reducer: (_, v) => v, default: () => 0 }),

  // ─── Planner agent ───
  actionPlan: Annotation({ reducer: (_, v) => v, default: () => null }),

  // ─── Critic agent ───
  criticResult: Annotation({ reducer: (_, v) => v, default: () => null }),

  // ─── Evaluator agent ───
  scores: Annotation({ reducer: (_, v) => v, default: () => null }),

  // ─── Pipeline log (append-only) ───
  stageLog: Annotation({
    reducer: (prev, v) => [...(prev || []), ...(Array.isArray(v) ? v : [v])],
    default: () => [],
  }),
});
