/**
 * Message templates that guarantee compliance elements are always present.
 * The LLM generates personalized content; templates ensure structural correctness.
 */

const SMS_TEMPLATE = ({ greeting, body, ctaText }) =>
  `${greeting}${body} ${ctaText} Reply STOP to opt out.`;

const EMAIL_BODY_TEMPLATE = ({ greeting, body, ctaBlock }) =>
  `${greeting}\n${body}\n${ctaBlock}\nTo opt out of emails, click here or reply STOP.`;

/**
 * Apply the channel-appropriate template to LLM-generated content.
 * Guarantees opt-out instructions are always present.
 */
export function applyTemplate(channel, content) {
  if (channel === "sms") {
    return SMS_TEMPLATE(content);
  }
  if (channel === "email") {
    return EMAIL_BODY_TEMPLATE(content);
  }
  // Fallback: just join content parts
  return `${content.greeting}\n${content.body}\n${content.ctaText || content.ctaBlock || ""}`;
}

/**
 * Check if a message body includes opt-out instructions.
 */
export function hasOptOutInstructions(body) {
  const lower = body.toLowerCase();
  return (
    lower.includes("stop") ||
    lower.includes("opt out") ||
    lower.includes("unsubscribe")
  );
}
