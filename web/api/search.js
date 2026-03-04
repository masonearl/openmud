const OpenAI = require('openai');
const CONTENT = require('../../data/site-content.json');

const CHUNKS = CONTENT.chunks || [];

// Synonym map: each key expands to itself plus all values when tokenizing a query.
// This lets "sewer" match chunks that only say "sanitary" or "wastewater", etc.
const SYNONYMS = {
  sewer:        ['sanitary', 'wastewater', 'gravity sewer'],
  sanitary:     ['sewer', 'wastewater'],
  water:        ['potable', 'waterline', 'water main', 'watermain'],
  waterline:    ['water main', 'potable', 'water'],
  main:         ['water main', 'sewer main', 'force main'],
  slope:        ['grade', 'gradient', 'minimum slope'],
  grade:        ['slope', 'gradient', 'elevation'],
  bluestakes:   ['811', 'blue stakes', 'locate', 'dig alert', 'call before you dig'],
  '811':        ['bluestakes', 'blue stakes', 'locate', 'utility locate'],
  locate:       ['bluestakes', '811', 'utility locate'],
  osha:         ['safety', 'excavation', 'trench safety', 'regulation'],
  trench:       ['excavation', 'ditch', 'open cut'],
  excavation:   ['trench', 'ditch', 'dig', 'open cut'],
  pipe:         ['pipeline', 'main', 'conduit'],
  pvc:          ['polyvinyl', 'plastic pipe', 'c900', 'sdr35', 'sdr 35'],
  hdpe:         ['polyethylene', 'high density', 'dr11', 'dr17'],
  ductile:      ['DI', 'ductile iron', 'class 52'],
  rcp:          ['reinforced concrete pipe', 'concrete pipe', 'storm pipe'],
  cmp:          ['corrugated metal pipe', 'culvert', 'corrugated'],
  prevailing:   ['davis-bacon', 'wage', 'certified payroll', 'prevailing wage'],
  wage:         ['prevailing wage', 'davis-bacon', 'labor rate', 'pay rate'],
  laborer:      ['labor', 'worker', 'common laborer', 'utility laborer'],
  operator:     ['equipment operator', 'operating engineer', 'excavator operator'],
  excavator:    ['backhoe', 'hoe', 'trackhoe', 'Cat 320', 'PC200'],
  dozer:        ['bulldozer', 'D6', 'D8', 'blade', 'earthmoving'],
  compaction:   ['compact', 'compactor', 'proctor', 'density', 'modified proctor'],
  backfill:     ['fill', 'select fill', 'native fill', 'compaction'],
  bedding:      ['pipe bedding', 'haunch', 'granular bedding', 'sand bedding'],
  estimate:     ['estimating', 'bid', 'takeoff', 'cost'],
  takeoff:      ['quantity takeoff', 'estimate', 'measurement'],
  bid:          ['estimate', 'proposal', 'unit price', 'lump sum'],
  concrete:     ['ready-mix', 'CDF', 'flowable fill', 'cement'],
  asphalt:      ['HMA', 'hot mix', 'paving', 'AC'],
  hydrant:      ['fire hydrant', 'hydrant assembly', 'hydrant installation'],
  valve:        ['gate valve', 'butterfly valve', 'ball valve', 'resilient wedge'],
  manhole:      ['MH', 'access structure', 'precast manhole', 'sewer manhole'],
  hdd:          ['directional drill', 'horizontal directional', 'boring'],
  boring:       ['HDD', 'directional drill', 'bore', 'trenchless'],
  trenchless:   ['HDD', 'boring', 'microtunnel', 'pipe jacking'],
  flow:         ['GPM', 'CFS', 'flow rate', 'discharge', 'hydraulics'],
  pressure:     ['PSI', 'working pressure', 'head', 'hydraulic'],
  aggregate:    ['gravel', 'base course', 'crushed rock', 'select fill'],
  gravel:       ['aggregate', 'base course', 'pit run', 'crushed'],
  sand:         ['bedding sand', 'concrete sand', 'fine aggregate'],
  rebar:        ['reinforcing', 'reinforcing bar', 'steel bar', '#4', '#5'],
  dewater:      ['dewatering', 'wellpoint', 'sump pump', 'groundwater'],
  stormwater:   ['storm water', 'runoff', 'storm drain', 'drainage'],
  storm:        ['stormwater', 'storm drain', 'runoff', 'culvert'],
  erosion:      ['SWPPP', 'sediment control', 'BMP', 'silt fence'],
  swppp:        ['erosion control', 'sediment', 'NPDES', 'stormwater plan'],
  traffic:      ['traffic control', 'MUTCD', 'work zone', 'flagger'],
  schedule:     ['CPM', 'critical path', 'Primavera', 'construction schedule'],
  rfi:          ['request for information', 'submittal', 'design clarification'],
  change:       ['change order', 'CO', 'extra work', 'differing site conditions'],
};

