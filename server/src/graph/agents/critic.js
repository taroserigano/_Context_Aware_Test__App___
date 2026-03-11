import { z } from "zod";
import { getChatModel } from "../../services/llmClient.js";

const CRITIC_SYSTEM_PROMPT = `You are a final QA reviewer for an automated messaging system.

You receive the COMPLETE output of a message pipeline. Review ONLY for OBJECTIVE FACTUAL errors.

You should flag an issue ONLY if:
1. WRONG CHANNEL: The channel doesn't match what consent allows (e.g. SMS when sms_opt_in=false)
2. MISSING OPT-OUT: No opt-out/unsubscribe text in the body
3. WRONG RECIPIENT NAME: The message uses the wrong first name
4. FACTUAL ERROR: The message references amenities, property name, or city that don't match the input data

Do NOT flag:
- Style preferences (tone, enthusiasm, length)
- Subjective quality opinions
- SMS body length — the system handles appropriate length
- Timing being "in the future" — scheduled messages are EXPECTED to be in the future
- CTA format preferences — the system matches CTA format to channel
- Action cadence naming — the system handles this

Most outputs should be APPROVED. Only flag clear factual/data errors.
If everything is factually correct, set approved=true with an empty issues array.`;

const criticSchema = z.object({
  approved: z.boolean().describe("Whether the overall output is approved"),
  issues: z.array(
    z.object({
      category: z.string().describe("The issue category"),
      description: z.string().describe("What the issue is"),
      suggestedFix: z.string().describe("How to fix it"),
    }),
  ),
  overallAssessment: z.string().describe("Brief overall quality assessment"),
});

/**
 * CRITIC AGENT — Reviews the full pipeline output for cross-node consistency.
 */
export async function criticNode(state) {
  const {
    record,
    channelDecision,
    timingDecision,
    messageOutput,
    actionPlan,
    enrichedContext,
  } = state;

  const model = getChatModel({ temperature: 0 });
  const structured = model.withStructuredOutput(criticSchema);

  const result = await structured.invoke([
    { role: "system", content: CRITIC_SYSTEM_PROMPT },
    {
      role: "user",
      content: buildCriticPrompt(
        record,
        channelDecision,
        timingDecision,
        messageOutput,
        actionPlan,
        enrichedContext,
      ),
    },
  ]);

  return {
    criticResult: {
      approved: result.approved,
      issues: result.issues,
      overallAssessment: result.overallAssessment,
    },
    stageLog: [
      {
        stage: "critic",
        timestamp: new Date().toISOString(),
        result: {
          approved: result.approved,
          issueCount: result.issues.length,
        },
      },
    ],
  };
}

function buildCriticPrompt(record, channel, timing, message, action, enriched) {
  return `## Full Pipeline Output to Review

### Record
Task: ${record.task_id}
Persona: ${record.persona}
Lifecycle: ${record.lifecycle_stage}
Urgency: ${enriched.urgency}
Days Until Move: ${enriched.daysUntilMove}

### Channel Decision
Channel: ${channel.channel}
Reasoning: ${channel.reasoning}

### Timing Decision
Send At: ${timing.sendAt}
Strategy: ${timing.strategy}

### Message
Subject: ${message.subject || "N/A"}
Body:
${message.body}

CTA: ${JSON.stringify(message.cta)}

### Next Action
Type: ${action.type}
${action.name ? `Name: ${action.name}` : ""}
${action.value ? `Value: ${action.value}` : ""}

### Task
Review all components for consistency and quality. Think systematically through each check.`;
}
