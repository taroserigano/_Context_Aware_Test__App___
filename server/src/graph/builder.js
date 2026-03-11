import { StateGraph, START, END } from "@langchain/langgraph";
import { PipelineState } from "./state.js";
import { enricherNode } from "./agents/enricher.js";
import { analystNode } from "./agents/analyst.js";
import { strategistNode } from "./agents/strategist.js";
import { copywriterNode } from "./agents/copywriter.js";
import { complianceNode } from "./agents/compliance.js";
import { plannerNode } from "./agents/planner.js";
import { evaluatorNode } from "./agents/evaluator.js";

/**
 * Build and compile the multi-agent LangGraph pipeline.
 *
 * Flow:
 *   START → enricher → analyst → strategist → copywriter
 *         → compliance → planner → evaluator → END
 */
let _compiled = null;

export function buildPipelineGraph() {
  if (_compiled) return _compiled;

  const workflow = new StateGraph(PipelineState)
    .addNode("enricher", enricherNode)
    .addNode("analyst", analystNode)
    .addNode("strategist", strategistNode)
    .addNode("copywriter", copywriterNode)
    .addNode("compliance", complianceNode)
    .addNode("planner", plannerNode)
    .addNode("evaluator", evaluatorNode);

  // Linear edges
  workflow.addEdge(START, "enricher");
  workflow.addEdge("enricher", "analyst");
  workflow.addEdge("analyst", "strategist");
  workflow.addEdge("strategist", "copywriter");
  workflow.addEdge("copywriter", "compliance");
  workflow.addEdge("compliance", "planner");
  workflow.addEdge("planner", "evaluator");
  workflow.addEdge("evaluator", END);

  _compiled = workflow.compile();
  return _compiled;
}