// Category keywords: if the query strongly matches these terms, boost the corresponding category.
const CATEGORY_SIGNALS = {
  Safety:    ['osha', 'safety', 'hazard', 'ppe', 'trench safety', 'fall', 'confined', 'struck', 'heat', 'silica', 'competent person', 'lockout', 'loto', 'egress', 'ladder'],
  Calculator:['calculate', 'calculator', 'compute', 'formula', 'equation', 'how much', 'how many', 'sizing', 'size'],
  Reference: ['spec', 'specification', 'standard', 'astm', 'awwa', 'aashto', 'class', 'rating', 'code', 'requirement'],
  Glossary:  ['what is', 'what does', 'define', 'definition', 'meaning', 'term'],
};

function expandQuery(query) {
  const lower = query.toLowerCase();
  const extra = [];
  for (const [key, aliases] of Object.entries(SYNONYMS)) {
    if (lower.includes(key)) {
      extra.push(...aliases);
    }
  }
  return lower + ' ' + extra.join(' ');
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function detectCategoryBoost(queryLower) {
  const boosts = {};
  for (const [cat, signals] of Object.entries(CATEGORY_SIGNALS)) {
    for (const signal of signals) {
      if (queryLower.includes(signal)) {
        boosts[cat] = (boosts[cat] || 0) + 2;
      }
    }
  }
  return boosts;
}

function scoreChunk(chunk, tokens, categoryBoosts) {
  const text = [chunk.title, chunk.content, chunk.category, ...(chunk.tags || [])].join(' ').toLowerCase();
  let score = 0;

  for (const token of tokens) {
    const count = (text.match(new RegExp(token, 'g')) || []).length;
    if (count) score += count;
    if ((chunk.title || '').toLowerCase().includes(token)) score += 3;
    if ((chunk.tags || []).some((t) => String(t).toLowerCase().includes(token))) score += 2;
  }

  // Apply category boost from query signal detection
  const catBoost = categoryBoosts[chunk.category] || 0;
  score += catBoost;

  return score;
}

function topChunks(query, n = 8) {
  const expanded = expandQuery(query);
  const tokens = tokenize(expanded);
  const categoryBoosts = detectCategoryBoost(query.toLowerCase());

  return CHUNKS
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, tokens, categoryBoosts) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.chunk);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const query = String((req.body && req.body.query) || '').trim();
  if (query.length < 2) return res.status(400).json({ error: 'Query is required' });

  const ranked = topChunks(query, 8);
  const sources = ranked.slice(0, 5).map((c) => ({
    title: c.title,
    url: c.url,
    category: c.category,
    excerpt: String(c.content || '').slice(0, 150) + '...',
  }));

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(200).json({
      answer: 'Search is available. Add OPENAI_API_KEY for AI-synthesized summaries.',
      sources,
    });
  }

  try {
    const openai = new OpenAI({ apiKey });
    const context = ranked.map((c, i) => `[${i + 1}] ${c.title}\n${c.content}\nURL: ${c.url}`).join('\n\n');
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 400,
      messages: [
        {
          role: 'system',
          content:
            'You are openmud search for heavy civil and underground utility construction. Answer in plain text, 2-4 sentences, using provided context. Include specific numbers, specs, or code references when relevant. If uncertain, say so and point to sources.',
        },
        { role: 'user', content: `Question: ${query}\n\nContext:\n${context}` },
      ],
    });
    const answer = completion.choices?.[0]?.message?.content || 'No answer generated.';
    return res.status(200).json({ answer, sources });
  } catch (err) {
    return res.status(200).json({
      answer: 'Search found related resources. AI summary is temporarily unavailable.',
      sources,
    });
  }
};
