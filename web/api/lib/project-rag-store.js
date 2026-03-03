/**
 * Project RAG store.
 * JSON-backed chunk index with hybrid retrieval scoring.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const STORAGE_PATH = process.env.PROJECT_RAG_STORE_PATH
  || path.join(os.tmpdir(), 'mudrag-project-rag-store.json');

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[_/\\-]+/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return normalize(text).split(' ').filter((x) => x && x.length > 1 && x.length < 40);
}

function tokenizeWithFreq(text) {
  const tokens = tokenize(text);
  const freq = {};
  for (const t of tokens) freq[t] = (freq[t] || 0) + 1;
  return { tokens, freq };
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function readStore() {
  try {
    if (!fs.existsSync(STORAGE_PATH)) return { version: 1, projects: {} };
    const raw = fs.readFileSync(STORAGE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { version: 1, projects: {} };
    parsed.projects = parsed.projects || {};
    return parsed;
  } catch (_) {
    return { version: 1, projects: {} };
  }
}

function writeStore(store) {
  try {
    fs.writeFileSync(STORAGE_PATH, JSON.stringify(store, null, 2), 'utf8');
  } catch (_) {
    // best effort for readonly/serverless environments
  }
}

function chunkText(text, chunkChars = 1100, overlapChars = 180) {
  const clean = String(text || '').trim();
  if (!clean) return [];
  if (clean.length <= chunkChars) return [clean];

  const slidingWindowChunk = (str) => {
    const subChunks = [];
    let cursor = 0;
    while (cursor < str.length) {
      const end = Math.min(str.length, cursor + chunkChars);
      const slice = str.slice(cursor, end).trim();
      if (slice) subChunks.push(slice);
      if (end >= str.length) break;
      cursor = Math.max(0, end - overlapChars);
    }
    return subChunks;
  };

  const paraLike = clean
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paraLike.length > 1) {
    const packed = [];
    let cur = '';
    for (const p of paraLike) {
      if (!cur) {
        cur = p;
        continue;
      }
      if ((cur.length + p.length + 2) <= chunkChars) {
        cur += '\n\n' + p;
      } else {
        packed.push(cur);
        cur = p;
      }
    }
    if (cur) packed.push(cur);
    if (packed.length > 0) {
      const result = [];
      for (const chunk of packed) {
        if (chunk.length <= chunkChars) {
          result.push(chunk);
        } else {
          result.push(...slidingWindowChunk(chunk));
        }
      }
      return result;
    }
  }

  return slidingWindowChunk(clean);
}

function buildChunkId(documentId, idx) {
  return `${documentId || 'doc'}::${idx + 1}`;
}

function sanitizeSourceMeta(meta) {
  if (!meta || typeof meta !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v == null) continue;
    out[String(k).slice(0, 40)] = String(v).slice(0, 220);
  }
  return out;
}

function indexDocument({ projectId, documentId, title, source, text, sourceMeta }) {
  const store = readStore();
  if (!projectId) throw new Error('projectId required');
  const docId = String(documentId || `doc_${Date.now()}`);
  const chunks = chunkText(text || '');
  const safeMeta = sanitizeSourceMeta(sourceMeta);
  const rows = chunks.map((content, idx) => {
    const norm = normalize(content);
    const sourceLabel = String(source || 'project-doc');
    const titleLabel = String(title || 'Project document');
    const sourceMetaNorm = normalize(Object.values(safeMeta).join(' '));
    return {
      id: buildChunkId(docId, idx),
      project_id: String(projectId),
      document_id: docId,
      title: titleLabel,
      title_norm: normalize(titleLabel),
      source: sourceLabel,
      source_norm: normalize(sourceLabel),
      source_meta: safeMeta,
      source_meta_norm: sourceMetaNorm,
      content,
      content_norm: norm,
      created_at: new Date().toISOString(),
      token_count: tokenize(content).length,
      chunk_no: idx + 1,
    };
  });

  const projectKey = String(projectId);
  if (!store.projects[projectKey]) store.projects[projectKey] = { chunks: [] };
  const existing = store.projects[projectKey].chunks || [];
  const withoutDoc = existing.filter((r) => String(r.document_id) !== docId);
  store.projects[projectKey].chunks = [...withoutDoc, ...rows];
  writeStore(store);
  return { project_id: projectKey, document_id: docId, chunks_indexed: rows.length };
}

function buildDocumentFrequency(rows) {
  const df = {};
  for (const row of rows) {
    const uniq = new Set(tokenize(row.content_norm || row.content || ''));
    for (const t of uniq) df[t] = (df[t] || 0) + 1;
  }
  return df;
}

function bm25Score(queryTokens, rowTokens, rowFreq, df, totalDocs, avgDocLen) {
  if (!queryTokens.length || !rowTokens.length || totalDocs === 0) return 0;
  const k1 = 1.2;
  const b = 0.75;
  const docLen = Math.max(1, rowTokens.length);
  let score = 0;
  for (const q of queryTokens) {
    const f = rowFreq[q] || 0;
    if (f === 0) continue;
    const n = df[q] || 0;
    const idf = Math.log(1 + ((totalDocs - n + 0.5) / (n + 0.5)));
    const denom = f + k1 * (1 - b + b * (docLen / Math.max(1, avgDocLen)));
    score += idf * ((f * (k1 + 1)) / Math.max(0.0001, denom));
  }
  return score;
}

function phraseBoost(queryNorm, contentNorm) {
  if (!queryNorm || queryNorm.length < 5 || !contentNorm) return 0;
  if (contentNorm.includes(queryNorm)) return 2.8;
  return 0;
}

function metadataBoost(queryTokens, row) {
  if (!queryTokens.length) return 0;
  const titleNorm = row.title_norm || normalize(row.title || '');
  const sourceNorm = row.source_norm || normalize(row.source || '');
  const metaNorm = row.source_meta_norm || normalize(Object.values(row.source_meta || {}).join(' '));
  let score = 0;
  for (const t of queryTokens) {
    if (titleNorm.includes(t)) score += 0.8;
    if (sourceNorm.includes(t)) score += 0.4;
    if (metaNorm.includes(t)) score += 0.5;
  }
  return score;
}

function recencyBoost(isoDate) {
  const ts = Date.parse(String(isoDate || ''));
  if (!Number.isFinite(ts)) return 0;
  const days = (Date.now() - ts) / 86400000;
  if (days <= 7) return 0.45;
  if (days <= 30) return 0.22;
  return 0;
}

function charNgrams(text, n = 3) {
  const t = normalize(text).replace(/\s+/g, '');
  if (t.length < n) return new Set([t]);
  const set = new Set();
  for (let i = 0; i <= t.length - n; i++) set.add(t.slice(i, i + n));
  return set;
}

function semanticLikeScore(query, chunk) {
  const a = charNgrams(query, 3);
  const b = charNgrams(chunk, 3);
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const g of a) if (b.has(g)) inter += 1;
  return (2 * inter) / (a.size + b.size);
}

function confidenceFromTop(topScore, secondScore) {
  if (topScore >= 3.8 && (topScore - secondScore) >= 0.35) return 'high';
  if (topScore >= 1.0) return 'medium';
  return 'low';
}

function buildSnippet(content, queryTokens, maxChars = 320) {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (!queryTokens || queryTokens.length === 0) return text.slice(0, maxChars);
  const lower = text.toLowerCase();
  let bestIdx = -1;
  for (const t of queryTokens) {
    const idx = lower.indexOf(t.toLowerCase());
    if (idx >= 0 && (bestIdx < 0 || idx < bestIdx)) bestIdx = idx;
  }
  if (bestIdx < 0) return text.slice(0, maxChars);
  const start = clamp(bestIdx - 90, 0, Math.max(0, text.length - maxChars));
  return text.slice(start, start + maxChars);
}

function searchProject({ projectId, query, topK = 5, sourceFilter }) {
  const store = readStore();
  const projectKey = String(projectId || '');
  let rows = (store.projects[projectKey] && store.projects[projectKey].chunks) || [];
  if (sourceFilter) {
    const sf = normalize(sourceFilter);
    rows = rows.filter((r) => normalize(r.source || '').includes(sf));
  }
  const queryNorm = normalize(query || '');
  const queryTokens = tokenize(queryNorm).slice(0, 16);
  if (!queryNorm || !rows.length) {
    return { chunks: [], confidence: 'low', fallback_used: true };
  }

  const df = buildDocumentFrequency(rows);
  const avgDocLen = rows.reduce((acc, row) => acc + Math.max(1, Number(row.token_count || 0)), 0) / Math.max(1, rows.length);

  const scored = rows
    .map((row) => {
      const { tokens: chunkTokens, freq } = tokenizeWithFreq(row.content_norm || row.content || '');
      const bm25 = bm25Score(queryTokens, chunkTokens, freq, df, rows.length, avgDocLen);
      const sem = semanticLikeScore(queryNorm, row.content_norm || row.content || '');
      const pBoost = phraseBoost(queryNorm, row.content_norm || '');
      const mBoost = metadataBoost(queryTokens, row);
      const rBoost = recencyBoost(row.created_at);
      const score = (bm25 * 1.1) + (sem * 2.3) + pBoost + mBoost + rBoost;
      return {
        id: row.id,
        document_id: row.document_id,
        title: row.title,
        source: row.source,
        source_meta: row.source_meta || {},
        chunk_no: row.chunk_no || null,
        score: Number(score.toFixed(4)),
        snippet: buildSnippet(row.content || '', queryTokens, 340),
      };
    })
    .filter((x) => x.score > 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Number(topK) || 5));

  const topScore = scored[0] ? scored[0].score : 0;
  const second = scored[1] ? scored[1].score : 0;
  return {
    chunks: scored,
    confidence: confidenceFromTop(topScore, second),
    fallback_used: scored.length === 0,
  };
}

async function getProjectRAGPackage({ projectId, query, userId, topK = 6, supabaseClient }) {
  const pid = String(projectId || '').trim();
  const q = String(query || '').trim();
  if (!pid || !q || !userId) return null;

  if (!supabaseClient) return null;

  const { data: project } = await supabaseClient
    .from('projects')
    .select('id')
    .eq('id', pid)
    .eq('user_id', userId)
    .single();

  if (!project) return null;

  const result = searchProject({ projectId: pid, query: q, topK });
  const chunks = (result && result.chunks) || [];

  const sources = chunks.map((c, idx) => ({
    id: c.id || `project_${idx + 1}`,
    title: c.title || `Project document ${idx + 1}`,
    source: c.source || 'project-doc',
    snippet: c.snippet || '',
    score: c.score || 0,
    document_id: c.document_id || null,
    source_meta: c.source_meta || {},
  }));

  const context = chunks
    .slice(0, topK)
    .map((c, idx) => {
      const title = c.title || `Project document ${idx + 1}`;
      const src = c.source || 'project-doc';
      const snippet = String(c.snippet || '').slice(0, 420);
      return `[Project Source ${idx + 1}] ${title} (${src})\n${snippet}`;
    })
    .join('\n\n');

  return {
    context,
    sources,
    confidence: (result && result.confidence) || 'low',
    fallback_used: !chunks.length,
  };
}

module.exports = {
  indexDocument,
  searchProject,
  chunkText,
  normalize,
  getProjectRAGPackage,
};
