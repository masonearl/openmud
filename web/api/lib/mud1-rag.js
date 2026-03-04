/**
 * mud1 RAG: retrieve construction context for LLM injection.
 * Shared by api/chat (web) and api/mud1-fallback (desktop proxy).
 */
const path = require('path');

const FALLBACK_CONTEXT = `
General openmud data (use when no specific match):
- Pipe: 4" $8.50/LF, 6" $12/LF, 8" $18/LF. Labor: operator $85/hr, foreman $55/hr, laborer $35/hr.
- Equipment: excavator $400/day, auger $450/day, compactor $100/day. Concrete: 3000 psi $166/CY.
- Markup: 10–20% typical. Clay: 20–40% higher cost. Rock: 3–5x soil.
`;

function getRAGContextForUser(userText) {
  try {
    const ragPath = path.join(__dirname, '..', '..', '..', 'mud1', 'src', 'rag.js');
    const rag = require(ragPath);
    if (typeof rag.getRAGPackage === 'function') {
      const pkg = rag.getRAGPackage(userText || '', 5);
      const formatted = (pkg && pkg.context) ? pkg.context : '';
      return formatted && formatted.trim() ? formatted : FALLBACK_CONTEXT.trim();
    }
    const topK = rag.retrieveTopK(userText || '', 5);
    const formatted = rag.formatContextForLLM(topK);
    return formatted && formatted.trim() ? formatted : FALLBACK_CONTEXT.trim();
  } catch (e) {
    return FALLBACK_CONTEXT.trim();
  }
}

function getRAGPackageForUser(userText, k = 5) {
  try {
    const ragPath = path.join(__dirname, '..', '..', '..', 'mud1', 'src', 'rag.js');
    const rag = require(ragPath);
    if (typeof rag.getRAGPackage === 'function') {
      const pkg = rag.getRAGPackage(userText || '', k);
      if (pkg && pkg.context && pkg.context.trim()) return pkg;
    }
    const topK = rag.retrieveTopK(userText || '', k);
    const context = rag.formatContextForLLM(topK);
    return {
      query: String(userText || ''),
      entries: topK,
      sources: (topK || []).map((e, i) => ({
        id: e.id || `kb_${i + 1}`,
        title: e.question,
        source: e.source || 'construction-qa',
        topic: e.topic || 'general',
        score: e.score || 0,
      })),
      context: context || FALLBACK_CONTEXT.trim(),
      confidence: topK.length ? 'medium' : 'low',
      fallback_used: topK.length === 0,
    };
  } catch (e) {
    return {
      query: String(userText || ''),
      entries: [],
      sources: [],
      context: FALLBACK_CONTEXT.trim(),
      confidence: 'low',
      fallback_used: true,
    };
  }
}

function buildMud1RAGSystemPrompt(retrievedContext) {
  const hasRetrieved = retrievedContext && !retrievedContext.includes('General openmud data');
  const block = hasRetrieved
    ? `## Retrieved context (PRIORITY: base your answer on this data)\n\n${retrievedContext}`
    : `## Context\n\n${retrievedContext || FALLBACK_CONTEXT.trim()}`;

  return `You are mud1, openmud's construction AI. Answer using the data below. Generate a short, accurate response grounded in our knowledge base.

Rules:
- Base your answer on the retrieved context. Use our numbers and facts—don't invent.
- Jokes or casual requests → construction-themed (trenching, excavators, pipe, bids).
- Stay concise. 1–3 sentences. No markdown. Stay in role.

${block}`;
}

module.exports = { getRAGContextForUser, getRAGPackageForUser, buildMud1RAGSystemPrompt };
