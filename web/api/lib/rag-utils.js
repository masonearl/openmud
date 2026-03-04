/**
 * Shared RAG utility functions for confidence ranking and source merging.
 */

function confidenceRank(label) {
  if (label === 'high') return 3;
  if (label === 'medium') return 2;
  return 1;
}

function maxConfidence(a, b) {
  return confidenceRank(a) >= confidenceRank(b) ? a : b;
}

function mergeRagSources(projectSources, kbSources, maxSources = 8) {
  const out = [];
  const seen = new Set();
  const push = (src) => {
    const key = `${src.id || ''}::${src.title || ''}::${src.source || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(src);
  };
  (projectSources || []).forEach(push);
  (kbSources || []).forEach(push);
  return out.slice(0, maxSources);
}

module.exports = {
  confidenceRank,
  maxConfidence,
  mergeRagSources,
};
