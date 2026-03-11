import { z } from "zod";
import { getChatModel } from "../../services/llmClient.js";
import { VectorStore } from "../../services/vectorStore.js";
import {
  setVectorStore,
  setRulebook,
  setPatterns,
  setLearned,
  getRulebook,
  getVectorStore,
} from "../../services/runtime.js";

const ANALYST_SYSTEM_PROMPT = `You are a data scientist specializing in customer communication patterns.

You are given a dataset of test cases for a property-management messaging system. Each test case contains:
- Input: user profile, preferences, context, constraints
- Expected: what message should be sent (or not sent), via which channel, when, and what action to take

Your job is to analyze ALL records and extract PRECISE, ACTIONABLE decision rules. Do NOT just describe the data — infer the RULES that explain WHY each expected output was chosen.

Focus on extracting rules for:
1. CHANNEL SELECTION:
   - When is SMS chosen vs email? How do consent flags (sms_opt_in, email_opt_in) gate availability?
   - How do channel_preferences interact with consent? (e.g. prefer SMS but no SMS consent → use email)
   - Rule format: "IF sms_opt_in=true AND 'sms' in preferences THEN channel=sms"

2. TIMING (CRITICAL — be very precise):
   - For each record, compute the exact day offset: dayOffset = calendar days between last_interaction and send_at
   - For each record, note the targetHour = hour of send_at in local timezone
   - What determines dayOffset? Does the task_id day number (e.g. "day0", "day3") correlate with the offset?
   - What determines targetHour? Does it differ by channel (SMS=9AM, email=10AM) or urgency?
   - Rule format: "IF urgency=high THEN dayOffset=1, targetHour=9"

3. MESSAGE BODY STYLE (CRITICAL — extract exact templates):
   - SMS: Copy the EXACT body text from examples as a template. Note the em-dash (—) after the name, the single-paragraph structure, the question with numbered reply options, and the "Reply STOP to opt out." ending.
   - Email: Copy the EXACT body text from examples as a template. Note the newline-separated structure: "Hi Name," then body paragraphs, then "Book now → https://slug.example/tour" then "To opt out of emails, click here or reply STOP."
   - For each example, QUOTE the full expected body text verbatim as part of the rule, so downstream agents can replicate it character-for-character.
   - What opt-out text is used? SMS: "Reply STOP to opt out." Email: "To opt out of emails, click here or reply STOP."
   - How is personalization applied (first name, property, amenities, city, move timeline)?
   - What special characters are used? Em-dashes (—), arrows (→), mid-dots (·)?

4. CTA FORMAT:
   - SMS: quick-reply numbered options (e.g. "Reply 1 for Thu, 2 for Fri")
   - Email: link-based CTA (e.g. "Book now → https://property.example/tour")
   - What determines options vs link? Channel type.

5. SUBJECT LINE:
   - SMS: subject is always null
   - Email: specific subject line referencing prospect interests
   - What pattern makes a good email subject?

6. NEXT ACTION:
   - When is start_cadence used vs follow_up_in_days?
   - What cadence names are used and what triggers them?
   - What follow-up day values are used and what determines them?

7. COMPLIANCE:
   - Required opt-out instructions per channel
   - Fair housing / no discrimination rules

Return a structured rulebook that another agent can follow to EXACTLY reproduce these decisions.`;

const rulebookSchema = z.object({
  rulebook: z
    .string()
    .describe(
      "Complete rulebook of inferred decision rules as structured text",
    ),
  patterns: z.array(
    z.object({
      category: z
        .string()
        .describe(
          "Rule category: channel, timing, content, cta, action, compliance",
        ),
      rule: z.string().describe("The inferred rule"),
      evidence: z
        .string()
        .describe("Which record(s) this rule was derived from"),
    }),
  ),
});

/**
 * ANALYST AGENT — Learns patterns from all records.
 * Called during /api/learn. Output is cached in runtime.
 */
export async function learnPatterns(allRecords) {
  const model = getChatModel({ temperature: 0.1 });
  const structured = model.withStructuredOutput(rulebookSchema);

  // Compact summary — only the fields agents need, not full pretty-printed JSON
  const recordsSummary = allRecords
    .map((r, i) => {
      const {
        input,
        expected,
        consent,
        channel_preferences,
        persona,
        lifecycle_stage,
        task_id,
        assertions,
      } = r;
      return `--- Record ${i + 1} (${task_id}) ---\n${JSON.stringify({ task_id, persona, lifecycle_stage, consent, channel_preferences, input, assertions, expected })}`;
    })
    .join("\n\n");

  // Run LLM analysis and vector store embedding in parallel
  const vsPromise = (async () => {
    const vs = new VectorStore();
    const docs = allRecords.map((r) => ({
      text: buildRecordContextText(r),
      metadata: { taskId: r.task_id, record: r },
    }));
    await vs.addDocuments(docs);
    return vs;
  })();

  const [result, vs] = await Promise.all([
    structured.invoke([
      { role: "system", content: ANALYST_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Analyze these records and extract the decision rules:\n\n${recordsSummary}`,
      },
    ]),
    vsPromise,
  ]);

  // Store in runtime
  setRulebook(result.rulebook);
  setPatterns(result.patterns);
  setVectorStore(vs);

  setLearned(true);
  return result;
}

/**
 * ANALYST NODE — Used within the LangGraph pipeline.
 * Retrieves cached rulebook and performs few-shot retrieval for the current record.
 */
export async function analystNode(state) {
  const { enrichedContext } = state;
  const rulebook = getRulebook();
  const vs = getVectorStore();

  let fewShotExamples = [];
  if (vs && enrichedContext?.profileSummary) {
    const results = await vs.search(enrichedContext.profileSummary, 3);
    fewShotExamples = results.map((r) => ({
      taskId: r.doc.metadata.taskId,
      input: r.doc.metadata.record.input,
      expected: r.doc.metadata.record.expected,
      persona: r.doc.metadata.record.persona,
      lifecycle_stage: r.doc.metadata.record.lifecycle_stage,
      consent: r.doc.metadata.record.consent,
      channel_preferences: r.doc.metadata.record.channel_preferences,
      score: r.score,
    }));
  }

  return {
    rulebook,
    fewShotExamples,
    stageLog: [
      {
        stage: "analyst",
        timestamp: new Date().toISOString(),
        result: {
          rulebookLength: rulebook.length,
          examplesFound: fewShotExamples.length,
          exampleIds: fewShotExamples.map((e) => e.taskId),
        },
      },
    ],
  };
}

function buildRecordContextText(record) {
  const { input, consent, channel_preferences, persona, lifecycle_stage } =
    record;
  return [
    `persona: ${persona}`,
    `lifecycle: ${lifecycle_stage}`,
    `property: ${input.property_name}`,
    `move_target: ${input.move_date_target}`,
    `channels: ${channel_preferences.join(",")}`,
    `consent_sms: ${consent.sms_opt_in}`,
    `consent_email: ${consent.email_opt_in}`,
    `name: ${input.profile?.first_name || "unknown"}`,
    input.profile?.amenity_interest
      ? `amenities: ${input.profile.amenity_interest.join(",")}`
      : "",
    input.profile?.city_interest ? `city: ${input.profile.city_interest}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}
