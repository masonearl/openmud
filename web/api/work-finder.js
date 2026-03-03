/**
 * Work Finder — searches public bid sites for construction opportunities.
 * Sources: SAM.gov (federal), Utah Division of Purchasing, PlanHub (future).
 * Also used as a helper by the desktop Electron app (main.js).
 */

const https = require('https');
const http = require('http');

// Trade type → search keyword lists
const TRADE_KEYWORD_MAP = {
  waterline:   ['waterline', 'water main', 'water line', 'water distribution', 'potable water'],
  sewer:       ['sewer', 'sanitary sewer', 'wastewater', 'sanitary'],
  storm:       ['storm drain', 'stormwater', 'drainage', 'culvert', 'storm sewer'],
  gas:         ['gas line', 'gas main', 'natural gas', 'gas distribution'],
  electrical:  ['electrical', 'conduit', 'power', 'electrical contractor'],
  civil:       ['civil', 'road construction', 'highway', 'street improvement', 'bridge'],
  concrete:    ['concrete', 'poured concrete', 'foundation', 'concrete contractor'],
  paving:      ['paving', 'asphalt', 'road resurfacing', 'pavement'],
  grading:     ['grading', 'earthwork', 'excavation', 'site preparation'],
  utility:     ['underground utility', 'utility construction', 'trench', 'pipe'],
};

// Trade type → NAICS codes (for SAM.gov filtering)
const TRADE_NAICS_MAP = {
  waterline:   ['237110'],
  sewer:       ['237110'],
  storm:       ['237110'],
  gas:         ['237120'],
  electrical:  ['237130'],
  civil:       ['237310'],
  concrete:    ['238110'],
  paving:      ['237310'],
  grading:     ['238910'],
  utility:     ['237110', '237130'],
};

function getTradeKeywords(trade) {
  if (!trade) return ['construction', 'utility', 'infrastructure'];
  const key = Object.keys(TRADE_KEYWORD_MAP).find(k => trade.toLowerCase().includes(k));
  return key ? TRADE_KEYWORD_MAP[key] : [trade, 'construction'];
}

function getTradeNAICS(trade) {
  if (!trade) return ['237110', '237310'];
  const key = Object.keys(TRADE_NAICS_MAP).find(k => trade.toLowerCase().includes(k));
  return key ? TRADE_NAICS_MAP[key] : ['237110'];
}

