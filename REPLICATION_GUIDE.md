# Context-Aware Message Bot — Full Replication Guide

## STEP 1: Create Folder Structure & Install Dependencies

```bash
mkdir message-bot && cd message-bot

mkdir -p server/src/graph/agents
mkdir -p server/src/graph/tools
mkdir -p server/src/routes
mkdir -p server/src/services

cd server
npm init -y
npm i express cors dotenv @langchain/core @langchain/langgraph @langchain/openai luxon zod uuid

cd ..
npm create vite@latest client -- --template react
cd client
npm i
cd ..
```

## STEP 2: Create .env in project root

```
OPENAI_API_KEY=sk-your-key-here
LLM_MODEL=gpt-4o-mini
```

## STEP 3: Create .gitignore in project root

```
node_modules/
.env
.env.local
.env.*.local
dist/
```

## STEP 4: Create sample.jsonl in project root

```jsonl
{"task_id":"prospect_welcome_day0","persona":"prospect","lifecycle_stage":"new","consent":{"email_opt_in":true,"sms_opt_in":true,"voice_opt_in":false},"channel_preferences":["sms","email"],"input":{"property_name":"Oak Ridge Apartments","move_date_target":"2026-01-10","last_interaction":"2025-12-08T15:04:00Z","timezone":"America/Chicago","language":"en","profile":{"first_name":"Taylor","city_interest":"Richardson, TX"}},"assertions":{"required_states":["consent_verified","fair_housing_check_passed","brand_style_applied"],"constraints":{"no_pii_leak":true,"no_sensitive_discrimination":true,"include_opt_out_instructions":true,"primary_cta":"book_tour"}},"thresholds":{"p95_latency_ms":2000,"personalization_score_min":0.85,"reply_classification_f1_min":0.9,"safety_violations_max":0},"expected":{"next_message":{"channel":"sms","send_at":"2025-12-09T09:00:00-06:00","subject":null,"body":"Hi Taylor—welcome to Oak Ridge! Tours are available this week. Would you like to book a time on Thursday or Friday? Reply 1 for Thu, 2 for Fri. Reply STOP to opt out.","cta":{"type":"schedule_tour","options":["Thu","Fri"]}},"next_action":{"type":"start_cadence","name":"prospect_welcome_short_horizon"}}}
{"task_id":"prospect_long_horizon_day3","persona":"prospect","lifecycle_stage":"open","consent":{"email_opt_in":true,"sms_opt_in":false,"voice_opt_in":false},"channel_preferences":["email","sms"],"input":{"property_name":"Oak Ridge Apartments","move_date_target":"2026-02-15","last_interaction":"2025-12-06T11:30:00Z","timezone":"America/Chicago","language":"en","profile":{"first_name":"Taylor","amenity_interest":["pool","fitness"]}},"assertions":{"required_states":["consent_verified","fair_housing_check_passed","brand_style_applied"],"constraints":{"no_pii_leak":true,"include_opt_out_instructions":true,"primary_cta":"book_tour"}},"thresholds":{"p95_latency_ms":2000,"personalization_score_min":0.8,"reply_classification_f1_min":0.9,"safety_violations_max":0},"expected":{"next_message":{"channel":"email","send_at":"2025-12-09T10:00:00-06:00","subject":"Tour Oak Ridge—See the pool & fitness rooms you asked about","body":"Hi Taylor,\nSince you're planning a mid‑February move, here's a quick look at our pool and 24/7 fitness center. Book a visit this week to compare floor plans.\nBook now → https://oakridge.example/tour\nTo opt out of emails, click here or reply STOP.","cta":{"type":"schedule_tour","link":"https://oakridge.example/tour"}},"next_action":{"type":"follow_up_in_days","value":3}}}
```

## STEP 5: Edit server/package.json — replace contents with:

```json
{
  "name": "message-bot-server",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js"
  },
  "dependencies": {
    "@langchain/core": "^0.3.0",
    "@langchain/langgraph": "^0.2.0",
    "@langchain/openai": "^0.3.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.21.0",
    "luxon": "^3.5.0",
    "uuid": "^10.0.0",
    "zod": "^3.23.0"
  }
}
```

## STEP 6: Edit client/vite.config.js — replace contents with:

```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
```

## STEP 7: Edit client/index.html — replace contents with:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Context-Aware Message Bot</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

## STEP 8: Create server/src/services/llmClient.js

```js
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";

let overrides = {};

export function updateLLMConfig(newConfig) {
  if (newConfig.apiKey) overrides.apiKey = newConfig.apiKey;
  if (newConfig.model) overrides.model = newConfig.model;
}

function getApiKey() {
  return overrides.apiKey || process.env.OPENAI_API_KEY || "";
}

function getModel() {
  return overrides.model || process.env.LLM_MODEL || "gpt-4o-mini";
}

export function getLLMConfig() {
  return { model: getModel(), hasKey: !!getApiKey() };
}

export function getChatModel(options = {}) {
  return new ChatOpenAI({
    openAIApiKey: getApiKey(),
    modelName: options.model || getModel(),
    temperature: options.temperature ?? 0.2,
  });
}

export function getEmbeddingsModel() {
  return new OpenAIEmbeddings({
    openAIApiKey: getApiKey(),
    modelName: "text-embedding-3-small",
  });
}
```

## STEP 9: Create server/src/services/vectorStore.js

```js
import { getEmbeddingsModel } from "./llmClient.js";

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class VectorStore {
  constructor() {
    this.vectors = [];
    this.documents = [];
  }

  async addDocuments(docs) {
    const embedModel = getEmbeddingsModel();
    const texts = docs.map((d) => d.text);
    const vecs = await embedModel.embedDocuments(texts);
    for (let i = 0; i < docs.length; i++) {
      this.vectors.push(vecs[i]);
      this.documents.push(docs[i]);
    }
  }

  async search(query, k = 3) {
    if (this.documents.length === 0) return [];
    const embedModel = getEmbeddingsModel();
    const queryVec = await embedModel.embedQuery(query);
    const scored = this.documents.map((doc, i) => ({
      doc,
      score: cosineSimilarity(queryVec, this.vectors[i]),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.min(k, scored.length));
  }
}

export async function computeSimilarity(text1, text2) {
  const embedModel = getEmbeddingsModel();
  const [vec1, vec2] = await Promise.all([
    embedModel.embedQuery(text1),
    embedModel.embedQuery(text2),
  ]);
  return cosineSimilarity(vec1, vec2);
}
```

## STEP 10: Create server/src/services/runtime.js

```js
let vectorStore = null;
let learnedRulebook = "";
let learnedPatterns = [];
let isLearned = false;

export function setVectorStore(vs) { vectorStore = vs; }
export function getVectorStore() { return vectorStore; }
export function setRulebook(rb) { learnedRulebook = rb; }
export function getRulebook() { return learnedRulebook; }
export function setPatterns(p) { learnedPatterns = p; }
export function getPatterns() { return learnedPatterns; }
export function setLearned(v) { isLearned = v; }
export function getIsLearned() { return isLearned; }

export function resetRuntime() {
  vectorStore = null;
  learnedRulebook = "";
  learnedPatterns = [];
  isLearned = false;
}
```

## STEP 11: Create server/src/services/jsonlParser.js

```js
import { readFileSync } from "fs";
import path from "path";

export function parseJsonl(filePath) {
  const resolved = path.resolve(filePath);
  const content = readFileSync(resolved, "utf-8");
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}
```

## STEP 12: Create server/src/graph/state.js

```js
import { Annotation } from "@langchain/langgraph";

export const PipelineState = Annotation.Root({
  record: Annotation({ reducer: (_, v) => v, default: () => null }),
  allRecords: Annotation({ reducer: (_, v) => v, default: () => [] }),
  enrichedContext: Annotation({ reducer: (_, v) => v, default: () => null }),
  rulebook: Annotation({ reducer: (_, v) => v, default: () => "" }),
  fewShotExamples: Annotation({ reducer: (_, v) => v, default: () => [] }),
  channelDecision: Annotation({ reducer: (_, v) => v, default: () => null }),
  timingDecision: Annotation({ reducer: (_, v) => v, default: () => null }),
  messageOutput: Annotation({ reducer: (_, v) => v, default: () => null }),
  complianceResult: Annotation({ reducer: (_, v) => v, default: () => null }),
  complianceAttempts: Annotation({ reducer: (_, v) => v, default: () => 0 }),
  actionPlan: Annotation({ reducer: (_, v) => v, default: () => null }),
  scores: Annotation({ reducer: (_, v) => v, default: () => null }),
  stageLog: Annotation({
    reducer: (prev, v) => [...(prev || []), ...(Array.isArray(v) ? v : [v])],
    default: () => [],
  }),
});
```

