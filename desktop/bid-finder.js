/**
 * openmud Bid Finder — Desktop scraper module
 * Scrapes public bid sources directly from the Electron main process.
 * Sources: SAM.gov (federal API), Horrocks Plan Room, UDOT Contractor Zone,
 *          Utah Bonfire Hub, QuestCDN, Utah Division of Purchasing
 */

'use strict';

const https = require('https');
const http  = require('http');
const url   = require('url');

// ── Relevance keywords ──────────────────────────────────────────────────────

const PRIMARY_KEYWORDS = [
  'gas main','gas line','gas distribution','natural gas','gas service',
  'waterline','water line','water main','water service','culinary water','water system',
  'sewer main','sewer line','sanitary sewer','force main','lift station','pump station',
  'storm drain','stormwater','storm sewer','drainage','catch basin',
  'fiber optic','conduit','duct bank',
  'underground utility','utility replacement','utility relocation',
  'directional drill','boring','hdpe','ductile iron','pvc pipe',
  'manhole','fire hydrant','service lateral',
];
const SECONDARY_KEYWORDS = [
  'underground','utility','utilities','water','sewer','sanitary',
  'storm','pipe','pipeline','excavation','trenching','culvert',
  'grading','earthwork','sitework','infrastructure','improvement',
  'reconstruction','rehabilitation','replacement',
];
const ALL_KEYWORDS = [...PRIMARY_KEYWORDS, ...SECONDARY_KEYWORDS];

function isRelevant(title = '', description = '') {
  const t = (title + ' ' + description).toLowerCase();
  return ALL_KEYWORDS.some(k => t.includes(k));
}

function matchesTrade(bid, trade) {
  if (!trade) return true;
  const t = (bid.title + ' ' + (bid.description || '')).toLowerCase();
  const maps = {
    waterline: ['water','waterline','water main','water line'],
    sewer:     ['sewer','sanitary','wastewater'],
    storm:     ['storm','drainage','stormwater','culvert'],
    gas:       ['gas','natural gas'],
    electrical:['electrical','conduit','power'],
    civil:     ['civil','road','highway','street','bridge'],
    concrete:  ['concrete','foundation'],
    paving:    ['paving','asphalt','pavement'],
    grading:   ['grading','earthwork','excavation'],
    utility:   ['utility','underground','trench','pipe'],
  };
  const keys = maps[trade] || [trade];
  return keys.some(k => t.includes(k));
}

// ── HTTP helper ─────────────────────────────────────────────────────────────

function fetchUrl(rawUrl, opts = {}, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects <= 0) return reject(new Error('Too many redirects'));
    const parsed = url.parse(rawUrl);
    const lib = parsed.protocol === 'https:' ? https : http;
    const reqOpts = {
      hostname: parsed.hostname,
      port:     parsed.port,
      path:     parsed.path,
      method:   opts.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept':     opts.accept || 'text/html,*/*',
        ...(opts.headers || {}),
      },
      timeout: opts.timeout || 12000,
    };
    const req = lib.request(reqOpts, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : `${parsed.protocol}//${parsed.host}${res.headers.location}`;
        return resolve(fetchUrl(next, opts, redirects - 1));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.end();
  });
}

function parseDate(str) {
  if (!str) return null;
  try {
    const d = new Date(str.replace(/\s*(MST|MDT|PST|PDT|EST|EDT)\s*/gi,'').trim());
    if (!isNaN(d)) return d.toISOString();
  } catch (_) {}
  return null;
}

// ── Simple regex-based HTML text extractor ──────────────────────────────────

function textContent(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function extractLinks(html, baseUrl) {
  const links = [];
  const re = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const h = m[1];
    if (h.startsWith('http')) links.push(h);
    else if (h.startsWith('/')) links.push(new URL(h, baseUrl).href);
  }
  return links;
}

// ── SAM.gov (Federal API) ───────────────────────────────────────────────────

async function fetchSamGov(trade, apiKey = null) {
  const bids = [];
  if (!apiKey || apiKey === 'DEMO_KEY') return bids;
  try {
    const from = new Date(); from.setDate(from.getDate() - 90);
    const postedFrom = `${String(from.getMonth()+1).padStart(2,'0')}/${String(from.getDate()).padStart(2,'0')}/${from.getFullYear()}`;
    const naics = ['237110','237120','237310','238910'];
    for (const n of naics) {
      try {
        const apiUrl = `https://api.sam.gov/opportunities/v2/search?api_key=${apiKey}&postedFrom=${postedFrom}&limit=50&naics=${n}&ptype=o`;
        const { body } = await fetchUrl(apiUrl, { accept: 'application/json', headers: { 'Accept': 'application/json' } });
        const data = JSON.parse(body);
        for (const opp of (data.opportunitiesData || [])) {
          if (bids.find(b => b.id === `sam-${opp.noticeId}`)) continue;
          if (!isRelevant(opp.title, opp.description)) continue;
          if (trade && !matchesTrade({ title: opp.title, description: opp.description }, trade)) continue;
          bids.push({
            id:             `sam-${opp.noticeId}`,
            title:          opp.title || '',
            description:    (opp.description || '').slice(0, 300),
            source:         'SAM.gov (Federal)',
            url:            `https://sam.gov/opp/${opp.noticeId}/view`,
            bidDate:        parseDate(opp.responseDeadLine),
            location:       opp.placeOfPerformance?.city?.name ? `${opp.placeOfPerformance.city.name}, ${opp.placeOfPerformance.state?.code || 'UT'}` : 'Federal',
            status:         'open',
            projectType:    'Federal',
            estimatedValue: null,
          });
        }
      } catch (_) {}
    }
  } catch (e) { console.error('SAM.gov error:', e.message); }
  return bids;
}

