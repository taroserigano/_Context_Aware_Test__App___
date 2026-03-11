import { z } from "zod";
import { getChatModel } from "../../services/llmClient.js";

const PLANNER_SYSTEM_PROMPT = `You are a CRM automation expert for property management.

Your job is to decide the NEXT ACTION after a message is sent to a prospect or resident.

Typical next actions:
- start_cadence: Begin an automated drip campaign. Use for new/high-urgency prospects on their first touch. Name format: "prospect_welcome_short_horizon", "prospect_nurture_long_horizon", etc.
- follow_up_in_days: Schedule a follow-up after N days. Use for open/ongoing prospects with longer timelines.
- escalate_to_human: Hand off to a leasing agent (for complex or high-value situations)
- close_loop: No further action needed

CRITICAL: Study the few-shot examples very carefully. Match the EXACT action type, cadence name format, and follow-up day values from the examples.

Consider:
- The urgency and move timeline
- Whether this is the first touch or a follow-up (lifecycle_stage: new vs open)
- The lifecycle stage and task_id pattern
- What the learned rulebook says about next actions
- The few-shot examples of what actions were taken in similar cases`;

const actionSchema = z.object({
  type: z
    .string()
    .describe(
      "Action type: start_cadence, follow_up_in_days, escalate_to_human, close_loop",
    ),
  name: z.string().optional().describe("Cadence name if type is start_cadence"),
  value: z
    .number()
    .optional()
    .describe("Number of days if type is follow_up_in_days"),
  reasoning: z.string().describe("Step-by-step reasoning for this action"),
});

/**
 * PLANNER AGENT — Decides the next CRM action after messaging.
 */
export async function plannerNode(state) {
  const {
    record,
    enrichedContext,
    rulebook,
    fewShotExamples,
    channelDecision,
  } = state;

  const model = getChatModel({ temperature: 0.1 });
  const structured = model.withStructuredOutput(actionSchema);

  const result = await structured.invoke([
    { role: "system", content: PLANNER_SYSTEM_PROMPT },
    {
      role: "user",
      content: buildPlannerPrompt(
        record,
        enrichedContext,
        rulebook,
        fewShotExamples,
      ),
    },
  ]);

  return {
    actionPlan: {
      type: result.type,
      name: result.name || undefined,
      value: result.value || undefined,
      reasoning: result.reasoning,
    },
    stageLog: [
      {
        stage: "planner",
        timestamp: new Date().toISOString(),
        result: { type: result.type, name: result.name, value: result.value },
      },
    ],
  };
}

function buildPlannerPrompt(record, enriched, rulebook, examples) {
  let prompt = `## Record Context\n`;
  prompt += `Task: ${record.task_id}\n`;
  prompt += `Persona: ${record.persona}\n`;
  prompt += `Lifecycle: ${record.lifecycle_stage}\n`;
  prompt += `Urgency: ${enriched.urgency}\n`;
  prompt += `Days Until Move: ${enriched.daysUntilMove}\n\n`;

  if (rulebook) {
    prompt += `## Learned Action Rules\n${rulebook}\n\n`;
  }

  if (examples?.length > 0) {
    prompt += `## Similar Records' Actions — Match these patterns EXACTLY\n`;
    for (const ex of examples) {
      prompt += `### ${ex.taskId}\n`;
      prompt += `Lifecycle: ${ex.lifecycle_stage || ex.input?.lifecycle_stage || "unknown"}\n`;
      prompt += `Move date: ${ex.input?.move_date_target || "unknown"}\n`;
      prompt += `Expected action: ${JSON.stringify(ex.expected?.next_action)}\n\n`;
    }
  }

  prompt += `## Expected Output Structure\n`;
  prompt += `{ "type": "start_cadence|follow_up_in_days|...", "name": "exact_cadence_name (match examples)", "value": N, "reasoning": "..." }\n\n`;
  prompt += `## Task\nDecide the best next action for this record. Match the patterns from the examples above as closely as possible. Think step by step.`;
  return prompt;
}