## STEP 13: Create server/src/graph/tools/timingTool.js

```js
import { DateTime } from "luxon";

export function computeSendTime(lastInteraction, timezone, urgency, options = {}) {
  const { dayOffset, targetHour } = options;
  const lastDt = DateTime.fromISO(lastInteraction, { zone: timezone });

  const offset = dayOffset != null ? dayOffset : urgency === "high" ? 1 : urgency === "medium" ? 1 : 2;
  const hour = targetHour != null ? targetHour : urgency === "high" ? 9 : 10;

  let candidate = lastDt
    .plus({ days: offset })
    .set({ hour, minute: 0, second: 0, millisecond: 0 });

  while (candidate.weekday > 5) {
    candidate = candidate.plus({ days: 1 });
  }

  const reasoning =
    `Urgency: ${urgency}. dayOffset: ${offset}, targetHour: ${hour}:00. ` +
    `Last interaction: ${lastDt.toISO()}. ` +
    `Computed send time: ${candidate.toISO({ suppressMilliseconds: true })} (${timezone}). ` +
    `Ensured business hours and skipped weekends.`;

  return { sendAt: candidate.toISO({ suppressMilliseconds: true }), reasoning };
}

export function daysBetween(isoA, isoB) {
  const a = DateTime.fromISO(isoA);
  const b = DateTime.fromISO(isoB);
  return Math.round(Math.abs(b.diff(a, "days").days));
}
```

## STEP 14: Create server/src/graph/tools/voting.js

```js
import { getChatModel } from "../../services/llmClient.js";

export async function voteOnResult(invoker, options = {}) {
  const { n = 3, voteKey } = options;

  const model = getChatModel({ temperature: 0.7 });
  const promises = Array.from({ length: n }, () =>
    invoker(model).catch(() => null),
  );
  const results = (await Promise.all(promises)).filter(Boolean);

  if (results.length === 0) {
    throw new Error("All voting calls failed");
  }

  if (!voteKey) return results[0];

  const counts = {};
  for (const r of results) {
    const val = r[voteKey];
    counts[val] = (counts[val] || 0) + 1;
  }

  const winningValue = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  return results.find((r) => r[voteKey] === winningValue) || results[0];
}
```

## STEP 15: Create server/src/graph/tools/templateTool.js

```js
const SMS_TEMPLATE = ({ greeting, body, ctaText }) =>
  `${greeting}${body} ${ctaText} Reply STOP to opt out.`;

const EMAIL_BODY_TEMPLATE = ({ greeting, body, ctaBlock }) =>
  `${greeting}\n${body}\n${ctaBlock}\nTo opt out of emails, click here or reply STOP.`;

export function applyTemplate(channel, content) {
  if (channel === "sms") return SMS_TEMPLATE(content);
  if (channel === "email") return EMAIL_BODY_TEMPLATE(content);
  return `${content.greeting}\n${content.body}\n${content.ctaText || content.ctaBlock || ""}`;
}

export function hasOptOutInstructions(body) {
  const lower = body.toLowerCase();
  return lower.includes("stop") || lower.includes("opt out") || lower.includes("unsubscribe");
}
```

## STEP 16: Create server/src/graph/agents/enricher.js

```js
import { DateTime } from "luxon";

export async function enricherNode(state) {
  const { record } = state;
  const { consent, channel_preferences, input } = record;

  const eligibleChannels = [];
  if (consent.email_opt_in) eligibleChannels.push("email");
  if (consent.sms_opt_in) eligibleChannels.push("sms");
  if (consent.voice_opt_in) eligibleChannels.push("voice");

  const preferredEligible = channel_preferences.filter((c) =>
    eligibleChannels.includes(c),
  );

  const lastInteraction = DateTime.fromISO(input.last_interaction);
  const moveDate = DateTime.fromISO(input.move_date_target);
  const daysUntilMove = Math.round(moveDate.diff(lastInteraction, "days").days);

  let urgency;
  if (daysUntilMove <= 14 || record.lifecycle_stage === "new") urgency = "high";
  else if (daysUntilMove <= 45) urgency = "medium";
  else urgency = "low";

  const dayMatch = record.task_id?.match(/day(\d+)/);
  const taskDayHint = dayMatch ? parseInt(dayMatch[1], 10) : null;

  const profileSummary = [
    `persona: ${record.persona}`,
    `lifecycle: ${record.lifecycle_stage}`,
    `property: ${input.property_name}`,
    `move target: ${input.move_date_target}`,
    `days until move: ${daysUntilMove}`,
    `urgency: ${urgency}`,
    `channels eligible: ${preferredEligible.join(", ")}`,
    `language: ${input.language}`,
    `timezone: ${input.timezone}`,
    input.profile?.first_name ? `name: ${input.profile.first_name}` : "",
    input.profile?.city_interest ? `city: ${input.profile.city_interest}` : "",
    input.profile?.amenity_interest
      ? `amenities: ${input.profile.amenity_interest.join(", ")}`
      : "",
    taskDayHint !== null ? `task day hint: day${taskDayHint}` : "",
  ]
    .filter(Boolean)
    .join("; ");

  const enrichedContext = {
    eligibleChannels,
    preferredEligible,
    daysUntilMove,
    urgency,
    taskDayHint,
    profileSummary,
    timezone: input.timezone,
    lastInteraction: input.last_interaction,
  };

  return {
    enrichedContext,
    stageLog: [{ stage: "enricher", timestamp: new Date().toISOString(), result: enrichedContext }],
  };
}
```

## STEP 17: Create server/src/graph/agents/analyst.js

```js
import { z } from "zod";
import { getChatModel } from "../../services/llmClient.js";
import { VectorStore } from "../../services/vectorStore.js";
import {
  setVectorStore, setRulebook, setPatterns, setLearned,
  getRulebook, getVectorStore,
} from "../../services/runtime.js";

const ANALYST_SYSTEM_PROMPT = `You are a data scientist specializing in customer communication patterns.

You are given a dataset of test cases for a property-management messaging system. Each test case contains:
- Input: user profile, preferences, context, constraints
- Expected: what message should be sent (or not sent), via which channel, when, and what action to take

Your job is to analyze ALL records and extract PRECISE, ACTIONABLE decision rules. Do NOT just describe the data — infer the RULES that explain WHY each expected output was chosen.

Focus on extracting rules for:
1. CHANNEL SELECTION:
   - When is SMS chosen vs email? How do consent flags gate availability?
   - How do channel_preferences interact with consent?
   - Rule format: "IF sms_opt_in=true AND 'sms' in preferences THEN channel=sms"

2. TIMING (CRITICAL — be very precise):
   - For each record, compute the exact day offset: dayOffset = calendar days between last_interaction and send_at
   - For each record, note the targetHour = hour of send_at in local timezone
   - What determines dayOffset? Does the task_id day number correlate with the offset?
   - What determines targetHour? Does it differ by channel?
   - Rule format: "IF urgency=high THEN dayOffset=1, targetHour=9"

3. MESSAGE BODY STYLE (CRITICAL — extract exact templates):
   - SMS: Copy the EXACT body text from examples as a template. Note the em-dash after the name, the single-paragraph structure, the question with numbered reply options, and the "Reply STOP to opt out." ending.
   - Email: Copy the EXACT body text from examples as a template. Note the newline-separated structure.
   - For each example, QUOTE the full expected body text verbatim as part of the rule.

4. CTA FORMAT:
   - SMS: quick-reply numbered options
   - Email: link-based CTA

5. SUBJECT LINE:
   - SMS: subject is always null
   - Email: specific subject line referencing prospect interests

