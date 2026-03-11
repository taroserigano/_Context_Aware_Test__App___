import { z } from "zod";
import { getChatModel } from "../../services/llmClient.js";

const COPYWRITER_SYSTEM_PROMPT = `You are a property marketing copywriter for a residential apartment community.

Your job is to compose a personalized outreach message for a prospect or resident.
Your output body must be EXTREMELY close — nearly identical — to the reference examples provided.

ABSOLUTE RULES:
- Use the prospect's FIRST NAME in the greeting
- Reference SPECIFIC details from their profile (amenity interests, city, move date, property name)
- Do NOT include any discriminatory language (fair housing compliance)
- Do NOT leak PII beyond first name

SMS FORMAT (follow this skeleton EXACTLY):
"Hi {FirstName}—welcome to {PropertyName}! {1 sentence about tours/availability}. {Question with 2 options}? Reply 1 for {Option1}, 2 for {Option2}. Reply STOP to opt out."
- Single paragraph, ~140-160 chars total
- Use em-dash (—) after the name, NOT a comma
- Subject MUST be null
- CTA: numbered quick-reply options
- End with exactly: "Reply STOP to opt out."

EMAIL FORMAT (follow this skeleton EXACTLY, using \\n for line breaks):
"Hi {FirstName},\\n{1-2 sentences referencing their interests/timeline and property amenities}. {Action suggestion}.\\nBook now → https://{propertyslug}.example/tour\\nTo opt out of emails, click here or reply STOP."
- Lines separated by \\n (newline)
- Line 1: "Hi {FirstName},"
- Line 2: Body with personalized content about their specific amenity interests + move timeline
- Line 3: "Book now → https://{propertyslug}.example/tour"
- Line 4: "To opt out of emails, click here or reply STOP."
- Subject: specific, references prospect's amenity interests and property name
- CTA link: https://{propertyslug}.example/tour

CRITICAL: Study the few-shot examples character-by-character. Replicate the EXACT wording patterns, punctuation (em-dashes, arrows →), line break positions, opt-out text, and CTA format. The body similarity score is computed by semantic embedding — the closer your wording, the higher the score.`;

const messageSchema = z.object({
  subject: z
    .string()
    .nullable()
    .describe(
      "Email subject line (null for SMS). Reference property name and prospect's specific interests/amenities.",
    ),
  body: z
    .string()
    .describe(
      "COMPLETE final message body. Must match the reference examples' exact structure, punctuation, em-dashes, arrows, newline positions, and opt-out text character-for-character.",
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

  const model = getChatModel({ temperature: 0 });
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

  prompt += `## Task
Compose a personalized ${channel} message for this prospect. `;
  prompt += `Your body text must be NEARLY IDENTICAL to the reference examples above — same structure, same punctuation, same line breaks, same opt-out wording. `;
  prompt += `Swap in this prospect's details (name, property, amenities, city, dates) but keep EVERYTHING ELSE the same as the examples. `;
  if (channel === "sms") {
    prompt += `\nSMS SKELETON: "Hi {Name}\u2014welcome to {Property}! {1 sentence}. {Question}? Reply 1 for {X}, 2 for {Y}. Reply STOP to opt out."\n`;
    prompt += `Subject MUST be null. Use em-dash (\u2014) not comma after name. Keep under 160 chars.\n`;
  } else {
    prompt += `\nEMAIL SKELETON (use \\n for line breaks):\nLine 1: "Hi {Name},"\nLine 2: "{Personalized body referencing their specific amenities/timeline}. {Suggestion}."\nLine 3: "Book now \u2192 https://{propertyslug}.example/tour"\nLine 4: "To opt out of emails, click here or reply STOP."\n`;
    prompt += `Subject must reference property name + prospect's specific amenity interests. Use \u2014 (em-dash) in body for inline breaks if needed.\n`;
  }
  return prompt;
}
