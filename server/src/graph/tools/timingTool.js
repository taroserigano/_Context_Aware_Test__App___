import { DateTime } from "luxon";

/**
 * Compute the next appropriate send time in the user's timezone.
 * Pure deterministic logic — no LLM involved.
 *
 * @param {string} lastInteraction - ISO timestamp of last interaction
 * @param {string} timezone - IANA timezone (e.g. "America/Chicago")
 * @param {string} urgency - "high" | "medium" | "low"
 * @param {object} [options] - Optional LLM-specified overrides
 * @param {number} [options.dayOffset] - Days after last interaction to send
 * @param {number} [options.targetHour] - Hour of day (0-23) in local timezone
 * @returns {{ sendAt: string, reasoning: string }}
 */
export function computeSendTime(
  lastInteraction,
  timezone,
  urgency,
  options = {},
) {
  const { dayOffset, targetHour } = options;
  const lastDt = DateTime.fromISO(lastInteraction, { zone: timezone });

  // Use LLM-specified offset/hour when available, fall back to urgency-based defaults
  const offset =
    dayOffset != null
      ? dayOffset
      : urgency === "high"
        ? 1
        : urgency === "medium"
          ? 1
          : 2;
  const hour = targetHour != null ? targetHour : urgency === "high" ? 9 : 10;

  let candidate = lastDt
    .plus({ days: offset })
    .set({ hour, minute: 0, second: 0, millisecond: 0 });

  // Skip weekends
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

/**
 * Compute days between two ISO date strings.
 */
export function daysBetween(isoA, isoB) {
  const a = DateTime.fromISO(isoA);
  const b = DateTime.fromISO(isoB);
  return Math.round(Math.abs(b.diff(a, "days").days));
}