/** Simple HTTP/HTTPS fetcher with redirect support and timeout */
function fetchUrl(urlStr, opts = {}) {
  return new Promise((resolve, reject) => {
    const lib = urlStr.startsWith('https') ? https : http;
    const req = lib.get(urlStr, {
      headers: {
        'User-Agent': 'openmud Work Finder/1.0 (construction bid search; openmud.ai)',
        'Accept': 'application/json, text/html;q=0.9',
        ...(opts.headers || {}),
      },
      timeout: opts.timeout || 10000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location;
        const next = loc.startsWith('http') ? loc : new URL(loc, urlStr).toString();
        return fetchUrl(next, opts).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

/**
 * Search SAM.gov (US federal procurement) for active bid opportunities.
 * Uses the free public API — users can register at api.sam.gov for a personal key
 * to increase rate limits from 10/hr to 1000/hr.
 */
async function searchSAMGov(trade, apiKey = null) {
  if (!apiKey || apiKey === 'DEMO_KEY') return [];
  try {
    const keywords = getTradeKeywords(trade);
    const keyword = keywords.slice(0, 2).join(' ');

    const today = new Date();
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - 60); // posted within last 60 days

    const fmt = (d) =>
      `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;

    const params = new URLSearchParams({
      api_key: apiKey,
      keyword,
      limit: '12',
      offset: '0',
      postedFrom: fmt(fromDate),
      status: 'active',
      typeOfSetAside: '',
    });

    const { status, body } = await fetchUrl(
      `https://api.sam.gov/opportunities/v2/search?${params}`,
      { headers: { Accept: 'application/json' }, timeout: 12000 }
    );

    if (status !== 200) return [];

    const json = JSON.parse(body);
    return (json.opportunitiesData || []).slice(0, 10).map((opp) => ({
      title: opp.title || 'Untitled Opportunity',
      agency:
        (opp.organizationHierarchy || [])[0]?.name ||
        opp.subtierName ||
        opp.organizationName ||
        'Federal Agency',
      due_date: opp.responseDeadLine
        ? opp.responseDeadLine.split(' ')[0]
        : opp.archiveDate || null,
      location:
        [
          opp.placeOfPerformance?.city?.name,
          opp.placeOfPerformance?.state?.name,
        ]
          .filter(Boolean)
          .join(', ') || 'Varies',
      url: `https://sam.gov/opp/${opp.noticeId}/view`,
      source: 'SAM.gov (Federal)',
      posted: opp.postedDate ? opp.postedDate.split(' ')[0] : null,
      type: opp.type || 'Solicitation',
      notice_id: opp.noticeId,
    }));
  } catch (e) {
    return [];
  }
}

/**
 * Search Utah Division of Purchasing public bid listings.
 * Scrapes the publicly accessible bid list page.
 */
async function searchUtahPurchasing(trade) {
  try {
    const keywords = getTradeKeywords(trade);

    const { status, body } = await fetchUrl('https://purchasing.utah.gov/bids/', {
      timeout: 10000,
    });

    if (status !== 200) return [];

    const bids = [];

    // Match bid listing entries: look for title + link patterns in the HTML
    const rowPattern =
      /<(?:tr|div|li)[^>]*>[\s\S]{0,500}?<a\s+[^>]*href="([^"]+)"[^>]*>([^<]{5,200})<\/a>[\s\S]{0,300}?<\/(?:tr|div|li)>/gi;
    const linkPattern =
      /<a\s+[^>]*href="([^"]+(?:solicitation|bid|rfp|itb|event)[^"]*)"[^>]*>([^<]{5,150})<\/a>/gi;

    let m;
    while ((m = linkPattern.exec(body)) !== null && bids.length < 8) {
      const url = m[1];
      const title = m[2].trim().replace(/\s+/g, ' ');
      const titleLow = title.toLowerCase();

      const isRelevant =
        keywords.some((kw) => titleLow.includes(kw.toLowerCase())) ||
        /\b(pipe|utility|construction|infrastructure|water|sewer|storm|road|civil|grade|excavat)\b/i.test(
          title
        );

      if (isRelevant) {
        bids.push({
          title,
          agency: 'State of Utah',
          due_date: null,
          location: 'Utah',
          url: url.startsWith('http') ? url : `https://purchasing.utah.gov${url}`,
          source: 'Utah Division of Purchasing',
          posted: null,
          type: 'State Solicitation',
        });
      }
    }

    return bids;
  } catch (e) {
    return [];
  }
}

/**
 * Main function: runs all web bid searches in parallel and returns combined results.
 */
async function findWebBids(trade, location, samApiKey) {
  const samKey = samApiKey || process.env.SAM_GOV_API_KEY || null;
  const warnings = [];
  const hasSamKey = !!samKey && samKey !== 'DEMO_KEY';
  if (!hasSamKey) {
    warnings.push('SAM.gov source unavailable: set SAM_GOV_API_KEY to enable federal results.');
  }
  const [samResult, utahResult] = await Promise.allSettled([
    hasSamKey ? searchSAMGov(trade, samKey) : Promise.resolve([]),
    searchUtahPurchasing(trade),
  ]);

  return {
    sam_bids: samResult.status === 'fulfilled' ? samResult.value : [],
    utah_bids: utahResult.status === 'fulfilled' ? utahResult.value : [],
    warnings,
    trade: trade || null,
    location: location || null,
    searched_at: new Date().toISOString(),
  };
}

/** Vercel / Express API handler */
async function workFinderHandler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const body = req.body || {};
    const result = await findWebBids(body.trade || null, body.location || null, body.sam_api_key);
    res.status(200).json(result);
  } catch (err) {
    console.error('[work-finder]', err);
    res.status(500).json({ error: err.message || 'Work finder failed' });
  }
}

workFinderHandler.findWebBids = findWebBids;
workFinderHandler.searchSAMGov = searchSAMGov;
workFinderHandler.searchUtahPurchasing = searchUtahPurchasing;
workFinderHandler.getTradeKeywords = getTradeKeywords;

module.exports = workFinderHandler;
