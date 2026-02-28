const OpenAI = require('openai');
const CONTENT = require('../data/site-content.json');

const CHUNKS = CONTENT.chunks;
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_VERSION = 'v2';
const SEARCH_CACHE = new Map();

/** Simple TF-IDF-style scoring: score each chunk against the query */
function scoreChunk(chunk, queryTokens) {
  const text = [chunk.title, chunk.content, chunk.category, ...(chunk.tags || [])].join(' ').toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (token.length < 3) continue;
    const count = (text.match(new RegExp(token, 'g')) || []).length;
    // Title and tag matches score higher
    const titleMatch = chunk.title.toLowerCase().includes(token) ? 3 : 0;
    const tagMatch = (chunk.tags || []).some(t => t.toLowerCase().includes(token)) ? 2 : 0;
    score += count + titleMatch + tagMatch;
  }
  return score;
}

function tokenize(query) {
  return query.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2);
}

function normalizeQuery(query) {
  return String(query || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function getRankedChunks(query) {
  const tokens = tokenize(query);
  return CHUNKS.map(chunk => ({ chunk, score: scoreChunk(chunk, tokens) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);
}

function findRelevantChunks(query, topN = 6) {
  const ranked = getRankedChunks(query).slice(0, topN);
  if (ranked.length === 0) return CHUNKS.slice(0, topN);
  return ranked.map(({ chunk }) => chunk);
}

function makeSources(chunks, limit = 4) {
  return chunks.slice(0, limit).map(c => ({
    title: c.title,
    url: c.url,
    category: c.category,
    excerpt: c.content.slice(0, 110) + '...',
  }));
}

function getFromCache(cacheKey) {
  const hit = SEARCH_CACHE.get(cacheKey);
  if (!hit) return null;
  if (Date.now() - hit.timestamp > CACHE_TTL_MS) {
    SEARCH_CACHE.delete(cacheKey);
    return null;
  }
  return hit.data;
}

function setCache(cacheKey, data) {
  SEARCH_CACHE.set(cacheKey, { timestamp: Date.now(), data });
}

function getSentences(text, count = 1) {
  const sentences = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .match(/[^.!?]+[.!?]?/g);
  if (!sentences || sentences.length === 0) return '';
  return sentences.slice(0, count).join(' ').trim();
}

function isNavigationQuery(query) {
  return /(^|\s)(go to|open|show me|where is|where can i find|navigate|take me to|page)(\s|$)/i.test(query);
}

function isLookupQuery(query) {
  return /(^|\s)(what is|what's|who is|define|minimum|how much|requirements?|summary)(\s|$)/i.test(query);
}

function shouldUseFastPath(query, ranked) {
  if (!ranked || ranked.length === 0) return false;
  const tokens = tokenize(query).filter(t => t.length >= 3);
  if (tokens.length === 0) return false;

  const top = ranked[0].score;
  const second = ranked[1] ? ranked[1].score : 0;
  const minScore = tokens.length <= 3 ? 4 : 6;
  const strongLead = second === 0 ? top >= minScore : (top - second >= 4 || top / second >= 1.35);
  const queryLooksFast = isNavigationQuery(query) || isLookupQuery(query);

  return queryLooksFast && top >= minScore && strongLead;
}

function buildFastAnswer(query, chunks) {
  const top = chunks[0];
  if (!top) return 'No answer found.';
  const summary = getSentences(top.content, 2) || top.content.slice(0, 220);

  if (isNavigationQuery(query) || top.category === 'Navigation') {
    return `Go to ${top.url}. ${summary}`;
  }
  return summary;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Search synthesis timeout')), ms);
    }),
  ]);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { query } = req.body || {};
  if (!query || typeof query !== 'string' || normalizeQuery(query).length < 2) {
    return res.status(400).json({ error: 'Query is required' });
  }
  const normalizedQuery = normalizeQuery(query);
  const cacheKey = `${CACHE_VERSION}:${normalizedQuery}`;
  const cached = getFromCache(cacheKey);
  if (cached) return res.status(200).json(cached);

  const ranked = getRankedChunks(normalizedQuery);
  const relevant = ranked.length ? ranked.slice(0, 7).map(({ chunk }) => chunk) : CHUNKS.slice(0, 7);
  const sources = makeSources(relevant, 4);

  if (shouldUseFastPath(normalizedQuery, ranked)) {
    const payload = {
      answer: buildFastAnswer(normalizedQuery, relevant),
      sources,
    };
    setCache(cacheKey, payload);
    return res.status(200).json(payload);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Fallback: return matched chunks without AI synthesis
    const payload = {
      answer: 'Add OPENAI_API_KEY to enable AI-synthesized answers. Here are the most relevant resources:',
      sources,
    };
    setCache(cacheKey, payload);
    return res.status(200).json(payload);
  }

  try {
    const context = relevant.map((c, i) =>
      `[${i + 1}] ${c.category} — ${c.title}\n${c.content}\nSource: ${c.url}`
    ).join('\n\n---\n\n');

    const openai = new OpenAI({ apiKey });
    const completion = await withTimeout(
      openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 200,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: `You are the openmud search assistant. openmud is a free, open-source AI platform for heavy civil and underground utility construction — estimating, scheduling, proposals, calculators, OSHA reference, and field tools. Built by contractors for contractors. MIT license, no paywall.

Answer rules:
- 1-3 sentences max. Be direct. Lead with the answer.
- No markdown, no bullet points, no headers. Plain prose only.
- If asked about openmud, its mission, or how to contribute: explain we're building AI tools for construction, everything is free and open source at github.com/masonearl/openmud, and people can contribute by submitting a PR, improving pricing data, or reaching out at hi@masonearl.com.
- If the user asks to navigate somewhere (e.g. "show me calculators", "go to resources"): tell them the URL and what they'll find there.
- If the context has the answer, use it. If not, give the best short answer you know and point to the relevant page.`,
          },
          {
            role: 'user',
            content: `Question: ${normalizedQuery}\n\nContext:\n\n${context}`,
          },
        ],
      }),
      7000
    );

    const answer = completion.choices?.[0]?.message?.content || 'No answer generated.';
    const payload = { answer, sources };
    setCache(cacheKey, payload);
    return res.status(200).json(payload);
  } catch (err) {
    console.error('Search error:', err);
    const payload = {
      answer: buildFastAnswer(normalizedQuery, relevant) || 'Could not generate AI answer. Here are the most relevant resources:',
      sources,
    };
    setCache(cacheKey, payload);
    return res.status(200).json(payload);
  }
};
