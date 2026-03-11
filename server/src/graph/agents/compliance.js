import { z } from "zod";
import { getChatModel } from "../../services/llmClient.js";
import { hasOptOutInstructions } from "../tools/templateTool.js";

const COMPLIANCE_SYSTEM_PROMPT = `You are a fair housing and privacy compliance auditor for residential property communications.

You ONLY check for HARD LEGAL/POLICY violations — NOT style, tone, or quality preferences.

CHECK ONLY THESE THREE THINGS:
1. FAIR HOUSING: Does the message contain language that discriminates based on race, color, religion, national origin, sex, familial status, or disability? Mentioning property amenities (pool, fitness, etc.), neighborhood, or city is NOT a violation.
2. PII LEAKAGE: Does the message expose sensitive personal information BEYOND first name? (First name usage is expected and fine.)
3. OPT-OUT INSTRUCTIONS: Does the message include opt-out instructions? For SMS: "STOP" or "opt out". For email: "opt out" or "unsubscribe" or "STOP".

IMPORTANT:
- A well-written marketing message about an apartment community almost ALWAYS passes.
- Mentioning amenities, tours, locations, move dates = NORMAL marketing, NOT a violation.
- Using the prospect's first name = EXPECTED, NOT a PII leak.
- If the pre-check confirms opt-out text is present, do NOT flag opt-out as a violation.
- Only mark passed=false for CLEAR, OBJECTIVE violations of the 3 rules above.
- When in doubt, PASS the message.`;

const complianceSchema = z.object({
  passed: z
    .boolean()
    .describe(
      "true unless there is a CLEAR violation of fair_housing, pii_leak, or no_opt_out. When in doubt, pass.",
    ),
  violations: z.array(
    z.object({
      category: z
        .enum(["fair_housing", "pii_leak", "no_opt_out"])
        .describe("Only these 3 categories"),
      description: z.string().describe("What the specific violation is"),
      fix: z.string().describe("Minimal fix to resolve it"),
    }),
  ),
  repairedBody: z
    .string()
    .nullable()
    .describe(
      "Minimally repaired message body ONLY if violations found, null if passed. Change as little as possible.",
    ),
  reasoning: z.string().describe("Brief compliance analysis"),
});

/**
 * COMPLIANCE AGENT — Checks and repairs message for constraint violations.
 */
export async function complianceNode(state) {
  const { record, messageOutput, complianceAttempts } = state;

  // Fast pre-check: verify opt-out text is present (guaranteed by template, but double-check)
  const bodyToCheck = messageOutput.body;
  const hasOptOut = hasOptOutInstructions(bodyToCheck);

  const model = getChatModel({ temperature: 0 });
  const structured = model.withStructuredOutput(complianceSchema);

  const result = await structured.invoke([
    { role: "system", content: COMPLIANCE_SYSTEM_PROMPT },
    {
      role: "user",
      content: buildCompliancePrompt(record, messageOutput, hasOptOut),
    },
  ]);

  // Filter out invalid violation categories and false positives
  result.violations = result.violations.filter((v) =>
    ["fair_housing", "pii_leak", "no_opt_out"].includes(v.category),
  );

  // If opt-out text is confirmed present, remove any no_opt_out violations
  if (hasOptOut) {
    result.violations = result.violations.filter(
      (v) => v.category !== "no_opt_out",
    );
  }

  // Re-evaluate passed status after filtering
  if (result.violations.length === 0) {
    result.passed = true;
    result.repairedBody = null;
  }

  // Only apply repaired body for genuine fair_housing or pii_leak violations
  let updatedMessage = null;
  if (!result.passed && result.repairedBody) {
    updatedMessage = { ...messageOutput, body: result.repairedBody };
  }

  return {
    complianceResult: {
      passed: result.passed,
      violations: result.violations,
      reasoning: result.reasoning,
    },
    complianceAttempts: complianceAttempts + 1,
    ...(updatedMessage ? { messageOutput: updatedMessage } : {}),
    stageLog: [
      {
        stage: "compliance",
        timestamp: new Date().toISOString(),
        result: {
          passed: result.passed,
          violations: result.violations.length,
          attempt: complianceAttempts + 1,
        },
      },
    ],
  };
}

function buildCompliancePrompt(record, message, hasOptOut) {
  let prompt = `## Message to Review\n`;
  prompt += `Channel: ${message.channel}\n`;
  prompt += `Subject: ${message.subject || "N/A"}\n`;
  prompt += `Body:\n${message.body}\n\n`;
  prompt += `CTA: ${JSON.stringify(message.cta)}\n\n`;
  prompt += `## Record Constraints\n${JSON.stringify(record.assertions, null, 2)}\n\n`;
  prompt += `## Pre-check Results\n`;
  prompt += `Opt-out instructions detected: ${hasOptOut}\n\n`;
  prompt += `## Task\nCheck ONLY for: (1) fair housing discrimination, (2) PII leakage beyond first name, (3) missing opt-out text. If opt-out is confirmed present in pre-check, do NOT flag it. Most well-written property marketing messages PASS. Only flag CLEAR violations.`;
  return prompt;
}
