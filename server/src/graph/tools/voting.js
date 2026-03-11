import { getChatModel } from "../../services/llmClient.js";

/**
 * Self-consistency voting: run the LLM N times and pick the majority/best result.
 *
 * @param {Function} invoker - async (model) => structured result object
 * @param {object} options
 * @param {number} options.n - number of parallel runs (default 3)
 * @param {string} options.voteKey - field name to majority-vote on (e.g. "channel")
 * @returns {object} - the winning result
 */
export async function voteOnResult(invoker, options = {}) {
  const { n = 3, voteKey } = options;

  // Run n calls in parallel at higher temperature for diversity
  const model = getChatModel({ temperature: 0.7 });
  const promises = Array.from({ length: n }, () => invoker(model));
  const results = await Promise.all(promises);

  if (!voteKey) {
    // No voting key — just return first successful result
    return results[0];
  }

  // Majority vote on the specified key
  const counts = {};
  for (const r of results) {
    const val = r[voteKey];
    counts[val] = (counts[val] || 0) + 1;
  }

  const winningValue = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];

  // Return the first result that has the winning value
  return results.find((r) => r[voteKey] === winningValue) || results[0];
}