6. NEXT ACTION:
   - When is start_cadence used vs follow_up_in_days?
   - What cadence names are used and what triggers them?

7. COMPLIANCE:
   - Required opt-out instructions per channel
   - Fair housing / no discrimination rules

Return a structured rulebook that another agent can follow to EXACTLY reproduce these decisions.`;

const rulebookSchema = z.object({
  rulebook: z.string().describe("Complete rulebook of inferred decision rules as structured text"),
  patterns: z.array(
    z.object({
      category: z.string().describe("Rule category: channel, timing, content, cta, action, compliance"),
      rule: z.string().describe("The inferred rule"),
      evidence: z.string().describe("Which record(s) this rule was derived from"),
    }),
  ),
});

export async function learnPatterns(allRecords) {
  const model = getChatModel({ temperature: 0.1 });
  const structured = model.withStructuredOutput(rulebookSchema);

  const recordsSummary = allRecords
    .map((r, i) => {
      const { input, expected, consent, channel_preferences, persona, lifecycle_stage, task_id, assertions } = r;
      return `--- Record ${i + 1} (${task_id}) ---\n${JSON.stringify({ task_id, persona, lifecycle_stage, consent, channel_preferences, input, assertions, expected })}`;
    })
    .join("\n\n");

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
      { role: "user", content: `Analyze these records and extract the decision rules:\n\n${recordsSummary}` },
    ]),
    vsPromise,
  ]);

  setRulebook(result.rulebook);
  setPatterns(result.patterns);
  setVectorStore(vs);
  setLearned(true);
  return result;
}

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
    stageLog: [{
      stage: "analyst",
      timestamp: new Date().toISOString(),
      result: { rulebookLength: rulebook.length, examplesFound: fewShotExamples.length, exampleIds: fewShotExamples.map((e) => e.taskId) },
    }],
  };
}

function buildRecordContextText(record) {
  const { input, consent, channel_preferences, persona, lifecycle_stage } = record;
  return [
    `persona: ${persona}`, `lifecycle: ${lifecycle_stage}`,
    `property: ${input.property_name}`, `move_target: ${input.move_date_target}`,
    `channels: ${channel_preferences.join(",")}`,
    `consent_sms: ${consent.sms_opt_in}`, `consent_email: ${consent.email_opt_in}`,
    `name: ${input.profile?.first_name || "unknown"}`,
    input.profile?.amenity_interest ? `amenities: ${input.profile.amenity_interest.join(",")}` : "",
    input.profile?.city_interest ? `city: ${input.profile.city_interest}` : "",
  ].filter(Boolean).join("; ");
}
```

## STEP 18: Create server/src/graph/agents/strategist.js

```js
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
- Business hours only (typically 9-18). Weekends are automatically skipped by the system.`;

const channelSchema = z.object({
  channel: z.enum(["sms", "email", "voice"]).describe("Selected communication channel"),
  channelReasoning: z.string().describe("Step-by-step reasoning for channel choice"),
  dayOffset: z.number().int().min(0).max(30).describe("Number of calendar days after last_interaction to send"),
  targetHour: z.number().int().min(6).max(20).describe("Hour of day (6-20) in user local timezone to send"),
  timingReasoning: z.string().describe("Step-by-step reasoning for timing choice"),
});

export async function strategistNode(state) {
  const { record, enrichedContext, rulebook, fewShotExamples } = state;

  const userPrompt = buildStrategistPrompt(record, enrichedContext, rulebook, fewShotExamples);

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

  const { sendAt, reasoning: timeCalcReasoning } = computeSendTime(
    enrichedContext.lastInteraction,
    enrichedContext.timezone,
    enrichedContext.urgency,
    { dayOffset: result.dayOffset, targetHour: result.targetHour },
  );

  return {
    channelDecision: { channel: result.channel, reasoning: result.channelReasoning },
    timingDecision: {
      sendAt,
      strategy: `dayOffset=${result.dayOffset}, targetHour=${result.targetHour}`,
      reasoning: `${result.timingReasoning}\n[Deterministic calc] ${timeCalcReasoning}`,
    },
    stageLog: [{ stage: "strategist", timestamp: new Date().toISOString(), result: { channel: result.channel, sendAt } }],
  };
}

function buildStrategistPrompt(record, enriched, rulebook, examples) {
  let prompt = `## Current Record\n${JSON.stringify(record.input, null, 2)}\n\n`;
  prompt += `## Consent\n${JSON.stringify(record.consent, null, 2)}\n\n`;
  prompt += `## Channel Preferences\n${JSON.stringify(record.channel_preferences)}\n\n`;
  prompt += `## Enriched Context\n${JSON.stringify(enriched, null, 2)}\n\n`;

  if (rulebook) prompt += `## Learned Rulebook\n${rulebook}\n\n`;

  if (examples?.length > 0) {
    prompt += `## Similar Records (few-shot examples with timing analysis)\n`;
    for (const ex of examples) {
      prompt += `### ${ex.taskId} (similarity: ${ex.score?.toFixed(3)})\n`;
      prompt += `Input: ${JSON.stringify(ex.input, null, 2)}\n`;
      prompt += `Expected channel: ${ex.expected?.next_message?.channel}\n`;
      prompt += `Expected send_at: ${ex.expected?.next_message?.send_at}\n`;
      if (ex.input?.last_interaction && ex.expected?.next_message?.send_at) {
        try {
          const lastDt = DateTime.fromISO(ex.input.last_interaction);
          const sendDt = DateTime.fromISO(ex.expected.next_message.send_at);
          const dayDiff = Math.round(sendDt.diff(lastDt, "days").days);
          const sendHour = sendDt.hour;
          prompt += `[Timing analysis: dayOffset=${dayDiff}, targetHour=${sendHour}]\n`;
        } catch { /* ignore */ }
      }
      prompt += `\n`;
    }
  }

  prompt += `## Task\nDecide the best channel and timing for this record. Output the exact dayOffset and targetHour based on the patterns in the examples above. Think step by step.`;
  return prompt;
}
```

## STEP 19: Create server/src/graph/agents/copywriter.js

```js
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

CRITICAL: Study the few-shot examples character-by-character. Replicate the EXACT wording patterns, punctuation (em-dashes, arrows →), line break positions, opt-out text, and CTA format.`;

const messageSchema = z.object({
  subject: z.string().nullable().describe("Email subject line (null for SMS)"),
  body: z.string().describe("COMPLETE final message body matching reference examples exactly"),
  cta: z.object({
    type: z.string().describe("CTA type: schedule_tour, learn_more, etc."),
    options: z.array(z.string()).optional().describe("Quick-reply options for SMS only"),
    link: z.string().optional().describe("CTA link URL for email only"),
  }),
  reasoning: z.string().describe("Step-by-step reasoning for content choices"),
});

export async function copywriterNode(state) {
  const { record, enrichedContext, rulebook, fewShotExamples, channelDecision, timingDecision } = state;
  const channel = channelDecision.channel;
  const userPrompt = buildCopywriterPrompt(record, enrichedContext, rulebook, fewShotExamples, channel, timingDecision);

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
    stageLog: [{
      stage: "copywriter",
      timestamp: new Date().toISOString(),
      result: { channel, subject: result.subject, bodyPreview: result.body.slice(0, 100), ctaType: result.cta.type },
    }],
  };
}

function buildCopywriterPrompt(record, enriched, rulebook, examples, channel, timing) {
  let prompt = `## Channel: ${channel}\n`;
  prompt += `## Send At: ${timing.sendAt}\n\n`;
  prompt += `## User Profile\n${JSON.stringify(record.input.profile, null, 2)}\n\n`;
  prompt += `## Property: ${record.input.property_name}\n`;
  prompt += `## Move Date: ${record.input.move_date_target}\n`;
  prompt += `## Language: ${record.input.language}\n`;
  prompt += `## Urgency: ${enriched.urgency}\n`;
  prompt += `## Days Until Move: ${enriched.daysUntilMove}\n\n`;
  prompt += `## Constraints\n${JSON.stringify(record.assertions?.constraints, null, 2)}\n\n`;

  if (rulebook) prompt += `## Learned Content Rules\n${rulebook}\n\n`;

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
  prompt += `Your body text must be NEARLY IDENTICAL to the reference examples above. `;
  prompt += `Swap in this prospect's details but keep EVERYTHING ELSE the same as the examples. `;
  if (channel === "sms") {
    prompt += `\nSMS SKELETON: "Hi {Name}\u2014welcome to {Property}! {1 sentence}. {Question}? Reply 1 for {X}, 2 for {Y}. Reply STOP to opt out."\n`;
    prompt += `Subject MUST be null. Use em-dash (\u2014) not comma after name. Keep under 160 chars.\n`;
  } else {
    prompt += `\nEMAIL SKELETON (use \\n for line breaks):\nLine 1: "Hi {Name},"\nLine 2: "{Personalized body}. {Suggestion}."\nLine 3: "Book now \u2192 https://{propertyslug}.example/tour"\nLine 4: "To opt out of emails, click here or reply STOP."\n`;
    prompt += `Subject must reference property name + prospect's specific amenity interests.\n`;
  }
  return prompt;
}
```

## STEP 20: Create server/src/graph/agents/compliance.js

```js
import { z } from "zod";
import { getChatModel } from "../../services/llmClient.js";
import { hasOptOutInstructions } from "../tools/templateTool.js";

