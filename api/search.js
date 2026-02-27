const OpenAI = require('openai');
const CONTENT = require('../data/site-content.json');

const CHUNKS = CONTENT.chunks;

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

function findRelevantChunks(query, topN = 6) {
  const tokens = tokenize(query);
  const scored = CHUNKS.map(chunk => ({ chunk, score: scoreChunk(chunk, tokens) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  // If no matches, return a broad sample of chunks
  if (scored.length === 0) {
    return CHUNKS.slice(0, topN);
  }
  return scored.map(({ chunk }) => chunk);
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
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return res.status(400).json({ error: 'Query is required' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Fallback: return matched chunks without AI synthesis
    const chunks = findRelevantChunks(query, 5);
    return res.status(200).json({
      answer: 'Add OPENAI_API_KEY to enable AI-synthesized answers. Here are the most relevant resources:',
      sources: chunks.map(c => ({ title: c.title, url: c.url, category: c.category, excerpt: c.content.slice(0, 120) + '...' })),
    });
  }

  try {
    const relevant = findRelevantChunks(query, 7);
    const context = relevant.map((c, i) =>
      `[${i + 1}] ${c.category} — ${c.title}\n${c.content}\nSource: ${c.url}`
    ).join('\n\n---\n\n');

    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
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
          content: `Question: ${query.trim()}\n\nContext:\n\n${context}`,
        },
      ],
    });

    const answer = completion.choices?.[0]?.message?.content || 'No answer generated.';
    const sources = relevant.slice(0, 4).map(c => ({
      title: c.title,
      url: c.url,
      category: c.category,
      excerpt: c.content.slice(0, 110) + '...',
    }));

    return res.status(200).json({ answer, sources });
  } catch (err) {
    console.error('Search error:', err);
    const chunks = findRelevantChunks(query, 4);
    return res.status(200).json({
      answer: 'Could not generate AI answer. Here are the most relevant resources:',
      sources: chunks.map(c => ({ title: c.title, url: c.url, category: c.category, excerpt: c.content.slice(0, 110) + '...' })),
    });
  }
};
