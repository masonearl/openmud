/**
 * mud1 RAG (Retrieval-Augmented Generation) – v2
 * Lexical retrieval with query cleanup, synonym expansion, weighted scoring,
 * confidence classification, and source metadata.
 *
 * Reserved (do not overlap): organize/clean/tidy/sort + desktop/downloads
 * Those trigger backend tools in desktop/main.js detectAgenticIntent().
 */

const path = require('path');
const fs = require('fs');

// Reserved: same patterns as desktop/main.js detectAgenticIntent - return [] for these
const RESERVED = [
  /\b(organize|clean|tidy|sort)\b.*\b(desktop|my desktop)\b/i,
  /\b(desktop)\b.*\b(organize|clean|tidy|sort)\b/i,
  /\b(organize|clean|tidy|sort)\b.*\b(downloads?|my downloads?)\b/i,
  /\b(downloads?)\b.*\b(organize|clean|tidy|sort)\b/i,
];

const DATA_PATH = path.join(__dirname, '..', 'data', 'construction-qa.json');
const DEFAULT_TOP_K = 5;
const MIN_ABSOLUTE_SCORE = 2;
const RELATIVE_SCORE_FACTOR = 0.28;

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'at', 'with', 'is', 'are', 'be',
  'do', 'does', 'did', 'can', 'could', 'would', 'should', 'i', 'you', 'we', 'they', 'it', 'this',
  'that', 'my', 'your', 'our', 'their', 'me', 'please', 'how', 'what', 'when', 'where', 'why',
]);

const SYNONYM_GROUPS = [
  ['payapp', 'pay_app', 'pay application', 'payment application', 'payment request', 'application for payment', 'sov', 'schedule of values'],
  ['rfi', 'request for information'],
  ['submittal', 'submittals', 'shop drawing', 'shop drawings', 'product data', 'transmittal'],
  ['daily report', 'daily log', 'field report', 'field log', 'construction diary'],
  ['change order', 'co', 'extra work', 'field change'],
  ['lien waiver', 'lien release', 'conditional waiver', 'unconditional waiver'],
  ['waterline', 'water line', 'water main', 'potable water'],
  ['sewer', 'sanitary sewer', 'wastewater'],
  ['storm', 'storm drain', 'stormwater', 'drainage'],
  ['pipe', 'pipeline', 'piping'],
  ['estimate', 'estimating', 'cost estimate', 'bid estimate'],
  ['proposal', 'quote', 'bid document'],
  ['schedule', 'timeline', 'gantt', 'project schedule'],
];

let _qa = null;
let _synonymMap = null;