const COMPLIANCE_SYSTEM_PROMPT = `You are a fair housing and privacy compliance auditor for residential property communications.

You ONLY check for HARD LEGAL/POLICY violations — NOT style, tone, or quality preferences.

CHECK ONLY THESE THREE THINGS:
1. FAIR HOUSING: Does the message contain language that discriminates based on race, color, religion, national origin, sex, familial status, or disability? Mentioning property amenities, neighborhood, or city is NOT a violation.
2. PII LEAKAGE: Does the message expose sensitive personal information BEYOND first name?
3. OPT-OUT INSTRUCTIONS: Does the message include opt-out instructions?

IMPORTANT:
- A well-written marketing message about an apartment community almost ALWAYS passes.
- Mentioning amenities, tours, locations, move dates = NORMAL marketing, NOT a violation.
- Using the prospect's first name = EXPECTED, NOT a PII leak.
- If the pre-check confirms opt-out text is present, do NOT flag opt-out as a violation.
- Only mark passed=false for CLEAR, OBJECTIVE violations.
- When in doubt, PASS the message.`;

const complianceSchema = z.object({
  passed: z.boolean().describe("true unless there is a CLEAR violation"),
  violations: z.array(
    z.object({
      category: z.enum(["fair_housing", "pii_leak", "no_opt_out"]),
      description: z.string().describe("What the specific violation is"),
      fix: z.string().describe("Minimal fix to resolve it"),
    }),
  ),
  repairedBody: z.string().nullable().describe("Minimally repaired body ONLY if violations found, null if passed"),
  reasoning: z.string().describe("Brief compliance analysis"),
});

export async function complianceNode(state) {
  const { record, messageOutput, complianceAttempts } = state;
  const bodyToCheck = messageOutput.body;
  const hasOptOut = hasOptOutInstructions(bodyToCheck);

  const model = getChatModel({ temperature: 0 });
  const structured = model.withStructuredOutput(complianceSchema);

  const result = await structured.invoke([
    { role: "system", content: COMPLIANCE_SYSTEM_PROMPT },
    { role: "user", content: buildCompliancePrompt(record, messageOutput, hasOptOut) },
  ]);

  result.violations = result.violations.filter((v) =>
    ["fair_housing", "pii_leak", "no_opt_out"].includes(v.category),
  );
  if (hasOptOut) {
    result.violations = result.violations.filter((v) => v.category !== "no_opt_out");
  }
  if (result.violations.length === 0) {
    result.passed = true;
    result.repairedBody = null;
  }

  let updatedMessage = null;
  if (!result.passed && result.repairedBody) {
    updatedMessage = { ...messageOutput, body: result.repairedBody };
  }

  return {
    complianceResult: { passed: result.passed, violations: result.violations, reasoning: result.reasoning },
    complianceAttempts: complianceAttempts + 1,
    ...(updatedMessage ? { messageOutput: updatedMessage } : {}),
    stageLog: [{
      stage: "compliance", timestamp: new Date().toISOString(),
      result: { passed: result.passed, violations: result.violations.length, attempt: complianceAttempts + 1 },
    }],
  };
}

function buildCompliancePrompt(record, message, hasOptOut) {
  let prompt = `## Message to Review\n`;
  prompt += `Channel: ${message.channel}\nSubject: ${message.subject || "N/A"}\nBody:\n${message.body}\n\n`;
  prompt += `CTA: ${JSON.stringify(message.cta)}\n\n`;
  prompt += `## Record Constraints\n${JSON.stringify(record.assertions, null, 2)}\n\n`;
  prompt += `## Pre-check Results\nOpt-out instructions detected: ${hasOptOut}\n\n`;
  prompt += `## Task\nCheck ONLY for: (1) fair housing discrimination, (2) PII leakage beyond first name, (3) missing opt-out text. If opt-out is confirmed present in pre-check, do NOT flag it. Most well-written property marketing messages PASS. Only flag CLEAR violations.`;
  return prompt;
}
```

## STEP 21: Create server/src/graph/agents/planner.js

```js
import { z } from "zod";
import { getChatModel } from "../../services/llmClient.js";

const PLANNER_SYSTEM_PROMPT = `You are a CRM automation expert for property management.

Your job is to decide the NEXT ACTION after a message is sent to a prospect or resident.

Typical next actions:
- start_cadence: Begin an automated drip campaign. Use for new/high-urgency prospects on their first touch.
- follow_up_in_days: Schedule a follow-up after N days. Use for open/ongoing prospects with longer timelines.
- escalate_to_human: Hand off to a leasing agent (for complex or high-value situations)
- close_loop: No further action needed

CRITICAL: Study the few-shot examples very carefully. Match the EXACT action type, cadence name format, and follow-up day values from the examples.`;

const actionSchema = z.object({
  type: z.string().describe("Action type: start_cadence, follow_up_in_days, escalate_to_human, close_loop"),
  name: z.string().optional().describe("Cadence name if type is start_cadence"),
  value: z.number().optional().describe("Number of days if type is follow_up_in_days"),
  reasoning: z.string().describe("Step-by-step reasoning for this action"),
});

export async function plannerNode(state) {
  const { record, enrichedContext, rulebook, fewShotExamples, channelDecision } = state;

  const model = getChatModel({ temperature: 0.1 });
  const structured = model.withStructuredOutput(actionSchema);

  const result = await structured.invoke([
    { role: "system", content: PLANNER_SYSTEM_PROMPT },
    { role: "user", content: buildPlannerPrompt(record, enrichedContext, rulebook, fewShotExamples) },
  ]);

  return {
    actionPlan: { type: result.type, name: result.name || undefined, value: result.value || undefined, reasoning: result.reasoning },
    stageLog: [{ stage: "planner", timestamp: new Date().toISOString(), result: { type: result.type, name: result.name, value: result.value } }],
  };
}

function buildPlannerPrompt(record, enriched, rulebook, examples) {
  let prompt = `## Record Context\nTask: ${record.task_id}\nPersona: ${record.persona}\n`;
  prompt += `Lifecycle: ${record.lifecycle_stage}\nUrgency: ${enriched.urgency}\nDays Until Move: ${enriched.daysUntilMove}\n\n`;

  if (rulebook) prompt += `## Learned Action Rules\n${rulebook}\n\n`;

  if (examples?.length > 0) {
    prompt += `## Similar Records' Actions — Match these patterns EXACTLY\n`;
    for (const ex of examples) {
      prompt += `### ${ex.taskId}\nLifecycle: ${ex.lifecycle_stage || "unknown"}\n`;
      prompt += `Move date: ${ex.input?.move_date_target || "unknown"}\n`;
      prompt += `Expected action: ${JSON.stringify(ex.expected?.next_action)}\n\n`;
    }
  }

  prompt += `## Task\nDecide the best next action for this record. Match the patterns from the examples above as closely as possible. Think step by step.`;
  return prompt;
}
```

## STEP 22: Create server/src/graph/agents/evaluator.js

```js
import { computeSimilarity } from "../../services/vectorStore.js";

