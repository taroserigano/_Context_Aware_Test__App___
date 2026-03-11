/**
 * Shared runtime state for learned artifacts that persist across API calls.
 */
let vectorStore = null;
let learnedRulebook = "";
let learnedPatterns = [];
let isLearned = false;

export function setVectorStore(vs) {
  vectorStore = vs;
}
export function getVectorStore() {
  return vectorStore;
}

export function setRulebook(rb) {
  learnedRulebook = rb;
}
export function getRulebook() {
  return learnedRulebook;
}

export function setPatterns(p) {
  learnedPatterns = p;
}
export function getPatterns() {
  return learnedPatterns;
}

export function setLearned(v) {
  isLearned = v;
}
export function getIsLearned() {
  return isLearned;
}

export function resetRuntime() {
  vectorStore = null;
  learnedRulebook = "";
  learnedPatterns = [];
  isLearned = false;
}
