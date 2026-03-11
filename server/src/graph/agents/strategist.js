import { z } from "zod";
import { DateTime } from "luxon";
import { getChatModel } from "../../services/llmClient.js";
import { computeSendTime } from "../tools/timingTool.js";
import { voteOnResult } from "../tools/voting.js";

const STRATEGIST_SYSTEM_PROMPT = `You are a marketing operations expert specializing in multi-channel communication strategy for property management.

Your job is to decide:
1. WHICH CHANNEL to use for this message
2. EXACTLY WHEN to send: the day offset (from last interaction) and hour of day

CHANNEL RULES:
- You MUST only select channels the user has consented to (see eligible_channels).
- Among eligible channels, prefer the user's stated preference order.
- Consider the urgency and context when choosing between channels.

TIMING RULES — CRITICAL:
- Analyze the few-shot examples carefully. Each one shows last_interaction and expected send_at.
- Each example includes a pre-computed [Timing analysis] showing the exact dayOffset and targetHour.
- dayOffset = number of calendar days between last_interaction and send_at.
- targetHour = hour of day of send_at in the user's local timezone.
- Apply the SAME pattern to the current record based on similarity.
- Business hours only (typically 9-18). Weekends are automatically skipped by the system.

You will be given:
- The user's record with all context
- Pre-computed enriched context (eligible channels, urgency, task day hint, etc.)
- A rulebook of learned patterns from similar records
- Few-shot examples with timing analysis`;

const channelSchema = z.object({
  channel: z
    .enum(["sms", "email", "voice"])
    .describe("Selected communication channel"),
  channelReasoning: z
    .string()
    .describe("Step-by-step reasoning for channel choice"),
  dayOffset: z
    .number()
    .int()
    .min(0)
    .max(30)
    .describe(
      "Number of calendar days after last_interaction to send the message. Analyze the few-shot timing patterns carefully.",
    ),
  targetHour: z
    .number()
    .int()
    .min(6)
    .max(20)
    .describe(
      "Hour of day (6-20) in user local timezone to send. Analyze the few-shot timing patterns carefully.",
    ),
  timingReasoning: z
    .string()
    .describe(
      "Step-by-step reasoning for timing choice, referencing the few-shot timing analysis",
    ),
});

/**
 * STRATEGIST AGENT — Decides channel and timing strategy.
 * Uses self-consistency voting for channel selection when voting is enabled.
 */
export async function strategistNode(state) {
  const { record, enrichedContext, rulebook, fewShotExamples } = state;

  const userPrompt = buildStrategistPrompt(
    record,
    enrichedContext,
    rulebook,
    fewShotExamples,
  );

  // Self-consistency voting on channel
  const result = await voteOnResult(
    async (model) => {
      const structured = model.withStructuredOutput(channelSchema);
      return structured.invoke([
        { role: "system", content: STRATEGIST_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ]);
    },
    { n: 3, voteKey: "channel" },
  );

  // Compute exact send time deterministically using Luxon, with LLM-specified offset/hour
  const { sendAt, reasoning: timeCalcReasoning } = computeSendTime(
    enrichedContext.lastInteraction,
    enrichedContext.timezone,
    enrichedContext.urgency,
    { dayOffset: result.dayOffset, targetHour: result.targetHour },
  );

  return {
    channelDecision: {
      channel: result.channel,
      reasoning: result.channelReasoning,
    },
    timingDecision: {
      sendAt,
      strategy: `dayOffset=${result.dayOffset}, targetHour=${result.targetHour}`,
      reasoning: `${result.timingReasoning}\n[Deterministic calc] ${timeCalcReasoning}`,
    },
    stageLog: [
      {
        stage: "strategist",
        timestamp: new Date().toISOString(),
        result: { channel: result.channel, sendAt },
      },
    ],
  };
}

function buildStrategistPrompt(record, enriched, rulebook, examples) {
  let prompt = `## Current Record\n${JSON.stringify(record.input, null, 2)}\n\n`;
  prompt += `## Consent\n${JSON.stringify(record.consent, null, 2)}\n\n`;
  prompt += `## Channel Preferences\n${JSON.stringify(record.channel_preferences)}\n\n`;
  prompt += `## Enriched Context\n${JSON.stringify(enriched, null, 2)}\n\n`;

  if (rulebook) {
    prompt += `## Learned Rulebook\n${rulebook}\n\n`;
  }

  if (examples?.length > 0) {
    prompt += `## Similar Records (few-shot examples with timing analysis)\n`;
    for (const ex of examples) {
      prompt += `### ${ex.taskId} (similarity: ${ex.score?.toFixed(3)})\n`;
      prompt += `Input: ${JSON.stringify(ex.input, null, 2)}\n`;
      prompt += `Expected channel: ${ex.expected?.next_message?.channel}\n`;
      prompt += `Expected send_at: ${ex.expected?.next_message?.send_at}\n`;
      // Pre-compute timing analysis to help LLM learn the pattern
      if (ex.input?.last_interaction && ex.expected?.next_message?.send_at) {
        try {
          const lastDt = DateTime.fromISO(ex.input.last_interaction);
          const sendDt = DateTime.fromISO(ex.expected.next_message.send_at);
          const dayDiff = Math.round(sendDt.diff(lastDt, "days").days);
          const sendHour = sendDt.hour;
          prompt += `[Timing analysis: dayOffset=${dayDiff}, targetHour=${sendHour}]\n`;
        } catch {
          /* ignore parse errors */
        }
      }
      prompt += `\n`;
    }
  }

  prompt += `## Task\nDecide the best channel and timing for this record. Output the exact dayOffset and targetHour based on the patterns in the examples above. Think step by step.`;
  return prompt;
}