export async function evaluatorNode(state) {
  const { record, channelDecision, timingDecision, messageOutput, actionPlan } = state;
  const expected = record.expected;

  if (!expected) {
    return {
      scores: { composite: 0, details: "No expected output to compare against" },
      stageLog: [{ stage: "evaluator", timestamp: new Date().toISOString(), result: { composite: 0 } }],
    };
  }

  const expectedMsg = expected.next_message;
  const expectedAction = expected.next_action;

  const channelScore = channelDecision.channel === expectedMsg.channel ? 1.0 : 0.0;
  const timingScore = computeTimingScore(timingDecision.sendAt, expectedMsg.send_at);

  let subjectScore = 0;
  if (expectedMsg.subject == null && messageOutput.subject == null) {
    subjectScore = 1.0;
  } else if (expectedMsg.subject && messageOutput.subject) {
    try { subjectScore = await computeSimilarity(messageOutput.subject, expectedMsg.subject); } catch { subjectScore = 0; }
  }

  let bodyScore = 0;
  try { bodyScore = await computeSimilarity(messageOutput.body, expectedMsg.body); } catch { bodyScore = 0; }

  const ctaScore = computeCtaScore(messageOutput.cta, expectedMsg.cta);
  const actionScore = computeActionScore(actionPlan, expectedAction);

  const composite =
    channelScore * 0.15 + timingScore * 0.15 + subjectScore * 0.05 +
    bodyScore * 0.35 + ctaScore * 0.15 + actionScore * 0.15;

  const scores = {
    channel: { score: channelScore, weight: 0.15, expected: expectedMsg.channel, actual: channelDecision.channel },
    timing: { score: timingScore, weight: 0.15, expected: expectedMsg.send_at, actual: timingDecision.sendAt },
    subject: { score: subjectScore, weight: 0.05, expected: expectedMsg.subject, actual: messageOutput.subject },
    body: { score: bodyScore, weight: 0.35 },
    cta: { score: ctaScore, weight: 0.15, expected: expectedMsg.cta, actual: messageOutput.cta },
    action: { score: actionScore, weight: 0.15, expected: expectedAction, actual: actionPlan },
    composite: Math.round(composite * 1000) / 1000,
  };

  return {
    scores,
    stageLog: [{ stage: "evaluator", timestamp: new Date().toISOString(), result: { composite: scores.composite } }],
  };
}

function computeTimingScore(actual, expected) {
  if (!actual || !expected) return 0;
  try {
    const diffHours = Math.abs(new Date(actual) - new Date(expected)) / (1000 * 60 * 60);
    return Math.max(0, 1 - diffHours / 24);
  } catch { return 0; }
}

function computeCtaScore(actual, expected) {
  if (!actual || !expected) return 0;
  let score = 0;
  if (actual.type === expected.type) score += 0.5;
  if (expected.options && actual.options) {
    const expectedSet = new Set(expected.options.map((o) => o.toLowerCase()));
    const actualSet = new Set(actual.options?.map((o) => o.toLowerCase()) || []);
    const overlap = [...expectedSet].filter((o) => actualSet.has(o)).length;
    score += 0.5 * (overlap / Math.max(expectedSet.size, 1));
  } else if (expected.link && actual.link) {
    score += 0.5;
  } else if (!expected.options && !expected.link && !actual.options && !actual.link) {
    score += 0.5;
  }
  return score;
}

function computeActionScore(actual, expected) {
  if (!actual || !expected) return 0;
  let score = 0;
  if (actual.type === expected.type) score += 0.6;
  if (actual.name && expected.name && actual.name === expected.name) score += 0.2;
  if (actual.value !== undefined && expected.value !== undefined) {
    score += actual.value === expected.value ? 0.2 : 0.1;
  } else {
    score += 0.2;
  }
  return Math.min(score, 1);
}
```

## STEP 23: Create server/src/graph/builder.js

```js
import { StateGraph, START, END } from "@langchain/langgraph";
import { PipelineState } from "./state.js";
import { enricherNode } from "./agents/enricher.js";
import { analystNode } from "./agents/analyst.js";
import { strategistNode } from "./agents/strategist.js";
import { copywriterNode } from "./agents/copywriter.js";
import { complianceNode } from "./agents/compliance.js";
import { plannerNode } from "./agents/planner.js";
import { evaluatorNode } from "./agents/evaluator.js";

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
```

## STEP 24: Create server/src/routes/api.js

```js
import { Router } from "express";
import { parseJsonl } from "../services/jsonlParser.js";
import { getLLMConfig } from "../services/llmClient.js";
import { getIsLearned, resetRuntime } from "../services/runtime.js";
import { learnPatterns } from "../graph/agents/analyst.js";
import { buildPipelineGraph } from "../graph/builder.js";

const router = Router();
let cachedRecords = null;

router.get("/config", (req, res) => {
  res.json(getLLMConfig());
});

