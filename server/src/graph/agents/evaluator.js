import { computeSimilarity } from "../../services/vectorStore.js";

/**
 * EVALUATOR AGENT — Scores output vs expected using structural + semantic matching.
 * No LLM needed — pure computation.
 */
export async function evaluatorNode(state) {
  const { record, channelDecision, timingDecision, messageOutput, actionPlan } =
    state;
  const expected = record.expected;

  if (!expected) {
    return {
      scores: {
        composite: 0,
        details: "No expected output to compare against",
      },
      stageLog: [
        {
          stage: "evaluator",
          timestamp: new Date().toISOString(),
          result: { composite: 0 },
        },
      ],
    };
  }

  const expectedMsg = expected.next_message;
  const expectedAction = expected.next_action;

  // ─── Channel match (exact, 15% weight) ───
  const channelScore =
    channelDecision.channel === expectedMsg.channel ? 1.0 : 0.0;

  // ─── Timing match (15% weight) ───
  const timingScore = computeTimingScore(
    timingDecision.sendAt,
    expectedMsg.send_at,
  );

  // ─── Subject match (5% weight) ───
  let subjectScore = 0;
  if (expectedMsg.subject == null && messageOutput.subject == null) {
    subjectScore = 1.0; // Both null (SMS) = perfect
  } else if (expectedMsg.subject && messageOutput.subject) {
    try {
      subjectScore = await computeSimilarity(
        messageOutput.subject,
        expectedMsg.subject,
      );
    } catch {
      subjectScore = 0;
    }
  } else {
    subjectScore = 0; // One null, one not
  }

  // ─── Body semantic similarity (35% weight) ───
  let bodyScore = 0;
  try {
    bodyScore = await computeSimilarity(messageOutput.body, expectedMsg.body);
  } catch {
    bodyScore = 0;
  }

  // ─── CTA match (15% weight) ───
  const ctaScore = computeCtaScore(messageOutput.cta, expectedMsg.cta);

  // ─── Action match (15% weight) ───
  const actionScore = computeActionScore(actionPlan, expectedAction);

  // ─── Weighted composite ───
  const composite =
    channelScore * 0.15 +
    timingScore * 0.15 +
    subjectScore * 0.05 +
    bodyScore * 0.35 +
    ctaScore * 0.15 +
    actionScore * 0.15;

  const scores = {
    channel: {
      score: channelScore,
      weight: 0.15,
      expected: expectedMsg.channel,
      actual: channelDecision.channel,
    },
    timing: {
      score: timingScore,
      weight: 0.15,
      expected: expectedMsg.send_at,
      actual: timingDecision.sendAt,
    },
    subject: {
      score: subjectScore,
      weight: 0.05,
      expected: expectedMsg.subject,
      actual: messageOutput.subject,
    },
    body: { score: bodyScore, weight: 0.35 },
    cta: {
      score: ctaScore,
      weight: 0.15,
      expected: expectedMsg.cta,
      actual: messageOutput.cta,
    },
    action: {
      score: actionScore,
      weight: 0.15,
      expected: expectedAction,
      actual: actionPlan,
    },
    composite: Math.round(composite * 1000) / 1000,
  };

  return {
    scores,
    stageLog: [
      {
        stage: "evaluator",
        timestamp: new Date().toISOString(),
        result: { composite: scores.composite },
      },
    ],
  };
}

function computeTimingScore(actual, expected) {
  if (!actual || !expected) return 0;
  try {
    const actualDate = new Date(actual);
    const expectedDate = new Date(expected);
    const diffHours = Math.abs(actualDate - expectedDate) / (1000 * 60 * 60);
    // Perfect if within 1 hour, degrades linearly to 0 at 24 hours
    return Math.max(0, 1 - diffHours / 24);
  } catch {
    return 0;
  }
}

function computeCtaScore(actual, expected) {
  if (!actual || !expected) return 0;
  let score = 0;
  // Type match
  if (actual.type === expected.type) score += 0.5;
  // Options match (for SMS quick-reply)
  if (expected.options && actual.options) {
    const expectedSet = new Set(expected.options.map((o) => o.toLowerCase()));
    const actualSet = new Set(
      actual.options?.map((o) => o.toLowerCase()) || [],
    );
    const overlap = [...expectedSet].filter((o) => actualSet.has(o)).length;
    score += 0.5 * (overlap / Math.max(expectedSet.size, 1));
  } else if (expected.link && actual.link) {
    score += 0.5; // Both have links
  } else if (
    !expected.options &&
    !expected.link &&
    !actual.options &&
    !actual.link
  ) {
    score += 0.5; // Neither has options or links
  }
  return score;
}

function computeActionScore(actual, expected) {
  if (!actual || !expected) return 0;
  let score = 0;
  if (actual.type === expected.type) score += 0.6;
  if (actual.name && expected.name && actual.name === expected.name)
    score += 0.2;
  if (actual.value !== undefined && expected.value !== undefined) {
    score += actual.value === expected.value ? 0.2 : 0.1;
  } else {
    score += 0.2; // No value to compare
  }
  return Math.min(score, 1);
}
