import { z } from "zod";
import { getChatModel } from "../../services/llmClient.js";

const COPYWRITER_SYSTEM_PROMPT = `You are a property marketing copywriter for a residential apartment community.

Your job is to compose a personalized outreach message for a prospect or resident.

CRITICAL REQUIREMENTS:
- Use the prospect's FIRST NAME in the greeting
- Reference SPECIFIC details from their profile (amenity interests, city, move date, property name)
- Match the CHANNEL format:
  * SMS: Concise single paragraph, ~160 chars. End with "Reply STOP to opt out."
  * Email: Multi-line. Greeting line, body paragraph(s), CTA link line, then "To opt out of emails, click here or reply STOP." as the last line.
- Include appropriate opt-out instructions at the END of the message (as shown in examples)
- Include a clear CTA (call to action)
- Do NOT include any discriminatory language (fair housing compliance)
- Do NOT leak PII beyond first name
- Keep tone warm, professional, and helpful

For CTA format:
- SMS: use quick-reply number options (e.g. "Reply 1 for Thu, 2 for Fri")
- Email: use link-based CTAs with a URL like https://propertyname.example/tour

IMPORTANT: Your body output must be the COMPLETE final message text EXACTLY as the recipient will see it.
Study the few-shot examples extremely carefully and replicate their EXACT style, structure, length, formatting, and opt-out text.
The body you return is sent directly — nothing is appended or modified after you.`;

const messageSchema = z.object({
  subject: z
    .string()
    .nullable()
    .describe(
      "Email subject line (null for SMS). Be specific and reference prospect interests/amenities/property.",
    ),
  body: z
    .string()
    .describe(
      "COMPLETE final message body exactly as the recipient will see it. Includes greeting, personalized content, CTA, and opt-out instructions. Match few-shot examples precisely.",
    ),
  cta: z.object({
    type: z
      .string()
      .describe("CTA type matching examples: schedule_tour, learn_more, etc."),
    options: z
      .array(z.string())
      .optional()
      .describe('Quick-reply options for SMS only, e.g. ["Thu", "Fri"]'),
    link: z
      .string()
      .optional()
      .describe(
        "CTA link URL for email only, e.g. https://propertyname.example/tour",
      ),
  }),
  reasoning: z.string().describe("Step-by-step reasoning for content choices"),
});

/**
 * COPYWRITER AGENT — Composes the personalized message.
 * Uses low temperature for deterministic output with strong few-shot anchoring.
 */
export async function copywriterNode(state) {
  const {
    record,
    enrichedContext,
    rulebook,
    fewShotExamples,
    channelDecision,
    timingDecision,
  } = state;

  const channel = channelDecision.channel;
  const userPrompt = buildCopywriterPrompt(
    record,
    enrichedContext,
    rulebook,
    fewShotExamples,
    channel,
    timingDecision,
  );

  // Use low temperature for deterministic output with strong few-shot anchoring
  const model = getChatModel({ temperature: 0.2 });
  const structured = model.withStructuredOutput(messageSchema);
  const result = await structured.invoke([
    { role: "system", content: COPYWRITER_SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ]);

  return {
    messageOutput: {
      channel,
      sendAt: timingDecision.sendAt,
      subject: result.subject,
      body: result.body,
      cta: result.cta,
      reasoning: result.reasoning,
    },
    stageLog: [
      {
        stage: "copywriter",
        timestamp: new Date().toISOString(),
        result: {
          channel,
          subject: result.subject,
          bodyPreview: result.body.slice(0, 100),
          ctaType: result.cta.type,
        },
      },
    ],
  };
}

function buildCopywriterPrompt(
  record,
  enriched,
  rulebook,
  examples,
  channel,
  timing,
) {
  let prompt = `## Channel: ${channel}\n`;
  prompt += `## Send At: ${timing.sendAt}\n\n`;
  prompt += `## User Profile\n${JSON.stringify(record.input.profile, null, 2)}\n\n`;
  prompt += `## Property: ${record.input.property_name}\n`;
  prompt += `## Move Date: ${record.input.move_date_target}\n`;
  prompt += `## Language: ${record.input.language}\n`;
  prompt += `## Urgency: ${enriched.urgency}\n`;
  prompt += `## Days Until Move: ${enriched.daysUntilMove}\n\n`;

  prompt += `## Constraints\n${JSON.stringify(record.assertions?.constraints, null, 2)}\n\n`;

  if (rulebook) {
    prompt += `## Learned Content Rules\n${rulebook}\n\n`;
  }

  if (examples?.length > 0) {
    prompt += `## Reference Examples — Replicate this EXACT style and structure\n`;
    for (const ex of examples) {
      const msg = ex.expected?.next_message;
      if (!msg) continue;
      prompt += `### ${ex.taskId} (channel: ${msg.channel})\n`;
      prompt += `Subject: ${msg.subject === null ? "null" : `"${msg.subject}"`}\n`;
      prompt += `Body (EXACT text):\n"""\n${msg.body}\n"""\n`;
      prompt += `CTA: ${JSON.stringify(msg.cta)}\n\n`;
    }
  }

  prompt += `## Task\nCompose a personalized ${channel} message for this prospect. `;
  prompt += `Replicate the EXACT formatting, style, length, tone, and structure from the reference examples above. `;
  if (channel === "sms") {
    prompt += `SMS format: single paragraph, concise (~160 chars), greeting + content + CTA options + "Reply STOP to opt out." at the end. Subject must be null.\n`;
  } else {
    prompt += `Email format: greeting line, body paragraph(s) referencing their interests, CTA link line ("Book now → URL"), then "To opt out of emails, click here or reply STOP." as the last line. Subject should be specific and reference their interests.\n`;
  }
  return prompt;
}