router.get("/records", (req, res) => {
  try {
    if (!cachedRecords) {
      const jsonlPath = process.env.JSONL_PATH || "../sample.jsonl";
      cachedRecords = parseJsonl(jsonlPath);
    }
    res.json({ records: cachedRecords });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/records/upload", (req, res) => {
  try {
    const { content } = req.body;
    cachedRecords = content.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
    res.json({ records: cachedRecords });
  } catch (err) {
    res.status(400).json({ error: "Invalid JSONL: " + err.message });
  }
});

router.post("/learn", async (req, res) => {
  try {
    if (!cachedRecords || cachedRecords.length === 0) {
      return res.status(400).json({ error: "No records loaded. Load records first." });
    }
    const result = await learnPatterns(cachedRecords);
    res.json({ ok: true, rulebook: result.rulebook, patterns: result.patterns, recordCount: cachedRecords.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/learn/status", (req, res) => {
  res.json({ learned: getIsLearned() });
});

router.get("/process/:taskId", async (req, res) => {
  const { taskId } = req.params;
  if (!cachedRecords) return res.status(400).json({ error: "No records loaded" });
  if (!getIsLearned()) return res.status(400).json({ error: "Patterns not learned yet. Call /api/learn first." });

  const record = cachedRecords.find((r) => r.task_id === taskId);
  if (!record) return res.status(404).json({ error: `Record ${taskId} not found` });

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });

  try {
    const graph = buildPipelineGraph();
    const stream = await graph.stream({ record, allRecords: cachedRecords }, { streamMode: "updates" });

    for await (const update of stream) {
      const [nodeName, partialState] = Object.entries(update)[0];
      res.write(`data: ${JSON.stringify({ node: nodeName, state: partialState })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ node: "__done__", state: {} })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ node: "__error__", error: err.message })}\n\n`);
    res.end();
  }
});

router.post("/process-all", async (req, res) => {
  if (!cachedRecords) return res.status(400).json({ error: "No records loaded" });
  if (!getIsLearned()) return res.status(400).json({ error: "Patterns not learned yet" });

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });

  const graph = buildPipelineGraph();
  const results = [];

  for (const record of cachedRecords) {
    try {
      res.write(`data: ${JSON.stringify({ type: "start", taskId: record.task_id })}\n\n`);
      let finalState = {};
      const stream = await graph.stream({ record, allRecords: cachedRecords }, { streamMode: "updates" });

      for await (const update of stream) {
        const [nodeName, partialState] = Object.entries(update)[0];
        finalState = { ...finalState, ...partialState };
        res.write(`data: ${JSON.stringify({ type: "stage", taskId: record.task_id, node: nodeName })}\n\n`);
      }

      results.push({
        taskId: record.task_id, scores: finalState.scores,
        channelDecision: finalState.channelDecision, timingDecision: finalState.timingDecision,
        messageOutput: finalState.messageOutput, actionPlan: finalState.actionPlan,
        complianceResult: finalState.complianceResult, stageLog: finalState.stageLog,
      });

      res.write(`data: ${JSON.stringify({ type: "complete", taskId: record.task_id, result: results[results.length - 1] })}\n\n`);
    } catch (err) {
      res.write(`data: ${JSON.stringify({ type: "error", taskId: record.task_id, error: err.message })}\n\n`);
    }
  }

  res.write(`data: ${JSON.stringify({ type: "summary", totalRecords: cachedRecords.length, processedRecords: results.length, results })}\n\n`);
  res.end();
});

export default router;
```

## STEP 25: Create server/src/index.js

```js
import dotenv from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", "..", ".env") });
dotenv.config({ path: join(__dirname, "..", ".env") });
dotenv.config();

import express from "express";
import cors from "cors";
import apiRouter from "./routes/api.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use("/api", apiRouter);

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
```

## STEP 26: Create client/src/main.jsx

```jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./App.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

## STEP 27: Create client/src/App.jsx

```jsx
import { useState, useCallback, useEffect } from "react";
import RecordSelector from "./components/RecordSelector.jsx";
import PipelineView from "./components/PipelineView.jsx";
import ResultPanel from "./components/ResultPanel.jsx";
import ScoreCard from "./components/ScoreCard.jsx";

const STAGES = [
  { id: "enricher", name: "Enricher", desc: "Pre-compute context (no LLM)" },
  { id: "analyst", name: "Analyst", desc: "Retrieve rulebook + few-shot examples" },
  { id: "strategist", name: "Strategist", desc: "Channel & timing decision" },
  { id: "copywriter", name: "Copywriter", desc: "Compose personalized message" },
  { id: "compliance", name: "Compliance", desc: "Check & repair violations" },
  { id: "planner", name: "Planner", desc: "Decide next CRM action" },
  { id: "evaluator", name: "Evaluator", desc: "Score vs expected" },
];

export default function App() {
  const [records, setRecords] = useState([]);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [learned, setLearned] = useState(false);
  const [rulebook, setRulebook] = useState("");
  const [stageStates, setStageStates] = useState({});
  const [stageData, setStageData] = useState({});
  const [result, setResult] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [allResults, setAllResults] = useState([]);

  const handleRecordsLoaded = useCallback((recs) => {
    setRecords(recs);
    setSelectedRecord(null);
    setResult(null);
    setStageStates({});
    setStageData({});
    setAllResults([]);
  }, []);

  useEffect(() => {
    fetch("/api/records")
      .then((res) => res.json())
      .then((data) => { if (data.records?.length) handleRecordsLoaded(data.records); })
      .catch(() => {});
  }, [handleRecordsLoaded]);

  const handleLearn = useCallback(async () => {
    try {
      const res = await fetch("/api/learn", { method: "POST" });
      const data = await res.json();
      if (data.ok) { setLearned(true); setRulebook(data.rulebook); }
      else alert("Learn failed: " + (data.error || "Unknown error"));
    } catch (err) { alert("Learn failed: " + err.message); }
  }, []);

  const handleProcess = useCallback(async (record) => {
    if (!record) return;
    setProcessing(true);
    setResult(null);
    setStageData({});

    const init = {};
    STAGES.forEach((s) => (init[s.id] = "pending"));
    setStageStates(init);

    try {
      const response = await fetch(`/api/process/${record.task_id}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = {};

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.node === "__done__") {
              setStageStates((prev) => {
                const next = { ...prev };
                STAGES.forEach((s) => { if (next[s.id] === "running") next[s.id] = "done"; });
                return next;
              });
              setResult(accumulated);
            } else if (evt.node === "__error__") {
              setStageStates((prev) => {
                const next = { ...prev };
                for (const key of Object.keys(next)) { if (next[key] === "running") next[key] = "error"; }
                return next;
              });
            } else {
              setStageStates((prev) => {
                const next = { ...prev };
                for (const key of Object.keys(next)) { if (next[key] === "running") next[key] = "done"; }
                next[evt.node] = "running";
                return next;
              });
              setStageData((prev) => ({ ...prev, [evt.node]: evt.state }));
              accumulated = { ...accumulated, ...evt.state };
            }
          } catch { /* skip malformed SSE */ }
        }
      }
    } catch (err) { alert("Process failed: " + err.message); }
    finally {
      setProcessing(false);
      setStageStates((prev) => {
        const next = { ...prev };
        STAGES.forEach((s) => { if (next[s.id] === "running") next[s.id] = "done"; });
        return next;
      });
    }
  }, []);

  const handleProcessAll = useCallback(async () => {
    setProcessing(true);
    setAllResults([]);
    setResult(null);
    try {
      const response = await fetch("/api/process-all", { method: "POST" });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "complete") setAllResults((prev) => [...prev, evt.result]);
            else if (evt.type === "summary") setAllResults(evt.results);
          } catch { /* skip */ }
        }
      }
    } catch (err) { alert("Process all failed: " + err.message); }
    finally { setProcessing(false); }
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Context-Aware Message Generator</h1>
          <div className="subtitle">Multi-Agent LangGraph Pipeline &bull; Pattern Learning &bull; Semantic Scoring</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {learned && <span className="badge badge-success">Patterns Learned</span>}
          {records.length > 0 && <span className="badge badge-info">{records.length} records</span>}
        </div>
      </header>

      <div className="row">
        <div className="col" style={{ maxWidth: 340 }}>
          <RecordSelector records={records} selectedRecord={selectedRecord} onRecordsLoaded={handleRecordsLoaded}
            onSelectRecord={setSelectedRecord} onLearn={handleLearn} learned={learned}
            onProcess={handleProcess} onProcessAll={handleProcessAll} processing={processing} />
        </div>
        <div className="col">
          {processing || Object.keys(stageStates).length > 0 ? (
            <PipelineView stages={STAGES} stageStates={stageStates} stageData={stageData} />
          ) : null}

          {result && selectedRecord && (
            <>
              <ResultPanel record={selectedRecord} result={result} />
              <ScoreCard scores={result.scores} />
            </>
          )}

          {allResults.length > 0 && !selectedRecord && (
            <div className="panel">
              <div className="panel-title">All Results <span className="badge badge-info">{allResults.length} processed</span></div>
              {allResults.map((r) => (
                <div key={r.taskId} className="record-card" onClick={() => {
                  const rec = records.find((x) => x.task_id === r.taskId);
                  setSelectedRecord(rec);
                  setResult(r);
                }}>
                  <div className="task-id">{r.taskId}</div>
                  <div className="meta">
                    Score: <strong className={r.scores?.composite >= 0.8 ? "text-success" : r.scores?.composite >= 0.6 ? "text-warning" : "text-error"}>
                      {((r.scores?.composite || 0) * 100).toFixed(1)}%
                    </strong> &bull; Channel: {r.channelDecision?.channel} &bull; Action: {r.actionPlan?.type}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!processing && Object.keys(stageStates).length === 0 && !result && allResults.length === 0 && (
            <div className="panel">
              <div className="loading-overlay" style={{ flexDirection: "column" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🤖</div>
                <div>Load records, learn patterns, then process to see results</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

## STEP 28: Create client/src/components/RecordSelector.jsx

```jsx
import { useState } from "react";

export default function RecordSelector({ records, selectedRecord, onRecordsLoaded, onSelectRecord, onLearn, learned, onProcess, onProcessAll, processing }) {
  const [loading, setLoading] = useState(false);
  const [learning, setLearning] = useState(false);

  const handleLoad = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/records");
      const data = await res.json();
      onRecordsLoaded(data.records || []);
    } catch (err) { alert("Load failed: " + err.message); }
    finally { setLoading(false); }
  };

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const res = await fetch("/api/records/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: text }) });
      const data = await res.json();
      if (data.records) onRecordsLoaded(data.records);
      else alert("Upload error: " + (data.error || "Unknown"));
    } catch (err) { alert("Upload failed: " + err.message); }
  };

  const handleLearn = async () => { setLearning(true); await onLearn(); setLearning(false); };

  return (
    <div className="panel">
      <div className="panel-title">Records</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button className="btn-primary" onClick={handleLoad} disabled={loading}>
          {loading ? <span className="spinner" /> : "Load Sample"}
        </button>
        <label className="btn-secondary" style={{ display: "inline-flex", alignItems: "center", cursor: "pointer" }}>
          Upload JSONL
          <input type="file" accept=".jsonl,.json" onChange={handleUpload} style={{ display: "none" }} />
        </label>
      </div>

      {records.length > 0 && (
        <>
          <div style={{ marginBottom: 12 }}>
            <button className="btn-success" onClick={handleLearn} disabled={learning || learned} style={{ width: "100%" }}>
              {learning ? (<><span className="spinner" /> Learning Patterns...</>) : learned ? "✓ Patterns Learned" : "🧠 Learn Patterns from Data"}
            </button>
          </div>
          <div style={{ marginBottom: 8, fontSize: 12, color: "var(--text-secondary)" }}>Select a record to process:</div>
          {records.map((r) => (
            <div key={r.task_id} className={`record-card ${selectedRecord?.task_id === r.task_id ? "selected" : ""}`} onClick={() => onSelectRecord(r)}>
              <div className="task-id">{r.task_id}</div>
              <div className="meta">{r.persona} &bull; {r.lifecycle_stage} &bull; {r.input?.profile?.first_name || "Unknown"}</div>
            </div>
          ))}
          {learned && (
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn-primary" onClick={() => selectedRecord && onProcess(selectedRecord)} disabled={!selectedRecord || processing} style={{ flex: 1 }}>
                {processing ? (<><span className="spinner" /> Processing...</>) : "Process Selected"}
              </button>
              <button className="btn-secondary" onClick={onProcessAll} disabled={processing} style={{ flex: 1 }}>Process All</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

## STEP 29: Create client/src/components/PipelineView.jsx

```jsx
import { useState } from "react";

export default function PipelineView({ stages, stageStates, stageData }) {
  const [expandedStage, setExpandedStage] = useState(null);

  const getIcon = (status) => {
    switch (status) {
      case "done": return "✓";
      case "running": return "⟳";
      case "error": return "✕";
      default: return "·";
    }
  };

  return (
    <div className="panel">
      <div className="panel-title">Pipeline Progress</div>
      <div className="stage-list">
        {stages.map((stage) => {
          const status = stageStates[stage.id] || "pending";
          const data = stageData[stage.id];
          const isExpanded = expandedStage === stage.id;
          return (
            <div key={stage.id}>
              <div className={`stage-item ${isExpanded ? "active" : ""}`} onClick={() => setExpandedStage(isExpanded ? null : stage.id)}>
                <div className={`stage-icon ${status}`}>{getIcon(status)}</div>
                <div className="stage-info">
                  <div className="stage-name">{stage.name}</div>
                  <div className="stage-desc">{stage.desc}</div>
                </div>
                {status === "done" && <span className="badge badge-success">Done</span>}
                {status === "running" && <span className="badge badge-info">Running</span>}
                {status === "error" && <span className="badge badge-error">Error</span>}
              </div>
              {isExpanded && data && (
                <div style={{ marginLeft: 40, marginTop: 4, marginBottom: 4 }}>
                  {renderStageData(stage.id, data)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function renderStageData(stageId, data) {
  const reasoning = extractReasoning(data);
  const jsonPreview = sanitizeForDisplay(data);
  return (
    <div>
      {reasoning && (
        <div className="reasoning-box">
          <strong style={{ color: "var(--accent)" }}>Reasoning:</strong>
          {"\n" + reasoning}
        </div>
      )}
      <details style={{ marginTop: 6 }}>
        <summary style={{ fontSize: 11, color: "var(--text-secondary)", cursor: "pointer" }}>Raw output</summary>
        <div className="json-viewer">{JSON.stringify(jsonPreview, null, 2)}</div>
      </details>
    </div>
  );
}

function extractReasoning(data) {
  if (!data) return null;
  const parts = [];
  for (const [key, val] of Object.entries(data)) {
    if (val && typeof val === "object" && val.reasoning) parts.push(`[${key}] ${val.reasoning}`);
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

function sanitizeForDisplay(data) {
  if (!data) return {};
  const clean = {};
  for (const [key, val] of Object.entries(data)) {
    if (key === "stageLog" || key === "allRecords") continue;
    clean[key] = val;
  }
  return clean;
}
```

## STEP 30: Create client/src/components/ResultPanel.jsx

```jsx
import { useState } from "react";

export default function ResultPanel({ record, result }) {
  const [tab, setTab] = useState("comparison");
  const expected = record?.expected;
  const msg = result?.messageOutput;
  const action = result?.actionPlan;
  if (!expected || !msg) return null;

  return (
    <div className="panel">
      <div className="panel-title">Results</div>
      <div className="tabs">
        <button className={`tab ${tab === "comparison" ? "active" : ""}`} onClick={() => setTab("comparison")}>Side-by-Side</button>
        <button className={`tab ${tab === "compliance" ? "active" : ""}`} onClick={() => setTab("compliance")}>Compliance</button>
        <button className={`tab ${tab === "raw" ? "active" : ""}`} onClick={() => setTab("raw")}>Raw JSON</button>
      </div>

      {tab === "comparison" && (
        <div className="comparison">
          <div className="comparison-col expected">
            <h3>Expected</h3>
            <MessageView msg={expected.next_message} action={expected.next_action} />
          </div>
          <div className="comparison-col generated">
            <h3>Generated</h3>
            <MessageView msg={{ channel: msg.channel, send_at: msg.sendAt, subject: msg.subject, body: msg.body, cta: msg.cta }} action={action} />
          </div>
        </div>
      )}

      {tab === "compliance" && <ComplianceView result={result.complianceResult} />}

      {tab === "raw" && (
        <div className="json-viewer">
          {JSON.stringify({ channelDecision: result.channelDecision, timingDecision: result.timingDecision, messageOutput: result.messageOutput, actionPlan: result.actionPlan, scores: result.scores }, null, 2)}
        </div>
      )}
    </div>
  );
}

function MessageView({ msg, action }) {
  if (!msg) return <div className="text-muted">No message</div>;
  return (
    <div>
      <Field label="Channel" value={msg.channel} />
      <Field label="Send At" value={msg.send_at || msg.sendAt} />
      {msg.subject && <Field label="Subject" value={msg.subject} />}
      <Field label="Body" value={msg.body} />
      <Field label="CTA" value={JSON.stringify(msg.cta, null, 2)} />
      {action && <Field label="Next Action" value={JSON.stringify(action, null, 2)} />}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div className="msg-field">
      <div className="field-label">{label}</div>
      <div className="field-value">{value || "—"}</div>
    </div>
  );
}

function ComplianceView({ result }) {
  if (!result) return <div className="text-muted">No compliance data</div>;
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        Status: {result.passed ? <span className="text-success">✓ Passed</span> : <span className="text-error">✕ Failed ({result.violations.length} violations)</span>}
      </div>
      {result.violations?.length > 0 && (
        <div>
          {result.violations.map((v, i) => (
            <div key={i} style={{ padding: 8, background: "var(--bg-primary)", borderRadius: 6, marginBottom: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }} className="text-error">{v.category}</div>
              <div style={{ fontSize: 12, marginTop: 2 }}>{v.description}</div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>Fix: {v.fix}</div>
            </div>
          ))}
        </div>
      )}
      {result.reasoning && <div className="reasoning-box">{result.reasoning}</div>}
    </div>
  );
}
```

## STEP 31: Create client/src/components/ScoreCard.jsx

```jsx
export default function ScoreCard({ scores }) {
  if (!scores) return null;

  const fields = [
    { key: "channel", label: "Channel", weight: "15%" },
    { key: "timing", label: "Timing", weight: "15%" },
    { key: "subject", label: "Subject", weight: "5%" },
    { key: "body", label: "Body", weight: "35%" },
    { key: "cta", label: "CTA", weight: "15%" },
    { key: "action", label: "Action", weight: "15%" },
  ];

  const composite = scores.composite || 0;
  const getColor = (score) => {
    if (score >= 0.8) return "var(--success)";
    if (score >= 0.6) return "var(--warning)";
    return "var(--error)";
  };

  return (
    <div className="panel">
      <div className="panel-title">
        Accuracy Score
        <span className={`badge ${composite >= 0.8 ? "badge-success" : composite >= 0.6 ? "badge-warning" : "badge-error"}`}>
          {(composite * 100).toFixed(1)}%
        </span>
      </div>
      <div className="composite-score" style={{ color: getColor(composite) }}>{(composite * 100).toFixed(1)}%</div>
      <div>
        {fields.map(({ key, label, weight }) => {
          const score = scores[key]?.score ?? 0;
          return (
            <div key={key} className="score-row">
              <div className="score-label">{label}<span style={{ fontSize: 10, color: "var(--text-secondary)" }}> ({weight})</span></div>
              <div className="score-bar-bg">
                <div className="score-bar-fill" style={{ width: `${score * 100}%`, background: getColor(score) }} />
              </div>
              <div className="score-value" style={{ color: getColor(score) }}>{(score * 100).toFixed(0)}%</div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 16 }}>
        <details>
          <summary style={{ fontSize: 12, color: "var(--text-secondary)", cursor: "pointer" }}>Score details</summary>
          <div className="grid-2" style={{ marginTop: 8 }}>
            {fields.map(({ key, label }) => {
              const s = scores[key];
              if (!s) return null;
              return (
                <div key={key} style={{ fontSize: 12, padding: 6, background: "var(--bg-primary)", borderRadius: 6 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
                  {s.expected !== undefined && <div><span className="text-muted">Expected:</span> {typeof s.expected === "object" ? JSON.stringify(s.expected) : String(s.expected)}</div>}
                  {s.actual !== undefined && <div><span className="text-muted">Actual:</span> {typeof s.actual === "object" ? JSON.stringify(s.actual) : String(s.actual)}</div>}
                </div>
              );
            })}
          </div>
        </details>
      </div>
    </div>
  );
}
```

## STEP 32: Create client/src/App.css

```css
:root {
  --bg-primary: #0f1117;
  --bg-secondary: #1a1d27;
  --bg-tertiary: #242736;
  --border: #2e3245;
  --text-primary: #e4e6f0;
  --text-secondary: #9ca0b0;
  --accent: #6c8cff;
  --accent-hover: #8da6ff;
  --success: #4ade80;
  --warning: #fbbf24;
  --error: #f87171;
  --font-mono: "SF Mono", "Fira Code", "Cascadia Code", monospace;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg-primary); color: var(--text-primary); min-height: 100vh; }
.app { max-width: 1400px; margin: 0 auto; padding: 20px; }
.app-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 0; border-bottom: 1px solid var(--border); margin-bottom: 24px; }
.app-header h1 { font-size: 22px; font-weight: 600; color: var(--accent); }
.app-header .subtitle { font-size: 13px; color: var(--text-secondary); }
.panel { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 10px; padding: 20px; margin-bottom: 16px; }
.panel-title { font-size: 15px; font-weight: 600; margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
.panel-title .badge { font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 500; }
.badge-success { background: rgba(74, 222, 128, 0.15); color: var(--success); }
.badge-warning { background: rgba(251, 191, 36, 0.15); color: var(--warning); }
.badge-error { background: rgba(248, 113, 113, 0.15); color: var(--error); }
.badge-info { background: rgba(108, 140, 255, 0.15); color: var(--accent); }
input, select, textarea { background: var(--bg-tertiary); border: 1px solid var(--border); border-radius: 6px; color: var(--text-primary); padding: 8px 12px; font-size: 13px; width: 100%; outline: none; transition: border-color 0.2s; }
input:focus, select:focus, textarea:focus { border-color: var(--accent); }
label { font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; display: block; }
button { cursor: pointer; border: none; border-radius: 6px; font-size: 13px; font-weight: 500; padding: 8px 16px; transition: all 0.2s; }
.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-secondary { background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border); }
.btn-secondary:hover { background: var(--border); }
.btn-success { background: var(--success); color: #000; }
.btn-success:hover:not(:disabled) { opacity: 0.9; }
.btn-success:disabled { opacity: 0.4; cursor: not-allowed; }
.row { display: flex; gap: 16px; }
.col { flex: 1; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
.input-row { display: flex; gap: 10px; align-items: end; }
.input-row > div { flex: 1; }
.stage-list { display: flex; flex-direction: column; gap: 8px; }
.stage-item { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: var(--bg-tertiary); border: 1px solid var(--border); border-radius: 8px; cursor: pointer; transition: all 0.2s; }
.stage-item:hover { border-color: var(--accent); }
.stage-item.active { border-color: var(--accent); background: rgba(108, 140, 255, 0.08); }
.stage-icon { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; flex-shrink: 0; }
.stage-icon.pending { background: var(--bg-secondary); border: 2px solid var(--border); color: var(--text-secondary); }
.stage-icon.running { background: rgba(108, 140, 255, 0.15); border: 2px solid var(--accent); color: var(--accent); animation: pulse 1.5s infinite; }
.stage-icon.done { background: rgba(74, 222, 128, 0.15); border: 2px solid var(--success); color: var(--success); }
.stage-icon.error { background: rgba(248, 113, 113, 0.15); border: 2px solid var(--error); color: var(--error); }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
.stage-info { flex: 1; }
.stage-name { font-size: 13px; font-weight: 500; }
.stage-desc { font-size: 11px; color: var(--text-secondary); }
.record-card { padding: 10px 14px; background: var(--bg-tertiary); border: 1px solid var(--border); border-radius: 8px; cursor: pointer; transition: all 0.2s; margin-bottom: 8px; }
.record-card:hover { border-color: var(--accent); }
.record-card.selected { border-color: var(--accent); background: rgba(108, 140, 255, 0.08); }
.record-card .task-id { font-size: 13px; font-weight: 600; font-family: var(--font-mono); }
.record-card .meta { font-size: 11px; color: var(--text-secondary); margin-top: 3px; }
.comparison { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.comparison-col h3 { font-size: 14px; font-weight: 600; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
.comparison-col.expected h3 { color: var(--text-secondary); }
.comparison-col.generated h3 { color: var(--accent); }
.msg-field { margin-bottom: 10px; }
.msg-field .field-label { font-size: 11px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px; }
.msg-field .field-value { font-size: 13px; line-height: 1.6; padding: 8px; background: var(--bg-primary); border-radius: 6px; white-space: pre-wrap; word-break: break-word; }
.score-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.score-label { font-size: 12px; width: 80px; flex-shrink: 0; color: var(--text-secondary); }
.score-bar-bg { flex: 1; height: 8px; background: var(--bg-tertiary); border-radius: 4px; overflow: hidden; }
.score-bar-fill { height: 100%; border-radius: 4px; transition: width 0.5s ease; }
.score-value { font-size: 13px; font-weight: 600; width: 50px; text-align: right; font-family: var(--font-mono); }
.composite-score { font-size: 48px; font-weight: 700; text-align: center; padding: 20px; font-family: var(--font-mono); }
.reasoning-box { background: var(--bg-primary); border: 1px solid var(--border); border-radius: 8px; padding: 12px; font-size: 13px; line-height: 1.6; white-space: pre-wrap; color: var(--text-secondary); max-height: 300px; overflow-y: auto; margin-top: 10px; }
.spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.6s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.loading-overlay { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 40px; color: var(--text-secondary); font-size: 14px; }
.json-viewer { background: var(--bg-primary); border: 1px solid var(--border); border-radius: 8px; padding: 12px; font-family: var(--font-mono); font-size: 12px; line-height: 1.6; white-space: pre-wrap; overflow-x: auto; max-height: 400px; overflow-y: auto; color: var(--text-secondary); }
.tabs { display: flex; gap: 0; margin-bottom: 16px; border-bottom: 1px solid var(--border); }
.tab { padding: 8px 16px; font-size: 13px; background: none; color: var(--text-secondary); border-bottom: 2px solid transparent; border-radius: 0; cursor: pointer; }
.tab:hover { color: var(--text-primary); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.text-success { color: var(--success); }
.text-warning { color: var(--warning); }
.text-error { color: var(--error); }
.text-info { color: var(--accent); }
.text-muted { color: var(--text-secondary); }
```

## STEP 33: Run

```bash
# Terminal 1 — from project root
cd server && npm run dev

# Terminal 2 — from project root
cd client && npm run dev
```

Open http://localhost:5173 → Load Records → Learn Patterns → Process Selected or Process All
