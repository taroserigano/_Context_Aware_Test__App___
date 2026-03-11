import { StateGraph, START, END } from "@langchain/langgraph";
import { PipelineState } from "./state.js";
import { enricherNode } from "./agents/enricher.js";
import { analystNode } from "./agents/analyst.js";
import { strategistNode } from "./agents/strategist.js";
import { copywriterNode } from "./agents/copywriter.js";
import { complianceNode } from "./agents/compliance.js";
import { plannerNode } from "./agents/planner.js";
import { criticNode } from "./agents/critic.js";
import { evaluatorNode } from "./agents/evaluator.js";

const MAX_COMPLIANCE_ATTEMPTS = 3;

/**
 * Build and compile the multi-agent LangGraph pipeline.
 *
 * Flow:
 *   START → enricher → analyst → strategist → copywriter
 *         → compliance ─┬─(pass)──→ planner → critic → evaluator → END
 *                        └─(fail)──→ copywriter (re-write, max 3 loops)
 */
export function buildPipelineGraph() {
  const workflow = new StateGraph(PipelineState)
    .addNode("enricher", enricherNode)
    .addNode("analyst", analystNode)
    .addNode("strategist", strategistNode)
    .addNode("copywriter", copywriterNode)
    .addNode("compliance", complianceNode)
    .addNode("planner", plannerNode)
    .addNode("critic", criticNode)
    .addNode("evaluator", evaluatorNode);

  // Linear edges
  workflow.addEdge(START, "enricher");
  workflow.addEdge("enricher", "analyst");
  workflow.addEdge("analyst", "strategist");
  workflow.addEdge("strategist", "copywriter");
  workflow.addEdge("copywriter", "compliance");

  // Compliance always proceeds to planner — repairs are done inline, no loopback
  workflow.addEdge("compliance", "planner");

  workflow.addEdge("planner", "critic");
  workflow.addEdge("critic", "evaluator");
  workflow.addEdge("evaluator", END);

  return workflow.compile();
}