// ── Horrocks Plan Room ──────────────────────────────────────────────────────

async function fetchHorrocks(trade) {
  const bids = [];
  const BASE = 'https://www.horrocksplanroom.com';
  try {
    const { body } = await fetchUrl(`${BASE}/jobs/calendar`);
    const jobLinks = [...new Set(extractLinks(body, BASE).filter(u => /\/jobs\/\d+\/details/.test(u)))];
    const toFetch = jobLinks.slice(0, 20);
    for (const jobUrl of toFetch) {
      try {
        const { body: jb } = await fetchUrl(jobUrl);
        if (/Closed|Bid Closed/i.test(jb)) continue;
        const titleMatch = jb.match(/<h1[^>]*>([^<]+)<\/h1>/i) || jb.match(/<h2[^>]*>([^<]+)<\/h2>/i);
        const title = titleMatch ? titleMatch[1].trim() : '';
        if (!title || title.length < 5) continue;
        const plain = textContent(jb);
        const bidMatch = plain.match(/Bid Date[:\s]+([\d\/]+[\s\d:apm]*[A-Z]*)/i);
        const bidDate = bidMatch ? parseDate(bidMatch[1].trim()) : null;
        if (trade && !matchesTrade({ title, description: plain.slice(0, 500) }, trade)) continue;
        const idM = jobUrl.match(/\/jobs\/(\d+)\//);
        bids.push({
          id:             `horrocks-${idM ? idM[1] : Date.now()}`,
          title,
          description:    '',
          source:         'Horrocks Plan Room',
          url:            jobUrl,
          bidDate,
          location:       'Utah / Idaho',
          status:         'open',
          projectType:    'Engineering',
          estimatedValue: null,
        });
      } catch (_) {}
    }
  } catch (e) { console.error('Horrocks error:', e.message); }
  return bids;
}

// ── Utah Division of Purchasing (Bonfire) ───────────────────────────────────

async function fetchUtahPurchasing(trade) {
  const bids = [];
  try {
    const { body } = await fetchUrl('https://purchasing.utah.gov/bids/');
    const rows = body.split('<tr').slice(1);
    for (const row of rows) {
      const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
      if (cells.length < 2) continue;
      const texts = cells.map(c => textContent(c).trim());
      const title = texts[0] || texts[1] || '';
      if (!title || title.length < 5) continue;
      const linkMatch = row.match(/href=["']([^"']+)["']/i);
      const bidUrl = linkMatch ? (linkMatch[1].startsWith('http') ? linkMatch[1] : `https://purchasing.utah.gov${linkMatch[1]}`) : 'https://purchasing.utah.gov/bids/';
      if (trade && !matchesTrade({ title, description: texts.join(' ') }, trade)) continue;
      if (!isRelevant(title, texts.join(' '))) continue;
      bids.push({
        id:             `ut-${Buffer.from(title).toString('base64').slice(0,12)}`,
        title,
        description:    texts.slice(1).join(' ').slice(0, 200),
        source:         'Utah Division of Purchasing',
        url:            bidUrl,
        bidDate:        parseDate(texts.find(t => /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t)) || null),
        location:       'Utah',
        status:         'open',
        projectType:    'State',
        estimatedValue: null,
      });
    }
  } catch (e) { console.error('Utah Purchasing error:', e.message); }
  return bids;
}

// ── Utah Bonfire Hub (U3P) ──────────────────────────────────────────────────