function buildSynonymMap() {
  if (_synonymMap) return _synonymMap;
  const map = new Map();
  for (const group of SYNONYM_GROUPS) {
    const normalizedGroup = [...new Set(group.map((x) => normalize(x)).filter(Boolean))];
    for (const term of normalizedGroup) {
      map.set(term, normalizedGroup);
    }
  }
  _synonymMap = map;
  return map;
}

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/["'`]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanUserText(text) {
  let t = String(text || '');
  t = t.replace(/\[ATTACHED DOCUMENTS\][\s\S]*?\[\/ATTACHED DOCUMENTS\]/gi, ' ');
  t = t.replace(/\[(?:Project has|Canvas mode\.|User is viewing:)[\s\S]*?\]/gi, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

function tokenize(text) {
  return normalize(text)
    .split(' ')
    .map((x) => x.trim())
    .filter((x) => x && x.length >= 2 && !STOP_WORDS.has(x));
}

function makePhrases(tokens) {
  const phrases = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    phrases.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  for (let i = 0; i < tokens.length - 2; i++) {
    phrases.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }
  return [...new Set(phrases)];
}

function expandTokens(tokens) {
  const syn = buildSynonymMap();
  const expanded = new Set(tokens);
  for (const token of tokens) {
    const variants = syn.get(token);
    if (!variants) continue;
    for (const v of variants) {
      for (const vt of tokenize(v)) expanded.add(vt);
    }
  }
  const phrases = makePhrases(tokens);
  for (const phrase of phrases) {
    const variants = syn.get(phrase);
    if (!variants) continue;
    for (const v of variants) {
      for (const vt of tokenize(v)) expanded.add(vt);
    }
  }
  return [...expanded];
}

function containsWholeWord(haystack, needle) {
  if (!needle) return false;
  const re = new RegExp(`(?:^|\\s)${escapeRegExp(needle)}(?:\\s|$)`);
  return re.test(haystack);
}

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inferTopic(entry) {
  const t = normalize(`${entry.question || ''} ${(entry.keywords || []).join(' ')}`);
  if (/\b(rfi|request for information)\b/.test(t)) return 'rfi';
  if (/\b(submittal|shop drawing)\b/.test(t)) return 'submittal';
  if (/\b(pay app|payment|retainage|sov)\b/.test(t)) return 'pay_application';
  if (/\b(change order|co)\b/.test(t)) return 'change_order';
  if (/\b(daily report|daily log|field report)\b/.test(t)) return 'daily_report';
  if (/\b(lien waiver|lien release)\b/.test(t)) return 'lien_waiver';
  if (/\b(schedule|timeline|gantt)\b/.test(t)) return 'schedule';
  if (/\b(proposal|quote)\b/.test(t)) return 'proposal';
  if (/\b(estimate|cost|markup|labor|equipment|material)\b/.test(t)) return 'estimating';
  if (/\b(osha|safety|trench)\b/.test(t)) return 'safety';
  return 'general';
}

function preprocessEntry(entry, index) {
  const id = String(entry.id || `kb_${index + 1}`);
  const question = String(entry.question || '').trim();
  const answer = String(entry.answer || '').trim();
  const keywords = Array.isArray(entry.keywords) ? entry.keywords.map((k) => String(k).trim()).filter(Boolean) : [];
  const source = String(entry.source || 'construction-qa');
  const topic = String(entry.topic || inferTopic(entry));
  const questionNorm = normalize(question);
  const answerNorm = normalize(answer);
  const keywordNorm = keywords.map((k) => normalize(k)).filter(Boolean);
  const keywordTokens = keywordNorm.flatMap((k) => tokenize(k));
  const questionTokens = tokenize(questionNorm);
  const answerTokens = tokenize(answerNorm);
  return {
    id,
    question,
    answer,
    keywords,
    source,
    topic,
    _questionNorm: questionNorm,
    _answerNorm: answerNorm,
    _keywordNorm: keywordNorm,
    _keywordTokens: keywordTokens,
    _questionTokens: questionTokens,
    _answerTokens: answerTokens,
  };
}

function loadQA() {
  if (_qa) return _qa;
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    _qa = (Array.isArray(parsed) ? parsed : []).map(preprocessEntry);
    return _qa;
  } catch (e) {
    console.error('mud1 RAG: failed to load', DATA_PATH, e.message);
    return [];
  }
}

function scoreEntry(query, entry) {
  let score = 0;
  const matched = [];

  for (const phrase of query.phrases) {
    if (phrase.length < 4) continue;
    if (entry._questionNorm.includes(phrase)) {
      score += 8;
      matched.push(`phrase:${phrase}`);
    } else if (entry._keywordNorm.some((k) => k.includes(phrase) || phrase.includes(k))) {
      score += 6;
      matched.push(`kwphrase:${phrase}`);
    }
  }

  for (const token of query.tokensExpanded) {
    if (token.length < 2) continue;
    let best = 0;
    if (entry._keywordTokens.includes(token)) best = Math.max(best, 4);
    if (entry._questionTokens.includes(token)) best = Math.max(best, 3);
    if (entry._answerTokens.includes(token)) best = Math.max(best, 1.2);
    if (!best && entry._questionNorm.includes(token)) best = Math.max(best, 1.0);
    if (!best && entry._keywordNorm.some((k) => k.startsWith(token) || token.startsWith(k) || k.includes(token))) {
      best = Math.max(best, 1.4);
    }
    if (!best && containsWholeWord(entry._answerNorm, token)) best = Math.max(best, 0.8);
    if (best > 0) {
      score += best;
      matched.push(`token:${token}`);
    }
  }

  if (query.tokens.length > 0) {
    const overlap = query.tokens.filter((t) => entry._questionTokens.includes(t) || entry._keywordTokens.includes(t)).length;
    if (overlap >= 3) score += 2.2;
    else if (overlap === 2) score += 1.1;
  }

  return { score, matched };
}

function buildQuery(userText) {
  const cleaned = cleanUserText(userText);
  const tokens = tokenize(cleaned);
  const tokensExpanded = expandTokens(tokens);
  const phrases = makePhrases(tokensExpanded);
  return { raw: userText || '', cleaned, tokens, tokensExpanded, phrases };
}

function confidenceFromScores(scores) {
  if (!scores.length) return 'low';
  const top = scores[0] || 0;
  const second = scores[1] || 0;
  if (top >= 14 && second >= 6) return 'high';
  if (top >= 8) return 'medium';
  return 'low';
}

function selectDiverse(scored, k) {
  const picked = [];
  const signatures = new Set();
  for (const item of scored) {
    const signature = normalize(item.question).split(' ').slice(0, 8).join(' ');
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    picked.push(item);
    if (picked.length >= k) break;
  }
  return picked;
}

/**
 * Retrieve top-k most relevant QA entries for a user query.
 * Used for true RAG: pass retrieved context to LLM for grounded generation.
 *
 * @param {string} userText - Raw user message
 * @param {number} k - Max entries to return (default 5)
 * @returns {{ id: string, question: string, answer: string, score: number, source: string, topic: string }[]}
 */
function retrieveTopK(userText, k = DEFAULT_TOP_K) {
  if (RESERVED.some((re) => re.test(userText || ''))) return [];

  const qa = loadQA();
  if (!qa.length) return [];

  const query = buildQuery(userText);
  if (!query.tokensExpanded.length && !query.phrases.length) return [];

  const scored = qa
    .map((entry) => {
      const s = scoreEntry(query, entry);
      return {
        id: entry.id,
        question: entry.question,
        answer: entry.answer,
        source: entry.source,
        topic: entry.topic,
        score: Number(s.score.toFixed(3)),
        matched: s.matched,
      };
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return [];
  const topScore = scored[0].score;
  const threshold = Math.max(MIN_ABSOLUTE_SCORE, topScore * RELATIVE_SCORE_FACTOR);
  const filtered = scored.filter((e) => e.score >= threshold);
  return selectDiverse(filtered, k);
}

function getRAGPackage(userText, k = DEFAULT_TOP_K) {
  const entries = retrieveTopK(userText, k);
  const context = formatContextForLLM(entries);
  const confidence = confidenceFromScores(entries.map((e) => e.score));
  return {
    query: cleanUserText(userText || ''),
    entries,
    context,
    sources: entries.map((e) => ({
      id: e.id,
      title: e.question,
      source: e.source,
      topic: e.topic,
      score: e.score,
    })),
    confidence,
    fallback_used: entries.length === 0,
  };
}

/**
 * Retrieve best single match (legacy). Prefer retrieveTopK for RAG.
 */
function retrieve(userText) {
  const top = retrieveTopK(userText, 1);
  return top.length ? { answer: top[0].answer, question: top[0].question } : null;
}

/**
 * Format retrieved context for LLM system prompt.
 */
function formatContextForLLM(entries) {
  if (!entries || entries.length === 0) return '';
  return entries
    .map((e) => `[Source: ${e.id} | topic=${e.topic} | score=${e.score}]\nQ: ${e.question}\nA: ${e.answer}`)
    .join('\n\n');
}

/**
 * Get response for user (legacy). Returns answer string or null.
 */
function getResponse(userText) {
  const result = retrieve(userText);
  return result ? result.answer : null;
}

module.exports = {
  retrieve,
  retrieveTopK,
  getRAGPackage,
  formatContextForLLM,
  getResponse,
  loadQA,
  normalize,
  cleanUserText,
};
