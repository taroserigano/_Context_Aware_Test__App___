import { DateTime } from "luxon";

/**
 * ENRICHER NODE — Pure code, no LLM.
 * Pre-computes deterministic facts from the record so agents don't have to do math.
 */
export async function enricherNode(state) {
  const { record } = state;
  const { consent, channel_preferences, input } = record;

  // Eligible channels: gated by consent
  const eligibleChannels = [];
  if (consent.email_opt_in) eligibleChannels.push("email");
  if (consent.sms_opt_in) eligibleChannels.push("sms");
  if (consent.voice_opt_in) eligibleChannels.push("voice");

  // Preferred eligible: intersection of preferences and consent, preserving preference order
  const preferredEligible = channel_preferences.filter((c) =>
    eligibleChannels.includes(c),
  );

  // Time calculations
  const lastInteraction = DateTime.fromISO(input.last_interaction);
  const moveDate = DateTime.fromISO(input.move_date_target);
  const daysUntilMove = Math.round(moveDate.diff(lastInteraction, "days").days);

  // Urgency classification — consider both timeline and lifecycle stage
  let urgency;
  if (daysUntilMove <= 14 || record.lifecycle_stage === "new") urgency = "high";
  else if (daysUntilMove <= 45) urgency = "medium";
  else urgency = "low";

  // Extract day number hint from task_id (e.g. "prospect_welcome_day0" → 0)
  const dayMatch = record.task_id?.match(/day(\d+)/);
  const taskDayHint = dayMatch ? parseInt(dayMatch[1], 10) : null;

  // Profile summary for embedding / few-shot retrieval
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
    stageLog: [
      {
        stage: "enricher",
        timestamp: new Date().toISOString(),
        result: enrichedContext,
      },
    ],
  };
}