async function fetchBonfireHub(trade) {
  const bids = [];
  try {
    const { body } = await fetchUrl('https://utah.bonfirehub.com/portal/?tab=openOpportunities');
    // Bonfire is JS-rendered — extract any JSON data embedded in the page
    const jsonMatch = body.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]+?\});/);
    if (jsonMatch) {
      try {
        const state = JSON.parse(jsonMatch[1]);
        const opps = state?.portal?.opportunities || state?.opportunities || [];
        for (const opp of opps) {
          const title = opp.title || opp.name || '';
          if (!title) continue;
          if (trade && !matchesTrade({ title, description: opp.description || '' }, trade)) continue;
          if (!isRelevant(title, opp.description || '')) continue;
          bids.push({
            id:             `bonfire-${opp.id || opp.uid || Date.now()}`,
            title,
            description:    (opp.description || '').slice(0, 300),
            source:         'Utah Bonfire Hub',
            url:            opp.url || 'https://utah.bonfirehub.com/portal/?tab=openOpportunities',
            bidDate:        parseDate(opp.closeDate || opp.dueDate || null),
            location:       'Utah',
            status:         'open',
            projectType:    'State',
            estimatedValue: null,
          });
        }
      } catch (_) {}
    }
    // Fallback: parse visible text rows
    if (bids.length === 0) {
      const rows = body.split('opportunity').slice(1, 20);
      for (const r of rows) {
        const titleM = r.match(/["']title["']\s*:\s*["']([^"']+)["']/i) || r.match(/<h\d[^>]*>([^<]+)<\/h\d>/i);
        if (!titleM) continue;
        const title = titleM[1].trim();
        if (title.length < 5) continue;
        if (trade && !matchesTrade({ title }, trade)) continue;
        bids.push({
          id: `bonfire-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
          title, description: '', source: 'Utah Bonfire Hub',
          url: 'https://utah.bonfirehub.com/portal/?tab=openOpportunities',
          bidDate: null, location: 'Utah', status: 'open',
          projectType: 'State', estimatedValue: null,
        });
      }
    }
  } catch (e) { console.error('Bonfire error:', e.message); }
  return bids;
}

// ── QuestCDN ────────────────────────────────────────────────────────────────

async function fetchQuestCDN(trade) {
  const bids = [];
  try {
    const { body } = await fetchUrl('https://qcpi.questcdn.com/cdn/posting/?group=81&projType=all', {
      headers: { 'Accept': 'text/html', 'Referer': 'https://qcpi.questcdn.com/' }
    });
    const rows = body.split('<tr').slice(1);
    for (const row of rows) {
      const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || []).map(c => textContent(c).trim());
      const title = cells[0] || cells[1] || '';
      if (!title || title.length < 5 || title.toLowerCase().includes('project name')) continue;
      const linkMatch = row.match(/href=["']([^"'#]+)["']/i);
      const bidUrl = linkMatch ? (linkMatch[1].startsWith('http') ? linkMatch[1] : `https://qcpi.questcdn.com${linkMatch[1]}`) : 'https://qcpi.questcdn.com/cdn/posting/?group=81';
      if (trade && !matchesTrade({ title, description: cells.join(' ') }, trade)) continue;
      bids.push({
        id:             `questcdn-${Buffer.from(title).toString('base64').slice(0,12)}`,
        title,
        description:    cells.slice(1, 3).join(' ').slice(0, 200),
        source:         'QuestCDN',
        url:            bidUrl,
        bidDate:        parseDate(cells.find(c => /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(c)) || null),
        location:       cells.find(c => /utah|UT|Idaho|ID/i.test(c)) || 'Utah',
        status:         'open',
        projectType:    'Plan Room',
        estimatedValue: null,
      });
    }
  } catch (e) { console.error('QuestCDN error:', e.message); }
  return bids;
}

// ── Main: run all sources in parallel ──────────────────────────────────────

async function findBids(trade, location, samApiKey) {
  const started = Date.now();
  const samKey = samApiKey || process.env.SAM_GOV_API_KEY || null;
  const warnings = [];
  const hasSamKey = !!samKey && samKey !== 'DEMO_KEY';
  if (!hasSamKey) {
    warnings.push('SAM.gov source unavailable: set SAM_GOV_API_KEY to enable federal results.');
  }
  const [samRes, horrocksRes, utahRes, bonfireRes, questRes] = await Promise.allSettled([
    hasSamKey ? fetchSamGov(trade, samKey) : Promise.resolve([]),
    fetchHorrocks(trade),
    fetchUtahPurchasing(trade),
    fetchBonfireHub(trade),
    fetchQuestCDN(trade),
  ]);

  const sources = {};
  const allBids = [];

  function collect(res, label) {
    const items = res.status === 'fulfilled' ? res.value : [];
    sources[label] = items.length;
    allBids.push(...items);
  }
  collect(samRes,     'SAM.gov (Federal)');
  collect(horrocksRes,'Horrocks Plan Room');
  collect(utahRes,    'Utah Division of Purchasing');
  collect(bonfireRes, 'Utah Bonfire Hub');
  collect(questRes,   'QuestCDN');

  // Deduplicate by title similarity
  const seen = new Set();
  const deduped = allBids.filter(bid => {
    const key = bid.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const elapsed = ((Date.now() - started) / 1000).toFixed(1) + 's';
  return { bids: deduped, sources, warnings, trade: trade || null, location: location || null, elapsed, scannedAt: new Date().toISOString() };
}

module.exports = { findBids, fetchSamGov, fetchHorrocks, fetchUtahPurchasing, fetchBonfireHub, fetchQuestCDN, isRelevant, matchesTrade };
